package com.daylight.share.core

import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

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

    fun send(method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null, maxResponseBytes: Long = 1L shl 20, readTimeoutMs: Int = 60_000): Response

    fun stream(url: String, headers: Map<String, String> = emptyMap(), readTimeoutMs: Int = 100_000): LineStream
}

/** [Http] over `java.net.HttpURLConnection` (on Android that is OkHttp underneath). */
open class UrlConnectionHttp(private val userAgent: String = "DaylightShare/1") : Http {
    var connectTimeoutMs = 15_000

    protected open fun open(url: String): HttpURLConnection = URL(url).openConnection() as HttpURLConnection

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
            val stream: InputStream? = if (status >= 400) c.errorStream else c.inputStream
            val bytes = stream?.use { readCapped(it, maxResponseBytes) } ?: ByteArray(0)
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
        fun readCapped(input: InputStream, max: Long): ByteArray {
            val out = ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > max) throw IOException("response larger than $max bytes")
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
    }
}

/** Thrown for relay answers the caller should report: [status] is the HTTP status, 0 for network failures. */
class RelayException(code: String, message: String, val status: Int = 0, cause: Throwable? = null) :
    ShareException(code, message, cause = cause)

/** One ntfy message from a poll or the live stream. [frame] is null when it is unusable (expired, not base64, ...). */
class RelayMessage(val id: String, val time: Long, val frame: ByteArray?, val skipped: Boolean = false)

/** ntfy transport (PROTOCOL 3.1 and 3.2). Blocking; call it off the main thread. */
class RelayClient(
    relay: String = Limits.DEFAULT_RELAY,
    private val http: Http = UrlConnectionHttp(),
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
) {
    val relay: String = Relay.normalize(relay)

    class Published(val id: String?, val time: Long?, val attachment: Boolean)

    /** Publishes one frame: POST base64 text when small, else PUT as an attachment. Throws [RelayException]. */
    fun publish(topic: String, frame: ByteArray, retries: Int = 3): Published {
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
                if (attempt >= retries) throw RelayException("network", "Couldn’t reach the relay (${e.message ?: e.javaClass.simpleName}).", 0, e)
                sleeper(1000L shl attempt)
                attempt++
                continue
            }
            if (res.ok) {
                val j = Bytes.fromUtf8Strict(res.body)?.let { Json.parseObjectOrNull(it.trim()) }
                return Published(j?.str("id"), j?.num("time")?.toLong(), !small)
            }
            if (res.status == 413) throw RelayException("too-large", "The relay refused the file as too large.", 413)
            if ((res.status == 429 || res.status >= 500) && attempt < retries) {
                val ra = res.header("Retry-After")?.trim()?.toDoubleOrNull()
                sleeper(if (ra != null && ra > 0) (minOf(ra, 60.0) * 1000).toLong() else 10_000L * (attempt + 1))
                attempt++
                continue
            }
            throw RelayException("relay", "The relay answered ${res.status}.", res.status)
        }
    }

    /**
     * Polls the cached messages of [topic] since [since] ("all" or Unix seconds). Messages for which [skip] says true
     * are listed (for the cursor) but not downloaded. Throws [RelayException] when the relay cannot be read.
     */
    fun poll(topic: String, since: String = "all", skip: (String) -> Boolean = { false }): List<RelayMessage> {
        val res = try {
            http.send("GET", "$relay/$topic/json?poll=1&since=${URLEncoder.encode(since, "UTF-8")}", maxResponseBytes = 64L shl 20)
        } catch (e: IOException) {
            throw RelayException("network", "Couldn’t reach the relay (${e.message ?: e.javaClass.simpleName}).", 0, e)
        }
        if (!res.ok) throw RelayException("relay", "The relay answered ${res.status}.", res.status)
        val text = String(res.body, Charsets.UTF_8)
        return text.split('\n').mapNotNull { line -> parseLine(line, skip) }
    }

    /** One line of ntfy's JSON output -> a message (downloading an attachment), or null for other events and junk. */
    fun parseLine(line: String, skip: (String) -> Boolean = { false }): RelayMessage? {
        if (line.isBlank()) return null
        val m = Json.parseObjectOrNull(line) ?: return null
        if (m["event"] != "message") return null
        val id = m["id"] as? String ?: return null
        val time = (m["time"] as? Double)?.toLong() ?: 0L
        if (skip(id)) return RelayMessage(id, time, null, skipped = true)
        @Suppress("UNCHECKED_CAST")
        val attachment = m["attachment"] as? Map<String, Any?>
        val attUrl = attachment?.get("url") as? String
        val frame = when {
            attachment != null && attUrl != null -> download(attUrl)
            m["message"] is String -> Bytes.fromBase64OrNull(m["message"] as String)
            else -> null
        }
        return RelayMessage(id, time, frame)
    }

    /** Downloads an attachment; null when it has expired or cannot be read (the sender re-sends). */
    fun download(url: String): ByteArray? {
        if (!url.startsWith("https://", ignoreCase = true) && !url.startsWith("http://", ignoreCase = true)) return null
        return try {
            val r = http.send("GET", url, maxResponseBytes = MAX_ATTACHMENT, readTimeoutMs = 120_000)
            if (r.ok) r.body else null
        } catch (e: IOException) {
            null
        }
    }

    /**
     * Opens the live stream (`/json` without poll). [LiveStream.next] blocks for the next message (keepalives are
     * skipped) and returns null when the connection ends; [LiveStream.close] stops it from any thread.
     */
    fun openStream(topic: String, since: String, skip: (String) -> Boolean = { false }): LiveStream {
        val s = try {
            http.stream("$relay/$topic/json?since=${URLEncoder.encode(since, "UTF-8")}")
        } catch (e: IOException) {
            throw RelayException("network", "Couldn’t reach the relay (${e.message ?: e.javaClass.simpleName}).", 0, e)
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
        /** A frame is at most one 12 MiB chunk plus header and overhead. */
        const val MAX_ATTACHMENT = Limits.CHUNK + 128L * 1024
    }
}
