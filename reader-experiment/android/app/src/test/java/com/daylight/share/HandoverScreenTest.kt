package com.daylight.share

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.daylight.share.core.lab.LabText
import com.daylight.share.inbox.handover.HANDOVER_TAG
import com.daylight.share.inbox.handover.Handover
import com.daylight.share.ui.COMFORT_TARGET
import com.daylight.share.ui.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The handover on screen (LAB-PLAN 5.3.4; card K6), with the fake providers of [HandoverTest]: the Lab card on the
 * Inbox has no handover row without the Lab Reader (every DC-1 but the lab tablet); with it, **Let Daylight Reader (lab)
 * receive** arms the grant and shows the step to take on the Lab Reader; once it took over, the card and the Inbox say
 * "Daylight Reader (lab) receives for this Daylight now."; a Reader that can't be reached adds its sentence and offers
 * no button; a Reader that says it stopped offers **Receive here again**, which resumes. Each state passes the F27
 * checks as shipped and with Comfort at the largest text on a 360 dp phone, and is saved for review
 * (`lab-handover-*.png` among the F27 screenshots).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class HandoverScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    private val let get() = LabText["handover.letReceive"]
    private val armed get() = LabText["handover.armed"]
    private val elsewhere get() = LabText["handover.receivingElsewhere"]
    private val receiveHere get() = LabText["handover.receiveHereAgain"]
    private val unreachable get() = LabText["handover.unreachable"]

    /**
     * K6 review: the five sentences are LAB_TEXT's `handover.*` (LabText), and those are LAB-PLAN 5.3.4's words, U+2019
     * included. The share lane's lab.test.mjs pins LAB_TEXT against the plan; this pins what the screens show.
     */
    @Test
    fun theHandoverWordsAreLabTexts() {
        assertEquals("Let Daylight Reader (lab) receive", let)
        assertEquals("Open Daylight Reader (lab) › Settings › Labs › Send to Daylight and choose Take over.", armed)
        assertEquals("Daylight Reader (lab) receives for this Daylight now.", elsewhere)
        assertEquals("Receive here again", receiveHere)
        assertEquals("Can\u2019t reach Daylight Reader (lab) right now.", unreachable)
    }

    @Before
    fun reset() {
        HandoverTest.FakeReaderInbox.reset()
        HandoverTest.AsCaller.pkg = null
    }

    private fun waitForText(text: String, ms: Long = 10_000) =
        compose.waitUntil(ms) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun gone(text: String): Boolean = compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty()

    private fun inbox(labReader: Boolean) {
        LabKit.useRelay(app, relay)
        app.prefs.labNoteShown = true
        if (labReader) {
            shadowOf(app.packageManager).installPackage(PackageInfo().apply {
                packageName = Handover.LAB_READER
                applicationInfo = ApplicationInfo().apply { packageName = Handover.LAB_READER }
            })
        }
        Robolectric.setupContentProvider(HandoverTest.AsCaller::class.java, Handover.AUTHORITY)
        MainScreen.INBOX.prepare(app)
        // No rows: with Comfort at the largest text the Inbox stays within the test window (16000 dp).
        for (i in app.inbox.items.value) app.inbox.remove(i.id)
        compose.waitForIdle()
    }

    /** The Lab Reader's inbox provider is there and says [receiving]. */
    private fun readerInbox(receiving: Boolean) {
        HandoverTest.FakeReaderInbox.receiving(receiving)
        Robolectric.setupContentProvider(HandoverTest.FakeReaderInbox::class.java, Handover.readerAuthority())
    }

    /** The Lab Reader's Take over: its call to Daylight Share's provider while armed. */
    private fun takeOver() {
        HandoverTest.AsCaller.pkg = Handover.LAB_READER
        val b = app.contentResolver.call(Uri.parse("content://${Handover.AUTHORITY}"), Handover.METHOD_PAIRING, null, null)
        assertTrue("the Lab Reader got no code", b?.getString(Handover.KEY_CODE) != null)
    }

    private fun openSettings() {
        compose.onNodeWithText("Settings").performClick()
        compose.waitForIdle()
    }

    /** F27 as shipped, then with Comfort at the largest text ([reopen] brings the screen back after the restart). */
    private fun checkAccessibility(name: String, reopen: () -> Unit) {
        ScreenKit.screenshot(compose, "$name-lab-on")
        val problems = ScreenKit.accessibilityProblems(compose)
        assertTrue("$name:\n${problems.joinToString("\n")}", problems.isEmpty())
        app.setComfort(true)
        ScreenKit.showAtLargestText(compose)
        reopen()
        ScreenKit.screenshot(compose, "$name-comfort-200")
        val cut = ScreenKit.textOverflows(compose)
        assertTrue("$name, Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text: text cut short or clipped:\n${cut.joinToString("\n")}", cut.isEmpty())
        val comfortProblems = ScreenKit.accessibilityProblems(compose, minTargetDp = COMFORT_TARGET.value)
        assertTrue("$name, Comfort:\n${comfortProblems.joinToString("\n")}", comfortProblems.isEmpty())
    }

    @Test
    fun noHandoverRowWithoutTheLabReader() {
        inbox(labReader = false)
        openSettings()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").assertIsDisplayed()
        compose.waitForIdle()
        assertTrue(gone(let))
        assertTrue(gone(elsewhere))
    }

    @Test
    fun letTheLabReaderReceiveThenItReceives() {
        inbox(labReader = true)
        openSettings()
        waitForText(let)
        assertTrue(gone(armed))
        compose.onNode(hasText(let) and hasClickAction()).performScrollTo().performClick()
        waitForText(armed)
        assertTrue(app.handover.armed())
        checkAccessibility("lab-handover-armed") {
            openSettings()
            waitForText(armed)
        }

        // The Lab Reader takes over: the card says so, and the button and the step go.
        readerInbox(receiving = true)
        takeOver()
        waitForText(elsewhere)
        assertTrue(gone(let))
        assertTrue(gone(armed))
        assertTrue(gone(receiveHere))
        assertTrue(gone(unreachable))

        // The Inbox screen says so too.
        compose.onNodeWithText("Done").performClick()
        waitForText(elsewhere)
        compose.onNode(hasTestTag(HANDOVER_TAG)).assertIsDisplayed()
    }

    @Test
    fun aReaderThatCantBeReachedIsSaidSoWithNoButton() {
        inbox(labReader = true)
        app.handover.arm()
        takeOver() // no ShareInboxProvider registered: it cannot be reached
        openSettings()
        waitForText(unreachable)
        assertTrue(gone(receiveHere))
        assertEquals(Handover.LAB_READER, app.handover.receivingElsewhere())
        checkAccessibility("lab-handover-unreachable") {
            openSettings()
            waitForText(unreachable)
        }
        // The Inbox screen too.
        compose.onNodeWithText("Done").performClick()
        compose.onNode(hasTestTag(HANDOVER_TAG)).assertIsDisplayed()
        waitForText(unreachable)
        assertTrue(gone(receiveHere))
    }

    @Test
    fun aReaderThatStoppedOffersReceiveHereAgain() {
        inbox(labReader = true)
        readerInbox(receiving = true)
        app.handover.arm()
        takeOver()
        openSettings()
        waitForText(elsewhere)
        compose.waitForIdle()
        assertTrue(gone(receiveHere))

        // The Lab Reader's switch went off: the next look at the card offers Receive here again.
        HandoverTest.FakeReaderInbox.receiving(false)
        compose.runOnUiThread { compose.activity.resumes.intValue++ }
        waitForText(receiveHere)
        assertEquals(Handover.LAB_READER, app.handover.receivingElsewhere())
        checkAccessibility("lab-handover-stopped") {
            openSettings()
            waitForText(receiveHere)
        }

        compose.onNode(hasText(receiveHere) and hasClickAction()).performScrollTo().performClick()
        waitForText(let)
        assertNull(app.handover.receivingElsewhere())
        assertTrue(gone(elsewhere))
    }

    /**
     * LAB-PLAN 1.3 (Oct 22): a handover outlives Lab off. With Lab off the Inbox screen keeps its handover line (it says
     * where items go), and offers **Receive here again** once the Lab Reader says it stopped; the Lab card is gone.
     */
    @Test
    fun withLabOffTheInboxKeepsItsHandoverLine() {
        inbox(labReader = true)
        readerInbox(receiving = true)
        app.handover.arm()
        takeOver()
        app.setLab(false)
        compose.waitForIdle()
        waitForText(elsewhere)
        compose.onNode(hasTestTag(HANDOVER_TAG)).assertIsDisplayed()
        assertTrue(gone(receiveHere))

        HandoverTest.FakeReaderInbox.receiving(false)
        compose.runOnUiThread { compose.activity.resumes.intValue++ }
        waitForText(receiveHere)
        assertEquals(Handover.LAB_READER, app.handover.receivingElsewhere())
        compose.onNode(hasText(receiveHere) and hasClickAction()).performScrollTo().performClick()
        // The setting goes first and the screen's state after it (Handover.end), so the line is waited for, not read
        // the moment the setting is gone.
        compose.waitUntil(10_000) { app.handover.receivingElsewhere() == null && gone(elsewhere) }
        assertNull(app.handover.receivingElsewhere())
        // Settings: with Lab off, the Lab card holds only its switch (no handover row).
        openSettings()
        assertTrue(gone(let))
        assertTrue(gone("${LabText.WHATS_IN_LAB} ›"))
    }
}
