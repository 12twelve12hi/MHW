package com.daylight.share

import com.daylight.share.core.Bytes
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.Http
import com.daylight.share.core.Json
import com.daylight.share.core.Keys
import com.daylight.share.core.Purpose
import java.io.IOException
import java.net.URI
import java.net.URLDecoder

/**
 * An ntfy relay in memory, for the Lab tests (and the Daylight server's discovery, which reads its config topic from
 * the relay): small publishes (POST, base64 text), polls (`/<topic>/json?poll=1&since=…`, by id order and relay time in
 * seconds) and the JSON stream the server client reads. Whatever the host in the URL, every request lands here.
 * [offline] makes every request fail as a network error does; [hangMs] holds every request that long first (a relay
 * that never answers); [publishStatus] and [pollStatus] answer an error status instead.
 */
class FakeRelay(private val clock: () -> Long = System::currentTimeMillis) : Http {
    class Msg(val id: String, val topic: String, val time: Long, val text: String) {
        val frame: ByteArray? get() = Bytes.fromBase64OrNull(text)
    }

    private val msgs = ArrayList<Msg>()
    private var n = 0

    @Volatile var offline = false
    @Volatile var hangMs = 0L
    @Volatile var publishStatus = 200
    @Volatile var pollStatus = 200

    /** Every request, as "METHOD /path", in order. */
    val requests: MutableList<String> = java.util.Collections.synchronizedList(ArrayList())

    fun messages(topic: String): List<Msg> = synchronized(msgs) { msgs.filter { it.topic == topic } }

    /** The headers of the ack-topic frames on [topic] that open with [keys] (Lab frames and acks alike), in order. */
    fun ackHeaders(keys: Keys, topic: String = keys.ackTopic): List<Map<String, Any?>> =
        messages(topic).mapNotNull { m -> m.frame?.let { runCatching { FrameCodec.open(keys, Purpose.ACK, it).header }.getOrNull() } }

    /** Puts a frame on [topic] as a sender or an Inbox would publish it. */
    fun publish(topic: String, frame: ByteArray): Msg = add(topic, Bytes.toBase64(frame))

    private fun add(topic: String, text: String): Msg = synchronized(msgs) {
        Msg("m${++n}", topic, clock() / 1000, text).also { msgs += it }
    }

    private fun gate(method: String, url: String) {
        requests += "$method ${URI(url).rawPath}"
        if (hangMs > 0) Thread.sleep(hangMs)
        if (offline) throw IOException("offline (test relay)")
    }

    override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
        gate(method, url)
        val path = URI(url).rawPath.trimStart('/')
        if (method == "POST") {
            if (publishStatus != 200) return Http.Response(publishStatus, emptyMap(), ByteArray(0))
            val m = add(path, String(body ?: ByteArray(0), Charsets.UTF_8))
            return Http.Response(200, mapOf("Content-Type" to "application/json"), Bytes.utf8(Json.write(linkedMapOf("id" to m.id, "time" to m.time))))
        }
        if (method == "GET" && path.endsWith("/json")) {
            if (pollStatus != 200) return Http.Response(pollStatus, emptyMap(), ByteArray(0))
            return Http.Response(200, emptyMap(), Bytes.utf8(lines(path.removeSuffix("/json"), since(url)).joinToString("\n")))
        }
        return Http.Response(404, emptyMap(), ByteArray(0))
    }

    override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream {
        gate("GET", url)
        val path = URI(url).rawPath.trimStart('/')
        val out = if (pollStatus == 200) lines(path.removeSuffix("/json"), since(url)).toMutableList() else ArrayList()
        val code = pollStatus
        return object : Http.LineStream {
            override val status: Int = code
            override fun readLine(): String? = if (out.isEmpty()) null else out.removeAt(0)
            override fun close() = Unit
        }
    }

    private fun since(url: String): String {
        val q = URI(url).rawQuery ?: return "all"
        return q.split('&').firstOrNull { it.startsWith("since=") }?.substringAfter('=')?.let { URLDecoder.decode(it, "UTF-8") } ?: "all"
    }

    private fun lines(topic: String, since: String): List<String> {
        val from = since.toLongOrNull()
        return messages(topic).filter { from == null || it.time >= from }.map { m ->
            Json.write(linkedMapOf("id" to m.id, "time" to m.time, "event" to "message", "topic" to m.topic, "message" to m.text))
        }
    }
}
