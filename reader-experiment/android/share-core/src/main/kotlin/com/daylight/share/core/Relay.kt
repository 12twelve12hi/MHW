package com.daylight.share.core

import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.util.Locale

/** The HTTP the relay client needs. [UrlConnectionHttp] is the default; tests or the Reader may plug in another. */
interface Http {
    class Response(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
        val ok: Boolean get() = status in 200..299
        fun header(name: String): String? = headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
    }

    /** A response read line by line (ntfy's JSON stream). [close] may be called from another thread to stop it. */
    interface LineStream : Closeable {
        val status: Int
        fun readLine(): String?
    }

    /** A 2xx answer longer than the caller's `maxResponseBytes` (checked against Content-Length, then while reading). */
    class TooLargeException(message: String) : IOException(message)

    /**
     * One request. Throws [TooLargeException] for a 2xx answer over [maxResponseBytes], and [IOException] when there is
     * no complete answer (no connection, a timeout, a reset while reading).
     */
    fun send(method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null, maxResponseBytes: Long = 1L shl 20, readTimeoutMs: Int = 60_000): Response

    fun stream(url: String, headers: Map<String, String> = emptyMap(), readTimeoutMs: Int = 100_000): LineStream
}

/** [Http] over `java.net.HttpURLConnection` (on Android that is OkHttp underneath). */
open class UrlConnectionHttp(private val userAgent: String = "DaylightShare/1") : Http {
    var connectTimeoutMs = 15_000

    protected open fun open(url: String): HttpURLConnection = URI(url).toURL().openConnection() as HttpURLConnection

    override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
        val c = open(url)
        try {
            c.requestMethod = method
            c.connectTimeout = connectTimeoutMs
            c.readTimeout = readTimeoutMs
            c.instanceFollowRedirects = true
            c.useCaches = false
            c.setRequestProperty("User-Agent", userAgent)
            for ((k, v) in headers) c.setRequestProperty(k, v)
            if (body != null) {
                c.doOutput = true
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
            }
            val status = c.responseCode
            val bytes = if (status in 200..299) {
                // An answer longer than the caller takes is refused before it is read when its length is known.
                val declared = c.contentLengthLong
                if (declared > maxResponseBytes) throw Http.TooLargeException("response of $declared bytes (at most $maxResponseBytes)")
                val read = c.inputStream?.use { readCapped(it, maxResponseBytes) } ?: ByteArray(0)
                // A connection closed mid-body can end the stream early without an error: that is no answer.
                if (declared >= 0 && read.size.toLong() != declared) throw IOException("connection closed after ${read.size} of $declared bytes")
                read
            } else {
                // Error bodies are only ever logged: keep the first 64 KiB.
                (c.errorStream ?: runCatching { c.inputStream }.getOrNull())?.use { readCapped(it, minOf(maxResponseBytes, 65_536L), truncate = true) } ?: ByteArray(0)
            }
            val hs = LinkedHashMap<String, String>()
            for ((k, v) in c.headerFields) if (k != null && v != null && v.isNotEmpty()) hs[k] = v.first()
            return Http.Response(status, hs, bytes)
        } finally {
            c.disconnect()
        }
    }

    override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream {
        val c = open(url)
        c.requestMethod = "GET"
        c.connectTimeout = connectTimeoutMs
        c.readTimeout = readTimeoutMs
        c.useCaches = false
        c.setRequestProperty("User-Agent", userAgent)
        for ((k, v) in headers) c.setRequestProperty(k, v)
        val status = try {
            c.responseCode
        } catch (e: IOException) {
            c.disconnect()
            throw e
        }
        val reader: BufferedReader? = if (status in 200..299) BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)) else null
        return object : Http.LineStream {
            @Volatile private var closed = false
            override val status: Int = status
            override fun readLine(): String? {
                if (closed || reader == null) return null
                return try {
                    reader.readLine()
                } catch (e: IOException) {
                    if (closed) null else throw e
                }
            }

            override fun close() {
                if (closed) return
                closed = true
                runCatching { c.disconnect() }
                runCatching { reader?.close() }
            }
        }
    }

    companion object {
        /** Reads at most [max] bytes: past it, throws [Http.TooLargeException] (or, with [truncate], stops there). */
        fun readCapped(input: InputStream, max: Long, truncate: Boolean = false): ByteArray {
            val out = ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (total + n > max) {
                    if (truncate) {
                        out.write(buf, 0, (max - total).toInt())
                        break
                    }
                    throw Http.TooLargeException("response larger than $max bytes")
                }
                total += n
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
    }
}

/**
 * Thrown by [RelayClient]: [code] is "network" (no answer, a timeout, 408, 5xx, or 429), "full" (413) or "refused" (any
 * other 4xx) for a publish, and "network" or "relay" for a poll; [status] is the HTTP status, 0 for network failures.
 */
class RelayException(code: String, message: String, status: Int = 0, cause: Throwable? = null) :
    ShareException(code, message, cause = cause, status = status)

/** What became of one ntfy message in a poll or the live stream (PROTOCOL 3.2; CHANGES-v1.1 2.6 "download"). */
enum class Outcome {
    /** [RelayMessage.frame] holds the frame. */
    FRAME,
    /** Not downloaded: the caller's skip rule said it was handled. */
    SKIPPED,
    /** The attachment answered 404 or 410: handled, never asked for again. */
    EXPIRED,
    /** Not base64, an attachment URL that is neither https nor the relay's own origin, or over [Limits.MAX_ATTACHMENT]: handled. */
    JUNK,
    /** 429, 5xx, any other status, a network error, a timeout, a reset while reading: not handled; holds the cursor. */
    RETRY,
}

/**
 * One ntfy message from a poll or the live stream: its id, its `time` (relay seconds), what became of it, and, for an
 * attachment that was requested, the download's HTTP [status] (0 for none or no answer).
 */
class RelayMessage(
    val id: String,
    val time: Long,
    val frame: ByteArray?,
    val outcome: Outcome = if (frame != null) Outcome.FRAME else Outcome.JUNK,
    val attachment: Boolean = false,
    val status: Int = 0,
) {
    val skipped: Boolean get() = outcome == Outcome.SKIPPED
    val expired: Boolean get() = outcome == Outcome.EXPIRED
    val junk: Boolean get() = outcome == Outcome.JUNK
    val retry: Boolean get() = outcome == Outcome.RETRY

    override fun toString() = "RelayMessage($id, $time, $outcome)"
}

/**
 * ntfy transport (PROTOCOL 3.1 and 3.2). Blocking; call it off the main thread. [retryDelaysMs] are the waits before
 * the in-call retries of a publish after a network error, 408 or 5xx.
 */
class RelayClient(
    relay: String = Limits.DEFAULT_RELAY,
    private val http: Http = UrlConnectionHttp(),
    private val retryDelaysMs: List<Long> = listOf(1_000L, 2_000L, 4_000L),
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
) {
    val relay: String = Relay.normalize(relay)

    /** `scheme://host[:port]`: attachments are downloaded only from https URLs or from this origin. */
    val origin: String = Relay.origin(this.relay)

    class Published(val id: String?, val time: Long?, val attachment: Boolean)

    /** One attachment download's outcome (the download rule of PROTOCOL 3.2). */
    class Download(val outcome: Outcome, val frame: ByteArray? = null, val status: Int = 0)

    /**
     * Publishes one frame (PROTOCOL 3.1): POST base64 text when small, else PUT as an attachment. Throws
     * [RelayException] with code "network" (no answer, a timeout, 408 or 5xx after the in-call retries, or 429, never
     * retried here), "full" (413) or "refused" (any other 4xx), and the HTTP status (0 when there was no answer).
     */
    fun publish(topic: String, frame: ByteArray, retries: Int = retryDelaysMs.size): Published {
        val small = FrameCodec.isSmall(frame.size.toLong())
        val headers = LinkedHashMap<String, String>()
        val body: ByteArray
        if (small) {
            headers["Content-Type"] = "text/plain"
            body = Bytes.utf8(Bytes.toBase64(frame))
        } else {
            headers["Content-Type"] = "application/octet-stream"
            headers["Filename"] = "dls1.bin"
            headers["Message"] = "dls1"
            body = frame
        }
        headers["Firebase"] = "no"
        headers["Cache"] = "yes"
        var attempt = 0
        while (true) {
            val res = try {
                http.send(if (small) "POST" else "PUT", "$relay/$topic", headers, body, readTimeoutMs = if (small) 30_000 else 120_000)
            } catch (e: IOException) {
                if (attempt < retries) {
                    sleeper(retryDelaysMs.getOrElse(attempt) { 0L })
                    attempt++
                    continue
                }
                throw RelayException(ErrorCode.NETWORK, "network error: ${e.message ?: e.javaClass.simpleName}", 0, e)
            }
            if (res.ok) {
                val j = Bytes.fromUtf8Strict(res.body)?.let { Json.parseObjectOrNull(it.trim()) }
                return Published(j?.str("id"), j?.num("time")?.toLong(), !small)
            }
            val st = res.status
            if (st == 429) throw RelayException(ErrorCode.NETWORK, "HTTP 429", st)
            if (st == 413) throw RelayException(ErrorCode.FULL, "HTTP 413", st)
            if (st in 400..499 && st != 408) throw RelayException(ErrorCode.REFUSED, "HTTP $st", st)
            if (attempt < retries) {
                val ra = res.header("Retry-After")?.trim()?.toDoubleOrNull()
                sleeper(if (ra != null && ra > 0) (minOf(ra, 60.0) * 1000).toLong() else retryDelaysMs.getOrElse(attempt) { 0L })
                attempt++
                continue
            }
            throw RelayException(ErrorCode.NETWORK, "HTTP $st", st)
        }
    }

    /**
     * Polls the cached messages of [topic] since [since] ("all" or Unix seconds), reading at most
     * [Limits.MAX_POLL_RESPONSE]. Returns one entry per message line, in order; messages for which [skip] says true are
     * listed (for the cursor) but not downloaded; after a 429 every later attachment entry is [Outcome.RETRY] without a
     * request. Throws [RelayException] "network" (no answer) or "relay" (an error status, or an answer over the cap).
     */
    fun poll(topic: String, since: String = "all", skip: (String) -> Boolean = { false }): List<RelayMessage> {
        val res = try {
            http.send("GET", "$relay/$topic/json?poll=1&since=${URLEncoder.encode(since, "UTF-8")}", maxResponseBytes = Limits.MAX_POLL_RESPONSE)
        } catch (e: Http.TooLargeException) {
            throw RelayException("relay", "The relay’s answer is too long.", 200, e)
        } catch (e: IOException) {
            throw RelayException(ErrorCode.NETWORK, "Couldn’t reach the relay (${e.message ?: e.javaClass.simpleName}).", 0, e)
        }
        if (!res.ok) throw RelayException("relay", "The relay answered ${res.status}.", res.status)
        if (res.body.size > Limits.MAX_POLL_RESPONSE) throw RelayException("relay", "The relay’s answer is too long.", res.status)
        val out = ArrayList<RelayMessage>()
        var stopDownloads = false
        for (line in String(res.body, Charsets.UTF_8).split('\n')) {
            val m = parseLine(line, skip, stopDownloads) ?: continue
            out += m
            if (m.status == 429) stopDownloads = true
        }
        return out
    }

    /**
     * One line of ntfy's JSON output -> a message (downloading an attachment unless [skip] or [noDownloads]), or null
     * for other events and lines that are not JSON.
     */
    fun parseLine(line: String, skip: (String) -> Boolean = { false }, noDownloads: Boolean = false): RelayMessage? {
        if (line.isBlank()) return null
        val m = Json.parseObjectOrNull(line) ?: return null
        if (m["event"] != "message") return null
        val id = m["id"] as? String ?: return null
        val time = (m["time"] as? Double)?.takeIf { !it.isNaN() && !it.isInfinite() }?.toLong() ?: 0L
        val att = m["attachment"]
        val hasAttachment = jsTruthy(att)
        if (skip(id)) return RelayMessage(id, time, null, Outcome.SKIPPED, hasAttachment)
        if (hasAttachment) {
            val url = (att as? Map<*, *>)?.get("url") as? String ?: return RelayMessage(id, time, null, Outcome.JUNK, true)
            if (noDownloads) return RelayMessage(id, time, null, Outcome.RETRY, true)
            val d = download(url)
            return RelayMessage(id, time, d.frame, d.outcome, true, d.status)
        }
        val text = m["message"] as? String ?: return RelayMessage(id, time, null, Outcome.JUNK)
        val frame = Bytes.fromBase64OrNull(text) ?: return RelayMessage(id, time, null, Outcome.JUNK)
        return RelayMessage(id, time, frame, Outcome.FRAME)
    }

    /** Whether [url] may be downloaded: https (any host), or the relay's own origin (scheme, host, port). */
    fun allowed(url: String): Boolean {
        val u = try {
            URI(url)
        } catch (e: Exception) {
            return false
        }
        val scheme = u.scheme?.lowercase(Locale.ROOT) ?: return false
        if (scheme == "https") return u.host != null || u.rawAuthority != null
        if (scheme != "http") return false
        val host = u.host?.lowercase(Locale.ROOT) ?: return false
        val port = if (u.port == -1 || u.port == 80) "" else ":${u.port}"
        val hostPart = if (':' in host && !host.startsWith("[")) "[$host]" else host
        return "http://$hostPart$port" == origin
    }

    /**
     * Downloads one attachment under the download rule (PROTOCOL 3.2): a URL that is not allowed, or an answer over
     * [Limits.MAX_ATTACHMENT], is junk; 2xx is the frame; 404 and 410 are expired; anything else, and every failure to
     * get a whole answer, is retry.
     */
    fun download(url: String): Download {
        if (!allowed(url)) return Download(Outcome.JUNK)
        return try {
            val r = http.send("GET", url, maxResponseBytes = Limits.MAX_ATTACHMENT, readTimeoutMs = 120_000)
            when {
                r.ok && r.body.size > Limits.MAX_ATTACHMENT -> Download(Outcome.JUNK, status = r.status)
                r.ok -> Download(Outcome.FRAME, r.body, r.status)
                r.status == 404 || r.status == 410 -> Download(Outcome.EXPIRED, status = r.status)
                else -> Download(Outcome.RETRY, status = r.status)
            }
        } catch (e: Http.TooLargeException) {
            Download(Outcome.JUNK)
        } catch (e: IOException) {
            Download(Outcome.RETRY)
        } catch (e: RuntimeException) {
            // A malformed URL the HTTP stack refuses (IllegalArgumentException and the like): nothing to download.
            Download(Outcome.JUNK)
        }
    }

    /**
     * Opens the live stream (`/json` without poll). [LiveStream.next] blocks for the next message (keepalives are
     * skipped; each message is classified like a poll's) and returns null when the connection ends; [LiveStream.close]
     * stops it from any thread.
     */
    fun openStream(topic: String, since: String, skip: (String) -> Boolean = { false }): LiveStream {
        val s = try {
            http.stream("$relay/$topic/json?since=${URLEncoder.encode(since, "UTF-8")}")
        } catch (e: IOException) {
            throw RelayException(ErrorCode.NETWORK, "Couldn’t reach the relay (${e.message ?: e.javaClass.simpleName}).", 0, e)
        }
        if (s.status !in 200..299) {
            s.close()
            throw RelayException("relay", "The relay answered ${s.status}.", s.status)
        }
        return LiveStream(s, skip)
    }

    inner class LiveStream internal constructor(private val lines: Http.LineStream, private val skip: (String) -> Boolean) : Closeable {
        fun next(): RelayMessage? {
            while (true) {
                val line = try {
                    lines.readLine()
                } catch (e: IOException) {
                    return null
                } ?: return null
                parseLine(line, skip)?.let { return it }
            }
        }

        override fun close() = lines.close()
    }

    companion object {
        /** Attachment downloads: v1.0 senders' 12 MiB chunks + 128 KiB (a literal, not derived from [Limits.CHUNK]). */
        const val MAX_ATTACHMENT = Limits.MAX_ATTACHMENT

        /** JavaScript truthiness of a parsed JSON value. */
        internal fun jsTruthy(v: Any?): Boolean = when (v) {
            null, false -> false
            is Double -> v != 0.0 && !v.isNaN()
            is String -> v.isNotEmpty()
            else -> true
        }

        /**
         * The cursor after a poll (PROTOCOL 3.2): `max(0, min(newest, held) - 1800)`; a numeric cursor never moves
         * backwards when nothing is held. [held] is null when nothing is held.
         */
        fun nextCursor(since: String, newest: Long, held: Long?): String {
            val c = maxOf(0L, minOf(newest, held ?: Long.MAX_VALUE) - Limits.CURSOR_OVERLAP_S)
            val prev = since.toLongOrNull()
            return if (held == null && prev != null && prev > c) prev.toString() else c.toString()
        }
    }
}
