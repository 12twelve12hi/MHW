package com.daylight.share.core

import org.junit.AfterClass
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.io.path.createTempDirectory

/**
 * Sender and receiver end to end through the mock ntfy relay (ntfy.sh's limits), the protocol 1.1 rules of
 * CHANGES-v1.1 2.4 and 2.6, and interop with the JavaScript reference both ways.
 */
@Suppress("UNCHECKED_CAST")
class RelayTest {
    companion object {
        private var relay: MockRelay? = null
        val url: String get() = relay!!.url

        @BeforeClass
        @JvmStatic
        fun up() {
            // The tests of this class upload more than ntfy.sh's 20 MB per visitor in all; the 413 tests use their own.
            relay = MockRelay.start("--visitor-total", "1000000000")
        }

        @AfterClass
        @JvmStatic
        fun down() {
            relay?.close()
        }

        private const val MIN = 60_000L
        private const val HOUR = 60 * MIN
        private const val DAY = 24 * HOUR
    }

    private fun tmp(prefix: String): File = createTempDirectory(prefix).toFile()

    private class Inbox(
        val pairing: Pairing,
        clock: () -> Long = System::currentTimeMillis,
        spool: Boolean = true,
        val dir: File = createTempDirectory("dls-inbox").toFile(),
        relay: RelayClient = RelayClient(pairing.relay, retryDelaysMs = listOf(0L, 0L, 0L)),
        val fail: () -> Boolean = { false },
    ) {
        val received = CopyOnWriteArrayList<Pair<ItemHeader, ByteArray>>()
        val receiver = Receiver(
            pairing, FileReceiverStore(File(dir, "state.json")), Reassembler(if (spool) File(dir, "spool") else null),
            relay, from = "Test Daylight", clock = clock,
        ) { done ->
            if (fail()) throw IOException("disk full")
            received += done.header to done.content.open().use { it.readBytes() }
            (done.content as? FileBody)?.file?.delete()
        }

        /** The same files, a new object (a restart). */
        fun restarted(clock: () -> Long = System::currentTimeMillis) = Inbox(pairing, clock, true, dir).also { it.received += received }

        fun state(): ReceiverState = FileReceiverStore(File(dir, "state.json")).load()
    }

    private fun outbox(
        pairing: Pairing,
        clock: () -> Long = System::currentTimeMillis,
        chunk: Int = Limits.CHUNK,
        dir: File = tmp("dls-outbox"),
    ) = Outbox(
        pairing, FileOutboxStore(dir), RelayClient(pairing.relay, retryDelaysMs = listOf(0L, 0L, 0L)),
        from = "JVM test", app = "jvm/test", clock = clock, chunkSize = chunk,
    )

    private fun pairing(relayUrl: String = url) = Pairing(Bytes.random(16), relayUrl, "Test Daylight")

    private fun pdf(n: Int) = OutgoingItem(Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper") to BytesBody(Bytes.random(n))

    private fun Outbox.addFile(n: Int): OutboxRow = pdf(n).let { (item, body) -> add(item, body) }

    // ------------------------------------------------------------------------------------------------ round trips

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
        assertNull(r.ackError)
        assertNull(r.storeError)
        val h = inbox.received.single().first
        assertEquals("https://example.com/a", h.url)
        assertEquals("A title", h.title)
        assertEquals("JVM test", h.from)
        assertEquals("jvm/test", h.app)

        assertEquals(1, out.checkAcks())
        val delivered = out.row(row.id)!!
        assertEquals(Status.DELIVERED, delivered.status)
        assertEquals("Test Daylight", delivered.deliveredBy)
        assertEquals(RowText("Delivered ✓", "Saved on your Daylight.", null), RowText.of(delivered))

        // A second poll finds nothing new and does not ack again (the message was handled; the digest is not due).
        val again = inbox.receiver.pollOnce()
        assertTrue(again.items.isEmpty())
        assertTrue(again.ackIds.isEmpty())
        assertTrue(again.digestIds.isEmpty())
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
    fun aFileOfFiveMegabytesGoesInThreePartsUnderTwoMegabytesEach() {
        val p = pairing()
        val out = outbox(p)
        val bytes = Bytes.random(5_000_000)
        val row = out.add(OutgoingItem(Kind.FILE, name = "big.pdf", mime = "application/pdf"), BytesBody(bytes))
        val prepared = PreparedItem(row.header, BytesBody(bytes))
        assertEquals(3, prepared.parts)
        for (i in 0 until 3) assertTrue(prepared.frameLength(i) <= RelayProbe.PROBE_BYTES)
        assertEquals(Status.SENT, out.publish(row.id)!!.status)
        val inbox = Inbox(p)
        assertEquals(listOf(row.id), inbox.receiver.pollOnce().items.map { it.id })
        assertArrayEquals(bytes, inbox.received.single().second)
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
    fun tooLargeIsRefusedBeforeAnythingIsReadOrStored() {
        val p = pairing()
        val dir = tmp("dls-outbox")
        val out = outbox(p, dir = dir)
        val huge = object : Body {
            override val length = Limits.MAX_ITEM + 1
            override fun open() = throw AssertionError("read")
            override fun read(offset: Long, len: Int) = throw AssertionError("read")
        }
        try {
            out.add(OutgoingItem(Kind.FILE, name = "huge.pdf", mime = "application/pdf"), huge)
            fail("accepted")
        } catch (e: ShareException) {
            assertEquals("too-large", e.code)
            assertEquals("Too big to send. Files can be up to 9 MB; this one is 9.1 MB.", e.message)
        }
        assertTrue(out.rows().isEmpty())
        assertTrue(File(dir, "content").listFiles().isNullOrEmpty())
    }

    // ------------------------------------------------------------------------------------------------ re-sends

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
        now.addAndGet(Limits.RESEND_MESSAGE_MS - MIN)
        assertTrue(out.resendDue().isEmpty())
        now.addAndGet(2 * MIN)
        assertEquals(listOf(row.id), out.resendDue().map { it.id })
        val second = inbox.receiver.pollOnce()
        assertTrue("dedupe by item id", second.items.isEmpty())
        assertEquals(listOf(row.id), second.ackIds)
        assertEquals(1, inbox.received.size)
        // The sighting refreshed the remembered id.
        assertEquals(now.get(), inbox.state().seenItems[row.id])
        assertEquals(1, out.checkAcks())
    }

    @Test
    fun attachmentsResendTwiceAt185MinutesThenEvery12Hours() {
        val p = pairing()
        val base = System.currentTimeMillis()
        val now = AtomicLong(base)
        val dir = tmp("dls-outbox")
        val out = outbox(p, clock = { now.get() }, chunk = 4000, dir = dir)
        val row = out.addFile(6000)
        assertTrue(row.attachment)
        assertTrue("a fresh row is not due", out.resendDue().isEmpty())
        assertEquals(Status.SENT, out.publish(row.id)!!.status)
        val publishes = arrayListOf(0L)
        for (min in 5L..3 * 24 * 60 step 5) {
            now.set(base + min * MIN)
            if (out.resendDue().isNotEmpty()) publishes += min
        }
        assertEquals(listOf(0L, 185, 370, 1090, 1810, 2530, 3250, 3970), publishes)

        // A week without an ack: expired, content kept; "Try again" sends it with the original `sent`.
        now.set(base + 7 * DAY + MIN)
        assertTrue(out.resendDue().isEmpty())
        val expired = out.row(row.id)!!
        assertEquals(Status.EXPIRED, expired.status)
        assertEquals("", expired.errorCode)
        assertEquals(RowText.TRY_AGAIN, RowText.of(expired, now.get()).action)
        assertTrue(File(dir, "content/${row.id}.enc").isFile)
        val again = out.retry(row.id)!!
        assertEquals(Status.SENT, again.status)
        assertEquals(now.get(), again.created)
        assertEquals(row.header.sent, again.header.sent)

        // 14 days after that share without an ack, the content goes; "Try again" then says it is gone.
        now.set(again.created + 7 * DAY + MIN)
        out.resendDue()
        assertEquals(Status.EXPIRED, out.row(row.id)!!.status)
        now.set(again.created + 14 * DAY + MIN)
        out.resendDue()
        assertFalse(File(dir, "content/${row.id}.enc").exists())
        val gone = out.retry(row.id)!!
        assertEquals(Status.EXPIRED, gone.status)
        assertEquals(ErrorCode.GONE, gone.errorCode)
        assertEquals("This is no longer stored on this device. Share it again.", RowText.of(gone, now.get()).sentence)
        assertNull(RowText.of(gone, now.get()).action)
    }

    @Test
    fun retryOnASentRowPublishesNothing() {
        val p = pairing()
        val out = outbox(p)
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/sent"), null)
        val sent = out.publish(row.id)!!
        assertEquals(Status.SENT, sent.status)
        assertEquals(sent, out.retry(row.id))
        assertEquals(sent, out.row(row.id))
        assertNull(RowText.of(sent).action)
    }

    @Test
    fun failedPublishIsRetriedWithBackoff() {
        val p = Pairing(Bytes.random(16), "http://127.0.0.1:9", "nowhere")
        val now = AtomicLong(System.currentTimeMillis())
        val out = Outbox(p, FileOutboxStore(tmp("dls-outbox")), RelayClient(p.relay) {}, clock = { now.get() })
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/x"), null)
        val failed = out.publish(row.id)!!
        assertEquals(Status.FAILED, failed.status)
        assertEquals(ErrorCode.NETWORK, failed.errorCode)
        assertEquals(1, failed.attempts)
        assertTrue(failed.error.isNotEmpty())
        assertEquals(RowText("Waiting to send", "Couldn’t send right now. It will try again by itself.", RowText.RETRY_NOW), RowText.of(failed))
        assertTrue(out.resendDue().isEmpty()) // backoff: 2 minutes after the first failure
        now.addAndGet(2 * MIN)
        assertEquals(2, out.resendDue().single().attempts)
        now.addAndGet(3 * MIN)
        assertTrue(out.resendDue().isEmpty()) // then 4 minutes
        now.addAndGet(MIN)
        assertEquals(3, out.resendDue().single().attempts)
        assertEquals(0, out.row(row.id)!!.slowFails)
    }

    @Test
    fun relayFullWaits185MinutesThenGivesUp() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val now = AtomicLong(System.currentTimeMillis())
            val out = outbox(p, clock = { now.get() }, chunk = 4000)
            val row = out.addFile(6000)
            m.control("fail-publish?count=3&status=413&topic=${p.keys.inboxTopic}")
            val first = out.publish(row.id)!!
            assertEquals(Status.FAILED, first.status)
            assertEquals(ErrorCode.FULL, first.errorCode)
            assertEquals(1, first.slowFails)
            assertEquals(
                RowText("Waiting to send", "A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.", null),
                RowText.of(first, now.get()),
            )
            now.addAndGet(Limits.ATTACHMENT_WAIT_MS - MIN)
            assertTrue("no re-upload within 185 minutes of a 413", out.resendDue().isEmpty())
            now.addAndGet(MIN)
            assertEquals(2, out.resendDue().single().slowFails)
            now.addAndGet(Limits.ATTACHMENT_WAIT_MS)
            val third = out.resendDue().single()
            assertEquals(Status.EXPIRED, third.status)
            assertEquals(ErrorCode.FULL, third.errorCode)
            assertEquals(RowText.TRY_AGAIN, RowText.of(third, now.get()).action)
            now.addAndGet(DAY)
            assertTrue("none at all after the third", out.resendDue().isEmpty())
            // "Try again" starts over, and the relay has room again.
            val again = out.retry(row.id)!!
            assertEquals(Status.SENT, again.status)
            assertEquals(0, again.slowFails)
            assertEquals(0, again.attempts)
            assertEquals("", again.errorCode)
        }
    }

    @Test
    fun aRealVisitorLimitIsFull() {
        MockRelay.start("--visitor-total", "3000000").use { m ->
            val p = pairing(m.url)
            val out = outbox(p)
            assertEquals(Status.SENT, out.publish(out.addFile(2_500_000).id)!!.status)
            val second = out.publish(out.addFile(1_000_000).id)!!
            assertEquals(Status.FAILED, second.status)
            assertEquals(ErrorCode.FULL, second.errorCode)
            assertTrue(second.error.contains("413"))
        }
    }

    @Test
    fun refusedIsRetriedSlowlyThenExpires() {
        MockRelay.start("--no-attachments").use { m ->
            val p = pairing(m.url)
            val now = AtomicLong(System.currentTimeMillis())
            val out = outbox(p, clock = { now.get() }, chunk = 4000)
            val file = out.publish(out.addFile(6000).id)!!
            assertEquals(Status.FAILED, file.status)
            assertEquals(ErrorCode.REFUSED, file.errorCode)
            assertEquals("The relay set on your Daylight turned this down. It will try again in about 3 hours.", RowText.of(file, now.get()).sentence)
            // A url item (a message, not an attachment) still goes.
            assertEquals(Status.SENT, out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/r"), null).id)!!.status)
            now.addAndGet(Limits.ATTACHMENT_WAIT_MS - MIN)
            assertTrue(out.resendDue().isEmpty())
            now.addAndGet(MIN)
            assertEquals(ErrorCode.REFUSED, out.resendDue().single().errorCode)
            now.addAndGet(Limits.ATTACHMENT_WAIT_MS)
            val last = out.resendDue().single()
            assertEquals(Status.EXPIRED, last.status)
            assertEquals(ErrorCode.REFUSED, last.errorCode)
            assertEquals(3, last.slowFails)
            assertEquals(
                RowText("Not delivered", "The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.", RowText.TRY_AGAIN),
                RowText.of(last, now.get()),
            )
        }
    }

    @Test
    fun passStopsAfter429AndSendsNoAttachmentAfter413() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val now = AtomicLong(System.currentTimeMillis())
            val out = outbox(p, clock = { now.get() }, chunk = 4000)
            val a = out.add(OutgoingItem(Kind.URL, url = "https://example.com/a"), null)
            now.addAndGet(1)
            val b = out.add(OutgoingItem(Kind.URL, url = "https://example.com/b"), null)
            now.addAndGet(Limits.SENDING_STALE_MS) // both are stale `sending` rows now: due
            m.control("fail-publish?count=1&status=429&topic=${p.keys.inboxTopic}")
            assertEquals(listOf(a.id), out.resendDue().map { it.id })
            assertEquals(ErrorCode.NETWORK, out.row(a.id)!!.errorCode)
            assertEquals(Status.SENDING, out.row(b.id)!!.status) // not attempted after the 429

            val p2 = pairing(m.url)
            val out2 = outbox(p2, clock = { now.get() }, chunk = 4000)
            val c = out2.addFile(6000)
            now.addAndGet(1)
            val d = out2.add(OutgoingItem(Kind.URL, url = "https://example.com/d"), null)
            now.addAndGet(1)
            val e = out2.addFile(6000)
            assertTrue(c.attachment && e.attachment && !d.attachment)
            now.addAndGet(Limits.SENDING_STALE_MS)
            m.control("fail-publish?count=1&status=413&topic=${p2.keys.inboxTopic}")
            assertEquals(listOf(c.id, d.id), out2.resendDue().map { it.id })
            assertEquals(ErrorCode.FULL, out2.row(c.id)!!.errorCode)
            assertEquals(Status.SENT, out2.row(d.id)!!.status) // a url item still goes
            assertEquals(Status.SENDING, out2.row(e.id)!!.status) // no attachment after the 413
        }
    }

    @Test
    fun aRowOver9MBFromVersion10EndsAsTooLarge() {
        val p = Pairing(Bytes.random(16), "http://127.0.0.1:9")
        val dir = tmp("dls-outbox")
        val store = FileOutboxStore(dir)
        val now = System.currentTimeMillis()
        val id = ItemHeader.newId()
        val header = ItemHeader(id, Kind.FILE, name = "big.pdf", mime = "application/pdf", size = 14_200_000, sha256 = "0".repeat(64), sent = Bytes.isoTime(now))
        store.save(listOf(OutboxRow(header, created = now - HOUR, status = Status.FAILED, attempts = 1, lastPublish = now - HOUR)), "all")
        store.contentDir.mkdirs()
        store.contentFile(id).writeBytes(ByteArray(10))
        val out = Outbox(p, store, RelayClient(p.relay) { fail("published") }, clock = { now })
        assertTrue(out.resendDue().isEmpty())
        val row = out.row(id)!!
        assertEquals(Status.EXPIRED, row.status)
        assertEquals(ErrorCode.TOO_LARGE, row.errorCode)
        assertFalse(store.contentFile(id).exists())
        assertEquals(RowText("Not delivered", "Too big to send. Files can be up to 9 MB; this one is 14.2 MB.", null), RowText.of(row, now))
    }

    @Test
    fun aVersion10AckAttachmentIsStillRead() {
        val p = pairing()
        val out = outbox(p)
        val row = out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/v10"), null).id)!!
        val ids = (0 until 149).map { ItemHeader.newId() } + row.id
        val frame = FrameCodec.encrypt(p.keys, Purpose.ACK, linkedMapOf("v" to 1, "kind" to "ack", "ids" to ids, "sent" to Bytes.isoTime(System.currentTimeMillis()), "from" to "Old Daylight"))
        assertFalse(FrameCodec.isSmall(frame.size.toLong()))
        assertTrue(RelayClient(url).publish(p.keys.ackTopic, frame).attachment)
        assertEquals(1, out.checkAcks())
        assertEquals("Old Daylight", out.row(row.id)!!.deliveredBy)
    }

    // ------------------------------------------------------------------------------------------------ receiving

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
        // Every one of them is handled: nothing is downloaded or decoded again.
        assertEquals(6, inbox.state().seenMsgs.size)
        assertTrue(inbox.receiver.pollOnce().items.isEmpty())
    }

    /** Publishes [frames] directly; returns the relay's answers (message ids and times). */
    private fun publishAll(relayUrl: String, topic: String, frames: List<ByteArray>): List<RelayClient.Published> {
        val c = RelayClient(relayUrl)
        return frames.map { c.publish(topic, it) }
    }

    @Test
    fun downloadFailureHoldsTheCursor() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val inbox = Inbox(p)
            val (prepared, frames) = ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "a.pdf", mime = "application/pdf"), Bytes.random(6000))
            val pub = publishAll(m.url, p.keys.inboxTopic, frames).single()
            assertTrue(pub.attachment)
            m.control("fail-downloads?count=1&status=503")
            val r1 = inbox.receiver.pollOnce()
            assertTrue(r1.items.isEmpty())
            assertTrue("held at the retry", inbox.receiver.since().toLong() <= pub.time!! - Limits.CURSOR_OVERLAP_S)
            assertFalse(inbox.receiver.handled(pub.id!!))
            assertEquals(listOf(prepared.header.id), inbox.receiver.pollOnce().items.map { it.id })

            // A 429 stops downloads for the rest of the poll: the next attachment is not even requested.
            val g = publishAll(m.url, p.keys.inboxTopic, ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "g.pdf", mime = "application/pdf"), Bytes.random(6000)).second).single()
            val h = publishAll(m.url, p.keys.inboxTopic, ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "h.pdf", mime = "application/pdf"), Bytes.random(6000)).second).single()
            m.control("fail-downloads?count=1&status=429")
            assertTrue(inbox.receiver.pollOnce().items.isEmpty())
            assertEquals(1, m.downloadsById()[g.id])
            assertNull("no request after the 429", m.downloadsById()[h.id])
            assertTrue(inbox.receiver.since().toLong() <= g.time!! - Limits.CURSOR_OVERLAP_S)
            assertEquals(2, inbox.receiver.pollOnce().items.size)

            // A connection reset mid-body is a retry too.
            val k = publishAll(m.url, p.keys.inboxTopic, ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "k.pdf", mime = "application/pdf"), Bytes.random(6000)).second).single()
            m.control("fail-downloads?count=1&status=reset")
            assertTrue(inbox.receiver.pollOnce().items.isEmpty())
            assertEquals(1, inbox.receiver.pollOnce().items.size)
            assertEquals(2, m.downloadsById()[k.id])
            assertEquals(4, inbox.received.size)
        }
    }

    @Test
    fun expiredAttachmentIsNotRequestedAgain() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val inbox = Inbox(p)
            val pub = publishAll(m.url, p.keys.inboxTopic, ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "a.pdf", mime = "application/pdf"), Bytes.random(6000)).second).single()
            m.control("fail-downloads?count=1&status=404")
            repeat(3) { assertTrue(inbox.receiver.pollOnce().items.isEmpty()) }
            assertEquals(1, m.downloadsById()[pub.id])
            assertTrue(inbox.receiver.handled(pub.id!!))
            assertTrue(inbox.received.isEmpty())
        }
    }

    @Test
    fun heldPartsAreNotDownloadedAgain() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val bytes = Bytes.random(12_000)
            val (prepared, frames) = ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "x.pdf", mime = "application/pdf"), bytes, chunkSize = 4000)
            assertEquals(3, frames.size)
            val first = publishAll(m.url, p.keys.inboxTopic, frames.subList(0, 2))
            val a = Inbox(p)
            assertTrue(a.receiver.pollOnce().items.isEmpty())
            val b = a.restarted()
            assertTrue(b.receiver.pollOnce().items.isEmpty())
            for (pub in first) assertEquals(1, m.downloadsById()[pub.id])
            val last = publishAll(m.url, p.keys.inboxTopic, frames.subList(2, 3)).single()
            assertEquals(listOf(prepared.header.id), b.receiver.pollOnce().items.map { it.id })
            assertArrayEquals(bytes, b.received.single().second)
            for (pub in first + last) {
                assertEquals(1, m.downloadsById()[pub.id])
                assertTrue("every message of the item is handled", b.receiver.handled(pub.id!!))
            }
            assertTrue(b.state().partMsgs.isEmpty())
            assertTrue(b.state().incomplete.isEmpty())
        }
    }

    @Test
    fun partsArrivingAcrossPollsHoldTheCursor() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val bytes = Bytes.random(12_000)
            val (prepared, frames) = ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "x.bin", mime = "application/octet-stream"), bytes, chunkSize = 3000)
            assertEquals(4, frames.size)
            val t0 = publishAll(m.url, p.keys.inboxTopic, frames.subList(0, 2)).first().time!!
            val inbox = Inbox(p)
            assertTrue(inbox.receiver.pollOnce().items.isEmpty())
            m.advance(60)
            val out = outbox(p)
            val link = out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/unrelated"), null).id)!!
            assertEquals(listOf(link.id), inbox.receiver.pollOnce().items.map { it.id })
            assertTrue("held at the first part", inbox.receiver.since().toLong() <= t0 - Limits.CURSOR_OVERLAP_S)
            // A restart between parts: the next receiver resumes from the held cursor and the parts on disk.
            val again = inbox.restarted()
            m.advance(60)
            publishAll(m.url, p.keys.inboxTopic, frames.subList(2, 4))
            assertEquals(listOf(prepared.header.id), again.receiver.pollOnce().items.map { it.id })
            assertArrayEquals(bytes, again.received.last().second)
            assertTrue(again.state().incomplete.isEmpty())
        }
    }

    @Test
    fun aLateLandingAttachmentIsNotSkipped() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val inbox = Inbox(p)
            val (prepared, frames) = ItemBuilder.buildFrames(p.keys, OutgoingItem(Kind.FILE, name = "slow.pdf", mime = "application/pdf"), Bytes.random(6000))
            // The slow upload is stamped when it starts and listed only when it ends, after later messages.
            val slow = Thread {
                UrlConnectionHttp().send("PUT", "${m.url}/${p.keys.inboxTopic}", mapOf("Filename" to "dls1.bin", "Message" to "dls1", "X-Mock-Hold" to "1500"), frames.single())
            }.apply { start() }
            Thread.sleep(300)
            m.advance(60)
            val out = outbox(p)
            val link = out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/fast"), null).id)!!
            assertEquals(listOf(link.id), inbox.receiver.pollOnce().items.map { it.id })
            slow.join(10_000)
            assertEquals(listOf(prepared.header.id), inbox.receiver.pollOnce().items.map { it.id })
        }
    }

    @Test
    fun acceptFailureWaitsForTheResend() {
        val p = pairing()
        val now = AtomicLong(System.currentTimeMillis())
        val out = outbox(p, clock = { now.get() })
        val row = out.add(OutgoingItem(Kind.URL, url = "https://example.com/disk-full"), null)
        out.publish(row.id)
        var full = true
        val inbox = Inbox(p, clock = { now.get() }, fail = { full })
        val first = inbox.receiver.pollOnce()
        assertTrue(first.items.isEmpty())
        assertTrue(first.ackIds.isEmpty())
        assertEquals("disk full", first.storeError)
        assertEquals(0, out.checkAcks())
        // Its message is handled: the next poll does not download it again, even with room on the disk.
        full = false
        val second = inbox.receiver.pollOnce()
        assertTrue(second.items.isEmpty())
        assertNull(second.storeError)
        // It comes back with the sender's re-send.
        now.addAndGet(Limits.RESEND_MESSAGE_MS)
        assertEquals(listOf(row.id), out.resendDue().map { it.id })
        assertEquals(listOf(row.id), inbox.receiver.pollOnce().items.map { it.id })
        assertEquals(1, out.checkAcks())
    }

    @Test
    fun ackFailureTriggersDigestAtNextPoll() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val out = outbox(p)
            val row = out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/ack-lost"), null).id)!!
            val inbox = Inbox(p)
            m.control("fail-publish?count=1&status=429&topic=${p.keys.ackTopic}")
            val r1 = inbox.receiver.pollOnce()
            assertEquals(listOf(row.id), r1.items.map { it.id })
            assertTrue(r1.ackIds.isEmpty())
            assertNotNull(r1.ackError)
            assertEquals(0L, inbox.state().lastDigest)
            assertEquals(0, out.checkAcks())
            val r2 = inbox.receiver.pollOnce()
            assertTrue(r2.items.isEmpty())
            assertEquals(listOf(row.id), r2.digestIds)
            assertNull(r2.ackError)
            assertTrue(inbox.state().lastDigest > 0)
            assertEquals(1, out.checkAcks())
            // The live path reports a failed ack the same way.
            inbox.receiver.ackFailed()
            assertEquals(listOf(row.id), inbox.receiver.pollOnce().digestIds)
            assertTrue(inbox.receiver.pollOnce().digestIds.isEmpty())
        }
    }

    @Test
    fun digestReachesARareSender() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val base = System.currentTimeMillis()
            val t = AtomicLong(0)
            val out = outbox(p, clock = { base + t.get() })
            val row = out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/rare"), null).id)!!
            val inbox = Inbox(p, clock = { base + t.get() })
            var resent = 0
            var deliveredAt = -1L
            for (step in 0..7 * 96) {
                t.set(step * 15 * MIN)
                m.control("clock?offsetSec=${t.get() / 1000}")
                inbox.receiver.pollOnce()
                if (t.get() > 0 && t.get() % (13 * HOUR) == 0L) {
                    resent += out.tick().resent
                    if (out.row(row.id)!!.status == Status.DELIVERED) {
                        deliveredAt = t.get()
                        break
                    }
                }
            }
            assertTrue("delivered before day 7 (at ${deliveredAt / HOUR} h)", deliveredAt in 0 until 7 * DAY)
            assertTrue("re-sent $resent times", resent <= 2)
            assertEquals(1, inbox.received.size)
        }
    }

    @Test
    fun liveRetryHoldsTheCursor() {
        val p = Pairing(Bytes.random(16), "http://127.0.0.1:9")
        val store = MemoryReceiverStore()
        val r = Receiver(p, store, Reassembler(), RelayClient(p.relay)) { }
        r.handleLive(listOf(RelayMessage("a", 10_000, null, Outcome.JUNK)))
        assertEquals("${10_000 - Limits.CURSOR_OVERLAP_S}", r.since())
        r.handleLive(listOf(RelayMessage("b", 9_000, null, Outcome.RETRY, attachment = true)))
        assertEquals("${9_000 - Limits.CURSOR_OVERLAP_S}", r.since())
        assertTrue(r.handled("a"))
        assertFalse(r.handled("b"))
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
                if (r.ackIds.isNotEmpty() && inbox.receiver.publishAcks(r.ackIds) != null) inbox.receiver.ackFailed()
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

    // ------------------------------------------------------------------------------------------------ state

    @Test
    fun outboxCapKeepsPendingRows() {
        val p = Pairing(Bytes.random(16), "http://127.0.0.1:9")
        val dir = tmp("dls-outbox")
        val store = FileOutboxStore(dir)
        store.contentDir.mkdirs()
        val finished = (1..210).map { i ->
            val id = "%032x".format(i)
            store.contentFile(id).writeBytes(ByteArray(4))
            OutboxRow(ItemHeader(id, Kind.FILE, name = "f$i.pdf", mime = "application/pdf", size = 4, sha256 = "0".repeat(64)), created = i.toLong(), status = if (i % 2 == 0) Status.EXPIRED else Status.DELIVERED)
        }
        store.save(finished.reversed(), "all")
        val now = AtomicLong(1_000_000)
        val out = Outbox(p, store, RelayClient(p.relay) {}, clock = { now.incrementAndGet() })
        repeat(3) { out.add(OutgoingItem(Kind.URL, url = "https://example.com/p$it"), null) }
        val rows = out.rows()
        assertEquals(200, rows.size)
        assertEquals(3, rows.count { it.status in Status.PENDING })
        assertEquals((14L..210).toSet(), rows.filter { it.status !in Status.PENDING }.map { it.created }.toSet())
        for (i in 1..13) assertFalse("content of evicted row $i", store.contentFile("%032x".format(i)).exists())
        for (i in 14..210) assertTrue(store.contentFile("%032x".format(i)).exists())
        // Pending rows are never dropped, however many there are.
        repeat(220) { out.add(OutgoingItem(Kind.URL, url = "https://example.com/q$it"), null) }
        assertEquals(223, out.rows().size)
        assertTrue(out.rows().all { it.status in Status.PENDING })
    }

    @Test
    fun twoOutboxObjectsOnOneDirectoryLoseNoRows() {
        MockRelay.start("--control").use { m ->
            val p = pairing(m.url)
            val dir = tmp("dls-outbox")
            val a = outbox(p, dir = dir)
            val b = outbox(p, dir = dir)
            val errors = CopyOnWriteArrayList<Throwable>()
            val threads = listOf(
                Thread { repeat(25) { a.send(OutgoingItem(Kind.URL, url = "https://example.com/a$it"), null) } },
                Thread { repeat(25) { b.send(OutgoingItem(Kind.URL, url = "https://example.com/b$it"), null) } },
                Thread { repeat(10) { b.tick() } },
            )
            threads.forEach { it.setUncaughtExceptionHandler { _, e -> errors += e }; it.start() }
            threads.forEach { it.join(60_000) }
            assertTrue(errors.toString(), errors.isEmpty())
            val rows = outbox(p, dir = dir).rows()
            assertEquals(50, rows.size)
            assertTrue(rows.all { it.status == Status.SENT })
            assertEquals("each item published once", 50, (m.state()["published"] as Double).toInt())
        }
    }

    @Test
    fun twoReceiversOnOneStateFileDeliverOnce() {
        val p = pairing()
        val out = outbox(p)
        val ids = (0 until 5).map { out.publish(out.add(OutgoingItem(Kind.URL, url = "https://example.com/r$it"), null).id)!!.id }
        val dir = tmp("dls-inbox")
        val accepted = CopyOnWriteArrayList<String>()
        fun receiver() = Receiver(p, FileReceiverStore(File(dir, "state.json")), Reassembler(File(dir, "spool")), RelayClient(url)) { accepted += it.header.id }
        val r1 = receiver()
        val r2 = receiver()
        val threads = listOf(r1, r2, r1, r2).map { r -> Thread { r.pollOnce() }.apply { start() } }
        threads.forEach { it.join(30_000) }
        assertEquals(ids.toSet(), accepted.toSet())
        assertEquals(5, accepted.size)
    }

    // ------------------------------------------------------------------------------------------------ the relay

    private class FakeHttp(val answer: (method: String, url: String, call: Int) -> Http.Response) : Http {
        val calls = CopyOnWriteArrayList<String>()
        override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
            calls += "$method $url"
            return answer(method, url, calls.size)
        }
        override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = error("unused")
    }

    private fun status(s: Int, headers: Map<String, String> = emptyMap()) = Http.Response(s, headers, ByteArray(0))

    @Test
    fun publishAnswersMapToErrorCodes() {
        fun codeOf(s: Int, retryAfter: String? = null): Triple<String, Int, Int> {
            val slept = CopyOnWriteArrayList<Long>()
            val http = FakeHttp { _, _, _ -> status(s, retryAfter?.let { mapOf("Retry-After" to it) } ?: emptyMap()) }
            val e = runCatching { RelayClient("https://ntfy.sh", http) { slept += it }.publish("dls-x", ByteArray(100)) }.exceptionOrNull() as RelayException
            assertEquals(s, e.status)
            return Triple(e.code, http.calls.size, slept.sumOf { it }.toInt())
        }
        assertEquals(Triple("network", 1, 0), codeOf(429)) // never retried in the call
        assertEquals(Triple("full", 1, 0), codeOf(413))
        for (s in listOf(400, 401, 403, 404, 405)) assertEquals(Triple("refused", 1, 0), codeOf(s))
        assertEquals(Triple("network", 4, 7000), codeOf(503)) // retried after 1, 2 and 4 s
        assertEquals(Triple("network", 4, 7000), codeOf(408))
        assertEquals(Triple("network", 4, 3000), codeOf(502, "1"))
        val slept = CopyOnWriteArrayList<Long>()
        val e = runCatching { RelayClient("https://ntfy.sh", FakeHttp { _, _, _ -> throw IOException("reset") }) { slept += it }.publish("dls-x", ByteArray(100)) }.exceptionOrNull() as RelayException
        assertEquals(ErrorCode.NETWORK, e.code)
        assertEquals(0, e.status)
        assertEquals(listOf(1000L, 2000L, 4000L), slept)
        // A 5xx that clears in the call is a success.
        val ok = FakeHttp { _, _, n -> if (n < 3) status(503) else Http.Response(200, emptyMap(), Bytes.utf8("{\"id\":\"abc\",\"time\":5}")) }
        assertEquals("abc", RelayClient("https://ntfy.sh", ok) {}.publish("dls-x", ByteArray(100)).id)
    }

    @Test
    fun pollClassifiesEveryMessage() {
        val keys = Pairing(Bytes.random(16)).keys
        val frame = FrameCodec.encrypt(keys, Purpose.INBOX, mapOf("v" to 1))
        fun line(id: String, time: Int, extra: String) = "{\"id\":\"$id\",\"time\":$time,\"event\":\"message\",\"topic\":\"t\",$extra}"
        val lines = listOf(
            "{\"id\":\"o\",\"time\":1,\"event\":\"open\"}",
            line("f", 10, "\"message\":\"${Bytes.toBase64(frame)}\""),
            line("j", 11, "\"message\":\"not base64!\""),
            line("x", 12, "\"message\":\"dls1\",\"attachment\":{\"url\":\"http://elsewhere.example/file/x.bin\"}"),
            line("e", 13, "\"message\":\"dls1\",\"attachment\":{\"url\":\"https://files.example/file/e.bin\"}"),
            line("s", 14, "\"message\":\"dls1\",\"attachment\":{\"url\":\"https://files.example/file/s.bin\"}"),
            line("r", 15, "\"message\":\"dls1\",\"attachment\":{\"url\":\"https://files.example/file/r.bin\"}"),
            line("l", 16, "\"message\":\"dls1\",\"attachment\":{\"url\":\"https://files.example/file/l.bin\"}"),
            line("m", 17, "\"message\":\"${Bytes.toBase64(frame)}\""),
            line("n", 18, "\"message\":\"dls1\",\"attachment\":{\"name\":\"no url\"}"),
            "not json",
        )
        val http = FakeHttp { _, u, _ ->
            when {
                "/json?" in u -> Http.Response(200, emptyMap(), Bytes.utf8(lines.joinToString("\n")))
                u.endsWith("e.bin") -> status(410)
                u.endsWith("r.bin") -> status(429)
                else -> status(500)
            }
        }
        val got = RelayClient("https://relay.example.org", http).poll("t", "all") { it == "s" }
        assertEquals(
            listOf("f" to Outcome.FRAME, "j" to Outcome.JUNK, "x" to Outcome.JUNK, "e" to Outcome.EXPIRED, "s" to Outcome.SKIPPED,
                "r" to Outcome.RETRY, "l" to Outcome.RETRY, "m" to Outcome.FRAME, "n" to Outcome.JUNK),
            got.map { it.id to it.outcome },
        )
        assertEquals(listOf(10L, 11, 12, 13, 14, 15, 16, 17, 18), got.map { it.time })
        // Only e and r were requested: x is not allowed, s is skipped, and nothing after the 429.
        assertEquals(listOf("e.bin", "r.bin"), http.calls.filter { "/file/" in it }.map { it.substringAfterLast('/') })

        // An answer over the poll cap is a failed poll; an attachment over the download cap is junk.
        val tooLong = FakeHttp { _, _, _ -> throw Http.TooLargeException("long") }
        assertEquals("relay", (runCatching { RelayClient("https://ntfy.sh", tooLong).poll("t") }.exceptionOrNull() as RelayException).code)
        assertEquals(Outcome.JUNK, RelayClient("https://ntfy.sh", tooLong).download("https://ntfy.sh/file/a.bin").outcome)
        assertEquals("network", (runCatching { RelayClient("https://ntfy.sh", FakeHttp { _, _, _ -> throw IOException("down") }).poll("t") }.exceptionOrNull() as RelayException).code)
    }

    @Test
    fun relayProbe() {
        assertNull(RelayProbe.check(url))
        MockRelay.start("--attachment-max", "1000000").use { assertEquals(RelayProbe.TOO_SMALL, RelayProbe.check(it.url)?.message) }
        MockRelay.start("--no-attachments").use { assertEquals(RelayProbe.NO_FILES, RelayProbe.check(it.url)?.message) }
        MockRelay.start("--public-url", "http://10.255.255.1:9").use {
            val e = RelayProbe.check(it.url)!!
            assertEquals(RelayProbe.NO_DOWNLOAD, e.message)
            assertEquals("download", e.reason)
        }
        val down = RelayProbe.check("http://127.0.0.1:9")!!
        assertEquals(RelayProbe.UNREACHABLE, down.message)
        assertEquals(RelayProbe.REASON_NETWORK, down.reason)
        assertEquals(RelayProbe.NEEDS_LOGIN, RelayProbe.check("https://relay.example.org", FakeHttp { _, _, _ -> status(401) })?.message)
        assertEquals(RelayProbe.NEEDS_LOGIN, RelayProbe.check("https://relay.example.org", FakeHttp { _, _, _ -> status(403) })?.message)
        assertEquals("That relay answered with an error (HTTP 502). Try again later.", RelayProbe.check("https://relay.example.org", FakeHttp { _, _, _ -> status(502) })?.message)
        // The bytes must come back unchanged.
        val wrong = FakeHttp { m, _, _ ->
            if (m == "PUT") Http.Response(200, emptyMap(), Bytes.utf8("{\"attachment\":{\"url\":\"https://relay.example.org/file/p.bin\"}}"))
            else Http.Response(200, emptyMap(), ByteArray(10))
        }
        assertEquals(RelayProbe.NO_DOWNLOAD, RelayProbe.check("https://relay.example.org", wrong)?.message)
    }

    // ------------------------------------------------------------------------------------------------ interop

    @Test
    fun javascriptSenderToKotlinReceiver() {
        val p = pairing()
        val pdf = Bytes.random(5_000_000)
        val file = File.createTempFile("dls-js", ".pdf").apply { writeBytes(pdf) }
        val row = MockRelay.js("send", url, p.compactCode,
            Json.write(mapOf("kind" to "file", "name" to "js.pdf", "mime" to "application/pdf", "title" to "From JS", "contentFile" to file.path))) as Map<String, Any?>
        assertEquals("sent", row["status"])
        assertEquals(true, row["attachment"])
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
        val out = outbox(p)
        val bytes = Bytes.random(5_000_000)
        val file = out.add(OutgoingItem(Kind.FILE, name = "kt.pdf", mime = "application/pdf", title = "From Kotlin"), BytesBody(bytes))
        val page = out.add(OutgoingItem(Kind.PAGE, url = "https://example.com/kt", title = "Kotlin page"), BytesBody(Bytes.utf8("<h1>kt</h1>".repeat(1000))))
        val link = out.add(OutgoingItem(Kind.URL, url = "https://example.com/kt-link", title = "Kotlin link"), null)
        for (id in listOf(file.id, page.id, link.id)) assertEquals(Status.SENT, out.publish(id)!!.status)
        val outDir = tmp("dls-js-out")
        val res = MockRelay.js("receive", url, p.compactCode, outDir.path) as Map<String, Any?>
        assertNull(res["ackError"])
        val items = (res["items"] as List<Any?>).map { it as Map<String, Any?> }
        val byId = items.associateBy { (it["header"] as Map<String, Any?>)["id"] as String }
        assertEquals(setOf(file.id, page.id, link.id), byId.keys)
        assertArrayEquals(bytes, File(byId.getValue(file.id)["contentFile"] as String).readBytes())
        assertEquals("kt.pdf", (byId.getValue(file.id)["header"] as Map<String, Any?>)["name"])
        assertArrayEquals(Bytes.utf8("<h1>kt</h1>".repeat(1000)), File(byId.getValue(page.id)["contentFile"] as String).readBytes())
        assertEquals(3, out.checkAcks())
        assertNull(out.rows().firstOrNull { it.status != Status.DELIVERED })
        assertEquals("JS Daylight", out.row(link.id)!!.deliveredBy)
    }
}
