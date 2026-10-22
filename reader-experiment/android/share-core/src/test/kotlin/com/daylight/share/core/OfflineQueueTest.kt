package com.daylight.share.core

import com.daylight.share.core.lab.LabRowText
import com.daylight.share.core.lab.Normalise
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.util.Collections
import java.util.concurrent.atomic.AtomicLong
import kotlin.io.path.createTempDirectory

/**
 * The offline-first outbox (LAB-PLAN F07; LAB-PROTOCOL 2.7.1; the JS `send(item, {defer})` and `flushNetwork`) and the
 * Lab item fields on every attempt (2.9.2), through the mock ntfy relay with ntfy.sh's limits. The F07.3 cases: 70
 * links queued offline go out in three passes with no 429; ten 9 MB files never put over 18 MB in a pass or 20 MB on the
 * relay, and a 413 sends the rest into v1.1's 3-hour wait.
 */
class OfflineQueueTest {
    private companion object {
        const val SEC = 1_000L
        const val MIN = 60 * SEC
    }

    /** [Http] that records every publish's answer and size, so a test sees each pass's traffic. */
    private class CountingHttp(private val inner: Http = UrlConnectionHttp()) : Http {
        /** One publish: a small frame is POSTed as base64 text, an attachment PUT as the raw frame. */
        class Publish(val method: String, val status: Int, val bytes: Int, val frame: ByteArray?)

        val publishes: MutableList<Publish> = Collections.synchronizedList(ArrayList())

        override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
            val r = inner.send(method, url, headers, body, maxResponseBytes, readTimeoutMs)
            if (method == "POST" || method == "PUT") {
                val frame = if (method == "POST") body?.let { Bytes.fromBase64OrNull(String(it, Charsets.UTF_8)) } else body
                publishes += Publish(method, r.status, body?.size ?: 0, if (r.ok && (frame?.size ?: 0) < 4_000_000) frame else null)
            }
            return r
        }

        override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = inner.stream(url, headers, readTimeoutMs)
    }

    private class Setup(val relay: MockRelay, val http: CountingHttp, val clock: AtomicLong, val pairing: Pairing, val dir: File, val out: Outbox) {
        val received: MutableList<Pair<ItemHeader, ByteArray>> = Collections.synchronizedList(ArrayList())
        val receiver = Receiver(
            pairing, FileReceiverStore(File(dir, "inbox.json")), Reassembler(null), RelayClient(pairing.relay, retryDelaysMs = listOf(0L, 0L, 0L)),
        ) { done -> received += done.header to done.content.open().use { it.readBytes() } }

        fun advance(ms: Long) {
            clock.addAndGet(ms)
            relay.advance(ms / 1000)
        }
    }

    private fun setup(vararg relayArgs: String): Setup {
        val relay = MockRelay.start("--control", *relayArgs)
        val http = CountingHttp()
        val clock = AtomicLong(1_792_483_200_000L)
        val pairing = Pairing(Bytes.random(16), relay.url, "Test Daylight")
        val dir = createTempDirectory("dls-offline").toFile()
        val out = Outbox(pairing, FileOutboxStore(File(dir, "outbox")), RelayClient(pairing.relay, http, listOf(0L, 0L, 0L)), from = "JVM test", clock = { clock.get() })
        return Setup(relay, http, clock, pairing, dir, out)
    }

    private fun pdf(n: Int, name: String = "a.pdf") = OutgoingItem(Kind.FILE, name = name, mime = "application/pdf") to BytesBody(Bytes.random(n))

    @Test
    fun deferStoresTheRowAsWaitingForAConnectionAndPublishesNothing() {
        val s = setup()
        s.relay.use {
            val (item, body) = pdf(5000)
            val row = s.out.send(item, body, defer = true)
            assertEquals(Status.FAILED, row.status)
            assertEquals(ErrorCode.NETWORK, row.errorCode)
            assertEquals(0, row.attempts)
            assertEquals(s.clock.get(), row.lastPublish)
            assertEquals(Outbox.DEFERRED, row.error)
            assertTrue("nothing published", s.http.publishes.isEmpty())
            assertTrue("the content is kept", FileOutboxStore(File(s.dir, "outbox")).contentFile(row.id).isFile)
            assertEquals("Waiting to send", RowText.of(row, s.clock.get()).label)
            assertEquals("Waiting for connection", LabRowText.of(row, s.clock.get(), LabRowText.Context(lab = true, online = false)).label)
            try {
                s.out.send(OutgoingItem(Kind.URL, url = "not a url"), null, defer = true)
                fail("bad input must throw")
            } catch (e: ShareException) {
                assertEquals("url", e.code)
            }
            assertEquals("bad input stores nothing, deferred or not", 1, s.out.rows().size)
            assertTrue("v1.1 back-off: not before a minute", s.out.resendDue().isEmpty())
            s.advance(MIN)
            assertEquals(Status.SENT, s.out.resendDue().single().status)
            assertEquals(1, s.receiver.pollOnce().items.size)
            // add(defer) is the same row, for apps that store first and publish from a worker
            val queued = s.out.add(OutgoingItem(Kind.URL, url = "https://example.com/q"), null, defer = true)
            assertEquals(Status.FAILED to ErrorCode.NETWORK, queued.status to queued.errorCode)
        }
    }

    @Test
    fun seventyLinksQueuedOfflineGoInOrderThirtyFramesAPassInThreePassesWithNo429() {
        val s = setup("--ntfy-limits")
        s.relay.use {
            val ids = ArrayList<String>()
            for (i in 0 until 70) {
                ids += s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/$i", title = "Link $i"), null, defer = true).id
                s.advance(SEC)
            }
            val passes = ArrayList<Int>()
            while (s.out.rows().any { it.status == Status.FAILED }) {
                val before = s.http.publishes.size
                val rows = s.out.flushNetwork()
                passes += rows.size
                assertTrue(s.http.publishes.size - before <= Outbox.FLUSH_MAX_FRAMES)
                assertTrue(rows.all { it.status == Status.SENT })
                s.advance(Outbox.FLUSH_SPACING_MS)
                assertTrue("runaway", passes.size < 10)
            }
            assertEquals(listOf(30, 30, 10), passes)
            assertTrue("no 429", s.http.publishes.none { it.status == 429 })
            assertEquals(70, s.receiver.pollOnce().items.size)
            assertEquals("oldest first", ids, s.received.map { it.first.id })
        }
    }

    @Test
    fun tenQueuedNineMegabyteFilesNeverPutOver18MBInAPassOr20MBOnTheRelay() {
        val s = setup("--ntfy-limits")
        s.relay.use {
            for (i in 0 until 10) {
                val (item, body) = pdf(9_000_000, "book-$i.pdf")
                s.out.send(item, body, defer = true)
                s.advance(SEC)
            }
            val perPass = ArrayList<Long>()
            var pass = 0
            while (pass < 12 && s.out.rows().any { it.status == Status.FAILED && it.errorCode == ErrorCode.NETWORK }) {
                val start = s.http.publishes.size
                s.out.flushNetwork()
                perPass += s.http.publishes.drop(start).filter { it.method == "PUT" && it.status in 200..299 }.sumOf { it.bytes.toLong() }
                s.advance(Outbox.FLUSH_SPACING_MS)
                pass++
            }
            assertTrue(perPass.toString(), perPass.all { it <= Outbox.FLUSH_MAX_ATTACHMENT_BYTES })
            val live = s.http.publishes.filter { it.method == "PUT" && it.status in 200..299 }.sumOf { it.bytes.toLong() }
            assertTrue("$live bytes on the relay at once", live <= 20_000_000)
            val rows = s.out.rows()
            assertEquals(2, rows.count { it.status == Status.SENT })
            val waiting = rows.filter { it.status == Status.FAILED }
            assertEquals(8, waiting.size)
            for (r in waiting) {
                assertEquals(ErrorCode.FULL, r.errorCode)
                assertEquals(
                    "A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.",
                    RowText.of(r, s.clock.get()).sentence,
                )
            }
            assertTrue("nothing before 185 minutes", s.out.resendDue().isEmpty())
            assertTrue("no 429", s.http.publishes.none { it.status == 429 })
        }
    }

    @Test
    fun flushNetworkFollowsThePassRulesAndSkipsOtherRows() {
        val s = setup()
        s.relay.use {
            val sentRow = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/sent"), null)
            val a = pdf(50_000, "a.pdf").let { (i, b) -> s.out.send(i, b, defer = true) }
            s.advance(SEC)
            val b = pdf(50_000, "b.pdf").let { (i, body) -> s.out.send(i, body, defer = true) }
            s.advance(SEC)
            val c = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/c"), null, defer = true)
            assertTrue(a.attachment && b.attachment && !c.attachment)
            s.relay.control("fail-publish?count=1&status=413&topic=${s.pairing.keys.inboxTopic}")
            var rows = s.out.flushNetwork()
            assertEquals(listOf(Triple(a.id, Status.FAILED, ErrorCode.FULL), Triple(c.id, Status.SENT, "")), rows.map { Triple(it.id, it.status, it.errorCode) })
            assertEquals("a sent row is not touched", 0, s.out.row(sentRow.id)!!.attempts)
            assertEquals(Status.SENT, s.out.row(sentRow.id)!!.status)
            val d = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/d"), null, defer = true)
            s.advance(SEC)
            val e = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/e"), null, defer = true)
            s.relay.control("fail-publish?count=1&status=429&topic=${s.pairing.keys.inboxTopic}")
            rows = s.out.flushNetwork()
            assertEquals("b first (oldest), then nothing after its 429", listOf(b.id), rows.map { it.id })
            assertEquals(ErrorCode.NETWORK, rows.single().errorCode)
            s.advance(3 * MIN)
            val f1 = pdf(50_000, "f1.pdf").let { (i, body) -> s.out.send(i, body, defer = true) }
            s.advance(SEC)
            val f2 = pdf(50_000, "f2.pdf").let { (i, body) -> s.out.send(i, body, defer = true) }
            assertEquals("a pass always takes its first row, and is then full", listOf(b.id), s.out.flushNetwork(maxAttachmentBytes = 10).map { it.id })
            assertEquals("the frame cap", listOf(d.id, e.id), s.out.flushNetwork(maxFrames = 2).map { it.id })
            assertEquals("the attachment cap", listOf(f1.id), s.out.flushNetwork(maxAttachmentBytes = 60_000).map { it.id })
            assertEquals(listOf(f2.id to Status.SENT), s.out.flushNetwork().map { it.id to it.status })
            assertTrue("nothing left", s.out.flushNetwork().isEmpty())
            // a row past the week is left to resendDue, which expires it
            val old = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/old"), null, defer = true)
            s.advance(Limits.OUTBOX_EXPIRY_MS + MIN)
            assertTrue(s.out.flushNetwork().isEmpty())
            s.out.resendDue()
            assertEquals(Status.EXPIRED, s.out.row(old.id)!!.status)
        }
    }

    @Test
    fun aRowWhoseContentIsGoneEndsInsteadOfBlockingThePass() {
        val s = setup()
        s.relay.use {
            val gone = pdf(5000).let { (i, b) -> s.out.send(i, b, defer = true) }
            s.advance(SEC)
            val next = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/next"), null, defer = true)
            FileOutboxStore(File(s.dir, "outbox")).contentFile(gone.id).delete()
            assertEquals(listOf(next.id), s.out.flushNetwork().map { it.id })
            assertEquals(Status.EXPIRED to ErrorCode.GONE, s.out.row(gone.id)!!.let { it.status to it.errorCode })
        }
    }

    /** 2.9.2: the Lab fields ride on part 0 of every attempt, re-sends included, and plain items stay exactly v1.1. */
    @Test
    fun labHeaderFieldsRideOnPartZeroOfEveryAttempt() {
        val s = setup()
        s.relay.use {
            val n = Normalise.normaliseShare("Story https://example.com/s?utm_source=x")
            val row = s.out.send(OutgoingItem(Kind.URL, url = n.url, title = n.title, extras = n.extras), null)
            assertEquals(mapOf("x-orig" to "https://example.com/s?utm_source=x"), row.header.extras)
            val plain = s.out.send(OutgoingItem(Kind.URL, url = "https://example.com/plain"), null)
            assertTrue(plain.header.extras.isEmpty())
            val (fileItem, fileBody) = pdf(4_000_000, "a.bin")
            val file = s.out.send(fileItem.copy(extras = mapOf("x-cap" to "excerpt", "x-bogus" to "1")), fileBody)
            assertEquals(mapOf("x-cap" to "excerpt"), file.header.extras)
            // the stored row reads back with its fields (a restart), and a re-send carries them
            assertEquals(row.header.extras, Outbox(s.pairing, FileOutboxStore(File(s.dir, "outbox"))).row(row.id)!!.header.extras)
            s.advance(Limits.RESEND_MESSAGE_MS + MIN)
            s.out.resendDue()
            s.receiver.pollOnce()
            fun extrasOf(id: String) = s.received.first { it.first.id == id }.first.extras
            assertEquals(mapOf("x-orig" to "https://example.com/s?utm_source=x"), extrasOf(row.id))
            assertEquals(emptyMap<String, String>(), extrasOf(plain.id))
            assertEquals(mapOf("x-cap" to "excerpt"), extrasOf(file.id))
            // and on the wire: part 0 only, on both attempts
            val keys = s.pairing.keys
            var withX = 0
            var frames = 0
            for (pub in s.http.publishes) {
                val frame = pub.frame ?: continue
                frames++
                val h = FrameCodec.open(keys, Purpose.INBOX, frame).header
                val x = h.keys.filter { it.startsWith("x-") }
                if (h["id"] == plain.id) assertTrue(x.isEmpty())
                if (((h["part"] as? Double) ?: 0.0) > 0) assertTrue("later parts carry no Lab fields", x.isEmpty())
                if (x.isNotEmpty()) withX++
            }
            assertEquals("two attempts of three items, the file in 3 parts", 10, frames)
            assertEquals("two attempts each of the link and the file's part 0", 4, withX)
            assertFalse(s.received.isEmpty())
        }
    }
}
