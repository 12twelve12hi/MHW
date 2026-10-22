package com.daylight.share

import android.app.Dialog
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.daylight.share.core.PairingConfirmation
import com.daylight.share.ui.COMFORT_TARGET
import com.daylight.share.ui.COMFORT_TEXT_SCALE
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.StillScroll
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog

/**
 * F27 where the screen tests do not reach: the app's three questions (dialogs) and scrolling.
 *
 * A dialog is a window of its own, and Compose gives it that window's density again: each question is opened with
 * Comfort on, and its text must be 1.3 times the system's size (as on the screen behind it), and at the largest text
 * size on a 360 dp phone nothing in it may be cut short and its buttons must be 56 dp (F27.4). Dialogs appear without
 * a window animation.
 *
 * Scrolling (the DC-1 Inbox never animates, Comfort is "no motion"): in a window short enough that a field is below
 * the fold, focusing it brings it into view in one step, and a focused field stays in view, in one step, when the
 * keyboard shrinks the screen. A self-test shows that the check sees Compose's own scroll animation, which the phone
 * keeps without Comfort.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DialogsAndScrollingTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App

    // ------------------------------------------------------------------------------------------------- dialogs

    /** The app's questions: the screen each is asked on, and how it is asked. */
    private enum class Question(val file: String, val screen: MainScreen) {
        /** A pairing link opened with the camera app, the phone not paired yet (MainActivity.offerPairing). */
        PAIRING("dialog-pairing", MainScreen.SENDER_UNPAIRED),
        /** "Reset pairing?" on the Inbox. */
        RESET("dialog-reset-pairing", MainScreen.INBOX_NEW),
        /** "Make this the Daylight Inbox?" in the phone's Settings. */
        ROLE("dialog-switch-role", MainScreen.SENDER_SETTINGS),
    }

    private fun ask(q: Question) {
        when (q) {
            Question.PAIRING -> compose.runOnUiThread {
                compose.activity.offerPairing(ScreenKit.senderPairing, PairingConfirmation.Source.LINK)
            }
            Question.RESET -> compose.onNodeWithText("Reset pairing").performClick()
            Question.ROLE -> compose.onNodeWithText("This is my Daylight (Inbox)").performClick()
        }
        compose.waitForIdle()
        compose.onNode(isDialog()).assertExists("${q.file} did not open")
    }

    @Test fun thePairingQuestionFollowsComfort() = checkQuestion(Question.PAIRING)
    @Test fun theResetQuestionFollowsComfort() = checkQuestion(Question.RESET)
    @Test fun theRoleQuestionFollowsComfort() = checkQuestion(Question.ROLE)

    private fun checkQuestion(q: Question) {
        ScreenKit.labOff(app)
        q.screen.prepare(app)
        app.setComfort(true)
        q.screen.open(compose)
        ask(q)

        // Comfort at the system's text size: 1.3 times, in the dialog as on the screen behind it.
        val system = compose.activity.resources.configuration.fontScale
        assertTextScale(q, "Comfort", system * COMFORT_TEXT_SCALE)

        // Comfort at the largest text size on a 360 dp phone (F27.4).
        ScreenKit.showAtLargestText(compose)
        q.screen.open(compose)
        ask(q)
        assertTextScale(q, "Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text", ScreenKit.LARGEST_FONT_SCALE * COMFORT_TEXT_SCALE)
        val cut = ScreenKit.textOverflows(compose)
        assertTrue("${q.file}, Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text: text cut short or clipped:\n${cut.joinToString("\n")}", cut.isEmpty())
        val problems = ScreenKit.accessibilityProblems(compose, minTargetDp = COMFORT_TARGET.value)
        assertTrue("${q.file}, Comfort:\n${problems.joinToString("\n")}", problems.isEmpty())
        val buttons = compose.onAllNodes(hasAnyAncestor(isDialog()) and hasClickAction()).fetchSemanticsNodes()
        assertEquals("${q.file}: its two buttons", 2, buttons.size)
        val dialog = latestDialog()
        runCatching { ScreenKit.screenshot(compose, "${q.file}-comfort-200", dialog.window!!.decorView) }
            .onFailure { println("f27-screenshot: ${q.file}-comfort-200 not taken: ${it.message}") }
    }

    /**
     * Every text in the open dialog is laid out at the font scale [scale], as the screen's text behind it, and 18 sp
     * comes out the same size in both. (A text is laid out with its node's density and font scale, and on Android 14
     * and later a font scale goes through Android's non-linear curve: 18 sp at x1.3 is 21.6 dp there, not 23.4.)
     */
    private fun assertTextScale(q: Question, how: String, scale: Float) {
        val behind = texts(!hasAnyAncestor(isDialog()) and !isDialog())
        assertTrue("${q.file}: no text behind the dialog", behind.isNotEmpty())
        val (behindWords, b) = behind.first()
        assertEquals("${q.file}, $how: \"$behindWords\" behind the dialog: font scale", scale, b.layoutInput.density.fontScale, 0.001f)
        val size = with(b.layoutInput.density) { 18.sp.toDp().value }
        val inDialog = texts(hasAnyAncestor(isDialog()))
        assertTrue("${q.file}: no text in the dialog", inDialog.isNotEmpty())
        for ((words, r) in inDialog) {
            assertEquals("${q.file}, $how: \"$words\" in the dialog: font scale", scale, r.layoutInput.density.fontScale, 0.001f)
            assertEquals("${q.file}, $how: \"$words\" in the dialog: 18 sp in dp", size, with(r.layoutInput.density) { 18.sp.toDp().value }, 0.01f)
        }
    }

    private fun texts(where: SemanticsMatcher): List<Pair<String, TextLayoutResult>> =
        compose.onAllNodes(where and SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true)
            .fetchSemanticsNodes()
            .mapNotNull { n ->
                val results = ArrayList<TextLayoutResult>()
                n.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
                val words = n.config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
                results.firstOrNull()?.let { words to it }
            }

    private fun latestDialog(): Dialog = ShadowDialog.getLatestDialog() ?: error("no dialog shown")

    /** Dialogs appear and go without a window animation (the app theme's dialogTheme): the Inbox's. */
    @Test
    fun theInboxsDialogsDoNotAnimate() {
        MainScreen.INBOX_NEW.prepare(app)
        MainScreen.INBOX_NEW.open(compose)
        ask(Question.RESET)
        assertEquals("the dialog window's animation style", 0, latestDialog().window!!.attributes.windowAnimations)
    }

    /** And the phone's. */
    @Test
    fun thePhonesDialogsDoNotAnimate() {
        MainScreen.SENDER_SETTINGS.prepare(app)
        MainScreen.SENDER_SETTINGS.open(compose)
        ask(Question.ROLE)
        assertEquals("the dialog window's animation style", 0, latestDialog().window!!.attributes.windowAnimations)
    }

    // ----------------------------------------------------------------------------------------------- scrolling

    /** Whether all of the node is inside what its list shows (its box in the root is not clipped). */
    private fun fullyShown(node: SemanticsNodeInteraction): Boolean {
        val n = node.fetchSemanticsNode()
        return n.boundsInRoot.height >= n.size.height - 1f && n.boundsInRoot.width >= n.size.width - 1f
    }

    private fun field(label: String) = compose.onNode(hasSetTextAction() and hasText(label))

    /** The DC-1 Inbox: focusing a field below the fold (Settings › Relay URL) shows it in one step. */
    @Config(qualifiers = "w360dp-h360dp")
    @Test
    fun theInboxShowsAFieldInOneStep() {
        ScreenKit.labOff(app)
        MainScreen.INBOX_SETTINGS.prepare(app)
        MainScreen.INBOX_SETTINGS.open(compose)
        val relay = field("Relay URL")
        assertFalse("the test needs Relay URL below the fold", fullyShown(relay))
        val moved = ScreenKit.motionAfter(compose) { relay.performSemanticsAction(SemanticsActions.RequestFocus) }
        assertTrue("bringing Relay URL into view moved:\n${moved.joinToString("\n")}", moved.isEmpty())
        relay.assertIsFocused()
        assertTrue("Relay URL is in view", fullyShown(relay))
    }

    /** Comfort on a phone, in a list (the pairing screen): the "Pairing code" field comes into view in one step. */
    @Config(qualifiers = "w360dp-h360dp")
    @Test
    fun comfortShowsAFieldInAListInOneStep() {
        ScreenKit.labOff(app)
        MainScreen.SENDER_UNPAIRED.prepare(app)
        app.setComfort(true)
        MainScreen.SENDER_UNPAIRED.open(compose)
        val code = field("Pairing code")
        assertFalse("the test needs the pairing-code field below the fold", fullyShown(code))
        // Focused and empty, the field shows the code's form: that text appears once, and is left out of the places.
        val moved = ScreenKit.motionAfter(compose, ignore = setOf("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX")) {
            code.performSemanticsAction(SemanticsActions.RequestFocus)
        }
        assertTrue("bringing the pairing-code field into view moved:\n${moved.joinToString("\n")}", moved.isEmpty())
        code.assertIsFocused()
        assertTrue("the pairing-code field is in view", fullyShown(code))
    }

    /**
     * The keyboard opening shrinks the screen (the activity resizes for it): a focused field it would cover moves up
     * in one step. The screen is hosted in a box whose height the test sets, as the keyboard would.
     */
    @Config(qualifiers = "w360dp-h480dp")
    @Test
    fun aFocusedFieldStaysInViewInOneStepWhenTheScreenShrinks() {
        ScreenKit.labOff(app)
        MainScreen.INBOX_SETTINGS.prepare(app)
        val height = mutableStateOf<Dp?>(null)
        compose.runOnUiThread {
            compose.activity.setContent {
                Box(height.value?.let { Modifier.fillMaxWidth().height(it) } ?: Modifier.fillMaxSize()) { compose.activity.AppContent() }
            }
        }
        MainScreen.INBOX_SETTINGS.open(compose)
        val relay = field("Relay URL")
        relay.performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        relay.assertIsFocused()
        assertTrue("Relay URL is in view once focused", fullyShown(relay))
        // Places unclipped: the shrinking itself moves nothing, it only cuts the bottom off.
        val moved = ScreenKit.motionAfter(compose, clipped = false) { height.value = 280.dp }
        assertTrue("keeping Relay URL in view moved:\n${moved.joinToString("\n")}", moved.isEmpty())
        assertTrue("Relay URL is in view after the screen shrank", fullyShown(relay))
    }

    /** The self-test: the phone without Comfort keeps Compose's scroll animation, and the check sees it. */
    @Config(qualifiers = "w360dp-h360dp")
    @Test
    fun theMotionCheckSeesComposesScrollAnimation() {
        ScreenKit.labOff(app)
        MainScreen.SENDER_SETTINGS.prepare(app)
        MainScreen.SENDER_SETTINGS.open(compose)
        val relay = field("Relay URL")
        assertFalse("the test needs Relay URL below the fold", fullyShown(relay))
        val moved = ScreenKit.motionAfter(compose) { relay.performSemanticsAction(SemanticsActions.RequestFocus) }
        assertTrue("Compose's own scroll to Relay URL should move frame by frame", moved.isNotEmpty())
        compose.waitForIdle()
        assertTrue("Relay URL is in view", fullyShown(relay))
    }

    /** The rule [StillScroll] scrolls by: Compose's own (the nearer edge; nothing when shown or too tall). */
    @Test
    fun theStillScrollRuleIsComposes() {
        assertEquals(0f, StillScroll.distanceToShow(10f, 50f, 100f), 0f)
        assertEquals(30f, StillScroll.distanceToShow(90f, 130f, 100f), 0f)
        assertEquals(-20f, StillScroll.distanceToShow(-20f, 20f, 100f), 0f)
        assertEquals(0f, StillScroll.distanceToShow(-20f, 130f, 100f), 0f)
    }
}
