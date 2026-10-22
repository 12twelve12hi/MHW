package com.daylight.share

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.daylight.share.PhoneKit.MIN
import com.daylight.share.core.ErrorCode
import com.daylight.share.core.Kind
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabRowText
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.LAB_NOTE_ENABLED_PHONE
import com.daylight.share.ui.LAB_CHECKED_IN_TAG
import com.daylight.share.ui.LAB_STEP_LINE_TAG
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The honest delivery timeline on the phone (LAB-PLAN F01, 2.5; card K4) and the offline queue (F07.2), on the home
 * screen with Lab on: the check-in header, rows in `LabRowText`'s words, the sentence and the step line only on the
 * newest row and on rows that are not final, the screen reader's "{label}. {sentence}" with the step line hidden from
 * it, no Delivered or In your Reader without an ack, v1.1's rows against a v1.1 Inbox, and "Waiting to send (n)".
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class SenderTimelineTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun waitForText(text: String, ms: Long = 10_000) =
        compose.waitUntil(ms) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun tick() {
        runBlocking { app.sender.tick() }
        compose.waitForIdle()
    }

    private fun ctx(id: String, state: String?, inboxLab: Boolean = true) =
        LabRowText.Context(lab = true, inboxLab = inboxLab, hasCap = { it == "st" || it == "tap" }, state = state, online = true)

    /** F01.6: three rows (reader, waiting, and the newest, sent): the sentence and step line only where 2.5 says. */
    @Test
    fun theStepLineShowsOnTheNewestRowAndOnRowsThatAreNotFinal() {
        PhoneKit.phone(app, relay)
        val now = System.currentTimeMillis()
        val reader = PhoneKit.row(1, "Already in the Reader", Status.DELIVERED, now - 3 * MIN, delivered = now - 2 * MIN)
        val waiting = PhoneKit.row(2, "Waits for a tap", Status.DELIVERED, now - 2 * MIN, kind = Kind.FILE, delivered = now - MIN)
        val sent = PhoneKit.row(3, "Just sent", Status.SENT, now - MIN)
        PhoneKit.writeRows(app, listOf(reader, waiting, sent))
        PhoneKit.hello(relay, mapOf(reader.id to "reader", waiting.id to "waiting"))
        tick()

        val r = LabRowText.of(reader, now, ctx(reader.id, "reader"))
        val w = LabRowText.of(waiting, now, ctx(waiting.id, "waiting"))
        val s = LabRowText.of(sent, now, ctx(sent.id, null))
        assertEquals(LabText["rows.reader.label"], r.label)
        assertEquals(LabText["rows.waiting.label"], w.label)
        waitForText(r.label)
        compose.onNodeWithText(w.label).assertIsDisplayed()
        compose.onNodeWithText(s.label).assertIsDisplayed()

        // Every row's label is read as "{label}. {sentence}", with no step count.
        for (t in listOf(r, w, s)) {
            compose.onNode(hasContentDescription(t.a11yLabel), useUnmergedTree = true).assertExists()
            assertEquals(if (t.sentence != null) "${t.label}. ${t.sentence}" else t.label, t.a11yLabel)
        }
        // Two step lines: the newest row (sent) and the row that is not final (waiting); none for the reader row.
        val lines = compose.onAllNodes(hasTestTag(LAB_STEP_LINE_TAG), useUnmergedTree = true).fetchSemanticsNodes()
        assertEquals(2, lines.size)
        // Hidden from screen readers: no node reads a step line.
        for (t in listOf(w, s)) assertTrue(compose.onAllNodes(hasText(t.stepLine!!, substring = true), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        for (n in lines) assertEquals(null, n.config.getOrNull(SemanticsProperties.Text))
        // The final row's sentence waits in its details: a tap on its title shows it (and its step line).
        assertTrue(compose.onAllNodes(hasTestTag(LAB_STEP_LINE_TAG), useUnmergedTree = true).fetchSemanticsNodes().size == 2)
        compose.onNodeWithText(reader.title).performClick()
        compose.waitForIdle()
        assertEquals(3, compose.onAllNodes(hasTestTag(LAB_STEP_LINE_TAG), useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    /** F01.3: the check-in header, before and after the Daylight checks in. */
    @Test
    fun theHeaderSaysWhenTheDaylightCheckedIn() {
        PhoneKit.phone(app, relay)
        PhoneKit.writeRows(app, listOf(PhoneKit.row(1, "A link", Status.SENT, System.currentTimeMillis() - MIN)))
        runBlocking { app.sender.refresh() }
        waitForText(LabText.NEVER_CHECKED_IN)
        PhoneKit.hello(relay)
        tick()
        val checked = app.sender.ledger()!!.snapshot().checkedIn
        val line = LabText.checkedInText(checked, System.currentTimeMillis())
        waitForText(line)
        compose.onNode(hasTestTag(LAB_CHECKED_IN_TAG)).assertExists()
        assertTrue(line, line.startsWith("Your Daylight checked in "))
    }

    /** F01.4: a Lab state never makes a row Delivered or In your Reader without an ack listing its id. */
    @Test
    fun noRowIsInTheReaderWithoutAnAck() {
        PhoneKit.phone(app, relay)
        val sent = PhoneKit.row(1, "Not acked yet", Status.SENT, System.currentTimeMillis() - MIN)
        PhoneKit.writeRows(app, listOf(sent))
        PhoneKit.hello(relay, mapOf(sent.id to "reader"))
        tick()
        compose.onNodeWithText("Sent · waiting for your Daylight").assertIsDisplayed()
        assertTrue(compose.onAllNodes(hasText(LabText["rows.reader.label"])).fetchSemanticsNodes().isEmpty())
        // The ack: delivered, and the state the ledger kept shows at once.
        PhoneKit.ack(relay, listOf(sent.id))
        tick()
        waitForText(LabText["rows.reader.label"])
    }

    /** F01.5 and F17.2: against an Inbox that never said hello (v1.0, v1.1), a delivered row reads as today. */
    @Test
    fun aV11InboxKeepsDeliveredRows() {
        PhoneKit.phone(app, relay)
        val now = System.currentTimeMillis()
        PhoneKit.writeRows(app, listOf(PhoneKit.row(1, "Delivered the v1.1 way", Status.DELIVERED, now - 2 * MIN, delivered = now - MIN)))
        runBlocking { app.sender.refresh() }
        waitForText("Delivered ✓")
        compose.onNodeWithText("Saved on your Daylight.", substring = true).assertExists()
        assertTrue(compose.onAllNodes(hasText(LabText["rows.delivered.label"])).fetchSemanticsNodes().isEmpty())
        // With a Lab Inbox and no state yet: "On your Daylight ✓".
        PhoneKit.hello(relay)
        tick()
        waitForText(LabText["rows.delivered.label"])
    }

    /** F01.4: a failed row says why, with v1.1's button only where it helps. */
    @Test
    fun failedRowsKeepTheirSentenceAndButton() {
        PhoneKit.phone(app, relay)
        val now = System.currentTimeMillis()
        PhoneKit.writeRows(
            app,
            listOf(
                PhoneKit.row(1, "Turned down", Status.EXPIRED, now - 3 * MIN, errorCode = ErrorCode.REFUSED),
                PhoneKit.row(2, "Far too big", Status.EXPIRED, now - 2 * MIN, kind = Kind.FILE, errorCode = ErrorCode.TOO_LARGE),
            ),
        )
        runBlocking { app.sender.refresh() }
        waitForText("Turned down")
        compose.onNode(hasText("The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.")).assertExists()
        assertEquals(1, compose.onAllNodes(hasText("Try again")).fetchSemanticsNodes().size)
        assertTrue(compose.onAllNodes(hasText("Retry now")).fetchSemanticsNodes().isEmpty())
    }

    /** F07.1 and F07.2: offline, a row waits for a connection in "Waiting to send (n)", with Cancel. */
    @Test
    fun theQueueShowsWhatWaitsForAConnection() {
        PhoneKit.phone(app, relay, online = false)
        val now = System.currentTimeMillis()
        PhoneKit.writeRows(
            app,
            listOf(
                PhoneKit.row(1, "Shared offline", Status.FAILED, now - 2 * MIN, errorCode = ErrorCode.NETWORK, lastPublish = now),
                PhoneKit.row(2, "Also offline", Status.FAILED, now - MIN, errorCode = ErrorCode.NETWORK, lastPublish = now),
                PhoneKit.row(3, "Sent before", Status.SENT, now - 3 * MIN),
            ),
        )
        runBlocking { app.sender.refresh() }
        waitForText(LabText.fill(LabText["queue.heading"], mapOf("n" to 2)))
        assertEquals(2, compose.onAllNodes(hasText(LabText["rows.offline.label"])).fetchSemanticsNodes().size)
        assertTrue("never Not delivered", compose.onAllNodes(hasText("Not delivered")).fetchSemanticsNodes().isEmpty())
        assertEquals(2, compose.onAllNodes(hasText(LabText["queue.cancel"])).fetchSemanticsNodes().size)
        compose.onAllNodes(hasText(LabText["queue.cancel"]))[0].performClick()
        waitForText(LabText.fill(LabText["queue.heading"], mapOf("n" to 1)))
        PhoneKit.until(what = "the row removed") { app.sender.rows.value.size == 2 }
    }

    /** 1.2: the phone's W1 build (F01, F04) shows the one-time note, once. */
    @Test
    fun thePhoneShowsTheOneTimeNoteOnce() {
        assertTrue(LAB_NOTE_ENABLED_PHONE)
        PhoneKit.phone(app, relay, noteSeen = false)
        waitForText(LabText.NOTE)
        compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText(LabText.NOTE)).fetchSemanticsNodes().isEmpty())
        assertTrue(app.prefs.labNoteShown)
    }
}
