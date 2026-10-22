package com.daylight.share

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.os.Looper
import android.widget.TextView
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.lab.LabText
import com.daylight.share.inbox.ArrivalActionReceiver
import com.daylight.share.inbox.ArrivalNotices
import com.daylight.share.inbox.Arrivals
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.HandoffActivity
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxLab
import com.daylight.share.inbox.NoticeDismissedReceiver
import com.daylight.share.inbox.Notices
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.WaitingCard
import org.junit.After
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
import org.robolectric.shadows.ShadowSettings
import java.io.File
import java.util.Calendar

/**
 * F15 on the DC-1 Inbox with Lab on (LAB-PLAN 3.3; card K5): a waiting item's notice and card get **Add to Reader**
 * and **Keep for later**; Keep for later and a swiped notice keep the item for later (`held`: it waits, and nothing
 * hands it over until Add to Reader); Add to Reader then gives `reader` for a link and `handed` for a document; waiting
 * excerpts from one sender share one notice; items handed over by themselves get one "Saved to the Reader" notice with
 * only Dismiss (no state), grouped, in the channel "Arrival notices" picks, silent during Quiet hours, and never for an
 * item that had a notice. The states are what the Inbox records for its senders ([com.daylight.share.inbox.LabReporter],
 * published by the tests of F17). With Lab off every notice and hand-off is v1.1's ([HandoffDecisionsTest]).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ArrivalNoticesTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val nm: NotificationManager get() = app.getSystemService(NotificationManager::class.java)
    private val relay = FakeRelay()
    private val main = ReaderApps.MAIN

    private val link = InboxItem(id = "a".repeat(32), kind = Kind.URL, url = "https://example.com/a", title = "A link", from = "Mac", received = 1_000)
    private val pdf = InboxItem(id = "b".repeat(32), kind = Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper", from = "iPhone", received = 2_000, file = "${"b".repeat(32)}/paper.pdf")
    private fun excerpt(n: Int, from: String = "iPhone") = InboxItem(
        id = "%032x".format(0xe0 + n), kind = Kind.FILE, name = "Excerpt - passage $n.html", mime = "text/html", title = "“Passage $n” · A page",
        from = from, received = 3_000L + n, file = "${"%032x".format(0xe0 + n)}/Excerpt.html", extras = mapOf(ItemHeader.X_CAP to "excerpt"),
    )

    @Before
    fun setUp() {
        HandoffActivity.running = false
        HandoffActivity.requestedAt = 0L
        HandoffActivity.claim = null
        HandoffActivity.lastImportHandoff = 0L
        WaitingCard.forget()
        InboxLab.clock = { noon() }
        FileProvider::class.java.declaredFields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && Map::class.java.isAssignableFrom(it.type) }
            .forEach { f ->
                f.isAccessible = true
                (f.get(null) as? MutableMap<*, *>)?.clear()
            }
        app.inbox.http = relay
        app.labReporter.autoFlush = false
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertTrue("Lab is on by default", app.prefs.lab)
        app.setRole(Role.INBOX)
    }

    @After
    fun tearDown() {
        InboxLab.clock = System::currentTimeMillis
    }

    /** Today at [hour]:00, local time. */
    private fun at(hour: Int): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, hour)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    private fun noon() = at(12)

    private fun installReader() {
        val pm = shadowOf(app.packageManager)
        val save = ComponentName(main, "$main.SavePageActivity")
        pm.addActivityIfNotPresent(save)
        pm.addIntentFilterForActivity(save, IntentFilter(ReaderApps.ACTION_SAVE_PAGE).apply { addCategory(Intent.CATEGORY_DEFAULT) })
        val import = ComponentName(main, "$main.ImportActivity")
        pm.addActivityIfNotPresent(import)
        pm.addIntentFilterForActivity(import, IntentFilter().apply {
            addAction(Intent.ACTION_SEND)
            addAction(Intent.ACTION_SEND_MULTIPLE)
            addCategory(Intent.CATEGORY_DEFAULT)
            for (t in listOf("text/plain", "text/html", "application/pdf", "application/epub+zip")) addDataType(t)
        })
    }

    private fun inboxWith(vararg items: InboxItem) {
        for (i in items) {
            app.inbox.put(i)
            i.file?.let { File(app.inbox.filesRoot, it).apply { parentFile!!.mkdirs(); writeText("%PDF-1.4") } }
        }
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun runHandoff(intent: Intent): ActivityController<HandoffActivity> {
        val c = Robolectric.buildActivity(HandoffActivity::class.java, intent).setup()
        idle()
        return c
    }

    /** A link's hand-off through SAVE_PAGE, answered [status]. */
    private fun answerSavePage(c: ActivityController<HandoffActivity>, status: String) {
        val save = shadowOf(c.get()).nextStartedActivityForResult
        assertEquals(ReaderApps.ACTION_SAVE_PAGE, save.intent.action)
        shadowOf(c.get()).receiveResult(save.intent, Activity.RESULT_OK, Intent().putExtra(ReaderApps.EXTRA_STATUS, status))
        idle()
    }

    private fun itemNotice(id: String): Notification? = shadowOf(nm).getNotification(id, Handoff.ITEM_NOTIFICATION)
    private fun summary(): Notification? = shadowOf(nm).getNotification(Handoff.SUMMARY_NOTIFICATION)
    private fun saved(id: String): Notification? = shadowOf(nm).getNotification(id, ArrivalNotices.ITEM_NOTIFICATION)
    private fun savedSummary(): Notification? = shadowOf(nm).getNotification(ArrivalNotices.SUMMARY_NOTIFICATION)
    private fun Notification.title(): String = extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    private fun Notification.text(): String = extras.getCharSequence(Notification.EXTRA_TEXT).toString()

    /** The states recorded for the senders and not published yet: id -> state. */
    @Suppress("UNCHECKED_CAST")
    private fun pending(): Map<String, String> =
        (app.labReporter.inbox()!!.debugState()["pending"] as List<Map<String, Any?>>).associate { it["i"] as String to it["s"] as String }

    private fun logs(): List<String> = ShadowLog.getLogsForTag(TAG).map { it.msg }

    // ------------------------------------------------------------------------------------------- waiting items

    @Test
    fun aWaitingItemsNoticeHasAddToReaderAndKeepForLater() {
        inboxWith(pdf)
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        val n = itemNotice(pdf.id)!!
        assertEquals("New PDF from iPhone: Paper", n.title()) // TalkBack reads the title and the source
        assertEquals(listOf(LabText["arrivals.addToReader"], LabText["arrivals.keepForLater"]), n.actions.map { it.title.toString() })
        assertEquals(listOf("Add to Reader", "Keep for later"), n.actions.map { it.title.toString() })
        // Add to Reader is the notice's tap: the hand-off of this item.
        assertTrue(shadowOf(n.contentIntent).savedIntent.filterEquals(shadowOf(n.actions[0].actionIntent).savedIntent))
        val add = shadowOf(n.actions[0].actionIntent).savedIntent
        assertEquals(HandoffActivity.MODE_ONE, add.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertEquals(pdf.id, add.getStringExtra(HandoffActivity.EXTRA_ITEM))
        val keep = shadowOf(n.actions[1].actionIntent).savedIntent
        assertEquals(ArrivalActionReceiver::class.java.name, keep.component!!.className)
        assertEquals(ArrivalActionReceiver.ACTION_KEEP, keep.action)
        assertEquals(Handoff.itemUri(pdf.id), keep.data)
        assertEquals(mapOf(pdf.id to "waiting"), pending())

        // Lab off: v1.1's notice (Open Inbox).
        Handoff.cancelNotification(app)
        app.setLab(false)
        val other = pdf.copy(id = "c".repeat(32))
        inboxWith(other)
        Handoff.notifyWaiting(app, listOf(other), DocumentMode.ASK)
        assertEquals(listOf("Open Inbox"), itemNotice(other.id)!!.actions.map { it.title.toString() })
    }

    /** F15.1: Keep for later -> held; the item waits (a hand-off with the Inbox in front leaves it); Add to Reader -> handed. */
    @Test
    fun keepForLaterOnTheNoticeKeepsTheDocumentUntilAddToReader() {
        installReader()
        inboxWith(pdf)
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        val keep = shadowOf(itemNotice(pdf.id)!!.actions[1].actionIntent).savedIntent
        ArrivalActionReceiver().onReceive(app, keep)
        assertNull("the notice goes", itemNotice(pdf.id))
        assertTrue(app.inbox.get(pdf.id)!!.held)
        assertEquals(InboxItem.WAITING, app.inbox.get(pdf.id)!!.state)
        assertEquals(mapOf(pdf.id to "held"), pending())
        assertTrue(logs().any { it.contains("received ${pdf.id} -> kept for later") })

        // Opening the Inbox (a hand-off of everything waiting) leaves it, and it is not announced again.
        runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        assertEquals(InboxItem.WAITING, app.inbox.get(pdf.id)!!.state)
        Handoff.notifyWaiting(app, app.inbox.waiting(), DocumentMode.ASK)
        assertNull(itemNotice(pdf.id))
        assertFalse(HandoffActivity.wanted(HandoffActivity.MODE_ALL, emptySet(), app.inbox.get(pdf.id)!!, DocumentMode.ASK, lab = true))
        assertFalse(HandoffActivity.wanted(HandoffActivity.MODE_AUTO, emptySet(), app.inbox.get(pdf.id)!!, DocumentMode.OPEN, lab = true))
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_ALL, emptySet(), app.inbox.get(pdf.id)!!, DocumentMode.ASK, lab = false))

        // Add to Reader (the notice's tap, the card's or the row's): handed over, and no longer kept.
        runHandoff(HandoffActivity.forItem(app, pdf.id))
        val got = app.inbox.get(pdf.id)!!
        assertEquals(InboxItem.IN_READER, got.state)
        assertFalse(got.held)
        assertEquals(mapOf(pdf.id to "handed"), pending())
        assertEquals("handed", got.labState)
    }

    /** F15.1 and F15.4: a link kept for later, then Add to Reader: `reader` once the Reader saved it. */
    @Test
    fun keepForLaterThenAddToReaderGivesReaderForALink() {
        installReader()
        inboxWith(link)
        Handoff.notifyWaiting(app, listOf(link), DocumentMode.ASK)
        Handoff.keepForLater(app, link.id)
        assertEquals(mapOf(link.id to "held"), pending())
        assertEquals("Sender sees: Kept for later on your Daylight", InboxLab.senderSees(app.inbox.get(link.id)!!))
        val c = runHandoff(HandoffActivity.forItem(app, link.id))
        answerSavePage(c, "saved")
        assertEquals(mapOf(link.id to "reader"), pending())
        assertTrue(app.inbox.get(link.id)!!.confirmedInReader)
        // Tapped: it had a notice, so no "Saved to the Reader".
        assertNull(saved(link.id))
    }

    /** F15.1: swiping the notice away keeps it for later too. */
    @Test
    fun swipingTheNoticeAwayKeepsTheItemForLater() {
        installReader()
        inboxWith(pdf)
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        val swiped = shadowOf(itemNotice(pdf.id)!!.deleteIntent).savedIntent
        nm.cancel(pdf.id, Handoff.ITEM_NOTIFICATION)
        NoticeDismissedReceiver().onReceive(app, swiped)
        assertTrue(app.inbox.get(pdf.id)!!.held)
        assertEquals(mapOf(pdf.id to "held"), pending())
        runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        assertEquals("waits for Add to Reader", InboxItem.WAITING, app.inbox.get(pdf.id)!!.state)

        // Lab off: a swiped item is v1.1's (it waits, and opening the Inbox hands it over).
        app.setLab(false)
        val other = pdf.copy(id = "c".repeat(32), file = "${"c".repeat(32)}/paper.pdf")
        inboxWith(other)
        Handoff.notifyWaiting(app, listOf(other), DocumentMode.ASK)
        NoticeDismissedReceiver().onReceive(app, shadowOf(itemNotice(other.id)!!.deleteIntent).savedIntent)
        assertFalse(app.inbox.get(other.id)!!.held)
    }

    /** The card over the Reader says Keep for later (it replaces v1.1's Later), and keeps its items for later. */
    @Test
    fun theCardSaysKeepForLater() {
        installReader()
        inboxWith(pdf)
        ShadowSettings.setCanDrawOverlays(true)
        Handoff.dispatch(app) // Documents = Ask: the PDF waits for a tap
        assertTrue(WaitingCard.showing)
        val later = WaitingCard.view!!.findViewWithTag<TextView>(WaitingCard.TAG_LATER)
        assertEquals("Keep for later", later.text.toString())
        assertEquals("Keep for later", later.contentDescription.toString())
        assertEquals("Add to Reader", WaitingCard.view!!.findViewWithTag<TextView>(WaitingCard.TAG_ADD).text.toString())
        later.performClick()
        assertFalse(WaitingCard.showing)
        assertTrue(app.inbox.get(pdf.id)!!.held)
        assertEquals(mapOf(pdf.id to "held"), pending())
        // The log line stays v1.1's (the emulator test reads it).
        assertTrue(logs().any { it.contains("card: later for ${pdf.id}") })
        // Its notice stays in the shade (a tap there still adds it); the card does not come back for it.
        assertNotNull(itemNotice(pdf.id))
        Handoff.dispatch(app)
        assertFalse(WaitingCard.showing)
        assertEquals(InboxItem.WAITING, app.inbox.get(pdf.id)!!.state)

        // Lab off: v1.1's "Later".
        assertEquals(Notices.LATER, Notices.card(listOf(pdf)).later)
        assertEquals("Keep for later", Notices.card(listOf(pdf), lab = true).later)
    }

    /** Waiting excerpts and documents from one sender share one notice: "3 excerpts from iPhone". */
    @Test
    fun waitingExcerptsFromOneSenderShareOneNotice() {
        val three = listOf(excerpt(1), excerpt(2), excerpt(3))
        assertEquals(LabText.fill(LabText["arrivals.excerptsGroup"], mapOf("n" to 3, "from" to "iPhone")), Notices.plan(three, emptySet(), lab = true).summary!!.title)
        assertEquals("3 excerpts from iPhone", Notices.plan(three, emptySet(), lab = true).summary!!.title)
        assertEquals("3 excerpts from iPhone", Notices.card(three, lab = true).heading)
        // With a PDF among them, or from two senders: v1.1's words.
        assertEquals("3 new from iPhone", Notices.plan(listOf(excerpt(1), excerpt(2), pdf), emptySet(), lab = true).summary!!.title)
        assertEquals("2 new items", Notices.plan(listOf(excerpt(1), excerpt(2, from = "Mac")), emptySet(), lab = true).summary!!.title)
        // Lab off: v1.1's.
        assertEquals("3 new from iPhone", Notices.plan(three, emptySet()).summary!!.title)

        inboxWith(*three.toTypedArray())
        Handoff.notifyWaiting(app, three, DocumentMode.ASK)
        assertEquals("3 excerpts from iPhone", summary()!!.title())
        for (e in three) assertNotNull(itemNotice(e.id))
    }

    // --------------------------------------------------------------------------- items handed over by themselves

    /** "Saved to the Reader: {title}" / "From {from}", only Dismiss, in "Arrivals" (quiet), grouped; Dismiss sets no state. */
    @Test
    fun itemsHandedOverByThemselvesGetOneQuietSavedNotice() {
        installReader()
        val page = link.copy(id = "9".repeat(32), kind = Kind.PAGE, title = "A page", from = "iPhone", received = 5_000)
        inboxWith(link, page)
        ShadowSettings.setCanDrawOverlays(true)
        // In the background with "Display over other apps": links and pages go without a tap.
        val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        answerSavePage(c, "saved")
        val n = saved(link.id)!!
        assertEquals(ArrivalNotices.savedTitle(link), n.title())
        assertEquals("Saved to the Reader: A link", n.title())
        assertEquals("From Mac", n.text())
        assertEquals(ArrivalNotices.CH_QUIET, n.channelId)
        assertEquals(ArrivalNotices.GROUP, n.group)
        assertEquals(listOf(LabText["arrivals.dismiss"]), n.actions.map { it.title.toString() })
        assertTrue(logs().any { it.contains("received ${link.id} kind=url -> handed to $main via save_page status=saved") && it.contains("by=auto") })

        // The channels (F15): "Arrivals" low, "Arrivals (alert)" high, "Inbox health" default.
        assertEquals(NotificationManager.IMPORTANCE_LOW, nm.getNotificationChannel(ArrivalNotices.CH_QUIET).importance)
        assertEquals("Arrivals", nm.getNotificationChannel(ArrivalNotices.CH_QUIET).name.toString())
        assertEquals(NotificationManager.IMPORTANCE_HIGH, nm.getNotificationChannel(ArrivalNotices.CH_ALERT).importance)
        assertEquals("Arrivals (alert)", nm.getNotificationChannel(ArrivalNotices.CH_ALERT).name.toString())
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, nm.getNotificationChannel(ArrivalNotices.CH_HEALTH).importance)
        assertEquals("Inbox health", nm.getNotificationChannel(ArrivalNotices.CH_HEALTH).name.toString())

        // The page, next in the same hand-off: two notices, grouped under "2 saved from your devices" (Mac and iPhone).
        answerSavePage(c, "duplicate")
        assertNotNull(saved(page.id))
        assertEquals("2 saved from your devices", savedSummary()!!.title())
        assertTrue(savedSummary()!!.flags and Notification.FLAG_GROUP_SUMMARY != 0)
        assertEquals(ArrivalNotices.summaryTitle(2, listOf("iPhone", "iPhone")), "2 saved from iPhone")

        // Dismiss: the notice goes (and the summary with it), and no state is recorded.
        val before = pending()
        ArrivalActionReceiver().onReceive(app, shadowOf(n.actions[0].actionIntent).savedIntent)
        assertNull(saved(link.id))
        assertNull(savedSummary())
        assertEquals(before, pending())

        // Never twice for one item.
        assertFalse(ArrivalNotices.saved(app, app.inbox.get(link.id)!!, "saved"))
    }

    @Test
    fun alertOffAndQuietHours() {
        val one = link.copy(id = "1".repeat(32))
        val two = link.copy(id = "2".repeat(32))
        val three = link.copy(id = "3".repeat(32))
        val four = link.copy(id = "4".repeat(32))
        inboxWith(one, two, three, four)

        app.prefs.labArrivals = Arrivals.ALERT.key
        assertTrue(ArrivalNotices.saved(app, one, "saved"))
        assertEquals(ArrivalNotices.CH_ALERT, saved(one.id)!!.channelId)
        assertEquals(Notification.GROUP_ALERT_CHILDREN, saved(one.id)!!.groupAlertBehavior)

        // Quiet hours, 23:00: posted silently.
        app.prefs.labQuietHours = true
        assertTrue(ArrivalNotices.saved(app, two, "queued", now = at(23)))
        assertEquals("silent", Notification.GROUP_ALERT_SUMMARY, saved(two.id)!!.groupAlertBehavior)
        // 07:00 is past them.
        assertTrue(ArrivalNotices.saved(app, three, "sent", now = at(7)))
        assertEquals(Notification.GROUP_ALERT_CHILDREN, saved(three.id)!!.groupAlertBehavior)

        // Off: none.
        app.prefs.labArrivals = Arrivals.OFF.key
        assertFalse(ArrivalNotices.saved(app, four, "saved"))
        assertNull(saved(four.id))
        // Only for what reached the Reader: not for an item kept in the Inbox.
        app.prefs.labArrivals = Arrivals.QUIET.key
        assertFalse(ArrivalNotices.saved(app, four.copy(id = "5".repeat(32)), "no_route"))
        // Never with Lab off, nor for the Reader hand-off test (Setup check shows its result).
        assertFalse(ArrivalNotices.saved(app, four.copy(id = "6".repeat(32), lane = InboxItem.LANE_LOCAL), "saved"))
        app.setLab(false)
        assertFalse(ArrivalNotices.saved(app, four.copy(id = "7".repeat(32)), "saved"))
    }

    /** During Quiet hours a waiting item's notice does not pop up either. */
    @Test
    fun quietHoursHushTheWaitingNotices() {
        inboxWith(pdf)
        app.prefs.labQuietHours = true
        InboxLab.clock = { at(23) }
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        assertEquals(Notification.GROUP_ALERT_SUMMARY, itemNotice(pdf.id)!!.groupAlertBehavior)
        InboxLab.clock = { noon() }
        val other = pdf.copy(id = "c".repeat(32), received = 9_000)
        inboxWith(other)
        Handoff.notifyWaiting(app, listOf(pdf, other), DocumentMode.ASK)
        assertEquals("it pops up outside Quiet hours", Notification.GROUP_ALERT_CHILDREN, itemNotice(other.id)!!.groupAlertBehavior)
    }

    /** With Lab off, nothing of F15: no Lab channel, no saved notice, the card's "Later". */
    @Test
    fun labOffPostsNoArrivalNotice() {
        app.setLab(false)
        installReader()
        inboxWith(link)
        ShadowSettings.setCanDrawOverlays(true)
        val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        answerSavePage(c, "saved")
        assertNull(saved(link.id))
        assertNull(nm.getNotificationChannel(ArrivalNotices.CH_QUIET))
        assertNull(nm.getNotificationChannel(ArrivalNotices.CH_HEALTH))
    }

}
