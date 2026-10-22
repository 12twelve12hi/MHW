package com.daylight.share

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.lab.LabText
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxLab
import com.daylight.share.inbox.Path
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.ui.INBOX_DETAILS_TAG
import com.daylight.share.ui.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The DC-1 Inbox's rows with Lab on (LAB-PLAN F03.4, F11, F01, F15; card K5): every row states its kind line from
 * the item's extras ("Page as you saw it", "Clean article", "Excerpt", "Test article", "Link (the Reader downloads
 * it)", "Document · {MB} MB", then " · from {from}"), which a screen reader reads; "Sender sees: {label}" and "Cleaned
 * from {host}" are in an item's details (a tap on its title), never on the row; an item kept for later says so. With
 * Lab off the rows are v1.1's.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
class InboxRowLineTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()
    private val MIN = 60_000L

    private fun id(n: Int) = "%032x".format(0x200 + n)

    /** One item of each kind and capture, from two senders, all in the Reader already (nothing hands over). */
    private fun items(now: Long): List<InboxItem> {
        val r = now - 30 * MIN
        fun inReader(i: InboxItem, via: Path, status: String) =
            i.copy(state = InboxItem.IN_READER, deliveredTo = ReaderApps.MAIN, via = via.key, readerStatus = status, handedAt = r)
        return listOf(
            inReader(InboxItem(id(1), Kind.PAGE, url = "https://example.com/seen", title = "A page as seen", size = 40_000, from = "Mac", received = r), Path.SAVE_PAGE, "saved"),
            inReader(InboxItem(id(2), Kind.PAGE, url = "https://example.com/clean", title = "A clean article", size = 20_000, from = "iPhone", received = r,
                extras = mapOf(ItemHeader.X_CAP to "clean", ItemHeader.X_ORIG to "https://example.com/clean?utm_source=news")), Path.SAVE_PAGE, "saved").copy(labState = "reader"),
            inReader(InboxItem(id(3), Kind.FILE, name = "Excerpt - a passage.html", mime = "text/html", title = "“A passage” · A page", size = 3_000, from = "iPhone", received = r,
                file = "${id(3)}/Excerpt - a passage.html", extras = mapOf(ItemHeader.X_CAP to "excerpt")), Path.SEND_FILE, "sent").copy(labState = "handed"),
            inReader(InboxItem(id(4), Kind.PAGE, url = "https://daylight.invalid/test/${id(4)}", title = "Test article from Mac", size = 4_000, received = r,
                extras = mapOf(ItemHeader.X_CAP to "test")), Path.SAVE_PAGE, "saved"),
            inReader(InboxItem(id(5), Kind.URL, url = "https://example.com/link", title = "A link", from = "iPhone", received = r), Path.SAVE_PAGE, "queued"),
            inReader(InboxItem(id(6), Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "A paper", size = 1_234_567, from = "Mac", received = r,
                file = "${id(6)}/paper.pdf"), Path.SEND_FILE, "sent"),
            inReader(InboxItem(id(7), Kind.PAGE, url = "https://example.com/odd", title = "An odd capture", size = 9_000, from = "Mac", received = r,
                extras = mapOf(ItemHeader.X_CAP to "something-new")), Path.SAVE_PAGE, "saved"),
            inReader(InboxItem(id(8), Kind.URL, url = "https://example.com/feed", title = "From the server", received = r, lane = InboxItem.LANE_SERVER), Path.SAVE_PAGE, "saved"),
        )
    }

    private fun inbox(lab: Boolean = true, extra: List<InboxItem> = emptyList()) {
        LabKit.useRelay(app, relay)
        app.prefs.labNoteShown = true
        if (!lab) ScreenKit.labOff(app)
        MainScreen.INBOX.prepare(app)
        // Instead of ScreenKit's items: this test's.
        for (i in app.inbox.items.value) app.inbox.remove(i.id)
        (items(System.currentTimeMillis()) + extra).reversed().forEach(app.inbox::put)
        compose.waitForIdle()
    }

    /** The texts of the merged tree (what a screen reader reads, node by node). */
    private fun read(): List<String> = compose.onAllNodes(SemanticsMatcher("anything") { true }).fetchSemanticsNodes().flatMap { n ->
        n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } + n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
    }

    @Test
    fun everyRowStatesItsKindLine() {
        inbox()
        val expected = listOf(
            "Page as you saw it · from Mac",
            "Clean article · from iPhone",
            "Excerpt · from iPhone",
            "Test article",
            "Link (the Reader downloads it) · from iPhone",
            LabText.inboxKindLine(Kind.FILE, size = 1_234_567, from = "Mac"),
            "Page as you saw it · from Mac", // an x-cap this Inbox does not know reads as none
            "Link (the Reader downloads it)",
        )
        for (i in items(System.currentTimeMillis())) assertEquals(i.title, InboxLab.kindLine(i), expected[i.id.last().digitToInt(16) - 1])
        for (line in expected.distinct()) {
            compose.onAllNodes(hasText(line))[0].performScrollTo().assertIsDisplayed()
        }
        // A screen reader reads each row's kind line (F03.4): every one is in the merged tree.
        val spoken = read()
        for (line in expected) assertTrue("TalkBack does not read \"$line\"", spoken.contains(line))
        assertEquals(2, spoken.count { it == "Page as you saw it · from Mac" })
        // The v1.1 meta line ("Web page · from Mac · …") is not there with Lab on.
        assertTrue(spoken.none { it.startsWith("Web page · from") })
    }

    /** F01, 2.3: the details (a tap on the title) say what the sender sees and where a cleaned link came from. */
    @Test
    fun theDetailsSayWhatTheSenderSees() {
        inbox()
        assertTrue("never on the row", read().none { it.startsWith("Sender sees:") })
        compose.onNode(hasText("A clean article") and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sender sees: In your Reader ✓").assertIsDisplayed()
        compose.onNodeWithText("Cleaned from example.com").assertIsDisplayed()
        compose.onNode(hasTestTag(INBOX_DETAILS_TAG)).assertIsDisplayed()

        compose.onNode(hasText("“A passage” · A page") and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sender sees: Handed to the Reader").assertIsDisplayed()

        // No state recorded yet: the sender's "On your Daylight ✓".
        compose.onNode(hasText("A link") and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sender sees: On your Daylight ✓").assertIsDisplayed()

        // An item from the Daylight server has no sender: no such line.
        compose.onNode(hasText("From the server") and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(3, read().count { it.startsWith("Sender sees:") })

        // A second tap closes them.
        compose.onNode(hasText("A clean article") and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Cleaned from example.com")).fetchSemanticsNodes().isEmpty())
    }

    /** F15: an item kept for later says so, in words, and keeps its Add to Reader. */
    @Test
    fun anItemKeptForLaterSaysSo() {
        val kept = InboxItem(id(9), Kind.URL, url = "https://example.com/kept", title = "Kept one", from = "iPhone",
            received = System.currentTimeMillis(), held = true, labState = "held")
        inbox(extra = listOf(kept))
        compose.onNodeWithText(LabText["arrivals.keptForLater"]).performScrollTo().assertIsDisplayed()
        compose.onNode(hasText("Kept one") and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sender sees: Kept for later on your Daylight").assertIsDisplayed()
        assertEquals("it waits: nothing handed it over", InboxItem.WAITING, app.inbox.get(kept.id)!!.state)
        // Add to Reader: no longer kept (the hand-off takes it).
        compose.onNodeWithText("Add to Reader").performScrollTo().performClick()
        compose.waitForIdle()
        assertTrue(!app.inbox.get(kept.id)!!.held)
    }

    /** With Lab off: v1.1's rows (the meta line, a title that is not a button, no details, "Waiting"). */
    @Test
    fun labOffRowsAreV11s() {
        val kept = InboxItem(id(9), Kind.URL, url = "https://example.com/kept", title = "Kept one", from = "iPhone",
            received = System.currentTimeMillis(), held = true)
        inbox(lab = false, extra = listOf(kept))
        val spoken = read()
        assertTrue(spoken.none { it.startsWith("Excerpt · from") || it.startsWith("Clean article") || it.startsWith("Sender sees:") })
        assertTrue(spoken.any { it.startsWith("Web page · from Mac · ") })
        assertTrue(compose.onAllNodes(hasText("A clean article") and hasClickAction()).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodes(hasText(LabText["arrivals.keptForLater"])).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick) and hasText("Kept one")).fetchSemanticsNodes().isEmpty())
    }
}
