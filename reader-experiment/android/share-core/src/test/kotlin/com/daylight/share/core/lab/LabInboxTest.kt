package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.Keys
import com.daylight.share.core.Purpose
import com.daylight.share.core.RelayClient
import com.daylight.share.core.ShareException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.time.Instant
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.io.path.createTempDirectory

/**
 * The Inbox's Lab frames (LAB-PROTOCOL 2.2.4) with a fake clock and an in-memory relay: record with the merge rule,
 * flush in 24s, 30 s spacing, giving way after a 429 or 413 and after failed acks, the daily cap, halving a refused
 * batch, the hello cadence, the lab: 0 frame and its 48-hour repeats, the pending cap and the digest. Then the sender's
 * ledger on files: where it lives, pruning and the pairing rule.
 */
class LabInboxTest {
    private val start = Instant.parse("2026-10-19T08:00:00Z").toEpochMilli() // a Monday morning, UTC
    private var clock = start
    private val http = FakeRelayHttp { clock }
    private val keys = Keys.derive(Bytes.random(16))
    private val relay = RelayClient("https://relay.test", http, emptyList())
    private var hello = LabInboxInfo(1, "android/1.5.0", listOf("st", "tap"), live = true)
    private val scheduled = ArrayList<Long>()
    private val logs = ArrayList<String>()

    private fun inbox(
        store: LabStore = MemoryLabStore(),
        buildFrame: ((Keys, LabInboxInfo, List<LabState>, String, String) -> ByteArray)? = null,
    ) = if (buildFrame == null) {
        LabInbox(store, relay, keys, { hello }, "Daylight", { clock }, { scheduled += it }, { logs += it })
    } else {
        LabInbox(store, relay, keys, { hello }, "Daylight", { clock }, { scheduled += it }, { logs += it }, buildFrame)
    }

    /** Every Lab frame published so far, as a sender reads it. */
    private fun frames(): List<LabAck> = http.on(keys.ackTopic).map {
        LabFrame.parse(FrameCodec.open(keys, Purpose.ACK, Bytes.fromBase64OrNull(it.text)!!).header)
    }

    private fun id(n: Int) = Bytes.toHex(Bytes.sha256(Bytes.utf8("item-$n"))).substring(0, 32)
    private val t: Long get() = clock / 1000

    private fun advance(ms: Long) {
        clock += ms
    }

    @Test
    fun recordKeepsAnEntryOnlyWhenItBeatsWhatIsPendingAndPublished() {
        val lab = inbox()
        assertEquals(LabInbox.FlushResult(1, "hello", 0, "sent"), lab.flush())
        advance(Lab.LAB_FRAME_GAP_MS)
        assertTrue(lab.record(id(1), "waiting", t))
        assertEquals(Lab.LAB_FLUSH_DELAY_MS, scheduled.last())
        assertFalse("the same rank and t", lab.record(id(1), "waiting", t))
        assertTrue("a higher rank replaces it", lab.record(id(1), "held", t - 5))
        assertFalse("a lower rank is ignored", lab.record(id(1), "waiting", t + 100))
        assertTrue("the same rank, later", lab.record(id(1), "inbox", t + 1))
        assertEquals(1, lab.flush().states)
        assertEquals(listOf(LabState(id(1), "inbox", t + 1)), frames().last().states)
        advance(Lab.LAB_FRAME_GAP_MS)
        // A re-announced item never goes back: what was published counts too.
        assertFalse(lab.record(id(1), "waiting", t))
        assertFalse(lab.record(id(1), "held", t - 100))
        assertTrue(lab.record(id(1), "reader", t))
        // Bad entries are refused, and logged.
        assertFalse(lab.record("NOT-AN-ID", "reader", t))
        assertFalse(lab.record(id(2), "done", t))
        assertFalse(lab.record(id(2), "reader", Lab.T_MAX + 1))
        assertFalse(lab.record(id(2), "reader", -1))
        assertTrue(logs.any { it.startsWith("lab: bad state") })
        assertTrue(logs.contains("lab: state ${id(1)} reader"))
    }

    @Test
    fun flushSendsAtMost24StatesAFrameOldestFirstAndOneFrameEvery30Seconds() {
        val lab = inbox()
        for (n in 1..50) assertTrue(lab.record(id(n), "reader", t + n))
        val first = lab.flush()
        assertEquals(LabInbox.FlushResult(1, "states", 24, "sent"), first)
        assertEquals((1..24).map { id(it) }, frames().last().states.map { it.i })
        assertEquals(Lab.LAB_FRAME_GAP_MS, scheduled.last()) // more waits
        advance(10_000)
        val early = lab.flush()
        assertEquals("spacing", early.reason)
        assertEquals(20_000L, early.waitMs)
        assertEquals(20_000L, scheduled.last())
        advance(20_000)
        assertEquals(24, lab.flush().states)
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals(2, lab.flush().states)
        assertEquals((25..50).map { id(it) }, frames().drop(1).flatMap { it.states }.map { it.i })
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals("idle", lab.flush().reason)
        // Every state frame is also a hello.
        for (f in frames()) assertEquals(LabInboxInfo(1, "android/1.5.0", listOf("st", "tap"), null, true), f.inbox)
        assertTrue(logs.contains("lab: states n=24 published"))
    }

    @Test
    fun labFramesGiveWayAfterFailedAcksAndForAnHourAfterA429Or413() {
        val lab = inbox()
        lab.record(id(1), "reader", t)
        lab.noteAcksFailed()
        assertEquals("yield", lab.flush().reason)
        lab.noteAcksFailed(false)
        assertEquals("sent", lab.flush().reason)
        for (status in listOf(429, 413)) {
            advance(Lab.LAB_FRAME_GAP_MS)
            lab.record(id(status), "reader", t)
            lab.noteRelayLimit(status)
            assertEquals("yield", lab.flush().reason)
            advance(Lab.LAB_YIELD_MS - 1)
            assertEquals("yield", lab.flush().reason)
            advance(1)
            assertEquals("sent", lab.flush().reason)
        }
        lab.noteRelayLimit(500) // not a limit
        advance(Lab.LAB_FRAME_GAP_MS)
        lab.record(id(2), "reader", t)
        assertEquals("sent", lab.flush().reason)
        // A publish that the relay answers 429 keeps the entry and gives way for an hour.
        advance(Lab.LAB_FRAME_GAP_MS)
        lab.record(id(3), "reader", t)
        http.failPublish = { 429 }
        val failed = lab.flush()
        assertEquals("error", failed.reason)
        assertNotNull(failed.error)
        http.failPublish = { null }
        advance(Lab.LAB_YIELD_MS - 1)
        assertEquals("yield", lab.flush().reason)
        advance(1)
        assertEquals(listOf(id(3)), lab.flush().let { frames().last().states.map { it.i } })
        // No answer at all keeps the entry too, without the hour.
        advance(Lab.LAB_FRAME_GAP_MS)
        lab.record(id(4), "reader", t)
        http.failPublish = { -1 }
        assertEquals("error", lab.flush().reason)
        http.failPublish = { null }
        assertEquals(1, lab.flush().states)
        assertTrue(logs.any { it.startsWith("lab: publish failed") })
    }

    @Test
    fun atMost30HellosAndStateFramesAUtcDayButDigestsAndLabOffGoOn() {
        val lab = inbox()
        var n = 0
        repeat(40) {
            lab.record(id(++n), "reader", t)
            lab.flush()
            advance(Lab.LAB_FRAME_GAP_MS)
        }
        assertEquals(Lab.LAB_FRAMES_PER_DAY, frames().size)
        assertEquals("cap", lab.flush().reason)
        // The digest still goes, past the cap.
        val d = lab.digest()
        assertEquals("digest", d.kind)
        assertEquals(Lab.MAX_ST_PER_FRAME, d.states)
        // The next UTC day, the waiting states go.
        clock = Instant.parse("2026-10-20T00:00:00Z").toEpochMilli()
        val r = lab.flush()
        assertEquals("sent", r.reason)
        // The lab: 0 frame is outside the cap.
        repeat(Lab.LAB_FRAMES_PER_DAY) {
            advance(Lab.LAB_FRAME_GAP_MS)
            lab.record(id(++n), "reader", t)
            lab.flush()
        }
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals("cap", lab.let { it.record(id(++n), "reader", t); it.flush() }.reason)
        assertEquals("off", lab.labTurnedOff().kind)
    }

    @Test
    fun aBatchThatIsNotSmallIsHalvedAndAnEntryThatNeverFitsIsDropped() {
        val tooBig = id(7)
        val lab = inbox(buildFrame = { k, inbox, states, from, sent ->
            if (states.size > 5 || states.any { it.i == tooBig }) throw ShareException("lab", "a Lab frame must be a small frame", "not-small")
            LabFrame.build(k, inbox, states, from, sent)
        })
        for (n in 1..24) lab.record(id(n), "reader", t + n)
        // 24 -> 12 -> 6 -> 3, and 1..3 go.
        assertEquals(3, lab.flush().states)
        assertEquals((1..3).map { id(it) }, frames().last().states.map { it.i })
        advance(Lab.LAB_FRAME_GAP_MS)
        // 4..24: 21 -> 11 -> 6 -> 3: 4, 5, 6.
        assertEquals(3, lab.flush().states)
        advance(Lab.LAB_FRAME_GAP_MS)
        // 7 is first now and never fits: 21 -> … -> 1 (7), dropped; then 8.. go in the same flush.
        val r = lab.flush()
        assertEquals("sent", r.reason)
        assertTrue(logs.any { it == "lab: dropped state $tooBig reader: the frame is not small" })
        assertFalse(frames().flatMap { it.states }.any { it.i == tooBig })
        // A hello that does not fit is a programming error, not a stall: it throws.
        val broken = inbox(MemoryLabStore(), buildFrame = { _, _, _, _, _ -> throw ShareException("lab", "x", "not-small") })
        try {
            broken.flush()
            org.junit.Assert.fail("a hello that is not small throws")
        } catch (e: ShareException) {
            assertEquals("not-small", e.reason)
        }
    }

    @Test
    fun hellosGoWhenLabTurnsOnWhenCapsOrAppChangeAndAtMost3ADayWhileIdle() {
        val lab = inbox()
        assertEquals("hello", lab.flush().kind) // never said hello
        assertTrue(logs.contains("lab: hello caps=st,tap"))
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals("idle", lab.flush().reason)
        // A day of flushes every 15 minutes while idle: a hello every 11 hours, at most 3.
        val before = frames().size
        repeat(24 * 4) {
            advance(15 * 60_000L)
            lab.flush()
        }
        val idle = frames().size - before
        assertTrue("$idle hellos in a day", idle in 2..3)
        // New caps (the Reader target changed) or a new version: a hello at the next flush.
        advance(Lab.LAB_FRAME_GAP_MS)
        hello = hello.copy(caps = listOf("st", "tap", "reader-link"))
        assertEquals("hello", lab.flush().kind)
        assertEquals(listOf("st", "tap", "reader-link"), frames().last().inbox!!.caps)
        advance(Lab.LAB_FRAME_GAP_MS)
        hello = hello.copy(app = "android/1.5.1")
        assertEquals("hello", lab.flush().kind)
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals("idle", lab.flush().reason)
        // Turning Lab on sends one at once.
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals("hello", lab.labTurnedOn().kind)
        // The hello's poll is the last successful poll.
        advance(Lab.LAB_FRAME_GAP_MS)
        lab.notePolled(clock - 2_000)
        assertEquals("hello", lab.labTurnedOn().kind)
        assertEquals(clock - 2_000, frames().last().inbox!!.poll)
        assertEquals(true, frames().last().inbox!!.live)
    }

    @Test
    fun labOffSendsOneLab0FrameRepeatedAfterEachDigestFor48Hours() {
        val lab = inbox()
        lab.flush()
        advance(Lab.LAB_FRAME_GAP_MS)
        lab.record(id(1), "waiting", t)
        val off = lab.labTurnedOff()
        assertEquals(LabInbox.FlushResult(1, "off", 0, "sent"), off)
        val f = frames().last()
        assertEquals(0, f.inbox!!.lab)
        assertEquals(emptyList<String>(), f.inbox!!.caps)
        assertEquals("pending states go with Lab", emptyList<LabState>(), f.states)
        assertTrue(logs.contains("lab: hello lab=0"))
        advance(Lab.LAB_FRAME_GAP_MS)
        assertFalse("nothing is recorded while Lab is off", lab.record(id(2), "reader", t))
        assertEquals("off", lab.flush().reason)
        // The v1.1 digest every 11 hours repeats it, at most 5 times within 48 hours.
        var repeats = 0
        repeat(8) {
            advance(11 * 3_600_000L)
            if (lab.digest().kind == "off") repeats++
        }
        assertEquals(4, repeats) // 11, 22, 33 and 44 h; at 55 h it is over 48 h
        val lab2 = inbox()
        lab2.labTurnedOff()
        var r2 = 0
        repeat(8) {
            advance(5 * 3_600_000L)
            if (lab2.digest().kind == "off") r2++
        }
        assertEquals(Lab.LAB_OFF_REPEATS, r2)
        // Lab on again: a hello with lab 1.
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals("hello", lab2.labTurnedOn().kind)
        assertEquals(1, frames().last().inbox!!.lab)
    }

    @Test
    fun atMost500PendingEntriesTheOldestGoFirst() {
        val lab = inbox()
        lab.noteAcksFailed()
        for (n in 1..520) lab.record(id(n), "reader", t)
        @Suppress("UNCHECKED_CAST")
        val pending = lab.debugState()["pending"] as List<Map<String, Any?>>
        assertEquals(Lab.PENDING_MAX, pending.size)
        assertEquals(id(21), pending.first()["i"])
        assertEquals(id(520), pending.last()["i"])
    }

    @Test
    fun theDigestRepublishesTheLatestStateOfEveryItemChangedIn48Hours() {
        val lab = inbox()
        lab.record(id(100), "reader", t - 49 * 3600) // older than the window: never in a digest
        for (n in 1..30) lab.record(id(n), "handed", t + n)
        lab.flush() // 24 published
        advance(Lab.LAB_FRAME_GAP_MS)
        lab.flush() // 7 published: 25..30 and 100
        advance(Lab.LAB_FRAME_GAP_MS)
        for (n in 1..20) lab.record(id(n), "reader", t + 100 + n) // pending, folded into the digest
        lab.record(id(31), "waiting", t + 200)
        for (n in 32..60) lab.record(id(n), "waiting", t + 300 + n)
        val r = lab.digest()
        assertEquals("digest", r.kind)
        assertEquals(24, r.states)
        val d1 = frames().last().states
        // Newest first; at most 48 in all (2 frames).
        assertEquals(d1.sortedByDescending { it.t }, d1)
        assertEquals(id(60), d1.first().i)
        advance(Lab.LAB_FRAME_GAP_MS)
        val r2 = lab.flush()
        assertEquals("digest", r2.kind)
        assertEquals(24, r2.states)
        val all = frames().takeLast(2).flatMap { it.states }
        assertEquals(Lab.STATE_DIGEST_MAX, all.size)
        assertEquals(all.size, all.map { it.i }.toSet().size)
        assertFalse(all.any { it.i == id(100) })
        // What the digest took is no longer pending; the rest goes as states.
        advance(Lab.LAB_FRAME_GAP_MS)
        val rest = lab.flush()
        assertEquals("states", rest.kind)
        assertTrue(frames().last().states.none { s -> all.any { it.i == s.i } })
    }

    /**
     * A flush holds the store's lock to choose its frame and to commit it, not while it publishes: record, the notes,
     * debugState and clear go on meanwhile (K1 calls record from the hand-off, on the main thread). A second flush of
     * the same file, from another LabInbox too, waits for the first and then keeps the spacing.
     */
    @Test
    fun recordAndTheNotesNeverWaitForAPublishInFlight() {
        val file = File(createTempDirectory("dls-labinbox").toFile(), "lab-dls-test.json")
        val lab = inbox(FileLabStore(file))
        assertEquals("sent", lab.flush().reason) // the hello
        advance(Lab.LAB_FRAME_GAP_MS)
        val t = this.t // fixed: the clock moves on below
        assertTrue(lab.record(id(1), "inbox", t))
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        http.failPublish = {
            entered.countDown()
            assertTrue("released", release.await(30, TimeUnit.SECONDS))
            null
        }
        val pool = Executors.newFixedThreadPool(3)
        try {
            val first = pool.submit(Callable { lab.flush() })
            assertTrue(entered.await(10, TimeUnit.SECONDS))
            val other = inbox(FileLabStore(file)) // the same file, another object (a worker and the app)
            val second = pool.submit(Callable { other.flush() })
            pool.submit(Callable {
                assertTrue(lab.record(id(1), "reader", t)) // beats the entry in flight
                assertTrue(other.record(id(2), "inbox", t))
                assertFalse(lab.record(id(3), "done", t))
                lab.notePolled(clock)
                lab.noteAcksFailed(false)
                lab.noteRelayLimit(200)
                lab.debugState()
            }).get(5, TimeUnit.SECONDS) // fails with a TimeoutException if any of them waited for the relay
            try {
                second.get(300, TimeUnit.MILLISECONDS)
                fail("the second flush ran while the first was publishing")
            } catch (e: TimeoutException) {
                // it waits for the first
            }
            release.countDown()
            assertEquals(LabInbox.FlushResult(1, "states", 1, "sent"), first.get(10, TimeUnit.SECONDS))
            assertEquals("spacing", second.get(10, TimeUnit.SECONDS).reason)
            assertEquals(listOf(LabState(id(1), "inbox", t)), frames().last().states)
            assertEquals(2, frames().size)
            // What was recorded during the publish is still pending, and goes next.
            advance(Lab.LAB_FRAME_GAP_MS)
            assertEquals(2, lab.flush().states)
            assertEquals(setOf(LabState(id(1), "reader", t), LabState(id(2), "inbox", t)), frames().last().states.toSet())

            // clear() during a publish: it does not wait, and the publish's outcome is not written back.
            advance(Lab.LAB_FRAME_GAP_MS)
            assertTrue(lab.record(id(4), "reader", t))
            val entered2 = CountDownLatch(1)
            val release2 = CountDownLatch(1)
            http.failPublish = {
                entered2.countDown()
                assertTrue("released", release2.await(30, TimeUnit.SECONDS))
                null
            }
            val third = pool.submit(Callable { lab.flush() })
            assertTrue(entered2.await(10, TimeUnit.SECONDS))
            pool.submit(Callable { lab.clear() }).get(5, TimeUnit.SECONDS)
            release2.countDown()
            assertEquals("sent", third.get(10, TimeUnit.SECONDS).reason)
            assertFalse("nothing written after clear()", file.exists())
            assertTrue(logs.contains("lab: cleared during a publish"))
        } finally {
            release.countDown()
            pool.shutdownNow()
            http.failPublish = { null }
        }
    }

    @Test
    fun theStoreSurvivesARestart() {
        val dir = createTempDirectory("dls-labinbox").toFile()
        val file = File(dir, "lab-dls-test.json")
        val a = inbox(FileLabStore(file))
        a.flush()
        a.record(id(1), "reader", t)
        val b = inbox(FileLabStore(file))
        assertEquals("spacing", b.flush().reason) // the last Lab frame was 0 s ago
        advance(Lab.LAB_FRAME_GAP_MS)
        assertEquals(1, b.flush().states)
        b.clear()
        assertFalse(file.exists())
    }

    @Test
    fun aSendersLedgerReadsWhatTheInboxPublishes() {
        val lab = inbox()
        for (n in 1..3) lab.record(id(n), if (n == 3) "handed" else "reader", t)
        lab.flush()
        val ledger = LabLedger(MemoryLabStore()) { clock }
        for (m in http.on(keys.ackTopic)) ledger.record(FrameCodec.open(keys, Purpose.ACK, Bytes.fromBase64OrNull(m.text)!!).header, m.time)
        val snap = ledger.snapshot()
        assertTrue(snap.inboxLab)
        assertEquals(listOf("st", "tap"), snap.caps)
        assertEquals("handed", snap.state(id(3))?.s)
        assertEquals((clock / 1000) * 1000, snap.checkedIn)
    }

    // ------------------------------------------------------------------------------------------- the sender's ledger

    @Test
    fun theLedgerLivesNextToTheOutboxAndGoesWithIt() {
        val outbox = FileOutboxStore(createTempDirectory("dls-ledger").toFile())
        val ledger = LabLedger.of(outbox) { clock }
        val header = linkedMapOf<String, Any?>(
            "v" to 1.0, "kind" to "ack", "ids" to emptyList<Any?>(),
            "x-inbox" to linkedMapOf("lab" to 1.0, "app" to "android/1.5.0", "caps" to listOf("st")),
            "x-st" to listOf(linkedMapOf("i" to id(1), "s" to "reader", "t" to t.toDouble())),
        )
        ledger.record(header, null) // no relay time: now
        assertEquals(File(outbox.dir, "lab.json"), outbox.labFile)
        assertTrue(outbox.labFile.isFile)
        assertEquals(clock, ledger.checkedIn())
        assertTrue(LabLedger.of(outbox) { clock }.inboxLab()) // another object on the same file
        outbox.clear() // a pairing with another secret
        assertFalse(LabLedger.of(outbox) { clock }.inboxLab())
        assertNull(LabLedger.of(outbox) { clock }.state(id(1)))
    }

    @Test
    fun pruneKeepsTheOutboxsIdsAtMost200TheLatestFirst() {
        val ledger = LabLedger(MemoryLabStore()) { clock }
        for (chunk in (1..300).chunked(24)) {
            ledger.record(linkedMapOf("kind" to "ack", "ids" to emptyList<Any?>(), "x-st" to chunk.map { linkedMapOf("i" to id(it), "s" to "reader", "t" to (1000 + it).toDouble()) }), t)
        }
        assertEquals(300, ledger.snapshot().states.size)
        ledger.prune((1..250).map { id(it) } + "f".repeat(32))
        val kept = ledger.snapshot().states
        assertEquals(Lab.LEDGER_STATES_MAX, kept.size)
        assertEquals((51..250).map { id(it) }.toSet(), kept.keys)
        // Headers that are not acks, or not objects, change nothing (not even heard).
        val fresh = LabLedger(MemoryLabStore()) { clock }
        fresh.record(linkedMapOf("kind" to "item"), t)
        fresh.record(null, t)
        assertNull(fresh.checkedIn())
        // At most 1,000 states between prunes.
        for (chunk in (1..1100).chunked(24)) {
            fresh.record(linkedMapOf("kind" to "ack", "ids" to emptyList<Any?>(), "x-st" to chunk.map { linkedMapOf("i" to id(it), "s" to "reader", "t" to it.toDouble()) }), t)
        }
        assertEquals(Lab.LEDGER_STATES_HARD_MAX, fresh.snapshot().states.size)
        assertNotNull(fresh.state(id(1100)))
        assertNull(fresh.state(id(100)))
    }
}
