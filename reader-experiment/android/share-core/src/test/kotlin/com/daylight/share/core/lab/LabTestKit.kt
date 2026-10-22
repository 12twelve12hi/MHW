package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.Http
import com.daylight.share.core.Json
import java.io.File
import java.io.IOException
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicInteger

/** The shared vectors, read once. */
@Suppress("UNCHECKED_CAST")
object Vectors {
    val lab: Map<String, Any?> by lazy {
        Json.parse(File(System.getProperty("dls.labVectors") ?: "../../share/vectors/lab-vectors.json").readText()) as Map<String, Any?>
    }
    /** share/vectors/normalise.json (W1 smart intake), next to lab-vectors.json. */
    val normalise: Map<String, Any?> by lazy {
        val lab = File(System.getProperty("dls.labVectors") ?: "../../share/vectors/lab-vectors.json")
        Json.parse(File(lab.absoluteFile.parentFile, "normalise.json").readText()) as Map<String, Any?>
    }
    val server: Map<String, Any?> by lazy {
        Json.parse(File(System.getProperty("dls.serverVectors") ?: "../../server/vectors/server-vectors.json").readText()) as Map<String, Any?>
    }

    /** A value as JSON reads it back (numbers as Double, maps compared by content). */
    fun norm(x: Any?): Any? = Json.parse(Json.write(x))
}

@Suppress("UNCHECKED_CAST")
fun Any?.obj(): Map<String, Any?> = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun Any?.objs(): List<Map<String, Any?>> = (this as List<Any?>).map { it as Map<String, Any?> }

fun Any?.long(): Long? = (this as? Double)?.toLong()

/**
 * An in-memory ntfy relay for unit tests: POST publishes a small frame (base64 text), GET `/json?poll=1` and the line
 * stream list a topic's messages since a cursor. [failPublish] answers a publish with a status instead (429, 413, …) or
 * -1 for no answer at all. Relay times come from [clock].
 */
class FakeRelayHttp(private val clock: () -> Long = System::currentTimeMillis) : Http {
    class Message(val id: String, val time: Long, val topic: String, val text: String)

    val messages = ArrayList<Message>()
    var failPublish: (topic: String) -> Int? = { null }
    var requests = 0
    private val ids = AtomicInteger()

    fun on(topic: String): List<Message> = synchronized(messages) { messages.filter { it.topic == topic } }

    /** Adds a message as another publisher would (no failure hooks). */
    fun inject(topic: String, frame: ByteArray, time: Long = clock() / 1000): Message = synchronized(messages) {
        Message("m" + ids.incrementAndGet(), time, topic, Bytes.toBase64(frame)).also { messages += it }
    }

    private fun topicOf(url: String): String = url.substringAfter("://").substringAfter('/').substringBefore('/').substringBefore('?')

    private fun pollLines(url: String): List<String> {
        val topic = topicOf(url)
        val since = url.substringAfter("since=", "all").substringBefore('&').let { URLDecoder.decode(it, "UTF-8") }
        val from = since.toLongOrNull() ?: Long.MIN_VALUE
        return on(topic).filter { it.time >= from }.map { m ->
            Json.write(linkedMapOf("id" to m.id, "time" to m.time, "event" to "message", "topic" to m.topic, "message" to m.text))
        }
    }

    override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
        requests++
        if (method == "GET" && url.contains("/json?")) {
            val text = pollLines(url).joinToString("") { it + "\n" }
            return Http.Response(200, emptyMap(), Bytes.utf8(text))
        }
        if (method == "POST" || method == "PUT") {
            val topic = topicOf(url)
            when (val st = failPublish(topic)) {
                null -> Unit
                -1 -> throw IOException("no answer")
                else -> return Http.Response(st, emptyMap(), Bytes.utf8("{\"code\":${st}01}"))
            }
            val text = String(body ?: ByteArray(0), Charsets.UTF_8)
            val m = synchronized(messages) { Message("m" + ids.incrementAndGet(), clock() / 1000, topic, text).also { messages += it } }
            return Http.Response(200, emptyMap(), Bytes.utf8(Json.write(linkedMapOf("id" to m.id, "time" to m.time, "event" to "message", "topic" to topic, "message" to text))))
        }
        return Http.Response(404, emptyMap(), ByteArray(0))
    }

    override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream {
        requests++
        val lines = ArrayDeque(pollLines(url))
        return object : Http.LineStream {
            override val status = 200
            override fun readLine(): String? = lines.removeFirstOrNull()
            override fun close() = Unit
        }
    }
}
