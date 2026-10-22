package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.BytesBody
import com.daylight.share.core.FileBody
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.FileReceiverStore
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Json
import com.daylight.share.core.Kind
import com.daylight.share.core.MockRelay
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Pairing
import com.daylight.share.core.Reassembler
import com.daylight.share.core.Receiver
import com.daylight.share.core.RelayClient
import com.daylight.share.core.RelayException
import com.daylight.share.core.RowText
import com.daylight.share.core.Status
import org.junit.AfterClass
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.io.path.createTempDirectory

/**
 * F17 version skew (LAB-PROTOCOL 2.8) through the mock relay, against the JS reference and its shipped versions
 * (share/js/test/fixtures: v1.0 as of b48752b, v1.1):
 * - the Kotlin Outbox with its LabLedger against the v1.0, v1.1 and current JS Receivers, and a JS Lab Daylight
 *   (LabInboxSim), for url, page and file;
 * - the v1.0, v1.1 and current (Lab, with its ledger) JS Senders against the Kotlin Receiver, with and without LabInbox;
 * - two Lab publishers on one ack topic (Daylight Share in Kotlin, the Lab Reader in JS) in both handover orders.
 * Every item is delivered and acked; Lab states appear only when both sides are Lab; old senders never throw on Lab
 * frames and v1.1 rows read as v1.1 reads them.
 */
@Suppress("UNCHECKED_CAST")
class LabSkewTest {
    companion object {
        private var relay: MockRelay? = null
        val url: String get() = relay!!.url

        @BeforeClass
        @JvmStatic
        fun up() {
            relay = MockRelay.start("--visitor-total", "1000000000")
        }

        @AfterClass
        @JvmStatic
        fun down() {
            relay?.close()
        }

        private val PAGE = "<html><body>" + "<p>Words, words.</p>".repeat(300) + "</body></html>"
        private val FILE = ByteArray(40_000) { i -> ((i * 31 + (i shr 7)) and 0xff).toByte() }
    }

    private fun pairing() = Pairing(Bytes.random(16), url, "Daylight")
    private fun tmp(prefix: String): File = createTempDirectory(prefix).toFile()
    private fun fast(p: Pairing) = RelayClient(p.relay, retryDelaysMs = listOf(0L, 0L, 0L))

    /** A Kotlin Lab sender: the Outbox with its ledger wired through onAckHeader (2.2.6). */
    private class LabSender(p: Pairing, relay: RelayClient, dir: File) {
        val store = FileOutboxStore(dir)
        val ledger = LabLedger.of(store)
        val outbox = Outbox(p, store, relay, from = "Kotlin phone", app = "android/test", onAckHeader = ledger.hook())

        fun send(kind: String): Pair<OutboxRow, ByteArray?> = when (kind) {
            Kind.URL -> outbox.send(OutgoingItem(Kind.URL, url = "https://example.com/story", title = "A story"), null) to null
            Kind.PAGE -> outbox.send(OutgoingItem(Kind.PAGE, url = "https://example.com/page", title = "A page"), BytesBody(Bytes.utf8(PAGE))) to Bytes.utf8(PAGE)
            else -> outbox.send(OutgoingItem(Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper"), BytesBody(FILE)) to FILE
        }

        fun rowText(id: String): LabRowText = LabRowText.of(outbox.row(id)!!, System.currentTimeMillis(), LabRowText.Context.of(true, ledger.snapshot(), id, online = true))
    }

    /**
     * A Kotlin Daylight: the Receiver, and with [lab] its LabInbox (the reference LabInboxSim's steps: the poll and its
     * acks, then the ack outcome and any 429/413, the states, and the flush). Its clock can run ahead ([ahead]), for the
     * 30 s spacing between Lab frames.
     */
    private inner class KotlinDaylight(
        val p: Pairing,
        val lab: Boolean,
        app: String = "android/1.5.0",
        caps: List<String> = listOf("st", "tap", "reader-link"),
        val stateFor: (ItemHeader) -> String = { if (it.kind == Kind.FILE) "handed" else "reader" },
        dir: File = tmp("dls-skew-inbox"),
    ) {
        var ahead = 0L
        val clock = { System.currentTimeMillis() + ahead }
        val received = CopyOnWriteArrayList<Pair<ItemHeader, ByteArray>>()
        val receiver = Receiver(p, FileReceiverStore(File(dir, "state.json")), Reassembler(File(dir, "spool")), fast(p), from = "Kotlin Daylight") { done ->
            received += done.header to done.content.open().use { it.readBytes() }
            (done.content as? FileBody)?.file?.delete()
        }
        val labInbox = LabInbox(FileLabStore(File(dir, "lab-${p.keys.inboxTopic}.json")), fast(p), p.keys, { LabInboxInfo(1, app, caps) }, "Kotlin Daylight", clock)
        var lastFlush: LabInbox.FlushResult? = null

        fun pollOnce(): Receiver.Result {
            val res = try {
                receiver.pollOnce()
            } catch (e: RelayException) {
                if (lab) labInbox.noteRelayLimit(e.status)
                throw e
            }
            if (lab) {
                val now = clock()
                labInbox.notePolled(now)
                labInbox.noteAcksFailed(res.ackError != null)
                if (res.limited) labInbox.noteRelayLimit(429)
                for (h in res.items) labInbox.record(h.id, stateFor(h), now / 1000)
                lastFlush = labInbox.flush()
            }
            return res
        }
    }

    private fun js(version: String, vararg args: String): Map<String, Any?> = MockRelay.jsWith(MockRelay.jsLib(version), *args) as Map<String, Any?>

    // --------------------------------------------------------------------------------- Kotlin Lab sender -> JS Daylights

    @Test
    fun theKotlinLabSenderAgainstEveryJsDaylight() {
        val outcomes = ArrayList<String>()
        for (rv in listOf("v1.0", "v1.1", "current", "lab")) {
            for (kind in listOf(Kind.URL, Kind.PAGE, Kind.FILE)) {
                val case = "kotlin-lab -> $rv $kind"
                val p = pairing()
                val sender = LabSender(p, fast(p), tmp("dls-skew-out"))
                val (row, content) = sender.send(kind)
                assertEquals(case, Status.SENT, row.status)
                val got = if (rv == "lab") js("current", "receive-lab", url, p.compactCode) else js(rv, "receive", url, p.compactCode)
                val items = got["items"].objs()
                assertEquals(case, 1, items.size)
                if (rv == "lab") {
                    assertEquals(case, row.id, items[0]["id"])
                    assertEquals(case, "sent", got["lab"].obj()["reason"])
                } else {
                    assertEquals(case, row.id, items[0]["header"].obj()["id"])
                    if (content != null) assertArrayEquals(case, content, Bytes.fromHex(items[0]["contentHex"] as String))
                }
                assertEquals(case, 1, sender.outbox.checkAcks())
                val stored = sender.outbox.row(row.id)!!
                assertEquals(case, Status.DELIVERED, stored.status)
                val snap = sender.ledger.snapshot()
                val d = sender.rowText(row.id)
                if (rv == "lab") {
                    assertTrue(case, snap.inboxLab)
                    assertEquals(case, listOf("reader-link", "st", "tap"), snap.caps)
                    assertEquals(case, if (kind == Kind.FILE) "handed" else "reader", snap.state(row.id)?.s)
                    assertEquals(case, if (kind == Kind.FILE) "Handed to the Reader" else "In your Reader ✓", d.label)
                    assertNotNull(case, d.stepLine)
                } else {
                    assertFalse("$case: no Lab hello from a v1 Inbox", snap.inboxLab)
                    assertTrue("$case: no states from a v1 Inbox", snap.states.isEmpty())
                    val old = RowText.of(stored, System.currentTimeMillis())
                    assertEquals("$case: rows read as v1.1 reads them (F01.5)", Triple(old.label, old.sentence, old.action), Triple(d.label, d.sentence, d.action))
                    assertNull(case, d.stepLine)
                    assertNotNull("$case: the check-in header still works, from ack times", snap.checkedIn)
                    assertTrue(case, System.currentTimeMillis() - snap.checkedIn!! < 120_000)
                }
                outcomes += case
            }
        }
        assertEquals(12, outcomes.size)
    }

    // ------------------------------------------------------------------- JS senders -> Kotlin Daylight, Lab and not

    @Test
    fun everyJsSenderAgainstTheKotlinDaylightWithAndWithoutLab() {
        val outcomes = ArrayList<String>()
        for (sv in listOf("v1.0", "v1.1", "current")) {
            for (lab in listOf(false, true)) {
                for (kind in listOf(Kind.URL, Kind.PAGE, Kind.FILE)) {
                    val case = "js $sv -> kotlin ${if (lab) "Lab" else "v1.1"} $kind"
                    val p = pairing()
                    val item = when (kind) {
                        Kind.URL -> mapOf("kind" to "url", "url" to "https://example.com/story", "title" to "A story")
                        Kind.PAGE -> mapOf("kind" to "page", "url" to "https://example.com/page", "title" to "A page", "content" to PAGE)
                        else -> mapOf("kind" to "file", "name" to "paper.pdf", "mime" to "application/pdf", "contentHex" to Bytes.toHex(FILE))
                    }
                    val row = js(sv, "send", url, p.compactCode, Json.write(item))
                    assertEquals(case, "sent", row["status"])
                    val daylight = KotlinDaylight(p, lab)
                    val res = daylight.pollOnce()
                    assertEquals(case, listOf(row["id"]), res.items.map { it.id })
                    assertNull(case, res.ackError)
                    when (kind) {
                        Kind.PAGE -> assertArrayEquals(case, Bytes.utf8(PAGE), daylight.received.single().second)
                        Kind.FILE -> assertArrayEquals(case, FILE, daylight.received.single().second)
                    }
                    if (lab) assertEquals(case, "sent", daylight.lastFlush!!.reason)
                    if (sv == "current") {
                        // A Lab sender: its ledger hears the Kotlin Daylight's states only when that Daylight is Lab.
                        val acks = js("current", "acks-lab", url, p.compactCode, Json.write(mapOf("id" to row["id"], "kind" to kind)))
                        assertEquals(case, 1.0, acks["delivered"])
                        assertEquals(case, "delivered", acks["status"])
                        assertEquals(case, lab, acks["inboxLab"])
                        val label = acks["row"].obj()["label"]
                        if (lab) {
                            assertEquals(case, if (kind == Kind.FILE) "handed" else "reader", acks["state"].obj()["s"])
                            assertEquals(case, if (kind == Kind.FILE) "Handed to the Reader" else "In your Reader ✓", label)
                            assertEquals(case, listOf("android"), acks["publishers"].objs().map { it["publisher"] })
                        } else {
                            assertNull(case, acks["state"])
                            assertEquals(case, "Delivered ✓", label)
                        }
                    } else {
                        // An old sender reads the Lab frames on its ack topic: no throw, and only the ack delivers.
                        val acks = js(sv, "acks", url, p.compactCode, row["id"] as String)
                        assertEquals(case, 1.0, acks["delivered"])
                        assertEquals(case, "delivered", acks["status"])
                    }
                    outcomes += case
                }
            }
        }
        assertEquals(18, outcomes.size)
    }

    // ------------------------------------------------------------------------------- two publishers on one ack topic

    private fun handover(shareFirst: Boolean): Triple<LabSender, String, String> {
        val p = pairing()
        val sender = LabSender(p, fast(p), tmp("dls-skew-handover"))
        val share = KotlinDaylight(p, lab = true) // Daylight Share: android/1.5.0
        val readerOpts = Json.write(mapOf("app" to "reader-lab/0.27.900", "caps" to listOf("st", "reader-link", "reader-doc", "quiet"), "from" to "Daylight Reader (lab)", "state" to "reader"))
        val (a, _) = sender.send(Kind.URL)
        if (shareFirst) share.pollOnce() else js("current", "receive-lab", url, p.compactCode, readerOpts)
        assertEquals(1, sender.outbox.checkAcks())
        val before = sender.ledger.snapshot()
        assertTrue(before.inboxLab)
        assertEquals(if (shareFirst) listOf("reader-link", "st", "tap") else listOf("quiet", "reader-doc", "reader-link", "st"), before.caps)
        // The handover: the first stops receiving and says so with lab: 0.
        if (shareFirst) {
            share.ahead += Lab.LAB_FRAME_GAP_MS
            assertEquals("off", share.labInbox.labTurnedOff().kind)
        } else {
            assertEquals("off", js("current", "lab-off", url, p.compactCode, readerOpts)["kind"])
        }
        val (b, _) = sender.send(Kind.FILE)
        // The second receives (the first item too, from the relay's cache) and sends its states.
        if (shareFirst) {
            val r = js("current", "receive-lab", url, p.compactCode, readerOpts)
            assertTrue(r["items"].objs().any { it["id"] == b.id })
        } else {
            assertTrue(KotlinDaylight(p, lab = true).pollOnce().items.any { it.id == b.id })
        }
        assertEquals(1, sender.outbox.checkAcks())
        return Triple(sender, a.id, b.id)
    }

    @Test
    fun twoLabPublishersDaylightShareHandsOverToTheLabReader() {
        val (sender, a, b) = handover(shareFirst = true)
        val after = sender.ledger.snapshot()
        assertEquals(listOf("android" to 0, "reader-lab" to 1), after.publishers.map { it.publisher to it.lab })
        assertTrue(after.inboxLab)
        assertEquals(listOf("quiet", "reader-doc", "reader-link", "st"), after.caps)
        assertEquals("reader", after.state(b)?.s)
        assertEquals("reader", after.state(a)?.s)
        assertEquals("In your Reader ✓", sender.rowText(b).label) // a PDF confirmed by the Lab Reader (R1.3)
    }

    @Test
    fun twoLabPublishersTheLabReaderHandsBackToDaylightShare() {
        val (sender, _, b) = handover(shareFirst = false)
        val after = sender.ledger.snapshot()
        assertEquals(listOf("android" to 1, "reader-lab" to 0), after.publishers.map { it.publisher to it.lab })
        assertEquals("reader-doc ends with the Lab Reader’s lab: 0", listOf("reader-link", "st", "tap"), after.caps)
        assertEquals("handed", after.state(b)?.s)
        assertEquals("Handed to the Reader", sender.rowText(b).label)
    }

    // ------------------------------------------------------------------------------------ Lab item extras (2.3, W0 part)

    @Test
    fun labHeaderExtrasReachTheKotlinInboxAndOldReceiversIgnoreThem() {
        val p = pairing()
        val big = Bytes.random(200_000) // random, so it is not deflated: 4 parts of 64 KiB, reassembled on disk
        val bigFile = File(tmp("dls-skew-big"), "excerpt.bin").apply { writeBytes(big) }
        val sent = js("current", "send", url, p.compactCode, Json.write(mapOf(
            "kind" to "file", "name" to "excerpt.html", "mime" to "text/html", "contentFile" to bigFile.path, "chunkSize" to 65_536,
            "extras" to mapOf("x-cap" to "excerpt", "x-orig" to "https://example.com/a?utm_source=x", "x-note" to "dropped"),
        )))
        val link = js("current", "send", url, p.compactCode, Json.write(mapOf(
            "kind" to "url", "url" to "https://example.com/a", "extras" to mapOf("x-orig" to "https://example.com/a?fbclid=1"),
        )))
        val accepted = CopyOnWriteArrayList<Reassembler.Completed>()
        val dir = tmp("dls-skew-extras")
        val receiver = Receiver(p, FileReceiverStore(File(dir, "state.json")), Reassembler(File(dir, "spool")), fast(p)) { done ->
            accepted += done
            (done.content as? FileBody)?.file?.delete()
        }
        val res = receiver.pollOnce()
        assertEquals(setOf(sent["id"], link["id"]), res.items.map { it.id }.toSet())
        val file = accepted.single { it.header.id == sent["id"] }
        assertEquals(ItemHeader.ENC_IDENTITY, file.header.enc)
        assertEquals(big.size.toLong(), file.header.size)
        assertEquals(mapOf("x-cap" to "excerpt", "x-orig" to "https://example.com/a?utm_source=x"), file.extras)
        assertEquals("excerpt", res.items.single { it.id == sent["id"] }.xCap)
        assertEquals(mapOf("x-orig" to "https://example.com/a?fbclid=1"), accepted.single { it.header.id == link["id"] }.extras)
        // The same items reach v1.0 and v1.1 receivers as plain items.
        for (old in listOf("v1.0", "v1.1")) {
            val r = js(old, "receive", url, p.compactCode)
            assertEquals(old, 2, r["items"].objs().size)
            assertArrayEquals(old, big, Bytes.fromHex(r["items"].objs().single { it["header"].obj()["id"] == sent["id"] }["contentHex"] as String))
        }
    }
}
