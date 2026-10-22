package com.daylight.share

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.daylight.share.core.lab.LabText
import com.daylight.share.inbox.ArrivalActionReceiver
import com.daylight.share.inbox.ArrivalNotices
import com.daylight.share.inbox.InboxHealth
import com.daylight.share.inbox.InboxText
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.ui.INBOX_HEALTH_TAG
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * F15's Inbox health on the DC-1 (LAB-PLAN 3.3; card K5), with a fake heartbeat and clock: Instant delivery stopped
 * (on, its service not running, no heartbeat for 2 minutes), the card at the top of the Inbox ("Last checked {rel} ·
 * Instant delivery on" and one warning at a time: stopped with Turn on, notifications off, the poll's error), and the
 * 15-minute job's "Instant delivery stopped" notice in "Inbox health", at most once every 12 hours, with Turn on.
 * With Lab off there is no card, no heartbeat and no notice.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class HealthTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val nm: NotificationManager get() = app.getSystemService(NotificationManager::class.java)
    private val relay = FakeRelay()
    private val now = 1_792_483_200_000L // 2026-10-20T08:00:00Z
    private val MIN = 60_000L

    @Before
    fun setUp() {
        InstantDeliveryService.running = false
        InstantDeliveryService.startedAt = 0L
    }

    @After
    fun tearDown() {
        InstantDeliveryService.running = false
        InstantDeliveryService.startedAt = 0L
    }

    private fun health(): Notification? = shadowOf(nm).getNotification(ArrivalNotices.HEALTH_NOTIFICATION)

    /** The Inbox with Instant delivery on, as after a reboot or a Task Manager stop: its service not running. */
    private fun inboxWithInstant(heartbeat: Long, instant: Boolean = true) {
        LabKit.useRelay(app, relay)
        app.prefs.instantDelivery = instant
        MainScreen.INBOX.prepare(app)
        InstantDeliveryService.startedAt = 0L
        app.prefs.labInstantBeat = heartbeat
        compose.runOnUiThread { compose.activity.resumes.intValue++ }
        compose.waitForIdle()
    }

    @Test
    fun stoppedMeansOnNotRunningAndNoHeartbeatForTwoMinutes() {
        assertFalse("off", InboxHealth.stopped(instantOn = false, running = false, beatAt = 0, now = now))
        assertFalse("running here", InboxHealth.stopped(instantOn = true, running = true, beatAt = 0, now = now))
        assertFalse("a heartbeat a minute ago", InboxHealth.stopped(instantOn = true, running = false, beatAt = now - MIN, now = now))
        assertFalse(InboxHealth.stopped(instantOn = true, running = false, beatAt = now - InboxHealth.STALE_MS, now = now))
        assertTrue(InboxHealth.stopped(instantOn = true, running = false, beatAt = now - InboxHealth.STALE_MS - 1, now = now))
        // A start just asked for counts as a heartbeat (the service is starting).
        app.prefs.instantDelivery = true
        app.prefs.labInstantBeat = 0L
        InstantDeliveryService.startedAt = now - MIN
        assertFalse(InboxHealth.stopped(app, now))
        InstantDeliveryService.startedAt = 0L
        assertTrue(InboxHealth.stopped(app, now))
    }

    @Test
    fun oneWarningAtATimeInThisOrder() {
        assertEquals(InboxHealth.Warning.STOPPED, InboxHealth.warning(stopped = true, notificationsOk = false, pollError = InboxText.OFFLINE))
        assertEquals(InboxHealth.Warning.NOTIFICATIONS, InboxHealth.warning(stopped = false, notificationsOk = false, pollError = InboxText.OFFLINE))
        assertEquals(InboxHealth.Warning.POLL, InboxHealth.warning(stopped = false, notificationsOk = true, pollError = InboxText.OFFLINE))
        assertNull(InboxHealth.warning(stopped = false, notificationsOk = true, pollError = null))
    }

    @Test
    fun theLineSaysWhenItLastCheckedAndWhetherInstantDeliveryIsOn() {
        assertEquals("Last checked just now · Instant delivery on", InboxHealth.line(lastCheck = 0, live = true, instantOn = true, now = now))
        assertEquals("Last checked 5 min ago · Instant delivery off", InboxHealth.line(lastCheck = now - 5 * MIN, live = false, instantOn = false, now = now))
        assertEquals(
            LabText.fill(LabText["arrivals.healthOff"], mapOf("rel" to LabText.relativeTime(now - 3 * 3_600_000L, now))),
            InboxHealth.line(lastCheck = now - 3 * 3_600_000L, live = false, instantOn = false, now = now),
        )
        assertNull("not checked yet", InboxHealth.line(lastCheck = 0, live = false, instantOn = true, now = now))
    }

    @Test
    fun theHeartbeatIsWrittenWithLabOnOnly() {
        InboxHealth.beat(app, now)
        assertEquals(now, app.prefs.labInstantBeat)
        app.setLab(false)
        InboxHealth.beat(app, now + MIN)
        assertEquals(now, app.prefs.labInstantBeat)
    }

    /** F15.2: the job's notice, once every 12 hours, with Turn on; none while it runs, with Lab off, or with it off. */
    @Test
    fun theJobSaysInstantDeliveryStoppedAtMostTwiceADay() {
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        LabKit.useRelay(app, relay)
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        app.prefs.instantDelivery = true
        app.setRole(Role.INBOX)
        InstantDeliveryService.startedAt = 0L
        app.prefs.labInstantBeat = now - 10 * MIN

        // Running in this process: nothing to say.
        InstantDeliveryService.running = true
        assertFalse(InboxHealth.checkInBackground(app, now))
        InstantDeliveryService.running = false

        assertTrue(InboxHealth.checkInBackground(app, now))
        val n = health()!!
        assertEquals(ArrivalNotices.CH_HEALTH, n.channelId)
        assertEquals(LabText["arrivals.channelHealth"], n.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("Instant delivery stopped. Turn it back on to get items within seconds.", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals(listOf(LabText["arrivals.turnOn"]), n.actions.map { it.title.toString() })
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, nm.getNotificationChannel(ArrivalNotices.CH_HEALTH).importance)

        // Not again within 12 hours; again after.
        nm.cancelAll()
        assertFalse(InboxHealth.checkInBackground(app, now + 11 * 3_600_000L))
        assertNull(health())
        assertTrue(InboxHealth.checkInBackground(app, now + 12 * 3_600_000L))

        // Turn on: the service is asked to start, and the notice goes.
        ArrivalActionReceiver().onReceive(app, shadowOf(health()!!.actions[0].actionIntent).savedIntent)
        assertNull(health())
        assertTrue(app.prefs.instantDelivery)
        val started = shadowOf(app as Application).nextStartedService
        assertNotNull(started)
        assertEquals(InstantDeliveryService::class.java.name, started.component!!.className)

        // Lab off, or Instant delivery off: no notice.
        InstantDeliveryService.startedAt = 0L
        app.setLab(false)
        assertFalse(InboxHealth.checkInBackground(app, now + 30 * 3_600_000L))
        app.setLab(true)
        app.prefs.instantDelivery = false
        assertFalse(InboxHealth.checkInBackground(app, now + 30 * 3_600_000L))
    }

    /** The 15-minute job itself (`SyncWorker`) runs the check after its poll. */
    @Test
    fun theFifteenMinuteJobRunsTheCheck() {
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        LabKit.useRelay(app, relay)
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        app.prefs.instantDelivery = true
        app.setRole(Role.INBOX)
        InstantDeliveryService.startedAt = 0L
        app.prefs.labInstantBeat = 0L
        val worker = TestListenableWorkerBuilder<SyncWorker>(app as Application).build()
        assertEquals(ListenableWorker.Result.success(), runBlocking { worker.doWork() })
        assertNotNull(health())
    }

    /** F15.2 on the screen: the warning card with Turn on, which starts Instant delivery again. */
    @Test
    fun theCardSaysInstantDeliveryStoppedWithTurnOn() {
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        inboxWithInstant(heartbeat = System.currentTimeMillis() - 10 * MIN)
        compose.onNode(hasTestTag(INBOX_HEALTH_TAG)).assertIsDisplayed()
        compose.onNodeWithText(LabText["arrivals.stopped"]).assertIsDisplayed()
        compose.onNodeWithText(LabText["arrivals.turnOn"]).performClick()
        compose.waitForIdle()
        val started = generateSequence { shadowOf(app as Application).nextStartedService }.toList()
        assertTrue(started.any { it.component?.className == InstantDeliveryService::class.java.name })
        assertTrue("the warning goes once it is starting", compose.onAllNodes(hasText(LabText["arrivals.stopped"])).fetchSemanticsNodes().isEmpty())
        // The line says what is on, in words, once the Inbox has checked.
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("Instant delivery on", substring = true)).fetchSemanticsNodes().isNotEmpty() }
    }

    /** Notifications off: the short state and Open Settings (the full sentence is F15's gate's, when tapped). */
    @Test
    fun theCardSaysWhenNotificationsAreOff() {
        shadowOf(app as Application).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        inboxWithInstant(heartbeat = System.currentTimeMillis(), instant = false)
        compose.onNodeWithText(LabText.short("needs-notifications")!!).assertIsDisplayed()
        compose.onNodeWithText(LabText.button("needs-notifications")!!).assertIsDisplayed()
    }

    /** The last poll's error, in the Inbox's own sentence; with Lab off, no card. */
    @Test
    fun theCardShowsThePollsErrorAndNothingWithLabOff() {
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        relay.offline = true
        inboxWithInstant(heartbeat = System.currentTimeMillis(), instant = false)
        val inCard = hasText(InboxText.OFFLINE) and hasAnyAncestor(hasTestTag(INBOX_HEALTH_TAG))
        compose.waitUntil(10_000) { compose.onAllNodes(inCard).fetchSemanticsNodes().isNotEmpty() }
        app.setLab(false)
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasTestTag(INBOX_HEALTH_TAG)).fetchSemanticsNodes().isEmpty())
    }
}
