package com.daylight.share

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Kind
import com.daylight.share.core.Pairing
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.HandoffActivity
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.NoticeDismissedReceiver
import com.daylight.share.inbox.Notices
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.WaitingCard
import com.daylight.share.ui.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
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
import java.time.Duration

/**
 * What the Inbox does with an item that arrives while it is not in front: hand it over now, or announce it (a
 * notification whose tap hands it over, and the card over the Reader); how "Documents" (ask / quiet / open) and
 * "Deliver to" route it; and what the hand-off activity then starts, records and logs.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HandoffDecisionsTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val nm: NotificationManager get() = app.getSystemService(NotificationManager::class.java)
    private val main = ReaderApps.MAIN

    private val link = InboxItem(id = "a".repeat(32), kind = Kind.URL, url = "https://example.com/a", title = "A link", from = "Mac", received = 1_000)
    private val pdf = InboxItem(id = "b".repeat(32), kind = Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper", from = "iPhone", received = 2_000, file = "${"b".repeat(32)}/paper.pdf")
    private val epub = InboxItem(id = "c".repeat(32), kind = Kind.FILE, name = "book.epub", mime = "application/epub+zip", title = "Book", from = "iPhone", received = 3_000, file = "${"c".repeat(32)}/book.epub")
    private val notes = InboxItem(id = "d".repeat(32), kind = Kind.FILE, name = "notes.pdf", mime = "application/pdf", title = "Notes", from = "iPhone", received = 4_000, file = "${"d".repeat(32)}/notes.pdf")

    @Before
    fun reset() {
        HandoffActivity.running = false
        HandoffActivity.requestedAt = 0L
        HandoffActivity.claim = null
        HandoffActivity.lastDocumentHandoff = 0L
        WaitingCard.forget()
        // FileProvider caches its roots in a static map; every Robolectric test has a new files folder.
        FileProvider::class.java.declaredFields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && Map::class.java.isAssignableFrom(it.type) }
            .forEach { f ->
                f.isAccessible = true
                (f.get(null) as? MutableMap<*, *>)?.clear()
            }
    }

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
            for (t in listOf("text/plain", "application/pdf", "application/epub+zip")) addDataType(t)
        })
    }

    /** The lab's side-by-side copy as modelled here: SAVE_PAGE only, no shared documents. */
    private fun installSavePageOnly(pkg: String) {
        val pm = shadowOf(app.packageManager)
        val cn = ComponentName(pkg, "$pkg.SavePageActivity")
        pm.addActivityIfNotPresent(cn)
        pm.addIntentFilterForActivity(cn, IntentFilter(ReaderApps.ACTION_SAVE_PAGE).apply { addCategory(Intent.CATEGORY_DEFAULT) })
    }

    /** The Daylight's Inbox with these items waiting (documents stored as the Receiver would). */
    private fun inboxWith(vararg items: InboxItem) {
        app.prefs.inboxRelay = "http://127.0.0.1:9"
        app.setRole(Role.INBOX)
        for (i in items) {
            app.inbox.put(i)
            i.file?.let { File(app.inbox.filesRoot, it).apply { parentFile!!.mkdirs(); writeText("%PDF-1.4") } }
        }
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    /** Starts the hand-off activity as the system would for [intent] and lets it run until it waits or finishes. */
    private fun runHandoff(intent: Intent): ActivityController<HandoffActivity> {
        val c = Robolectric.buildActivity(HandoffActivity::class.java, intent).setup()
        idle()
        return c
    }

    private fun itemNotice(id: String): Notification? = shadowOf(nm).getNotification(id, Handoff.ITEM_NOTIFICATION)
    private fun summary(): Notification? = shadowOf(nm).getNotification(Handoff.SUMMARY_NOTIFICATION)
    private fun Notification.title(): String = extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    private fun Notification.text(): String = extras.getCharSequence(Notification.EXTRA_TEXT).toString()
    private fun cardText(tag: String): String = WaitingCard.view!!.findViewWithTag<TextView>(tag).text.toString()

    private fun logs(): List<String> = ShadowLog.getLogsForTag(TAG).map { it.msg }
    private fun assertLogged(line: String) =
        assertTrue("not logged: $line\n--- logged:\n${logs().joinToString("\n")}", logs().any { it.contains(line) })

    // ------------------------------------------------------------------------------------------------- decisions

    @Test
    fun planHandsOverNowOrAnnounces() {
        val both = listOf(link, pdf)
        // The Inbox in front: everything now, whatever "Documents" says.
        for (m in DocumentMode.entries) assertEquals(Handoff.Plan(HandoffActivity.MODE_ALL, emptyList()), Handoff.plan(both, true, inFront = true, background = false, docs = m))
        // Another app in front (the Reader), "Display over other apps" allowed:
        Handoff.plan(both, true, inFront = false, background = true, docs = DocumentMode.ASK).let {
            assertEquals(HandoffActivity.MODE_AUTO, it.start) // the link goes now
            assertEquals(listOf(pdf), it.notify) // the PDF is announced at once
        }
        for (m in listOf(DocumentMode.QUIET, DocumentMode.OPEN)) {
            assertEquals(Handoff.Plan(HandoffActivity.MODE_AUTO, emptyList()), Handoff.plan(both, true, inFront = false, background = true, docs = m))
        }
        assertEquals(Handoff.Plan(null, listOf(pdf)), Handoff.plan(listOf(pdf), true, inFront = false, background = true, docs = DocumentMode.ASK))
        // Without "Display over other apps", everything waits for a tap on its notification.
        for (m in DocumentMode.entries) assertEquals(Handoff.Plan(null, both), Handoff.plan(both, true, inFront = false, background = false, docs = m))
        // No app to deliver to: kept in the Inbox, no notification.
        assertEquals(Handoff.Plan(null, emptyList(), keep = both), Handoff.plan(both, false, inFront = true, background = true, docs = DocumentMode.OPEN))
        assertEquals(Handoff.Plan(null, emptyList()), Handoff.plan(emptyList(), true, inFront = false, background = true, docs = DocumentMode.ASK))
        // Only documents have an app: the link stays in the Inbox, the PDF goes on.
        assertEquals(
            Handoff.Plan(HandoffActivity.MODE_ALL, emptyList(), keep = listOf(link)),
            Handoff.plan(both, { it.kind == Kind.FILE }, inFront = true, background = false, docs = DocumentMode.ASK),
        )
    }

    @Test
    fun aHandOffTakesWhatItWasStartedFor() {
        val none = emptySet<String>()
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_ALL, none, pdf, DocumentMode.ASK))
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_AUTO, none, link, DocumentMode.ASK))
        assertFalse(HandoffActivity.wanted(HandoffActivity.MODE_AUTO, none, pdf, DocumentMode.ASK))
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_AUTO, none, pdf, DocumentMode.QUIET))
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_AUTO, none, pdf, DocumentMode.OPEN))
        // A notification tapped while a background hand-off runs joins it.
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_AUTO, setOf(pdf.id), pdf, DocumentMode.ASK))
        // A tap on one item's notification hands over that item only.
        assertTrue(HandoffActivity.wanted(HandoffActivity.MODE_ONE, setOf(pdf.id), pdf, DocumentMode.ASK))
        assertFalse(HandoffActivity.wanted(HandoffActivity.MODE_ONE, setOf(pdf.id), epub, DocumentMode.OPEN))
        assertFalse(HandoffActivity.wanted(HandoffActivity.MODE_ONE, setOf(pdf.id), link, DocumentMode.OPEN))
        // The summary's and the card's taps carry exactly the items they show.
        val i = HandoffActivity.forItems(app, listOf(pdf.id, epub.id), by = HandoffActivity.BY_CARD)
        assertEquals(HandoffActivity.MODE_ONE, i.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertEquals(listOf(pdf.id, epub.id), HandoffActivity.itemsOf(i))
        assertEquals(listOf(pdf.id), HandoffActivity.itemsOf(HandoffActivity.forItem(app, pdf.id)))
    }

    @Test
    fun documentsDefaultToAskingAndTheOldSwitchMeansOpen() {
        assertEquals(DocumentMode.ASK, DocumentMode.DEFAULT)
        assertEquals(DocumentMode.ASK, app.prefs.documentMode)
        val sp = app.getSharedPreferences("daylight-share", Context.MODE_PRIVATE)
        sp.edit().putBoolean("autoDocs", true).commit()
        assertEquals(DocumentMode.OPEN, app.prefs.documentMode)
        app.prefs.documentMode = DocumentMode.QUIET
        assertEquals(DocumentMode.QUIET, app.prefs.documentMode)
        assertFalse(sp.contains("autoDocs"))
        assertEquals(DocumentMode.QUIET, DocumentMode.parse(" Quiet "))
        assertNull(DocumentMode.parse("loud"))
        assertNull(DocumentMode.parse(null))
        assertFalse(DocumentMode.ASK.automatic)
        assertTrue(DocumentMode.QUIET.automatic && DocumentMode.OPEN.automatic)
        // Not "quietly": today's Reader opens a lone document and closes the open one for a batch.
        assertEquals(listOf("Ask with a notification", "Add to the library as a batch", "Open as they arrive"), DocumentMode.entries.map { it.label })
    }

    @Test
    fun theDebugSetupLinkSetsDocuments() {
        fun setup(query: String) {
            val code = Pairing.generate().compactCode
            val uri = Uri.parse("daylightshare://setup?role=inbox&c=$code&r=http%3A%2F%2F127.0.0.1%3A9&n=CI$query")
            val c = Robolectric.buildActivity(MainActivity::class.java, Intent(Intent.ACTION_VIEW, uri).setClass(app, MainActivity::class.java)).setup()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
            c.pause().stop().destroy()
        }
        setup("&auto=1")
        assertEquals(Role.INBOX, app.prefs.role)
        assertEquals(DocumentMode.OPEN, app.prefs.documentMode)
        setup("&auto=0")
        assertEquals(DocumentMode.ASK, app.prefs.documentMode)
        setup("&docs=quiet&to=${ReaderApps.EXPERIMENT}")
        assertEquals(DocumentMode.QUIET, app.prefs.documentMode)
        assertEquals(ReaderApps.EXPERIMENT, app.prefs.deliverTo)
        setup("&to=")
        assertEquals("", app.prefs.deliverTo)
        assertEquals(DocumentMode.QUIET, app.prefs.documentMode)
    }

    // ------------------------------------------------------------------------------------------------ notifications

    @Test
    fun noticesSayWhatArrivedFromWhom() {
        assertEquals("New PDF from iPhone: Paper", Notices.title(pdf))
        assertEquals("New EPUB from iPhone: Book", Notices.title(epub))
        assertEquals("New link from Mac: A link", Notices.title(link))
        assertEquals("web page", Notices.kind(link.copy(kind = Kind.PAGE)))
        assertEquals("Word document", Notices.kind(pdf.copy(name = "cv.docx", mime = null)))
        assertEquals("Markdown document", Notices.kind(pdf.copy(name = "notes.md", mime = "text/markdown")))
        assertEquals("document", Notices.kind(pdf.copy(name = "data.bin", mime = "application/octet-stream")))
        assertEquals("New PDF from your phone: paper.pdf", Notices.title(pdf.copy(from = " ", title = null)))

        // One notice per item, oldest first; only the newest never announced alerts; a summary for several.
        val p = Notices.plan(listOf(epub, pdf), seen = emptySet())
        assertEquals(listOf(pdf.id, epub.id), p.items.map { it.id })
        assertEquals(listOf(false, true), p.items.map { it.alert })
        assertEquals(Notices.TAP, p.items[0].text)
        assertEquals("2 new from iPhone", p.summary!!.title)
        assertEquals(listOf("PDF: Paper", "EPUB: Book"), p.summary!!.lines)
        assertEquals(listOf(true, false), Notices.plan(listOf(pdf, epub), seen = setOf(epub.id)).items.map { it.alert })
        assertEquals(listOf(false, false), Notices.plan(listOf(pdf, epub), seen = setOf(pdf.id, epub.id)).items.map { it.alert })
        // The card is up: it shows them, nothing pops up.
        assertEquals(listOf(false, false), Notices.plan(listOf(pdf, epub), seen = emptySet(), quiet = true).items.map { it.alert })
        assertEquals("2 new items", Notices.plan(listOf(link, pdf), emptySet()).summary!!.title)
        assertNull(Notices.plan(listOf(pdf), emptySet()).summary)

        // The card's words.
        assertEquals(Notices.Card("New PDF from iPhone", "Paper", "Add to Reader"), Notices.card(listOf(pdf)))
        val four = Notices.card(listOf(notes, epub, pdf, link))
        assertEquals("4 new items", four.heading)
        assertEquals("link: A link\nPDF: Paper\nEPUB: Book\nand 1 more", four.body)
        assertEquals("Add all to Reader", four.add)
    }

    @Test
    fun eachWaitingItemGetsANotificationThatPopsUpAndHandsItOver() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        // HIGH: it pops up over the full-screen Reader on the Daylight.
        assertEquals(NotificationManager.IMPORTANCE_HIGH, nm.getNotificationChannel(App.CH_ITEMS).importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, Handoff.itemsChannelImportance(app))
        assertNull(nm.getNotificationChannel("arrivals"))

        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        val n = itemNotice(pdf.id)!!
        assertEquals("New PDF from iPhone: Paper", n.title())
        assertEquals(Notices.TAP, n.text())
        assertEquals(App.CH_ITEMS, n.channelId)
        assertEquals(Notices.GROUP, n.group)
        // It alerts on its own (a child that alerts), so it pops up although it is in a group.
        assertEquals(Notification.GROUP_ALERT_CHILDREN, n.groupAlertBehavior)
        val tap = shadowOf(n.contentIntent).savedIntent
        assertEquals(HandoffActivity::class.java.name, tap.component!!.className)
        assertEquals(HandoffActivity.MODE_ONE, tap.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertEquals(pdf.id, tap.getStringExtra(HandoffActivity.EXTRA_ITEM))
        assertEquals(Handoff.itemUri(pdf.id), tap.data)
        assertTrue(tap.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertNotNull(n.deleteIntent)
        assertNull(summary())

        // A second one: it alone pops up; the first is not posted again; a summary whose tap hands over both.
        Handoff.notifyWaiting(app, listOf(pdf, epub), DocumentMode.ASK)
        assertSame(n, itemNotice(pdf.id))
        val e = itemNotice(epub.id)!!
        assertEquals(Notification.GROUP_ALERT_CHILDREN, e.groupAlertBehavior)
        assertEquals(epub.id, shadowOf(e.contentIntent).savedIntent.getStringExtra(HandoffActivity.EXTRA_ITEM))
        val s = summary()!!
        assertTrue(s.flags and Notification.FLAG_GROUP_SUMMARY != 0)
        assertEquals(Notices.GROUP, s.group)
        assertEquals("2 new from iPhone", s.title())
        // The summary never alerts (its children do).
        assertEquals(Notification.GROUP_ALERT_CHILDREN, s.groupAlertBehavior)
        val all = shadowOf(s.contentIntent).savedIntent
        assertEquals(HandoffActivity.MODE_ONE, all.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertEquals(listOf(pdf.id, epub.id), HandoffActivity.itemsOf(all))

        // Nothing changed: nothing is posted again (no rate limit spent, no second "waiting for a tap").
        Handoff.notifyWaiting(app, listOf(pdf, epub), DocumentMode.ASK)
        assertSame(n, itemNotice(pdf.id))
        assertSame(e, itemNotice(epub.id))
        assertSame(s, summary())
        assertEquals(1, logs().count { it.contains("received ${epub.id} kind=${Kind.FILE} -> waiting for a tap") })

        // The PDF went to the Reader: its notification and the summary go, the EPUB's stays.
        Handoff.notifyWaiting(app, listOf(epub), DocumentMode.ASK)
        assertNull(itemNotice(pdf.id))
        assertNull(summary())
        assertNotNull(itemNotice(epub.id))
        Handoff.cancelNotification(app)
        assertEquals(0, shadowOf(nm).size())

        // Two never announced at once: the newest pops up, the older is posted quietly, and so is the summary.
        val older = notes.copy(id = "e".repeat(32), received = 5_000)
        val newer = notes.copy(id = "f".repeat(32), received = 6_000)
        Handoff.notifyWaiting(app, listOf(newer, older), DocumentMode.ASK)
        assertEquals(Notification.GROUP_ALERT_SUMMARY, itemNotice(older.id)!!.groupAlertBehavior)
        assertEquals(Notification.GROUP_ALERT_CHILDREN, itemNotice(newer.id)!!.groupAlertBehavior)
        assertEquals(Notification.GROUP_ALERT_CHILDREN, summary()!!.groupAlertBehavior)
        assertTrue(summary()!!.flags and Notification.FLAG_GROUP_SUMMARY != 0)
    }

    @Test
    fun swipedAwayOrTakenNotificationsDoNotComeBack() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        inboxWith(pdf, epub, notes)
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        val first = itemNotice(pdf.id)!!
        // The user swipes it away: the system takes it down and sends its delete intent.
        val swiped = shadowOf(first.deleteIntent).savedIntent
        assertEquals(Handoff.itemUri(pdf.id), swiped.data)
        nm.cancel(pdf.id, Handoff.ITEM_NOTIFICATION)
        NoticeDismissedReceiver().onReceive(app, swiped)
        assertLogged("received ${pdf.id} -> notification dismissed")

        // Something else arrives (here with a link's hand-off running): the PDF stays away, the EPUB pops up alone.
        Handoff.notifyWaiting(app, listOf(pdf, epub), DocumentMode.ASK)
        assertNull(itemNotice(pdf.id))
        assertEquals(Notification.GROUP_ALERT_CHILDREN, itemNotice(epub.id)!!.groupAlertBehavior)
        assertNull(summary())

        // The EPUB's notification is tapped (Android takes it down) and its hand-off runs: another arrival does not
        // bring it back meanwhile.
        nm.cancel(epub.id, Handoff.ITEM_NOTIFICATION)
        HandoffActivity.running = true
        HandoffActivity.claim = HandoffActivity.Claim(HandoffActivity.MODE_ONE, setOf(epub.id), DocumentMode.ASK)
        assertTrue(HandoffActivity.claims(epub))
        assertFalse(HandoffActivity.claims(notes))
        Handoff.notifyWaiting(app, listOf(pdf, epub, notes), DocumentMode.ASK)
        assertNull(itemNotice(pdf.id))
        assertNull(itemNotice(epub.id))
        assertEquals(Notification.GROUP_ALERT_CHILDREN, itemNotice(notes.id)!!.groupAlertBehavior)

        // That hand-off ends with the EPUB still waiting: it is shown again, quietly (it was announced before).
        HandoffActivity.running = false
        HandoffActivity.claim = null
        Handoff.notifyWaiting(app, listOf(pdf, epub, notes), DocumentMode.ASK)
        assertNull(itemNotice(pdf.id))
        assertEquals(Notification.GROUP_ALERT_SUMMARY, itemNotice(epub.id)!!.groupAlertBehavior)
        assertEquals("2 new from iPhone", summary()!!.title())
        assertEquals(1, logs().count { it.contains("received ${epub.id} kind=${Kind.FILE} -> waiting for a tap") })

        // Handed over or removed, an item's memory goes: were it to wait again, it would be announced again.
        app.inbox.remove(pdf.id)
        Handoff.notifyWaiting(app, listOf(epub, notes), DocumentMode.ASK)
        assertFalse(app.prefs.noticeIds(Prefs.NOTICE_DISMISSED).contains(pdf.id))
        assertTrue(app.prefs.noticeIds(Prefs.NOTICE_ANNOUNCED).containsAll(listOf(epub.id, notes.id)))
    }

    @Test
    fun withoutPermissionNothingIsPosted() {
        shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertFalse(Handoff.notificationsAllowed(app))
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        assertEquals(0, shadowOf(nm).size())
        assertFalse(WaitingCard.showing)
        assertLogged("received ${pdf.id} kind=${Kind.FILE} -> waiting for a tap (notifications off) docs=ask")
    }

    @Test
    fun aDocumentArrivingWhileTheReaderIsInFrontIsAnnouncedAtOnce() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        installReader()
        inboxWith(link, pdf)
        assertEquals(DocumentMode.ASK, app.prefs.documentMode)

        // No "Display over other apps": both wait for a tap, each with its notification.
        ShadowSettings.setCanDrawOverlays(false)
        Handoff.dispatch(app)
        assertNull(shadowOf(app).nextStartedActivity)
        assertNotNull(itemNotice(link.id))
        assertNotNull(itemNotice(pdf.id))
        assertFalse(WaitingCard.showing)

        // Allowed (the Daylight's setup), "Ask": the link goes in the background, the PDF stays announced.
        ShadowSettings.setCanDrawOverlays(true)
        Handoff.dispatch(app)
        val started = shadowOf(app).nextStartedActivity
        assertEquals(HandoffActivity::class.java.name, started.component!!.className)
        assertEquals(HandoffActivity.MODE_AUTO, started.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertNull(itemNotice(link.id))
        assertNotNull(itemNotice(pdf.id))

        // While that hand-off starts, a second document is announced right away too: the card over the Reader comes
        // up with both, and the new notification is posted without popping up (the card shows it).
        app.inbox.put(epub)
        Handoff.dispatch(app)
        assertNull(shadowOf(app).nextStartedActivity)
        assertEquals(Notification.GROUP_ALERT_SUMMARY, itemNotice(epub.id)!!.groupAlertBehavior)
        assertNotNull(summary())
        assertTrue(WaitingCard.showing)
        assertEquals(listOf(pdf.id, epub.id), WaitingCard.ids)
        assertLogged("received ${epub.id} kind=${Kind.FILE} -> waiting for a tap (card + notification) docs=ask")

        // "Add to the library as a batch": nothing waits for a tap.
        HandoffActivity.requestedAt = 0L
        app.prefs.documentMode = DocumentMode.QUIET
        Handoff.dispatch(app)
        assertEquals(HandoffActivity.MODE_AUTO, shadowOf(app).nextStartedActivity.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertNull(itemNotice(pdf.id))
        assertNull(itemNotice(epub.id))
        assertNull(summary())
        assertFalse(WaitingCard.showing)
    }

    @Test
    fun theCardOverTheReaderStaysUntilAnswered() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        installReader()
        inboxWith(pdf)
        ShadowSettings.setCanDrawOverlays(true)
        Handoff.dispatch(app) // "Ask": the PDF waits for a tap

        assertTrue(WaitingCard.showing)
        assertEquals(listOf(pdf.id), WaitingCard.ids)
        assertEquals("New PDF from iPhone", cardText(WaitingCard.TAG_HEADING))
        assertEquals("Paper", cardText(WaitingCard.TAG_BODY))
        assertEquals("Add to Reader", cardText(WaitingCard.TAG_ADD))
        val p = WaitingCard.params!!
        assertEquals(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, p.type)
        assertTrue(p.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE != 0) // the Reader keeps its keys
        assertTrue(p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL != 0) // and touches outside the card
        // The card shows it, so its notification waits in the shade without popping up.
        assertEquals(Notification.GROUP_ALERT_SUMMARY, itemNotice(pdf.id)!!.groupAlertBehavior)
        assertLogged("received ${pdf.id} kind=${Kind.FILE} -> waiting for a tap (card + notification) docs=ask")

        // "Add to Reader" hands that document over.
        WaitingCard.view!!.findViewWithTag<View>(WaitingCard.TAG_ADD).performClick()
        assertFalse(WaitingCard.showing)
        val started = shadowOf(app).nextStartedActivity
        assertEquals(HandoffActivity::class.java.name, started.component!!.className)
        assertEquals(HandoffActivity.MODE_ONE, started.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertEquals(listOf(pdf.id), HandoffActivity.itemsOf(started))
        assertEquals(HandoffActivity.BY_CARD, started.getStringExtra(HandoffActivity.EXTRA_BY))
        assertTrue(started.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)

        // The card was only taken down: nothing new, no card. A new document brings it back with what waits.
        Handoff.dispatch(app)
        assertFalse(WaitingCard.showing)
        app.inbox.put(epub)
        Handoff.dispatch(app)
        assertEquals(listOf(pdf.id, epub.id), WaitingCard.ids)
        assertEquals("2 new from iPhone", cardText(WaitingCard.TAG_HEADING))
        assertEquals("PDF: Paper\nEPUB: Book", cardText(WaitingCard.TAG_BODY))
        assertEquals("Add all to Reader", cardText(WaitingCard.TAG_ADD))

        // "Later": the card goes and does not come back for them; they wait in the Inbox and in the shade.
        WaitingCard.view!!.findViewWithTag<View>(WaitingCard.TAG_LATER).performClick()
        assertFalse(WaitingCard.showing)
        Handoff.dispatch(app)
        assertFalse(WaitingCard.showing)
        assertNotNull(itemNotice(pdf.id))
        assertNotNull(itemNotice(epub.id))
        assertEquals(InboxItem.WAITING, app.inbox.get(pdf.id)!!.state)

        // A third: the card shows just that one.
        app.inbox.put(notes)
        Handoff.dispatch(app)
        assertEquals(listOf(notes.id), WaitingCard.ids)

        // Swiping its notification away takes it off the card too.
        val swiped = shadowOf(itemNotice(notes.id)!!.deleteIntent).savedIntent
        nm.cancel(notes.id, Handoff.ITEM_NOTIFICATION)
        NoticeDismissedReceiver().onReceive(app, swiped)
        assertFalse(WaitingCard.showing)
    }

    @Test
    fun theCardShowsEvenWithNotificationsOff() {
        shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        ShadowSettings.setCanDrawOverlays(true)
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        assertEquals(0, shadowOf(nm).size())
        assertTrue(WaitingCard.showing)
        assertLogged("received ${pdf.id} kind=${Kind.FILE} -> waiting for a tap (card) docs=ask")
        Handoff.cancelNotification(app)
        assertFalse(WaitingCard.showing)
    }

    @Test
    fun aRefusedBackgroundHandOffAnnouncesEverythingThatWaits() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        installReader()
        inboxWith(link, pdf)
        ShadowSettings.setCanDrawOverlays(true)
        val refusing = object : ContextWrapper(app) {
            override fun startActivity(intent: Intent?) {
                throw SecurityException("background activity start blocked")
            }
        }
        Handoff.dispatch(refusing)
        assertEquals(0L, HandoffActivity.requestedAt) // the next arrival may try again
        assertLogged("background hand-off refused by the system: background activity start blocked")
        // The link, which would have gone on its own, waits for a tap like the PDF.
        assertNotNull(itemNotice(link.id))
        assertNotNull(itemNotice(pdf.id))
        assertEquals(listOf(link.id, pdf.id), WaitingCard.ids)
    }

    @Test
    fun withoutAReaderItemsStayInTheInbox() {
        inboxWith(pdf)
        Handoff.dispatch(app)
        assertEquals(InboxItem.OPEN, app.inbox.get(pdf.id)!!.state)
        assertNull(shadowOf(app).nextStartedActivity)
    }

    // ------------------------------------------------------------------------------------------- the hand-off itself

    @Test
    fun aTapOnADocumentsNotificationHandsOverThatDocumentOnly() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        installReader()
        inboxWith(pdf, epub)
        Handoff.notifyWaiting(app, app.inbox.waiting(), DocumentMode.ASK)
        val c = runHandoff(shadowOf(itemNotice(pdf.id)!!.contentIntent).savedIntent)

        val sent = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_SEND, sent.action)
        assertEquals(main, sent.`package`)
        assertEquals("application/pdf", sent.type)
        assertTrue(sent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)!!.path!!.endsWith("/paper.pdf"))
        assertTrue(sent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        // A fresh Reader task for every document (the Reader drops a document shared while an import is pending).
        assertTrue(sent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertTrue(sent.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK != 0)
        assertNull(shadowOf(app).nextStartedActivity) // the EPUB was not asked for
        app.inbox.get(pdf.id)!!.let {
            assertEquals(InboxItem.IN_READER, it.state)
            assertEquals(main, it.deliveredTo)
            assertEquals("send_file", it.via)
        }
        assertEquals(InboxItem.WAITING, app.inbox.get(epub.id)!!.state)
        assertLogged("received ${pdf.id} kind=${Kind.FILE} -> handed to $main via send_file status=sent docs=ask by=tap")
        // Afterwards: the PDF's notification is gone, the EPUB's stays; the activity is done.
        assertNull(itemNotice(pdf.id))
        assertNotNull(itemNotice(epub.id))
        assertTrue(c.get().isFinishing)
        assertNull(HandoffActivity.claim)
        assertFalse(HandoffActivity.running)
    }

    @Test
    fun documentHandOffsAreSpacedOutAndBatched() {
        installReader()
        inboxWith(pdf, epub, notes)
        runHandoff(HandoffActivity.forItem(app, pdf.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val first = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_SEND, first.action)
        assertLogged("documents: 1 to $main via send_file in a fresh task (NEW_TASK|CLEAR_TASK)")

        // A tap on the next document right away: it waits rather than meet the Reader's pending import.
        val c = runHandoff(HandoffActivity.forItem(app, epub.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        assertNull(shadowOf(app).nextStartedActivity)
        assertTrue(HandoffActivity.running)
        assertLogged("documents: 1 waiting; next hand-off in 25 s")
        assertEquals(InboxItem.WAITING, app.inbox.get(epub.id)!!.state)
        // Meanwhile a third one is tapped: it joins the same hand-off.
        c.newIntent(HandoffActivity.forItem(app, notes.id))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(10))
        assertNull(shadowOf(app).nextStartedActivity)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(16))
        val batch = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_SEND_MULTIPLE, batch.action)
        assertEquals(2, batch.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)!!.size)
        assertTrue(batch.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK != 0)
        assertLogged("documents: handing over 2 together")
        for (id in listOf(epub.id, notes.id)) assertEquals("send_multiple", app.inbox.get(id)!!.via)
        assertTrue(c.get().isFinishing)
        assertFalse(HandoffActivity.running)

        // A link never waits for the document gap.
        app.inbox.put(link.copy(id = "e".repeat(32)))
        val l = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        assertEquals(ReaderApps.ACTION_SAVE_PAGE, shadowOf(l.get()).nextStartedActivityForResult.intent.action)
    }

    @Test
    fun theCardsAddHandsOverEverythingItShowsAsABatch() {
        installReader()
        inboxWith(pdf, epub, notes)
        runHandoff(HandoffActivity.forItems(app, listOf(pdf.id, epub.id), by = HandoffActivity.BY_CARD).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val sent = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_SEND_MULTIPLE, sent.action)
        assertEquals(main, sent.`package`)
        assertEquals(2, sent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)!!.size)
        for (id in listOf(pdf.id, epub.id)) {
            assertEquals("send_multiple", app.inbox.get(id)!!.via)
            assertLogged("received $id kind=${Kind.FILE} -> handed to $main via send_multiple status=sent docs=ask by=card")
        }
        assertEquals(InboxItem.WAITING, app.inbox.get(notes.id)!!.state)
    }

    @Test
    fun quietHandsEvenOneDocumentOverAsABatchInTheBackground() {
        installReader()
        inboxWith(pdf)
        app.prefs.documentMode = DocumentMode.QUIET
        runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val sent = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_SEND_MULTIPLE, sent.action)
        assertEquals(main, sent.`package`)
        assertEquals("application/pdf", sent.type)
        assertEquals(1, sent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)!!.size)
        assertEquals("send_multiple", app.inbox.get(pdf.id)!!.via)
        assertLogged("received ${pdf.id} kind=${Kind.FILE} -> handed to $main via send_multiple status=sent docs=quiet by=auto")
    }

    @Test
    fun aBackgroundHandOffSavesTheLinkAndLeavesTheDocumentToATap() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        installReader()
        inboxWith(link, pdf)
        val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val a = c.get()
        val save = shadowOf(a).nextStartedActivityForResult
        assertEquals(ReaderApps.ACTION_SAVE_PAGE, save.intent.action)
        assertEquals(main, save.intent.`package`)
        assertEquals(link.url, save.intent.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals("started", app.inbox.get(link.id)!!.readerStatus)
        // Meanwhile this hand-off claims the link, not the PDF (which "Ask" leaves to a tap).
        assertTrue(HandoffActivity.claims(link))
        assertFalse(HandoffActivity.claims(pdf))

        shadowOf(a).receiveResult(save.intent, Activity.RESULT_OK, Intent().putExtra(ReaderApps.EXTRA_STATUS, "saved"))
        idle()
        app.inbox.get(link.id)!!.let {
            assertEquals(InboxItem.IN_READER, it.state)
            assertEquals("save_page", it.via)
            assertEquals("saved", it.readerStatus)
        }
        assertLogged("received ${link.id} kind=${Kind.URL} -> handed to $main via save_page status=saved by=auto")
        assertEquals(InboxItem.WAITING, app.inbox.get(pdf.id)!!.state)
        assertNotNull(itemNotice(pdf.id))
        assertTrue(a.isFinishing)
    }

    @Test
    fun whatTheChosenAppCannotTakeGoesToTheReader() {
        installReader()
        installSavePageOnly(ReaderApps.EXPERIMENT)
        app.prefs.deliverTo = ReaderApps.EXPERIMENT
        inboxWith(link, pdf)
        val c = runHandoff(HandoffActivity.intent(app, HandoffActivity.MODE_ALL))
        val save = shadowOf(c.get()).nextStartedActivityForResult
        assertEquals(ReaderApps.EXPERIMENT, save.intent.`package`) // chosen on purpose: it gets the link
        shadowOf(c.get()).receiveResult(save.intent, Activity.RESULT_OK, Intent().putExtra(ReaderApps.EXTRA_STATUS, "saved"))
        idle()
        val sent = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_SEND, sent.action)
        assertEquals(main, sent.`package`) // it takes no documents: the PDF goes to the Daylight Reader
        assertLogged("received ${link.id} kind=${Kind.URL} -> handed to ${ReaderApps.EXPERIMENT} via save_page status=saved by=front")
        assertLogged("received ${pdf.id} kind=${Kind.FILE} -> handed to $main via send_file status=sent docs=ask by=front")
    }
}
