package com.daylight.share

import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.FileReceiverStore
import com.daylight.share.core.Keys
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Pairing
import com.daylight.share.core.RelayClient
import com.daylight.share.inbox.InboxHealth
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.Live
import com.daylight.share.inbox.handover.Handover
import com.daylight.share.inbox.handover.HandoverProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
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
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The handover to the Lab Reader (LAB-PLAN 5.3.4; card K6), with a fake provider on each side: the Lab Reader's
 * `ShareInboxProvider` ([FakeReaderInbox], `call("receiving")` as R1 will answer it, or missing, throwing or answering
 * nonsense) and Daylight Share's [HandoverProvider] as a calling package reaches it ([AsCaller]). It checks:
 *
 * - the contract: the provider's authority `com.daylight.share.handover`, exported; the manifest's `<queries>` names
 *   the Lab Reader's pinned package and its `ShareInboxProvider` authority;
 * - step 2: `call("pairing")` answers `{code, relay, name, since}` only while armed (2 minutes; a clock set back reads as
 *   not armed), with Lab on, in the Inbox role, and only to `com.daylightcomputer.readerexperiment`; the grant is used
 *   up; an unknown caller (the real provider under Robolectric has none) gets nothing;
 * - step 3: then nothing polls the pairing lane (the poll, the 15-minute job, the live connection), Instant delivery
 *   stops and does not start, Inbox health does not call it stopped, and the Inbox's Lab frames say `lab: 0` once and
 *   no hello follows, even when Lab is switched off and on;
 * - step 4, the resume rule: the Inbox asks before each would-be poll; it resumes only when the Reader says false or is
 *   uninstalled; a provider that is **invisible while the package is installed** (not there, throwing, an answer without
 *   a Boolean) never makes it resume, however often it asks; on resuming the receive cursor skips what the Lab Reader
 *   took, Instant delivery starts again and a hello goes;
 * - a new pairing (Reset pairing) ends a handover; Lab off keeps it.
 *
 * Every relay request goes to a relay in memory ([FakeRelay]) with a fake clock; the Inbox's Lab frames go only when a
 * test flushes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HandoverTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private var now = 1_792_483_200_000L // 2026-10-20T08:00:00Z
    private val relay = FakeRelay { now }
    private val handover: Handover get() = app.handover
    private val keys: Keys get() = app.inbox.ensurePairing().keys

    /** The Lab Reader's `ShareInboxProvider` (LAB-PLAN 5.3): `call("receiving")` -> [answer], or it throws [failure]. */
    class FakeReaderInbox : ContentProvider() {
        override fun onCreate() = true

        override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
            calls.incrementAndGet()
            failure?.let { throw it }
            return if (method == Handover.METHOD_RECEIVING) answer else null
        }

        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

        companion object {
            @Volatile var answer: Bundle? = null
            @Volatile var failure: Exception? = null
            val calls = AtomicInteger()

            fun receiving(on: Boolean) {
                answer = Bundle().apply { putBoolean(Handover.KEY_RECEIVING, on) }
            }

            fun reset() {
                answer = null
                failure = null
                calls.set(0)
            }
        }
    }

    /** [HandoverProvider] as the app [pkg] calls it (Android tells the provider the calling package; here the test does). */
    class AsCaller : HandoverProvider() {
        override fun caller(): String? = pkg

        companion object {
            @Volatile var pkg: String? = null
        }
    }

    @Before
    fun setUp() {
        // Live is one object for the whole test run: holders that earlier tests' activities left behind go first.
        Live.release("screen")
        Live.release("instant")
        FakeReaderInbox.reset()
        AsCaller.pkg = null
        InstantDeliveryService.running = false
        LabKit.useRelay(app, relay)
        app.labReporter.clock = { now }
        handover.clock = { now }
        // The device's clock as the Inbox's relay client reads it (the relay's clock is the relay's, FakeRelay's `now`).
        app.inbox.clock = { now }
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        // The Lab state digest runs with the v1.1 ack digest, every 11 hours: not due at the start of a test.
        app.prefs.labDigestAt = now
        app.prefs.instantDelivery = false
        app.setRole(Role.INBOX)
        Robolectric.setupContentProvider(AsCaller::class.java, Handover.AUTHORITY)
    }

    @After
    fun tearDown() {
        Live.release(LIVE_HOLDER)
        InstantDeliveryService.running = false
    }

    // ------------------------------------------------------------------------------------------------- helpers

    private fun installLabReader() {
        shadowOf(app.packageManager).installPackage(PackageInfo().apply {
            packageName = Handover.LAB_READER
            applicationInfo = ApplicationInfo().apply { packageName = Handover.LAB_READER }
        })
    }

    /** The Lab Reader's inbox provider is there and answers (a visible provider). */
    private fun readerInbox(receiving: Boolean) {
        FakeReaderInbox.receiving(receiving)
        Robolectric.setupContentProvider(FakeReaderInbox::class.java, Handover.readerAuthority())
    }

    /** `call("pairing")` on Daylight Share's provider, as [caller]. */
    private fun askForPairing(caller: String?): Bundle? {
        AsCaller.pkg = caller
        return app.contentResolver.call(Uri.parse("content://${Handover.AUTHORITY}"), Handover.METHOD_PAIRING, null, null)
    }

    /** The whole handover: the Lab Reader installed, the grant armed, its call. -> the answer. */
    private fun handOver(): Bundle {
        installLabReader()
        handover.arm()
        val b = askForPairing(Handover.LAB_READER)
        assertNotNull("the Lab Reader got no answer", b)
        assertNotNull("the Lab Reader got no code: ${b!!.getString(Handover.KEY_ERROR)}", b.getString(Handover.KEY_CODE))
        return b
    }

    /** A sender on the Inbox's pairing, publishing to the relay in memory. */
    private fun sender(): Outbox {
        val p = app.inbox.ensurePairing()
        return Outbox(Pairing(p.secret, p.relay, "iPhone"), FileOutboxStore(File(app.filesDir, "test-sender")), RelayClient(p.relay, relay))
    }

    private fun sendLink(s: Outbox, title: String): String {
        val row = s.add(OutgoingItem(Kind.URL, url = "https://example.com/${title.lowercase()}", title = title, from = "iPhone"), null)
        s.publish(row.id)
        return row.id
    }

    /** The Inbox's reads of its inbox topic (polls and the live stream; a sender's publishes there are not its own). */
    private fun inboxRequests(): List<String> = relay.requests.toList().filter { it.startsWith("GET ") && it.contains(keys.inboxTopic) }

    private fun poll(): Int = runBlocking { app.inbox.pollOnce() }

    /** The Lab frames this Inbox put on its ack topic (a Lab frame's `ids` is empty). */
    private fun labFrames(): List<Map<String, Any?>> = relay.ackHeaders(keys).filter { (it["ids"] as? List<*>)?.isEmpty() == true }

    @Suppress("UNCHECKED_CAST")
    private fun labLevels(): List<Any?> = labFrames().map { (it["x-inbox"] as Map<String, Any?>)["lab"] }

    private fun logs(): List<String> = ShadowLog.getLogsForTag(TAG).map { it.msg }

    private fun assertLogged(line: String) =
        assertTrue("not logged: $line\n--- logged:\n${logs().joinToString("\n")}", logs().any { it.contains(line) })

    private fun waitUntil(ms: Long, what: String, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (!cond()) {
            if (System.currentTimeMillis() > end) throw AssertionError("timed out waiting for $what")
            Thread.sleep(20)
        }
    }

    // ----------------------------------------------------------------------------------------------- the contract

    /** LAB-PLAN 5.3.4 step 2 and K6's `<queries>` entry: what the Lab Reader (R1) builds against. */
    @Test
    fun theContractsAuthoritiesAndQueries() {
        assertEquals("com.daylight.share.handover", Handover.AUTHORITY)
        assertEquals("com.daylightcomputer.readerexperiment", Handover.LAB_READER)
        assertEquals(setOf(Handover.LAB_READER), Handover.ALLOWED)
        assertEquals("com.daylightcomputer.readerexperiment.shareinbox", Handover.readerAuthority())

        val info = app.packageManager.resolveContentProvider(Handover.AUTHORITY, 0)
        assertNotNull("no provider for ${Handover.AUTHORITY}", info)
        assertEquals(HandoverProvider::class.java.name, info!!.name)
        assertTrue("the handover provider must be exported", info.exported)

        // The source manifest's <queries> (Robolectric has no package visibility to ask).
        val manifest = listOf(File("src/main/AndroidManifest.xml"), File("app/src/main/AndroidManifest.xml")).first { it.isFile }
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest)
        val queries = doc.getElementsByTagName("queries").item(0)
        val ns = "http://schemas.android.com/apk/res/android"
        val entries = (0 until queries.childNodes.length).map { queries.childNodes.item(it) }.filterIsInstance<org.w3c.dom.Element>()
        assertTrue("<queries> names the Lab Reader's package", entries.any { it.tagName == "package" && it.getAttributeNS(ns, "name") == Handover.LAB_READER })
        assertTrue("<queries> names the Lab Reader's ShareInboxProvider", entries.any { it.tagName == "provider" && it.getAttributeNS(ns, "authorities") == Handover.readerAuthority() })
    }

    // ----------------------------------------------------------------------------------------- step 2: the grant

    @Test
    fun onlyTheLabReaderGetsThePairingAndOnlyWhileArmed() {
        installLabReader()
        val p = app.inbox.ensurePairing()

        // Not armed: the Lab Reader hears why; nothing changes.
        assertEquals(Handover.ERROR_NOT_ARMED, askForPairing(Handover.LAB_READER)!!.getString(Handover.KEY_ERROR))
        assertNull(handover.receivingElsewhere())

        handover.arm()
        assertTrue(handover.armed())
        // Any other app, or a caller Android did not name, gets nothing, and the grant stays for the Lab Reader.
        assertNull(askForPairing("com.example.reader"))
        assertNull(askForPairing("com.daylightcomputer.reader"))
        assertNull(askForPairing("com.daylightcomputer.readerexperiment.other"))
        assertNull(askForPairing(null))
        assertTrue(handover.armed())
        assertNull(handover.receivingElsewhere())
        assertLogged("lab: handover: refused the pairing to com.example.reader")

        // The Lab Reader: the code, the relay, the name, and where the Inbox's cursor is.
        val b = askForPairing(Handover.LAB_READER)!!
        assertNull(b.getString(Handover.KEY_ERROR))
        assertArrayEquals(p.secret, Pairing.parseCode(b.getString(Handover.KEY_CODE)))
        assertEquals(p.relay, b.getString(Handover.KEY_RELAY))
        assertEquals(app.prefs.deviceName, b.getString(Handover.KEY_NAME))
        assertEquals("all", b.getString(Handover.KEY_SINCE))
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())
        assertEquals(Handover.LAB_READER, app.prefs.receivingElsewhere)
        assertEquals(Handover.LAB_READER, handover.state.value.elsewhere)
        assertLogged("lab: handover: com.daylightcomputer.readerexperiment receives for this Daylight now")

        // The grant was used up: asking again gets nothing new.
        assertFalse(handover.armed())
        assertEquals(Handover.ERROR_NOT_ARMED, askForPairing(Handover.LAB_READER)!!.getString(Handover.KEY_ERROR))
    }

    @Test
    fun theRealProviderGivesNothingToACallerAndroidDidNotName() {
        installLabReader()
        handover.arm()
        val real = Robolectric.buildContentProvider(HandoverProvider::class.java).create().get()
        assertNull(real.call(Handover.METHOD_PAIRING, null, null))
        assertNull(real.call("receiving", null, null))
        assertNull(real.query(Uri.parse("content://${Handover.AUTHORITY}/pairing"), null, null, null, null))
        assertTrue(handover.armed())
        assertNull(handover.receivingElsewhere())
    }

    @Test
    fun theGrantLastsTwoMinutesWithLabOnOnTheInbox() {
        installLabReader()
        handover.arm()
        now += Handover.GRANT_MS + 1
        assertEquals(Handover.ERROR_NOT_ARMED, askForPairing(Handover.LAB_READER)!!.getString(Handover.KEY_ERROR))

        // A clock set back after arming reads as not armed (never a grant longer than 2 minutes).
        handover.arm()
        now -= 10 * 60_000L
        assertFalse(handover.armed())
        now += 10 * 60_000L

        // Lab off, or not the Inbox: not armed either.
        handover.arm()
        app.setLab(false)
        assertEquals(Handover.ERROR_NOT_ARMED, askForPairing(Handover.LAB_READER)!!.getString(Handover.KEY_ERROR))
        app.setLab(true)
        app.setRole(Role.SENDER)
        assertEquals(Handover.ERROR_NOT_ARMED, askForPairing(Handover.LAB_READER)!!.getString(Handover.KEY_ERROR))
        app.setRole(Role.INBOX)

        // Within the 2 minutes, with Lab on, on the Inbox: handed over.
        now += Handover.GRANT_MS - 1_000
        assertNotNull(askForPairing(Handover.LAB_READER)!!.getString(Handover.KEY_CODE))
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())
    }

    // ---------------------------------------------------------------------- step 3: nothing polls, Lab frames

    @Test
    fun whileTheLabReaderReceivesTheInboxPollsNothing() {
        val s = sender()
        sendLink(s, "Before")
        assertEquals(1, poll())
        handOver()
        readerInbox(receiving = true)
        relay.requests.clear()
        sendLink(s, "During")

        assertEquals(0, poll())
        assertEquals(0, poll())
        // The 15-minute job too.
        val worker = TestListenableWorkerBuilder<SyncWorker>(app as Application).build()
        assertEquals(ListenableWorker.Result.success(), runBlocking { worker.doWork() })

        assertEquals("no request on the inbox topic: ${inboxRequests()}", emptyList<String>(), inboxRequests())
        assertTrue("asked before each would-be poll: ${FakeReaderInbox.calls.get()}", FakeReaderInbox.calls.get() >= 3)
        assertEquals(1, app.inbox.items.value.size)
        assertEquals(Handover.Reach.RECEIVING, handover.state.value.reach)
        assertLogged("lab: handover: com.daylightcomputer.readerexperiment receives; poll skipped")
    }

    @Test
    fun noLiveConnectionWhileTheLabReaderReceives() {
        handOver()
        readerInbox(receiving = true)
        Live.acquire(LIVE_HOLDER)
        Thread.sleep(300)
        relay.requests.clear()
        Thread.sleep(1_500)
        assertEquals("no live connection or poll: ${inboxRequests()}", emptyList<String>(), inboxRequests())

        // The Reader stops: the next would-be poll resumes, and the live connection opens again.
        FakeReaderInbox.receiving(false)
        poll()
        waitUntil(10_000, "the live connection's catch-up poll and stream") { inboxRequests().size >= 3 }
    }

    @Test
    fun instantDeliveryStopsAndStaysStoppedThenStartsAgain() {
        app.prefs.instantDelivery = true
        while (shadowOf(app as Application).nextStoppedService != null) Unit
        handOver()
        readerInbox(receiving = true)
        val stopped = shadowOf(app as Application).nextStoppedService
        assertEquals(InstantDeliveryService::class.java.name, stopped?.component?.className)

        // Started anyway (boot, the switch, Turn on): it stops itself and holds no connection.
        val service = Robolectric.buildService(InstantDeliveryService::class.java).create()
        service.startCommand(0, 1)
        assertTrue(shadowOf(service.get()).isStoppedBySelf)
        assertFalse(InstantDeliveryService.running)
        // Inbox health does not call it stopped: it is off on purpose.
        app.prefs.labInstantBeat = 0L
        InstantDeliveryService.startedAt = 0L
        assertFalse(InboxHealth.stopped(app, now))
        assertFalse(InboxHealth.checkInBackground(app, now))

        // Resuming starts it again.
        while (shadowOf(app as Application).nextStartedService != null) Unit
        FakeReaderInbox.receiving(false)
        poll()
        val started = generateSequence { shadowOf(app as Application).nextStartedService }.toList()
        assertTrue("Instant delivery started again: $started", started.any { it.component?.className == InstantDeliveryService::class.java.name })
        assertNull(handover.receivingElsewhere())
    }

    @Test
    fun theInboxsLabFramesSayLabZeroOnceThenAHelloOnResuming() {
        app.labReporter.flushNow()
        assertEquals(listOf<Any?>(1.0), labLevels())

        now += 31_000
        handOver()
        readerInbox(receiving = true)
        assertEquals(0, app.labReporter.info().lab)
        app.labReporter.flushNow()
        assertEquals(listOf<Any?>(1.0, 0.0), labLevels())

        // Lab switched off and on meanwhile: still nothing from the Inbox (the Lab Reader says its own hellos).
        now += 31_000
        app.setLab(false)
        app.labReporter.flushNow()
        now += 31_000
        app.setLab(true)
        app.labReporter.flushNow()
        now += 12 * 3_600_000L
        app.labReporter.flushNow()
        assertEquals(listOf<Any?>(1.0, 0.0), labLevels())

        // The Reader stops receiving: the Inbox resumes, and its hello says Lab again.
        now += 31_000
        app.prefs.labDigestAt = now // no ack digest due with this poll (it would repeat lab: 0 before the hello)
        FakeReaderInbox.receiving(false)
        poll()
        assertEquals(1, app.labReporter.info().lab)
        app.labReporter.flushNow()
        assertEquals(1.0, labLevels().last())
    }

    /**
     * K6 review (2.2.4): no poll runs while the Lab Reader receives, so there is no ack digest, yet the `lab: 0` frame is
     * still repeated every 11 hours for 48 hours, so a sender that was offline still reads this Inbox's Lab as off.
     */
    @Test
    fun theLabZeroFrameIsRepeatedDuringAHandover() {
        app.labReporter.flushNow()
        now += 31_000
        handOver()
        readerInbox(receiving = true)
        app.labReporter.flushNow()
        assertEquals(listOf<Any?>(1.0, 0.0), labLevels())
        relay.requests.clear()
        // Within the 11 hours a skipped poll sends nothing.
        now += 3_600_000L
        assertEquals(0, poll())
        assertEquals(listOf<Any?>(1.0, 0.0), labLevels())
        // Then one lab: 0 frame each 11 hours, while within 48 hours of the first; nothing after.
        for (i in 1..5) {
            now += Limits.DIGEST_INTERVAL_MS
            assertEquals(0, poll())
        }
        assertEquals(listOf<Any?>(1.0, 0.0, 0.0, 0.0, 0.0, 0.0), labLevels())
        assertEquals("nothing polled meanwhile", emptyList<String>(), inboxRequests())
    }

    // -------------------------------------------------------------------------------------- step 4: the resume rule

    @Test
    fun itResumesWhenTheReaderSaysItStopped() {
        handOver()
        readerInbox(receiving = true)
        relay.requests.clear()
        assertEquals(0, poll())
        assertTrue(inboxRequests().isEmpty())

        FakeReaderInbox.receiving(false)
        poll()
        assertTrue("it polled: ${relay.requests}", inboxRequests().isNotEmpty())
        assertNull(handover.receivingElsewhere())
        assertNull(app.prefs.receivingElsewhere)
        assertNull(handover.state.value.elsewhere)
        assertLogged("lab: handover: the Inbox receives here again (com.daylightcomputer.readerexperiment is not receiving)")

        // Receiving here: no more questions to the Reader.
        val asked = FakeReaderInbox.calls.get()
        poll()
        assertEquals(asked, FakeReaderInbox.calls.get())
    }

    /**
     * The invisible provider (LAB-PLAN 5.3 HandoverTest): the Lab Reader is installed but its provider cannot be
     * reached (not there or not visible, throwing, answering without a Boolean `receiving`). Daylight Share must not
     * resume, however often it asks: the Lab Reader may still be receiving, and two receivers would both take every item.
     */
    @Test
    fun anInvisibleProviderWhileInstalledNeverMakesItResume() {
        val s = sender()
        handOver()
        relay.requests.clear()
        sendLink(s, "Meanwhile")

        // No provider at all (Robolectric answers null; Android throws "Unknown URI").
        repeat(3) { assertEquals(0, poll()) }
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())
        assertEquals(Handover.Reach.UNREACHABLE, handover.state.value.reach)
        assertLogged("lab: handover: can't reach com.daylightcomputer.readerexperiment; poll skipped")

        // A provider that throws, as Android's own refusals do.
        Robolectric.setupContentProvider(FakeReaderInbox::class.java, Handover.readerAuthority())
        for (e in listOf(SecurityException("not visible"), IllegalArgumentException("Unknown URI"), IllegalStateException("dead"))) {
            FakeReaderInbox.failure = e
            assertEquals(0, poll())
        }
        FakeReaderInbox.failure = null

        // Answers that are not a Boolean "receiving": no answer, another key, a string.
        for (answer in listOf(null, Bundle(), Bundle().apply { putBoolean("receivingElsewhere", false) }, Bundle().apply { putString(Handover.KEY_RECEIVING, "false") })) {
            FakeReaderInbox.answer = answer
            assertEquals(0, poll())
        }
        assertEquals("nothing polled while the Lab Reader may be receiving: ${inboxRequests()}", emptyList<String>(), inboxRequests())
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())
        assertTrue(app.inbox.items.value.isEmpty())
        // Receive here again is not offered: only a "not receiving" answer offers it.
        assertEquals(Handover.Reach.UNREACHABLE, handover.check())
        assertFalse(handover.receiveHereAgain())
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())

        // Uninstalled (PackageManager says so): the Inbox resumes and takes what nobody took.
        shadowOf(app.packageManager).removePackage(Handover.LAB_READER)
        assertEquals(1, poll())
        assertNull(handover.receivingElsewhere())
        assertLogged("lab: handover: the Inbox receives here again (com.daylightcomputer.readerexperiment is not installed)")
    }

    @Test
    fun receiveHereAgainAsksTheReaderFirst() {
        handOver()
        readerInbox(receiving = true)
        assertEquals(Handover.Reach.RECEIVING, handover.check())
        assertFalse(handover.receiveHereAgain())
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())

        FakeReaderInbox.receiving(false)
        // check() only records the answer (the button shows); it does not resume by itself.
        assertEquals(Handover.Reach.NOT_RECEIVING, handover.check())
        assertEquals(Handover.Reach.NOT_RECEIVING, handover.state.value.reach)
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())
        assertTrue(handover.receiveHereAgain())
        assertNull(handover.receivingElsewhere())
        assertLogged("lab: handover: the Inbox receives here again (Receive here again)")
    }

    /**
     * Resuming skips what the Lab Reader took: the receive cursor moves up to the last time the Reader may have been
     * receiving, less the protocol's 30-minute overlap. Items sent after that come in; earlier ones were the Reader's.
     */
    @Test
    fun resumingSkipsWhatTheLabReaderTook() {
        val s = sender()
        val before = sendLink(s, "Before")
        assertEquals(1, poll())

        now += 3_600_000L
        handOver()
        readerInbox(receiving = true)
        now += 3_600_000L
        val tookByReader = sendLink(s, "Reader") // the Lab Reader took this one
        now += 40 * 60_000L
        assertEquals(0, poll()) // the Reader still receives: the last time it may have been
        val lastSeen = now
        now += 20 * 60_000L
        val gap = sendLink(s, "Gap") // the Reader may or may not have taken it before it stopped
        now += 60 * 60_000L
        val afterwards = sendLink(s, "After") // nobody took it
        FakeReaderInbox.receiving(false)
        assertEquals(2, poll())

        val ids = app.inbox.items.value.map { it.id }.toSet()
        assertEquals(setOf(before, gap, afterwards), ids)
        assertFalse(tookByReader in ids)
        val since = FileReceiverStore(File(app.filesDir, "inbox/receiver-${keys.inboxTopic}.json")).load().since.toLong()
        assertTrue("cursor $since from ${lastSeen / 1000 - Limits.CURSOR_OVERLAP_S}", since >= lastSeen / 1000 - Limits.CURSOR_OVERLAP_S)
    }

    /**
     * K6 review: the cursor is a relay time, so the resume turns the device's last-seen time into relay time with the
     * relay's own clock (the times of its answers). A DC-1 whose clock runs 2 hours fast still takes what reached the
     * relay after the Lab Reader stopped; before, it skipped everything within 1.5 hours of that.
     */
    @Test
    fun aFastClockDoesNotSkipWhatCameAfterTheReaderStopped() {
        val fast = 2 * 3_600_000L
        handover.clock = { now + fast }
        app.labReporter.clock = { now + fast }
        app.inbox.clock = { now + fast }
        val s = sender()
        sendLink(s, "Before")
        assertEquals(1, poll()) // its ack's publish answers with the relay's time
        assertEquals(-fast, app.prefs.inboxRelayOffsetMs)

        now += 3_600_000L
        handOver()
        readerInbox(receiving = true)
        now += 30 * 60_000L
        assertEquals(0, poll()) // the Reader still receives: the last time it may have been
        now += 5 * 60_000L
        FakeReaderInbox.receiving(false) // it stops, and then this reaches the relay: nobody took it
        now += 5 * 60_000L
        val after = sendLink(s, "After")
        assertEquals(1, poll())
        assertTrue(after in app.inbox.items.value.map { it.id })
        val since = FileReceiverStore(File(app.filesDir, "inbox/receiver-${keys.inboxTopic}.json")).load().since.toLong()
        assertTrue("the cursor $since is a relay time, not ahead of the item's", since <= relay.messages(keys.inboxTopic).last().time)
    }

    /**
     * K6 review, round 2: the resume reads the relay's clock again (`/v1/health`'s Date) before it moves the cursor. A
     * DC-1 that ran 2 hours fast when it last heard the relay, and whose clock was set right (NTP) while the Lab Reader
     * received, does not put the cursor 2 hours early, which would take again what the Lab Reader took.
     */
    @Test
    fun aClockSetRightDuringTheHandoverIsMeasuredAgainAtTheResume() {
        val fast = 2 * 3_600_000L
        var skew = fast
        handover.clock = { now + skew }
        app.labReporter.clock = { now + skew }
        app.inbox.clock = { now + skew }
        val s = sender()
        sendLink(s, "Before")
        assertEquals(1, poll())
        assertEquals(-fast, app.prefs.inboxRelayOffsetMs)

        now += 3_600_000L
        handOver()
        readerInbox(receiving = true)
        now += 3_600_000L
        skew = 0L // NTP sets the DC-1's clock right
        val tookByReader = sendLink(s, "Reader") // the Lab Reader took this one
        now += 40 * 60_000L
        assertEquals(0, poll()) // the Reader still receives: the last time it may have been, on the right clock
        val lastSeen = now
        now += 5 * 60_000L
        FakeReaderInbox.receiving(false)
        now += 5 * 60_000L
        val after = sendLink(s, "After") // nobody took it
        relay.requests.clear()
        assertEquals(1, poll())

        assertTrue("the resume asked the relay's clock: ${relay.requests}", "GET /v1/health" in relay.requests)
        assertEquals(0L, app.prefs.inboxRelayOffsetMs)
        val ids = app.inbox.items.value.map { it.id }.toSet()
        assertTrue(after in ids)
        assertFalse("the Inbox took again what the Lab Reader took", tookByReader in ids)
        val since = FileReceiverStore(File(app.filesDir, "inbox/receiver-${keys.inboxTopic}.json")).load().since.toLong()
        assertTrue("cursor $since from ${lastSeen / 1000 - Limits.CURSOR_OVERLAP_S}", since >= lastSeen / 1000 - Limits.CURSOR_OVERLAP_S)
    }

    @Test
    fun handingOverPassesTheInboxsCursor() {
        val s = sender()
        sendLink(s, "Before")
        assertEquals(1, poll())
        val since = FileReceiverStore(File(app.filesDir, "inbox/receiver-${keys.inboxTopic}.json")).load().since
        assertTrue(since.toLongOrNull() != null)
        assertEquals(since, handOver().getString(Handover.KEY_SINCE))
    }

    // ---------------------------------------------------------------------------------- pairing and the Lab switch

    @Test
    fun aNewPairingEndsTheHandover() {
        handOver()
        readerInbox(receiving = true)
        app.inbox.resetPairing()
        // At once for every reader of the state, and the poll goes to the new pairing without asking the Lab Reader.
        assertNull(handover.receivingElsewhere())
        val asked = FakeReaderInbox.calls.get()
        relay.requests.clear()
        poll()
        assertEquals(asked, FakeReaderInbox.calls.get())
        assertTrue(inboxRequests().isNotEmpty())
        waitUntil(5_000, "the handover forgotten") { app.prefs.receivingElsewhere == null }
    }

    @Test
    fun labOffKeepsTheHandover() {
        handOver()
        readerInbox(receiving = true)
        app.setLab(false)
        relay.requests.clear()
        assertEquals(0, poll())
        assertTrue(inboxRequests().isEmpty())
        assertEquals(Handover.LAB_READER, handover.receivingElsewhere())
        assertTrue(FakeReaderInbox.calls.get() >= 1)
        // ... and the resume rule still runs with Lab off.
        FakeReaderInbox.receiving(false)
        poll()
        assertNull(handover.receivingElsewhere())
        assertTrue(inboxRequests().isNotEmpty())
    }

    @Test
    fun theHandoverOutlivesARestartOfTheApp() {
        handOver()
        readerInbox(receiving = true)
        // What a new process reads: the settings.
        val again = Handover(app)
        assertEquals(Handover.LAB_READER, again.receivingElsewhere())
        assertEquals(Handover.LAB_READER, again.state.value.elsewhere)
        again.clock = { now }
        assertFalse(again.beforePoll())
    }

    private companion object {
        const val LIVE_HOLDER = "handover-test"
    }
}
