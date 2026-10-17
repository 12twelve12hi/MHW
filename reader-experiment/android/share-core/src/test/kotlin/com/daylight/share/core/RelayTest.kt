package com.daylight.share.core

import org.junit.AfterClass
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong
import kotlin.io.path.createTempDirectory

/** Sender and receiver end to end through the mock ntfy relay, and interop with the JavaScript reference. */
@Suppress("UNCHECKED_CAST")
class RelayTest {
    companion object {
        private var relay: MockRelay? = null
        val url: String get() = relay!!.url

        @BeforeClass
        @JvmStatic
        fun up() {
            relay = MockRelay.start()
        }

        @AfterClass
        @JvmStatic
        fun down() {
            relay?.close()
        }
    }

    private class Inbox(pairing: Pairing, clock: () -> Long = System::currentTimeMillis, spool: Boolean = true) {
        val dir: File = createTempDirectory("dls-inbox").toFile()
        val received = CopyOnWriteArrayList<Pair<ItemHeader, ByteArray>>()
        val receiver = Receiver(
            pairing, FileReceiverStore(File(dir, "state.json")), Reassembler(if (spool) File(dir, "spool") else null),
            from = "Test Daylight", clock = clock,
        ) { done ->
            received += done.header to done.content.open().use { it.readBytes() }
            (done.content as? FileBody)?.file?.delete()
        }
    }

    private fun outbox(pairing: Pairing, clock: () -> Long = System::currentTimeMillis, chunk: Int = Limits.CHUNK) =
        Outbox(pairing, FileOutboxStore(createTempDirectory("dls-outbox").toFile()), from = "JVM test", app = "jvm/test", clock = clock, chunkSize = chunk)

    private fun pairing() = Pairing(Bytes.random(16), url, "Test Daylight")

    @Test
    fun urlRoundTripWithAck() {
        val p = pairing()
        val out = outbox(p)
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/a", title = "A title"), null)
        assertEquals(Status.SENDING, row.status)
        assertEquals(Status.SENT, out.publish(row.id)!!.status)
        assertEquals(0, out.checkAcks())

        val inbox = Inbox(p)
        val r = inbox.receiver.pollOnce()
        assertEquals(listOf(row.id), r.items.map { it.id })
        assertEquals(listOf(row.id), r.ackIds)
        val h = inbox.received.single().first
        assertEquals("https://example.com/a", h.url)
        assertEquals("A title", h.title)
        assertEquals("JVM test", h.from)
        assertEquals("jvm/test", h.app)

        assertEquals(1, out.checkAcks())
        val delivered = out.row(row.id)!!
        assertEquals(Status.DELIVERED, delivered.status)
        assertEquals("Test Daylight", delivered.deliveredBy)

        // A second poll finds nothing new and does not ack again (the message was handled).
        val again = inbox.receiver.pollOnce()
        assertTrue(again.items.isEmpty())
        assertTrue(again.ackIds.isEmpty())
    }

    @Test
    fun largeFileAsAttachmentsInParts() {
        val p = pairing()
        val out = outbox(p, chunk = 5000)
        val bytes = Bytes.random(23_456) // incompressible: identity, 5 parts, each an attachment
        val tmp = File.createTempFile("dls", ".pdf").apply { writeBytes(bytes) }
        val row = out.add(OutgoingItem(Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper"), FileBody(tmp), moveContent = true)
        assertTrue(row.attachment)
        assertTrue("content moved into the outbox", !tmp.exists())
        assertEquals(Status.SENT, out.publish(row.id)!!.status)

        val inbox = Inbox(p)
        val r = inbox.receiver.pollOnce()
        assertEquals(listOf(row.id), r.items.map { it.id })
        val (h, content) = inbox.received.single()
        assertArrayEquals(bytes, content)
        assertEquals("paper.pdf", h.name)
        assertEquals("application/pdf", h.mime)
        assertEquals(1, out.checkAcks())
        assertEquals(Status.DELIVERED, out.row(row.id)!!.status)
    }

    @Test
    fun pageAndTextAreCompressed() {
        val p = pairing()
        val out = outbox(p)
        val html = "<html><body>" + "<p>Hello, Daylight. ünïcödé “quotes”.</p>".repeat(3000) + "</body></html>"
        val page = out.add(OutgoingItem(Kind.PAGE, url = "https://example.com/page", title = "Page"), BytesBody(Bytes.utf8(html)))
        val md = out.add(OutgoingItem(Kind.FILE, name = "notes.md", mime = "text/markdown"), BytesBody(Bytes.utf8("# Notes\n\n" + "- item\n".repeat(500))))
        out.publish(page.id)
        out.publish(md.id)
        val inbox = Inbox(p)
        inbox.receiver.pollOnce()
        val byId = inbox.received.associate { it.first.id to it }
        assertEquals(ItemHeader.ENC_DEFLATE_RAW, byId.getValue(page.id).first.enc)
        assertEquals(html, String(byId.getValue(page.id).second, Charsets.UTF_8))
        assertEquals("text/html", byId.getValue(page.id).first.mime)
        assertEquals(ItemHeader.ENC_DEFLATE_RAW, byId.getValue(md.id).first.enc)
        assertEquals(2, out.checkAcks())
    }

    @Test
    fun resendIsDeduplicatedAndAckedAgain() {
        val p = pairing()
        val now = AtomicLong(System.currentTimeMillis())
        val out = outbox(p, clock = { now.get() })
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/dup"), null)
        out.publish(row.id)
        val inbox = Inbox(p, clock = { now.get() })
        assertEquals(1, inbox.receiver.pollOnce().items.size)

        // The sender missed the ack (never checked) and re-sends after 11 hours: same id, new nonces.
        now.addAndGet(Limits.RESEND_MESSAGE_MS - 60_000)
        assertTrue(out.resendDue().isEmpty())
        now.addAndGet(120_000)
        assertEquals(listOf(row.id), out.resendDue().map { it.id })
        val second = inbox.receiver.pollOnce()
        assertTrue("dedupe by item id", second.items.isEmpty())
        assertEquals(listOf(row.id), second.ackIds)
        assertEquals(1, inbox.received.size)
        assertEquals(1, out.checkAcks())
    }

    @Test
    fun attachmentsResendAfter150MinutesAndExpireAfter7Days() {
        val p = pairing()
        val now = AtomicLong(System.currentTimeMillis())
        val out = outbox(p, clock = { now.get() }, chunk = 4000)
        val row = out.add(OutgoingItem(Kind.FILE, name = "a.bin", mime = "application/octet-stream"), BytesBody(Bytes.random(6000)))
        assertTrue(row.attachment)
        assertEquals(1, out.resendDue().size) // never published -> published now
        now.addAndGet(Limits.RESEND_ATTACHMENT_MS - 1000)
        assertTrue(out.resendDue().isEmpty())
        now.addAndGet(2000)
        assertEquals(1, out.resendDue().size)
        now.addAndGet(Limits.OUTBOX_EXPIRY_MS)
        assertTrue(out.resendDue().isEmpty())
        assertEquals(Status.EXPIRED, out.row(row.id)!!.status)
        // "Try again" brings it back for another week.
        assertEquals(Status.SENT, out.retry(row.id)!!.status)
    }

    @Test
    fun failedPublishIsRetriedWithBackoff() {
        val p = Pairing(Bytes.random(16), "http://127.0.0.1:9", "nowhere")
        val now = AtomicLong(System.currentTimeMillis())
        val out = Outbox(p, FileOutboxStore(createTempDirectory("dls-outbox").toFile()), RelayClient(p.relay, sleeper = {}), clock = { now.get() })
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/x"), null)
        val failed = out.publish(row.id)!!
        assertEquals(Status.FAILED, failed.status)
        assertTrue(failed.error.isNotEmpty())
        assertTrue(out.resendDue().isEmpty()) // backoff: 2 minutes after the first failure
        now.addAndGet(121_000)
        assertEquals(1, out.resendDue().size)
    }

    @Test
    fun anItemThatCannotBeStoredIsNotAckedAndComesBack() {
        val p = pairing()
        val out = outbox(p)
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/disk-full"), null)
        out.publish(row.id)
        var full = true
        val got = ArrayList<String>()
        val dir = createTempDirectory("dls-full").toFile()
        val receiver = Receiver(p, FileReceiverStore(File(dir, "state.json")), Reassembler(), from = "T") { done ->
            if (full) throw java.io.IOException("disk full")
            got += done.header.id
        }
        val first = receiver.pollOnce()
        assertTrue(first.items.isEmpty())
        assertTrue(first.ackIds.isEmpty())
        assertEquals(0, out.checkAcks())
        full = false
        assertEquals(listOf(row.id), receiver.pollOnce().items.map { it.id })
        assertEquals(listOf(row.id), got)
        assertEquals(1, out.checkAcks())
    }

    @Test
    fun junkOnTheTopicIsIgnored() {
        val p = pairing()
        val http = UrlConnectionHttp()
        val topic = p.keys.inboxTopic
        http.send("POST", "$url/$topic", body = Bytes.utf8("hello, not a frame"))
        http.send("POST", "$url/$topic", body = Bytes.utf8(Bytes.toBase64(Bytes.utf8("DLS1 but not really a frame at all......"))))
        http.send("PUT", "$url/$topic", mapOf("Filename" to "x.bin"), Bytes.random(5000))
        // A frame for another pairing, and a valid frame with a bad header.
        val other = Pairing(Bytes.random(16), url)
        RelayClient(url).publish(topic, FrameCodec.encrypt(other.keys, Purpose.INBOX, mapOf("v" to 1, "id" to "00".repeat(16), "kind" to "url", "url" to "https://e.com", "sent" to "")))
        RelayClient(url).publish(topic, FrameCodec.encrypt(p.keys, Purpose.INBOX, mapOf("v" to 1, "id" to "00".repeat(16), "kind" to "url", "url" to "javascript:alert(1)", "sent" to "")))
        val out = outbox(p)
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/real"), null)
        out.publish(row.id)
        val inbox = Inbox(p)
        val r = inbox.receiver.pollOnce()
        assertEquals(listOf(row.id), r.items.map { it.id })
    }

    @Test
    fun partsArrivingAcrossPollsHoldTheCursor() {
        val p = pairing()
        val keys = p.keys
        val inbox = Inbox(p)
        val (prepared, frames) = ItemBuilder.buildFrames(keys, OutgoingItem(Kind.FILE, name = "x.bin", mime = "application/octet-stream"), Bytes.random(9000), chunkSize = 3000)
        assertEquals(3, frames.size)
        val client = RelayClient(url)
        client.publish(keys.inboxTopic, frames[0])
        client.publish(keys.inboxTopic, frames[1])
        assertTrue(inbox.receiver.pollOnce().items.isEmpty())
        val since = inbox.receiver.since()
        client.publish(keys.inboxTopic, frames[2])
        val r = inbox.receiver.pollOnce()
        assertEquals(listOf(prepared.header.id), r.items.map { it.id })
        assertTrue(since != "all")
    }

    @Test
    fun liveStreamDeliversWhileOpen() {
        val p = pairing()
        val inbox = Inbox(p, spool = false)
        val stream = inbox.receiver.relay.openStream(p.keys.inboxTopic, "all")
        val got = CopyOnWriteArrayList<String>()
        val t = Thread {
            while (true) {
                val m = stream.next() ?: break
                val r = inbox.receiver.handleLive(listOf(m))
                got += r.items.map { it.id }
                if (r.ackIds.isNotEmpty()) inbox.receiver.publishAcks(r.ackIds)
            }
        }.apply { start() }
        val out = outbox(p)
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/live"), null)
        out.publish(row.id)
        val deadline = System.currentTimeMillis() + 10_000
        while (got.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(50)
        stream.close()
        t.join(5000)
        assertEquals(listOf(row.id), got)
        assertEquals(1, out.checkAcks())
    }

    @Test
    fun javascriptSenderToKotlinReceiver() {
        val p = pairing()
        val pdf = Bytes.random(10_000)
        val row = MockRelay.js("send", url, p.compactCode,
            Json.write(mapOf("kind" to "file", "name" to "js.pdf", "mime" to "application/pdf", "title" to "From JS", "contentHex" to Bytes.toHex(pdf)))) as Map<String, Any?>
        assertEquals("sent", row["status"])
        val page = MockRelay.js("send", url, p.compactCode,
            Json.write(mapOf("kind" to "page", "url" to "https://example.com/js", "title" to "JS page", "content" to "<p>hi from js</p>".repeat(400)))) as Map<String, Any?>
        val inbox = Inbox(p)
        val r = inbox.receiver.pollOnce()
        assertEquals(setOf(row["id"], page["id"]), r.items.map { it.id }.toSet())
        val byId = inbox.received.associate { it.first.id to it }
        assertArrayEquals(pdf, byId.getValue(row["id"] as String).second)
        assertEquals("<p>hi from js</p>".repeat(400), String(byId.getValue(page["id"] as String).second, Charsets.UTF_8))
        // The JS sender sees the Kotlin receiver's ack.
        val acks = MockRelay.js("acks", url, p.compactCode, row["id"] as String) as Map<String, Any?>
        assertEquals("delivered", acks["status"])
    }

    @Test
    fun kotlinSenderToJavascriptReceiver() {
        val p = pairing()
        val out = outbox(p, chunk = 6000)
        val bytes = Bytes.random(14_000)
        val file = out.add(OutgoingItem(Kind.FILE, name = "kt.pdf", mime = "application/pdf", title = "From Kotlin"), BytesBody(bytes))
        val page = out.add(OutgoingItem(Kind.PAGE, url = "https://example.com/kt", title = "Kotlin page"), BytesBody(Bytes.utf8("<h1>kt</h1>".repeat(1000))))
        val link = out.add(OutgoingItem(Kind.URL, url = "https://example.com/kt-link", title = "Kotlin link"), null)
        out.tick()
        val res = MockRelay.js("receive", url, p.compactCode) as Map<String, Any?>
        val items = (res["items"] as List<Any?>).map { it as Map<String, Any?> }
        val byId = items.associateBy { (it["header"] as Map<String, Any?>)["id"] as String }
        assertEquals(setOf(file.id, page.id, link.id), byId.keys)
        assertEquals(Bytes.toHex(bytes), byId.getValue(file.id)["contentHex"])
        assertEquals("kt.pdf", (byId.getValue(file.id)["header"] as Map<String, Any?>)["name"])
        assertEquals(Bytes.toHex(Bytes.utf8("<h1>kt</h1>".repeat(1000))), byId.getValue(page.id)["contentHex"])
        assertEquals(3, out.checkAcks())
        assertNull(out.rows().firstOrNull { it.status != Status.DELIVERED })
        assertEquals("JS Daylight", out.row(link.id)!!.deliveredBy)
    }

    @Test
    fun relayRetriesOn429() {
        val calls = AtomicLong()
        val http = object : Http {
            override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response =
                if (calls.incrementAndGet() < 3) Http.Response(429, mapOf("Retry-After" to "1"), ByteArray(0))
                else Http.Response(200, emptyMap(), Bytes.utf8("{\"id\":\"abc\",\"time\":5}"))
            override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = error("unused")
        }
        val slept = CopyOnWriteArrayList<Long>()
        val r = RelayClient("https://ntfy.sh", http) { slept += it }.publish("dls-x", ByteArray(100))
        assertEquals("abc", r.id)
        assertEquals(listOf(1000L, 1000L), slept)
        val tooLarge = object : Http {
            override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int) =
                Http.Response(413, emptyMap(), ByteArray(0))
            override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = error("unused")
        }
        val e = runCatching { RelayClient("https://ntfy.sh", tooLarge) {}.publish("dls-x", ByteArray(100)) }.exceptionOrNull()
        assertNotNull(e)
        assertEquals("too-large", (e as ShareException).code)
    }
}
