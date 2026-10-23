package com.daylight.share

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.daylight.share.core.lab.LabText
import com.daylight.share.ui.COMFORT_TARGET
import com.daylight.share.ui.MainActivity
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The accessibility baseline (F27) on Lab's screens (K1, K4, K5): What's in Lab with a needs-setup note open (with the
 * phone's Use switches and feature settings), and the Daylight server section, on the phone and the Inbox; the phone's
 * home with the delivery timeline and the queue, and Setup check; the Inbox's home with Lab's health card, kind lines,
 * an item kept for later and an item's details open, and its arrival notice settings, and the Inbox's Setup check. As
 * shipped, the Accessibility Test Framework's rules on the semantics
 * tree (labels, 48 dp targets, one control per spot); with Comfort at the largest text on a 360 dp phone, no text cut
 * short and no control under 56 dp (F27.4). Each is saved as a PNG for review (`lab-*.png` among the F27 screenshots).
 * The share-in-place card with Options open and the automation sheet, which are other activities' windows, get the same
 * checks in [LabCardsAccessibilityTest].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LabScreensAccessibilityTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    private fun waitForText(text: String, ms: Long = 10_000) = LabKit.waitForText(compose, text, ms)

    private fun openWhatsInLabWithANote() {
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        waitForText(LabText.serverHeadingShort("needs-server"))
        compose.onNode(hasText(LabText.featureName("F37")) and hasClickAction()).performClick()
        waitForText(LabText.button("needs-server")!!)
    }

    private fun openServerSection() {
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("${LabText.SERVER_ROW} ›", substring = true).performClick()
        waitForText(app.lab.serverCode())
    }

    private fun phone() {
        LabKit.useRelay(app, relay)
        app.prefs.askedNotifications = true
        app.prefs.labNoteShown = true
        app.sender.pair(LabKit.vectorPairing)
        app.setRole(Role.SENDER)
        compose.waitForIdle()
    }

    private fun inbox() {
        LabKit.useRelay(app, relay)
        MainScreen.INBOX.prepare(app)
        compose.waitForIdle()
    }

    /** K4: the phone's home with the timeline (a row in every state, a Lab Daylight that said hello). */
    private fun phoneWithTimeline() {
        phone()
        val now = System.currentTimeMillis()
        val rows = ScreenKit.outboxRows(now)
        PhoneKit.writeRows(app, rows)
        PhoneKit.hello(relay, mapOf(rows[2].id to "reader"))
        kotlinx.coroutines.runBlocking { app.sender.tick() }
        compose.waitForIdle()
    }

    private fun openHome() = waitForText(LabText.fill(LabText["queue.heading"], mapOf("n" to 1)))

    private fun openSetupCheck() {
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        waitForText(LabText.serverHeadingShort("needs-server"))
        compose.onNode(hasText(LabText.featureName("F26")) and hasClickAction()).performClick()
        waitForText(LabText["setup.testSend"])
    }

    @Test fun phoneHomeTimeline() = check("lab-home", ::phoneWithTimeline, ::openHome)
    @Test fun phoneSetupCheck() = check("lab-setup-check", ::phone, ::openSetupCheck)
    @Test fun phoneWhatsInLab() = check("lab-whats-in-lab", ::phone, ::openWhatsInLabWithANote)
    @Test fun phoneServerSection() = check("lab-server", ::phone, ::openServerSection)
    @Test fun inboxWhatsInLab() = check("lab-inbox-whats-in-lab", ::inbox, ::openWhatsInLabWithANote)
    @Test fun inboxHome() = check("lab-inbox-home", ::inboxWithLabItems, ::openInboxDetails)
    @Test fun inboxSetupCheck() = check("lab-inbox-setup-check", ::inbox, ::openInboxSetupCheck)

    /** K5: the Inbox's Setup check (its checks and Test the Reader hand-off). */
    private fun openInboxSetupCheck() {
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        waitForText(LabText.serverHeadingShort("needs-server"))
        compose.onNode(hasText(LabText.featureName("F26")) and hasClickAction()).performClick()
        waitForText(LabText["setup.readerTest"])
    }

    /** K5: the Inbox with Lab's rows: an excerpt, a cleaned link, a test article and an item kept for later. */
    private fun inboxWithLabItems() {
        inbox()
        // Only Lab's rows: with Comfort at the largest text the screen stays within the test window (16000 dp).
        for (i in app.inbox.items.value) app.inbox.remove(i.id)
        val now = System.currentTimeMillis()
        val r = now - 20 * 60_000L
        fun id(n: Int) = "%032x".format(0x300 + n)
        app.inbox.put(com.daylight.share.inbox.InboxItem(id(1), com.daylight.share.core.Kind.URL, url = "https://example.com/kept", title = "A link kept for later",
            from = "iPhone", received = r, held = true, labState = "held"))
        app.inbox.put(com.daylight.share.inbox.InboxItem(id(2), com.daylight.share.core.Kind.FILE, name = "Excerpt - a passage.html", mime = "text/html",
            title = "“A passage worth keeping” · A long page title from a newspaper", size = 3_000, from = "iPhone", received = r,
            file = "${id(2)}/Excerpt.html", state = com.daylight.share.inbox.InboxItem.IN_READER, deliveredTo = com.daylight.share.inbox.ReaderApps.MAIN,
            via = com.daylight.share.inbox.Path.SEND_FILE.key, readerStatus = "sent", handedAt = r,
            extras = mapOf(com.daylight.share.core.ItemHeader.X_CAP to "excerpt"), labState = "handed"))
        app.inbox.put(com.daylight.share.inbox.InboxItem(id(3), com.daylight.share.core.Kind.URL, url = "https://example.com/clean", title = "A cleaned link",
            from = "Mac", received = r, state = com.daylight.share.inbox.InboxItem.IN_READER, deliveredTo = com.daylight.share.inbox.ReaderApps.MAIN,
            via = com.daylight.share.inbox.Path.SAVE_PAGE.key, readerStatus = "saved", handedAt = r,
            extras = mapOf(com.daylight.share.core.ItemHeader.X_ORIG to "https://example.com/clean?utm_source=news"), labState = "reader"))
        compose.waitForIdle()
    }

    /** The Inbox's home with the cleaned link's details open ("Cleaned from …", "Sender sees: …"). */
    private fun openInboxDetails() {
        waitForText("A cleaned link")
        compose.onNode(hasText("A cleaned link") and hasClickAction()).performClick()
        waitForText("Sender sees: In your Reader ✓")
    }
    @Test fun inboxServerSection() = check("lab-inbox-server", ::inbox, ::openServerSection)

    private fun check(name: String, setUp: () -> Unit, open: () -> Unit) {
        setUp()
        open()
        ScreenKit.screenshot(compose, "$name-lab-on")
        val problems = ScreenKit.accessibilityProblems(compose)
        assertTrue("$name:\n${problems.joinToString("\n")}", problems.isEmpty())

        app.setComfort(true)
        ScreenKit.showAtLargestText(compose)
        open()
        ScreenKit.screenshot(compose, "$name-comfort-200")
        val cut = ScreenKit.textOverflows(compose)
        assertTrue("$name, Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text: text cut short or clipped:\n${cut.joinToString("\n")}", cut.isEmpty())
        val comfortProblems = ScreenKit.accessibilityProblems(compose, minTargetDp = COMFORT_TARGET.value)
        assertTrue("$name, Comfort:\n${comfortProblems.joinToString("\n")}", comfortProblems.isEmpty())
    }
}
