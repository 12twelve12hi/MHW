package com.daylight.share

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Kind
import com.daylight.share.core.Pairing
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.HandoffActivity
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.Notices
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.ui.MainActivity
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
import org.robolectric.shadows.ShadowSettings
import java.time.Duration

/**
 * What the Inbox does with an item that arrives while it is not in front: hand it over now, or announce it with a
 * notification whose tap hands it over; and how "Documents" (ask / quiet / open) and the notifications behave.
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

    @Before
    fun reset() {
        HandoffActivity.running = false
        HandoffActivity.requestedAt = 0L
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

    private fun itemNotice(id: String): Notification? = shadowOf(nm).getNotification(id, Handoff.ITEM_NOTIFICATION)
    private fun summary(): Notification? = shadowOf(nm).getNotification(Handoff.SUMMARY_NOTIFICATION)
    private fun Notification.title(): String = extras.getCharSequence(Notification.EXTRA_TITLE).toString()
    private fun Notification.text(): String = extras.getCharSequence(Notification.EXTRA_TEXT).toString()

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
        assertEquals(listOf("Ask with a notification", "Add quietly to the library", "Open as they arrive"), DocumentMode.entries.map { it.label })
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

        // One notice per item, oldest first; only the newest that was not shown alerts; a summary for several.
        val p = Notices.plan(listOf(epub, pdf), shown = emptySet())
        assertEquals(listOf(pdf.id, epub.id), p.items.map { it.id })
        assertEquals(listOf(false, true), p.items.map { it.alert })
        assertEquals(Notices.TAP, p.items[0].text)
        assertEquals("2 new from iPhone", p.summary!!.title)
        assertEquals(listOf("PDF: Paper", "EPUB: Book"), p.summary!!.lines)
        assertEquals(listOf(true, false), Notices.plan(listOf(pdf, epub), shown = setOf(epub.id)).items.map { it.alert })
        assertEquals(listOf(false, false), Notices.plan(listOf(pdf, epub), shown = setOf(pdf.id, epub.id)).items.map { it.alert })
        assertEquals("2 new items", Notices.plan(listOf(link, pdf), emptySet()).summary!!.title)
        assertNull(Notices.plan(listOf(pdf), emptySet()).summary)
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
        val tap = shadowOf(n.contentIntent).savedIntent
        assertEquals(HandoffActivity::class.java.name, tap.component!!.className)
        assertEquals(HandoffActivity.MODE_ONE, tap.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertEquals(pdf.id, tap.getStringExtra(HandoffActivity.EXTRA_ITEM))
        assertNull(summary())

        // A second one: grouped under a summary whose tap hands over both.
        Handoff.notifyWaiting(app, listOf(pdf, epub), DocumentMode.ASK)
        assertNotNull(itemNotice(pdf.id))
        assertEquals(epub.id, shadowOf(itemNotice(epub.id)!!.contentIntent).savedIntent.getStringExtra(HandoffActivity.EXTRA_ITEM))
        val s = summary()!!
        assertTrue(s.flags and Notification.FLAG_GROUP_SUMMARY != 0)
        assertEquals(Notices.GROUP, s.group)
        assertEquals("2 new from iPhone", s.title())
        assertEquals(HandoffActivity.MODE_ALL, shadowOf(s.contentIntent).savedIntent.getStringExtra(HandoffActivity.EXTRA_MODE))

        // The PDF went to the Reader: its notification and the summary go, the EPUB's stays.
        Handoff.notifyWaiting(app, listOf(epub), DocumentMode.ASK)
        assertNull(itemNotice(pdf.id))
        assertNull(summary())
        assertNotNull(itemNotice(epub.id))
        Handoff.cancelNotification(app)
        assertEquals(0, shadowOf(nm).size())
    }

    @Test
    fun withoutPermissionNothingIsPosted() {
        shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertFalse(Handoff.notificationsAllowed(app))
        Handoff.notifyWaiting(app, listOf(pdf), DocumentMode.ASK)
        assertEquals(0, shadowOf(nm).size())
    }

    @Test
    fun aDocumentArrivingWhileTheReaderIsInFrontIsAnnouncedAtOnce() {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        installReader()
        app.prefs.inboxRelay = "http://127.0.0.1:9"
        app.setRole(Role.INBOX)
        app.inbox.put(link)
        app.inbox.put(pdf)
        assertEquals(DocumentMode.ASK, app.prefs.documentMode)

        // No "Display over other apps": both wait for a tap, each with its notification.
        ShadowSettings.setCanDrawOverlays(false)
        Handoff.dispatch(app)
        assertNull(shadowOf(app).nextStartedActivity)
        assertNotNull(itemNotice(link.id))
        assertNotNull(itemNotice(pdf.id))

        // Allowed (the Daylight's setup), "Ask": the link goes in the background, the PDF stays announced.
        ShadowSettings.setCanDrawOverlays(true)
        Handoff.dispatch(app)
        val started = shadowOf(app).nextStartedActivity
        assertEquals(HandoffActivity::class.java.name, started.component!!.className)
        assertEquals(HandoffActivity.MODE_AUTO, started.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertNull(itemNotice(link.id))
        assertNotNull(itemNotice(pdf.id))

        // While that hand-off starts, a second document is announced right away too.
        app.inbox.put(epub)
        Handoff.dispatch(app)
        assertNull(shadowOf(app).nextStartedActivity)
        assertNotNull(itemNotice(epub.id))
        assertNotNull(summary())

        // "Add quietly to the library": nothing waits for a tap.
        HandoffActivity.requestedAt = 0L
        app.prefs.documentMode = DocumentMode.QUIET
        Handoff.dispatch(app)
        assertEquals(HandoffActivity.MODE_AUTO, shadowOf(app).nextStartedActivity.getStringExtra(HandoffActivity.EXTRA_MODE))
        assertNull(itemNotice(pdf.id))
        assertNull(itemNotice(epub.id))
        assertNull(summary())
    }

    @Test
    fun withoutAReaderItemsStayInTheInbox() {
        app.prefs.inboxRelay = "http://127.0.0.1:9"
        app.setRole(Role.INBOX)
        app.inbox.put(pdf)
        Handoff.dispatch(app)
        assertEquals(InboxItem.OPEN, app.inbox.get(pdf.id)!!.state)
        assertNull(shadowOf(app).nextStartedActivity)
    }
}
