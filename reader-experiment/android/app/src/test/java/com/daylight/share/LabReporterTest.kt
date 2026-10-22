package com.daylight.share

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Looper
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.Keys
import com.daylight.share.core.Kind
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Pairing
import com.daylight.share.core.RelayClient
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabFrame
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.HandoffActivity
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.LabReporter
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.WaitingCard
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog
import java.io.File
import java.time.Duration

/**
 * The DC-1 Inbox's Lab frames (LAB-PLAN F17, K1; LAB-PROTOCOL 2.2.3, 2.2.4) as the app drives share-core's LabInbox:
 * which state each hand-off path records (2.2.3's mapping, an unknown status as handed, nothing for "started"),
 * `waiting` once per item, a held item that is announced again stays held, server-lane items record nothing; the hello
 * and its caps, the log lines, giving way after failed acks and 429/413 from polls, hello cadence (at most 3 a day
 * while idle, plus one per Lab toggle), the `lab: 0` frame and its repeats, nothing at all from a store with Lab off,
 * Reset pairing, and the debug setup link's `lab=`. Every relay request goes to a relay in memory ([FakeRelay]), with
 * a fake clock; flushes run when the test says ([LabReporter.autoFlush] off).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LabReporterTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private var now = 1_792_483_200_000L // 2026-10-20T08:00:00Z
    private val relay = FakeRelay { now }
    private val reporter: LabReporter get() = app.labReporter
    private val keys: Keys get() = app.inbox.ensurePairing().keys

    private val link = InboxItem(id = "a".repeat(32), kind = Kind.URL, url = "https://example.com/a", title = "A link", from = "Mac", received = 1_000)
    private val pdf = InboxItem(id = "b".repeat(32), kind = Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper", from = "iPhone", received = 2_000, file = "${"b".repeat(32)}/paper.pdf")

    @Before
    fun setUp() {
        HandoffActivity.running = false
        HandoffActivity.requestedAt = 0L
        HandoffActivity.claim = null
        HandoffActivity.lastImportHandoff = 0L
        WaitingCard.forget()
        FileProvider::class.java.declaredFields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && Map::class.java.isAssignableFrom(it.type) }
            .forEach { f ->
                f.isAccessible = true
                (f.get(null) as? MutableMap<*, *>)?.clear()
            }
        app.inbox.http = relay
        reporter.autoFlush = false
        reporter.clock = { now }
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        // The Lab state digest runs with the v1.1 ack digest, every 11 hours: not due at the start of a test.
        app.prefs.labDigestAt = now
        app.setRole(Role.INBOX)
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun inboxWith(vararg items: InboxItem) {
        for (i in items) {
            app.inbox.put(i)
            i.file?.let { File(app.inbox.filesRoot, it).apply { parentFile!!.mkdirs(); writeText("%PDF-1.4") } }
        }
    }

    private fun runHandoff(intent: Intent): ActivityController<HandoffActivity> {
        val c = Robolectric.buildActivity(HandoffActivity::class.java, intent).setup()
        idle()
        return c
    }

    /** The states recorded and not published yet: id -> state. */
    @Suppress("UNCHECKED_CAST")
    private fun pending(): Map<String, String> =
        (reporter.inbox()!!.debugState()["pending"] as List<Map<String, Any?>>).associate { it["i"] as String to it["s"] as String }

    /** The Lab frames this Inbox put on its ack topic (an ack frame lists ids; a Lab frame's `ids` is empty). */
    private fun labFrames(): List<Map<String, Any?>> = relay.ackHeaders(keys).filter { (it["ids"] as? List<*>)?.isEmpty() == true }

    private fun hellos(frames: List<Map<String, Any?>> = labFrames()) = frames.filter { it["x-st"] == null }

    @Suppress("UNCHECKED_CAST")
    private fun inboxOf(h: Map<String, Any?>): Map<String, Any?> = h["x-inbox"] as Map<String, Any?>

    private fun logs(): List<String> = ShadowLog.getLogsForTag(TAG).map { it.msg }

    private fun assertLogged(line: String) =
        assertTrue("not logged: $line\n--- logged:\n${logs().joinToString("\n")}", logs().any { it.contains(line) })

    // ------------------------------------------------------------------------------------------- what it records

    @Test
    fun theReadersStatusMapsAsInLabProtocol223() {
        for (s in listOf("saved", "duplicate")) assertEquals(s, "reader", LabReporter.stateFor(s))
        assertEquals("queued", LabReporter.stateFor("queued"))
        for (s in listOf("no_reader", "no_route")) assertEquals(s, "inbox", LabReporter.stateFor(s))
        // sent, ok, no_answer, and any status not listed (the Reader's status is a free string): handed.
        for (s in listOf("sent", "ok", "no_answer", "refused", "weird", "", null)) assertEquals("$s", "handed", LabReporter.stateFor(s))
    }

    /** Every SAVE_PAGE answer through the real hand-off, and nothing while the Reader has not answered ("started"). */
    @Test
    fun eachSavePageAnswerRecordsItsState() {
        ScreenKit.installReader(app)
        val cases = listOf(
            Triple("saved", Activity.RESULT_OK, "reader"),
            Triple("duplicate", Activity.RESULT_OK, "reader"),
            Triple("queued", Activity.RESULT_OK, "queued"),
            Triple("something-new", Activity.RESULT_OK, "handed"),
            Triple(null, Activity.RESULT_OK, "handed"), // ok
            Triple(null, Activity.RESULT_CANCELED, "handed"), // no_answer
        )
        for ((n, case) in cases.withIndex()) {
            val (status, code, expected) = case
            val item = link.copy(id = "%032x".format(0x100 + n), received = 10_000L + n)
            inboxWith(item)
            val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
            val save = shadowOf(c.get()).nextStartedActivityForResult
            assertEquals(ReaderApps.ACTION_SAVE_PAGE, save.intent.action)
            assertNull("nothing for \"started\"", pending()[item.id])
            shadowOf(c.get()).receiveResult(save.intent, code, if (status == null) null else Intent().putExtra(ReaderApps.EXTRA_STATUS, status))
            idle()
            assertEquals("status $status ($code)", expected, pending()[item.id])
            c.pause().stop().destroy()
            idle()
        }
    }

    /** SAVE_PAGE refused (read-later off), then shared as a link: handed. */
    @Test
    fun aRefusedSavePageSharedAsALinkIsHanded() {
        ScreenKit.installReader(app)
        inboxWith(link)
        val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        val save = shadowOf(c.get()).nextStartedActivityForResult
        shadowOf(c.get()).receiveResult(save.intent, Activity.RESULT_OK, Intent().putExtra(ReaderApps.EXTRA_STATUS, "refused"))
        idle()
        assertEquals("send_link", app.inbox.get(link.id)!!.via)
        assertEquals(mapOf(link.id to "handed"), pending())
        assertLogged("lab: state ${link.id} handed")
    }

    @Test
    fun aDocumentGoesToTheReadersImportAndIsHanded() {
        ScreenKit.installReader(app)
        inboxWith(pdf)
        runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        assertEquals(Intent.ACTION_SEND, shadowOf(app).nextStartedActivity.action)
        assertEquals(mapOf(pdf.id to "handed"), pending())
    }

    /** Kept in the Inbox: no Reader at all (no_reader), and a document whose content is gone. */
    @Test
    fun whatStaysInTheInboxIsInbox() {
        inboxWith(link, pdf)
        Handoff.dispatch(app)
        idle()
        assertEquals(mapOf(link.id to "inbox", pdf.id to "inbox"), pending())

        ScreenKit.installReader(app)
        val gone = pdf.copy(id = "c".repeat(32), file = "${"c".repeat(32)}/missing.pdf")
        app.inbox.put(gone)
        runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        assertEquals("inbox", pending()[gone.id])
    }

    /** `waiting` when first announced, never again; held (swiped away, or Later on the card) stays held. */
    @Test
    fun waitingIsRecordedOnceAndAHeldItemStaysHeld() {
        inboxWith(pdf)
        Handoff.notifyWaiting(app, listOf(app.inbox.get(pdf.id)!!))
        assertEquals(mapOf(pdf.id to "waiting"), pending())
        assertLogged("lab: state ${pdf.id} waiting")

        // Swiped away: kept for later on purpose.
        Handoff.onDismissed(app, pdf.id)
        assertEquals(mapOf(pdf.id to "held"), pending())

        // Announced again (a hand-off's end announces what still waits; the notice's state was forgotten): still held.
        app.prefs.keepNoticeIds(emptySet())
        Handoff.notifyWaiting(app, listOf(app.inbox.get(pdf.id)!!))
        assertEquals(mapOf(pdf.id to "held"), pending())

        // Published; then announced once more: waiting is not recorded a second time for this id.
        assertEquals("states", reporter.flushNow()!!.kind)
        @Suppress("UNCHECKED_CAST")
        val st = labFrames().single()["x-st"] as List<Map<String, Any?>>
        assertEquals(listOf(pdf.id to "held"), st.map { it["i"] to it["s"] })
        reporter.announced(listOf(app.inbox.get(pdf.id)!!))
        assertEquals(emptyMap<String, String>(), pending())

        // Later on the card, for another item.
        val epub = pdf.copy(id = "d".repeat(32), name = "book.epub", file = null)
        app.inbox.put(epub)
        reporter.held(listOf(epub.id))
        assertEquals(mapOf(epub.id to "held"), pending())
    }

    @Test
    fun serverLaneItemsRecordNothing() {
        val server = link.copy(lane = InboxItem.LANE_SERVER)
        assertEquals(InboxItem.LANE_SERVER, InboxItem.fromJson(server.toJson())!!.lane)
        assertEquals(InboxItem.LANE_PAIRING, InboxItem.fromJson(link.toJson())!!.lane)
        assertFalse("v1.1's items.json is unchanged for pairing items", link.toJson().containsKey("lane"))
        inboxWith(server)
        reporter.announced(listOf(server))
        reporter.handedOff(server, "saved")
        reporter.kept(server)
        reporter.held(listOf(server.id))
        ScreenKit.installReader(app)
        val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        val save = shadowOf(c.get()).nextStartedActivityForResult
        shadowOf(c.get()).receiveResult(save.intent, Activity.RESULT_OK, Intent().putExtra(ReaderApps.EXTRA_STATUS, "saved"))
        idle()
        assertEquals(InboxItem.IN_READER, app.inbox.get(server.id)!!.state)
        assertEquals(emptyMap<String, String>(), pending())
    }

    // ----------------------------------------------------------------------------------------------- what it sends

    @Test
    fun theHelloSaysLabAppAndCaps() {
        val r = reporter.flushNow()!!
        assertEquals("hello", r.kind)
        val h = hellos().single()
        val x = inboxOf(h)
        assertEquals(1.0, x["lab"])
        assertEquals("android/${BuildConfig.VERSION_NAME}", x["app"])
        // cap-kind (W1, K5): the Inbox's rows show each item's x-cap kind (F03).
        assertEquals(listOf("st", "tap", "cap-kind"), x["caps"])
        assertEquals(false, x["live"])
        val parsed = LabFrame.parse(h)
        assertNotNull(parsed.inbox)
        assertTrue(parsed.states.isEmpty())
        assertTrue("a small frame", relay.messages(keys.ackTopic).all { it.text.length <= 3_800 })
        assertLogged("lab: hello caps=st,tap,cap-kind")

        // A Reader that confirms links and pages (SAVE_PAGE): the caps change, and the next flush says so.
        ScreenKit.installReader(app)
        assertEquals(listOf("st", "tap", "reader-link", "cap-kind"), reporter.caps())
        now += 31_000
        assertEquals("hello", reporter.flushNow()!!.kind)
        assertEquals(listOf("st", "tap", "reader-link", "cap-kind"), inboxOf(hellos().last())["caps"])
        // Nothing changed: nothing goes.
        now += 31_000
        assertEquals("idle", reporter.flushNow()!!.reason)
    }

    @Test
    fun statesGoOutInAFrameAndTheLogSaysSo() {
        reporter.flushNow() // the hello
        now += 31_000
        reporter.handedOff(link, "saved")
        reporter.handedOff(pdf, "sent")
        val r = reporter.flushNow()!!
        assertEquals("states", r.kind)
        assertEquals(2, r.states)
        @Suppress("UNCHECKED_CAST")
        val st = labFrames().last()["x-st"] as List<Map<String, Any?>>
        assertEquals(listOf(link.id to "reader", pdf.id to "handed"), st.map { it["i"] to it["s"] })
        assertEquals((now / 1000).toDouble(), st[0]["t"])
        assertNotNull("a state frame carries x-inbox too", labFrames().last()["x-inbox"])
        assertLogged("lab: states n=2 published")
    }

    /** After a poll, once its acks are out: the poll time, a failed ack publish, and a 429/413 make the frames give way. */
    @Test
    fun aPollsOutcomeComesFirst() {
        // A sender's link reaches the Inbox through its poll.
        val p = app.inbox.ensurePairing()
        val sender = Outbox(Pairing(p.secret, p.relay, ""), FileOutboxStore(File(app.filesDir, "test-sender")), RelayClient(p.relay, relay))
        val row = sender.add(OutgoingItem(Kind.URL, url = "https://example.com/polled", title = "Polled"), null)
        sender.publish(row.id)

        // The ack publish fails (the relay answers 429): the Lab frames give way, for an hour.
        relay.publishStatus = 429
        assertEquals(1, runBlocking { app.inbox.pollOnce() })
        val st = reporter.inbox()!!.debugState()
        assertEquals(now, (st["lastPoll"] as Number).toLong())
        assertEquals(true, st["acksFailed"])
        assertEquals(now + Lab.LAB_YIELD_MS, (st["limitUntil"] as Number).toLong())
        relay.publishStatus = 200
        reporter.handedOff(app.inbox.get(row.id)!!, "saved")
        assertEquals("yield", reporter.flushNow()!!.reason)
        assertTrue(labFrames().isEmpty())

        // The next poll's acks go out, but the hour is not over.
        now += 30 * 60_000L
        runBlocking { app.inbox.pollOnce() }
        assertEquals(false, reporter.inbox()!!.debugState()["acksFailed"])
        assertEquals("yield", reporter.flushNow()!!.reason)

        // A poll the relay answers 429: another hour.
        relay.pollStatus = 429
        runBlocking { app.inbox.pollOnce() }
        assertEquals(now + Lab.LAB_YIELD_MS, (reporter.inbox()!!.debugState()["limitUntil"] as Number).toLong())
        relay.pollStatus = 200
        now += Lab.LAB_YIELD_MS + 1
        val r = reporter.flushNow()!!
        assertEquals("states", r.kind)
        @Suppress("UNCHECKED_CAST")
        assertEquals(listOf(row.id to "reader"), (labFrames().single()["x-st"] as List<Map<String, Any?>>).map { it["i"] to it["s"] })
    }

    /** The live path: a failed ack publish, then a 413 from it. */
    @Test
    fun aLiveBatchsAcksComeFirstToo() {
        reporter.afterLiveAcks(ackFailed = true, limitStatus = 0)
        reporter.handedOff(link, "saved")
        assertEquals("yield", reporter.flushNow()!!.reason)
        reporter.afterLiveAcks(ackFailed = false, limitStatus = 413)
        assertEquals("yield", reporter.flushNow()!!.reason)
        now += Lab.LAB_YIELD_MS + 1
        assertEquals("states", reporter.flushNow()!!.kind)
    }

    /** F17.3: at most 3 hellos a day while idle (every 15 minutes a poll), plus one per Lab toggle, at least 30 s apart. */
    @Test
    fun helloCadence() {
        val start = now
        repeat(4 * 24) {
            reporter.afterPoll(ackFailed = false, limitStatus = 0)
            reporter.flushNow()
            now += 15 * 60_000L
        }
        val day = hellos()
        assertEquals("hellos in a day while idle: ${day.map { inboxOf(it)["poll"] }}", 3, day.size)
        assertTrue(labFrames().all { it["x-st"] == null })

        // A Lab toggle: one lab: 0 frame, then one hello.
        app.setLab(false)
        reporter.flushNow()
        now += 31_000
        app.setLab(true)
        reporter.flushNow()
        val all = labFrames()
        assertEquals(5, all.size)
        assertEquals(0.0, inboxOf(all[3])["lab"])
        assertEquals(emptyList<String>(), inboxOf(all[3])["caps"])
        assertEquals(1.0, inboxOf(all[4])["lab"])
        val times = relay.messages(keys.ackTopic).map { it.time }
        assertTrue("30 s apart: $times", times.zipWithNext().all { (a, b) -> b - a >= 30 })
        assertTrue(now - start < 25 * 3_600_000L)
    }

    /** Lab off: one lab: 0 frame, the same frame after each digest for 48 hours (at most 5 more), then nothing; no states. */
    @Test
    fun labOffSendsTheLabZeroFrameAndItsRepeatsOnly() {
        reporter.flushNow() // the hello
        now += 60_000
        app.setLab(false)
        assertEquals("off", reporter.flushNow()!!.kind)
        reporter.handedOff(link, "saved")
        reporter.announced(listOf(pdf))
        assertEquals(emptyMap<String, String>(), pending())
        repeat(4 * 4 * 24) { // four days of polls
            reporter.afterPoll(ackFailed = false, limitStatus = 0)
            reporter.flushNow()
            now += 15 * 60_000L
        }
        val off = labFrames().drop(1)
        assertTrue("the lab: 0 frame and at most 5 repeats: ${off.size}", off.size in 2..6)
        assertTrue(off.all { inboxOf(it)["lab"] == 0.0 && it["x-st"] == null })
        val times = relay.messages(keys.ackTopic).drop(1).map { it.time }
        assertTrue("none after 48 hours", times.all { it - times[0] <= 48 * 3_600 + 15 * 60 })
    }

    /** With Lab off from the start (a new store), nothing is recorded and nothing at all is published. */
    @Test
    fun aNewStoreWithLabOffPublishesNothing() {
        app.setLab(false)
        inboxWith(pdf)
        Handoff.notifyWaiting(app, listOf(app.inbox.get(pdf.id)!!))
        reporter.handedOff(pdf, "sent")
        repeat(3 * 4 * 24) {
            runBlocking { app.inbox.pollOnce() }
            reporter.flushNow()
            now += 15 * 60_000L
        }
        assertEquals(emptyMap<String, String>(), pending())
        assertTrue(relay.messages(keys.ackTopic).isEmpty())
    }

    @Test
    fun resetPairingClearsTheStore() {
        reporter.handedOff(link, "saved")
        val old = keys.inboxTopic
        assertTrue(reporter.storeFile(old).isFile)
        app.inbox.resetPairing()
        assertFalse(reporter.storeFile(old).exists())
        assertTrue(keys.inboxTopic != old)
        assertEquals(emptyMap<String, String>(), pending())
    }

    /** The debug builds' setup link: `lab=0|1` sets the switch (LAB-PLAN 1.7); without it, the switch stays. */
    @Test
    fun theDebugSetupLinkSetsLab() {
        fun setup(query: String) {
            val code = Pairing.generate().compactCode
            val uri = Uri.parse("daylightshare://setup?role=inbox&c=$code&r=http%3A%2F%2F127.0.0.1%3A9&n=CI$query")
            val c = Robolectric.buildActivity(MainActivity::class.java, Intent(Intent.ACTION_VIEW, uri).setClass(app, MainActivity::class.java)).setup()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
            c.pause().stop().destroy()
        }
        setup("&lab=0")
        assertFalse(app.prefs.lab)
        assertFalse(app.labOn.value)
        assertLogged("lab=0")
        setup("")
        assertFalse("kept", app.prefs.lab)
        setup("&lab=1")
        assertTrue(app.prefs.lab)
        assertLogged("lab=1")
    }
}
