package com.daylight.share

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.AutomationActivity
import com.daylight.share.sender.ShareActivity
import com.daylight.share.ui.COMFORT_TARGET
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The accessibility baseline (F27) on the two cards K4 added outside the app's screens, as [LabScreensAccessibilityTest]
 * runs it on Lab's screens: the share-in-place card with Options open (the title field, Send link / Send as excerpt,
 * Send and Close: what Comfort, TalkBack and Switch Access users always get, F04.5) and the automation sheet with its
 * needs-quick-sends note (F09). As shipped, the Accessibility Test Framework's rules on the semantics tree (labels, 48 dp
 * targets, one control per spot; the tap outside a card is a gesture, not an unlabelled control the size of the
 * screen); with Comfort at the largest text on a 360 dp phone, no text cut short and no control under 56 dp (F27.4),
 * with a Daylight name about as long as a pairing keeps (58 of 60 characters) and a long title. The window is tall, so the whole
 * card is laid out; on a small phone (360 x 640 dp) at that size the cards are taller than the screen, and every
 * control on them can still be scrolled to. Each is saved as a PNG for review (`lab-share-card-*.png`,
 * `lab-automation-sheet-*.png` among the F27 screenshots).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LabCardsAccessibilityTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @Before
    fun setUp() = AutomationActivity.resetQuickSends()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun phone() {
        PhoneKit.phone(app, relay, pairing = LabKit.vectorPairing.withName(LONG_NAME))
        assertEquals("the name as the pairing keeps it", LONG_NAME, app.sender.pairing()?.name)
    }

    private fun shareIntent(): Intent =
        Intent(app, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, QUOTE)

    /** A quick send asked for while quick sends are off: the sheet with its needs-quick-sends note. */
    private fun automationIntent(): Intent =
        Intent(AutomationActivity.ACTION_SEND_URL).setClass(app, AutomationActivity::class.java)
            .putExtra(Intent.EXTRA_TEXT, "https://www.example.com/stories/2026/10/22/the-real-reason-inflation-is-still-too-high?utm_source=feed")
            .putExtra(Intent.EXTRA_TITLE, LONG_TITLE)
            .putExtra(AutomationActivity.EXTRA_QUICK, true)

    private fun <A : ComponentActivity> ActivityScenario<A>.activity(): A {
        var a: A? = null
        onActivity { a = it }
        return a!!
    }

    private fun waitFor(matcher: SemanticsMatcher, ms: Long = 10_000) =
        compose.waitUntil(ms) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }

    private val send = hasText(LabText["shareInPlace.send"]) and hasClickAction()

    /** The card with Options open: as shipped it counts down, and Options stops it (with Comfort it opens so). */
    private fun openOptions() {
        val options = compose.onAllNodes(hasText(LabText["shareInPlace.options"]) and hasClickAction())
        if (options.fetchSemanticsNodes().isNotEmpty()) options.onFirst().performClick()
        waitFor(send)
        compose.onNode(hasSetTextAction()).performTextReplacement(LONG_TITLE)
    }

    private fun openSheet() = waitFor(hasText(LabText["automation.send"]) and hasClickAction())

    @Test
    fun shareCardWithOptions() {
        phone()
        ActivityScenario.launch<ShareActivity>(shareIntent()).use { s ->
            val a = s.activity()
            check("lab-share-card-options", a, { a.Screen() }, ::openOptions)
            compose.onNode(hasText(LabText["shareInPlace.sendAsExcerpt"])).assertExists()
            assertFalse("the card is still up", a.isFinishing)
        }
        assertTrue("nothing was sent", PhoneKit.store(app).load().first.isEmpty())
    }

    @Test
    fun automationSheetWithTheQuickSendsNote() {
        phone()
        ActivityScenario.launch<AutomationActivity>(automationIntent()).use { s ->
            val a = s.activity()
            check("lab-automation-sheet", a, { a.Screen() }, ::openSheet)
            compose.onNode(hasText(LabText.button("needs-quick-sends")!!) and hasClickAction()).assertExists()
        }
        assertTrue("nothing was sent", PhoneKit.store(app).load().first.isEmpty())
    }

    /**
     * F27.4 on a small phone: with Comfort at the largest text, each card is taller than the screen, and every control
     * on it can be scrolled into full view (it is not cut off below the screen's edge).
     */
    @Config(qualifiers = "w360dp-h640dp")
    @Test
    fun onASmallPhoneEveryControlCanBeReached() {
        phone()
        app.setComfort(true)
        ActivityScenario.launch<ShareActivity>(shareIntent()).use { s ->
            val a = s.activity()
            ScreenKit.showAtLargestText(compose, a) { a.Screen() }
            waitFor(send)
            reachAll(
                "the share card",
                listOf(
                    hasSetTextAction(),
                    hasText(LabText["shareInPlace.sendLink"]),
                    hasText(LabText["shareInPlace.sendAsExcerpt"]),
                    send,
                    hasText("Close") and hasClickAction(),
                ),
            )
        }
        ActivityScenario.launch<AutomationActivity>(automationIntent()).use { s ->
            val a = s.activity()
            ScreenKit.showAtLargestText(compose, a) { a.Screen() }
            openSheet()
            reachAll(
                "the automation sheet",
                listOf(
                    hasText(LabText["automation.send"]) and hasClickAction(),
                    hasText(LabText["automation.cancel"]) and hasClickAction(),
                    hasText(LabText.button("needs-quick-sends")!!) and hasClickAction(),
                ),
            )
        }
    }

    private fun fullyShown(node: SemanticsNodeInteraction): Boolean {
        val n = node.fetchSemanticsNode()
        return n.boundsInRoot.height >= n.size.height - 1f && n.boundsInRoot.width >= n.size.width - 1f
    }

    /** Each of [controls] can be brought into full view; at least one starts below the fold (the test needs that). */
    private fun reachAll(what: String, controls: List<SemanticsMatcher>) {
        assertFalse("$what: the test needs a card taller than the screen", controls.all { fullyShown(compose.onNode(it)) })
        for (m in controls) {
            val node = compose.onNode(m)
            if (!fullyShown(node)) node.performScrollTo()
            assertTrue("$what: ${m.description} can be scrolled into full view", fullyShown(node))
        }
    }

    private fun check(name: String, activity: ComponentActivity, content: @Composable () -> Unit, open: () -> Unit) {
        open()
        ScreenKit.screenshot(compose, "$name-lab-on", activity.window.decorView, onWhite = true)
        val problems = ScreenKit.accessibilityProblems(compose)
        assertTrue("$name:\n${problems.joinToString("\n")}", problems.isEmpty())

        app.setComfort(true)
        ScreenKit.showAtLargestText(compose, activity, content)
        open()
        ScreenKit.screenshot(compose, "$name-comfort-200", activity.window.decorView, onWhite = true)
        val cut = ScreenKit.textOverflows(compose)
        assertTrue("$name, Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text: text cut short or clipped:\n${cut.joinToString("\n")}", cut.isEmpty())
        val comfortProblems = ScreenKit.accessibilityProblems(compose, minTargetDp = COMFORT_TARGET.value)
        assertTrue("$name, Comfort:\n${comfortProblems.joinToString("\n")}", comfortProblems.isEmpty())
    }

    companion object {
        /** 58 characters: about as long as a Daylight's name gets (a pairing keeps 60). */
        const val LONG_NAME = "The Daylight on the kitchen counter, next to the bread bin"

        const val LONG_TITLE = "The Real Reason Inflation Is Still Too High, According to the Economists Who Study It for a Living"

        /** Text with a link: Options offers Send link and Send as excerpt (F11). */
        const val QUOTE = "“The quick brown fox jumps over the lazy dog, again and again, until the dog gets up and walks away.” " +
            "https://www.example.com/stories/the-quick-brown-fox"
    }
}
