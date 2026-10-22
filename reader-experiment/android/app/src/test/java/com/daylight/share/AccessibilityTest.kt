package com.daylight.share

import android.view.accessibility.AccessibilityManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalCursorBlinkEnabled
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.daylight.share.core.Json
import com.daylight.share.core.RelayProbe
import com.daylight.share.inbox.InboxText
import com.daylight.share.sender.ShareActivity
import com.daylight.share.ui.A11yText
import com.daylight.share.ui.COMFORT_TARGET
import com.daylight.share.ui.COMFORT_TEXT_SCALE
import com.daylight.share.ui.DaylightTheme
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.NoBringIntoViewScroll
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * The accessibility baseline (LAB-PLAN F27; not a Lab feature) on every main screen of both roles: the Accessibility
 * Test Framework's error rules (F27.2), announced status changes, and with Comfort at the largest text on a 360 dp phone
 * no text cut short and no control under 56 dp (F27.4). The window is tall, so every row of a list is laid out and
 * checked; native graphics, so text is measured as on a device. Each screen is saved as a PNG for review, with Lab off
 * and with Comfort at 200 % (`app/build/f27-screenshots`, CI's `daylight-share-f27-screenshots`). Nothing moves: no
 * animation in the source, no overscroll stretch, and a tap or a focus changes a screen once, then it holds still.
 *
 * Compose's `enableAccessibilityChecks()` runs too, but under Robolectric the framework sees only the Android views
 * (DecorView … AndroidComposeView), never Compose's nodes, so it passes whatever the screen holds. The same rules run
 * on the semantics tree instead ([ScreenKit.accessibilityProblems]); [theChecksCatchAnUnlabelledSmallButton] shows they
 * catch what the framework would.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AccessibilityTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App

    // ------------------------------------------------------------------------------------------ every main screen

    @Test fun roleChoice() = checkScreen(MainScreen.ROLE_CHOICE)
    @Test fun senderUnpaired() = checkScreen(MainScreen.SENDER_UNPAIRED)
    @Test fun sender() = checkScreen(MainScreen.SENDER)
    @Test fun senderSettings() = checkScreen(MainScreen.SENDER_SETTINGS)
    @Test fun inboxNew() = checkScreen(MainScreen.INBOX_NEW)
    @Test fun inbox() = checkScreen(MainScreen.INBOX)
    @Test fun inboxSettings() = checkScreen(MainScreen.INBOX_SETTINGS)

    private fun checkScreen(screen: MainScreen) {
        ScreenKit.labOff(app)
        screen.prepare(app)
        screen.open(compose)
        compose.enableAccessibilityChecks()

        // As shipped (Comfort off, the system's text size), with Lab off.
        ScreenKit.screenshot(compose, "${screen.file}-lab-off")
        compose.onRoot().tryPerformAccessibilityChecks()
        val problems = ScreenKit.accessibilityProblems(compose)
        assertTrue("${screen.file}:\n${problems.joinToString("\n")}", problems.isEmpty())

        // Comfort at the largest text size, on a 360 dp phone (F27.4).
        app.setComfort(true)
        ScreenKit.showAtLargestText(compose)
        screen.open(compose)
        ScreenKit.screenshot(compose, "${screen.file}-comfort-200")
        val cut = ScreenKit.textOverflows(compose)
        assertTrue("${screen.file}, Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text: text cut short or clipped:\n${cut.joinToString("\n")}", cut.isEmpty())
        compose.onRoot().tryPerformAccessibilityChecks()
        val comfortProblems = ScreenKit.accessibilityProblems(compose, minTargetDp = COMFORT_TARGET.value)
        assertTrue("${screen.file}, Comfort:\n${comfortProblems.joinToString("\n")}", comfortProblems.isEmpty())
    }

    /** The rules catch what the framework would: an unlabelled 20 dp button, twice on the same spot. */
    @Test
    fun theChecksCatchAnUnlabelledSmallButton() {
        compose.runOnUiThread {
            compose.activity.setContent {
                androidx.compose.foundation.layout.Box {
                    androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.size(20.dp).clickable { })
                    androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.size(20.dp).clickable { })
                }
            }
        }
        compose.waitForIdle()
        val problems = ScreenKit.accessibilityProblems(compose)
        assertEquals(problems.joinToString("\n"), 2, problems.count { it.startsWith("no label") })
        assertEquals(problems.joinToString("\n"), 2, problems.count { it.startsWith("touch target under 48") })
        assertEquals(problems.joinToString("\n"), 1, problems.count { it.startsWith("controls on the same spot") })
    }

    /**
     * Text contrast (the framework's TextContrastCheck needs a screenshot): every text colour on every background the
     * app uses is at least 4.5:1 (WCAG AA), and Comfort's secondary text is black.
     */
    @Test
    fun theColoursHaveEnoughContrast() {
        fun ratio(a: androidx.compose.ui.graphics.Color, b: androidx.compose.ui.graphics.Color): Float {
            val (hi, lo) = listOf(a.luminance(), b.luminance()).sortedDescending()
            return (hi + 0.05f) / (lo + 0.05f)
        }
        val pairs = mapOf(
            "text on paper" to (com.daylight.share.ui.Ink to com.daylight.share.ui.Paper),
            "secondary text on paper" to (com.daylight.share.ui.Pencil to com.daylight.share.ui.Paper),
            "secondary text on wash" to (com.daylight.share.ui.Pencil to com.daylight.share.ui.Wash),
            "a primary button's words" to (com.daylight.share.ui.Paper to com.daylight.share.ui.Ink),
            "a disabled primary button's words" to (com.daylight.share.ui.Pencil to com.daylight.share.ui.Wash),
        )
        for ((what, colours) in pairs) {
            val r = ratio(colours.first, colours.second)
            assertTrue("$what: $r:1", r >= 4.5f)
        }
        var comfortSmall = androidx.compose.ui.graphics.Color.Unspecified
        compose.runOnUiThread {
            compose.activity.setContent { DaylightTheme(comfort = true) { comfortSmall = androidx.compose.material3.MaterialTheme.typography.bodySmall.color } }
        }
        compose.waitForIdle()
        assertEquals(com.daylight.share.ui.Ink, comfortSmall)
    }

    /** The F27.4 measure itself: a text cut to one line is caught, a short line in a wide column is not. */
    @Test
    fun theOverflowCheckSeesCutText() {
        compose.runOnUiThread {
            compose.activity.setContent {
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.width(200.dp)) {
                    androidx.compose.material3.Text("Short")
                    androidx.compose.material3.Text("A sentence far too long for one line of two hundred dp", maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    androidx.compose.material3.Text("Unwrapped words that run past the edge of the column", softWrap = false)
                }
            }
        }
        compose.waitForIdle()
        val cut = ScreenKit.textOverflows(compose)
        assertEquals(cut.joinToString("\n"), 2, cut.size)
        assertTrue(cut[0], cut[0].startsWith("\"A sentence far too long"))
        assertTrue(cut[1], cut[1].startsWith("\"Unwrapped words"))
    }

    // ------------------------------------------------------------------------------------------------- Comfort

    @Test
    fun comfortIsASettingOutsideLabOffByDefault() {
        assertFalse(app.prefs.comfort)
        assertFalse(app.comfort.value)
        MainScreen.SENDER_UNPAIRED.prepare(app)
        compose.waitForIdle()
        compose.onNodeWithText("Settings").performClick()
        compose.waitForIdle()
        val row = compose.onNode(hasText(A11yText.COMFORT) and hasText(A11yText.COMFORT_FOOTER) and isToggleable())
        row.assertIsOff()
        row.performClick()
        compose.waitForIdle()
        // Still in Settings, on the same switch: turning Comfort on keeps the screen.
        row.assertIsOn()
        compose.onNodeWithText("Done").assertIsDisplayed()
        assertTrue(app.comfort.value)
        assertTrue("kept across starts", Prefs(app).comfort)
        row.performClick()
        compose.waitForIdle()
        row.assertIsOff()
        assertFalse(Prefs(app).comfort)
    }

    @Test
    fun comfortWordsAreTheSharedLabTexts() {
        val path = System.getProperty("dls.labVectors") ?: error("dls.labVectors not set")
        @Suppress("UNCHECKED_CAST")
        val strings = ((Json.parse(File(path).readText()) as Map<String, Any?>)["labText"] as Map<String, Any?>)["strings"] as Map<String, Any?>
        assertEquals(strings["comfort"], A11yText.COMFORT)
        assertEquals(strings["comfortFooter"], A11yText.COMFORT_FOOTER)
    }

    @OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
    @Test
    fun comfortScalesTextAndTargetsAndTheInboxNeverAnimates() {
        var baseScale = 0f
        var scale = 0f
        var baseText = 0.dp
        var text = 0.dp
        var target: Dp = 0.dp
        var ripple: Any? = "unread"
        var overscroll: Any? = "unread"
        var blink: Boolean? = null
        var scrollIntoView: Any? = null
        compose.runOnUiThread {
            compose.activity.setContent {
                baseScale = LocalDensity.current.fontScale
                baseText = with(LocalDensity.current) { 18.sp.toDp() }
                DaylightTheme(comfort = true) {
                    scale = LocalDensity.current.fontScale
                    text = with(LocalDensity.current) { 18.sp.toDp() }
                    target = LocalMinimumInteractiveComponentSize.current
                    ripple = LocalRippleConfiguration.current
                    overscroll = LocalOverscrollFactory.current
                    blink = LocalCursorBlinkEnabled.current
                    scrollIntoView = LocalBringIntoViewSpec.current
                }
            }
        }
        compose.waitForIdle()
        assertEquals(baseScale * COMFORT_TEXT_SCALE, scale, 0.001f)
        assertEquals(baseText.value * COMFORT_TEXT_SCALE, text.value, 0.01f)
        assertEquals(56.dp, target)
        assertNull("Comfort: no ripples", ripple)
        assertNull("Comfort: no overscroll stretch", overscroll)
        assertEquals("Comfort: a steady cursor", false, blink)
        assertSame("Comfort: no scrolling animation into view", NoBringIntoViewScroll, scrollIntoView)

        // The phone role without Comfort keeps the usual feedback; the Inbox role never animates.
        app.setRole(Role.SENDER)
        compose.runOnUiThread {
            compose.activity.setContent {
                DaylightTheme {
                    ripple = LocalRippleConfiguration.current
                    overscroll = LocalOverscrollFactory.current
                    blink = LocalCursorBlinkEnabled.current
                    scrollIntoView = LocalBringIntoViewSpec.current
                }
            }
        }
        compose.waitForIdle()
        assertNotNull(ripple)
        assertNotNull(overscroll)
        assertEquals(true, blink)
        assertNotSame(NoBringIntoViewScroll, scrollIntoView)
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.setRole(Role.INBOX)
        compose.runOnUiThread {
            compose.activity.setContent {
                DaylightTheme {
                    ripple = LocalRippleConfiguration.current
                    target = LocalMinimumInteractiveComponentSize.current
                    overscroll = LocalOverscrollFactory.current
                    blink = LocalCursorBlinkEnabled.current
                    scrollIntoView = LocalBringIntoViewSpec.current
                }
            }
        }
        compose.waitForIdle()
        assertNull("the Inbox: no ripples", ripple)
        assertNull("the Inbox: no overscroll stretch", overscroll)
        assertEquals(48.dp, target)
        assertEquals("the Inbox: a steady cursor", false, blink)
        assertSame("the Inbox: no scrolling animation into view", NoBringIntoViewScroll, scrollIntoView)
    }

    /**
     * "No AnimatedVisibility or crossfades" (F27), and the Inbox never animates: the app's own code (comments left out)
     * uses no animation API (animate*, Animat*, *Transition, enter/exit transitions, animation specs) and none of
     * Material's components that move by themselves (its text fields float their labels; its switches, checks and
     * radio buttons slide; progress indicators, menus, sheets, tabs and snackbars move). The app draws its own still
     * ones: [com.daylight.share.ui.Field], [com.daylight.share.ui.SwitchRow], [com.daylight.share.ui.Choice].
     */
    @Test
    fun theAppHasNoAnimations() {
        val src = File("src/main/java")
        assertTrue("run from the app module (cwd ${File(".").absolutePath})", src.isDirectory)
        val found = src.walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, line -> if (moves(line)) "${f.name}:${i + 1}: ${line.trim()}" else null }
        }.toList()
        assertTrue("animations in the app:\n${found.joinToString("\n")}", found.isEmpty())
    }

    /** The check of [theAppHasNoAnimations] catches each kind of animation, and leaves the app's still code alone. */
    @Test
    fun theAnimationCheckSeesAnimations() {
        val moving = listOf(
            "Column(Modifier.animateContentSize()) {",
            "scope.launch { listState.animateScrollToItem(0) }",
            "offset.animateTo(1f, tween(300))",
            "val alpha by animateFloatAsState(if (on) 1f else 0f)",
            "AnimatedVisibility(visible = open, enter = fadeIn() + expandVertically()) {",
            "Crossfade(targetState = page) { p ->",
            "val t = rememberInfiniteTransition()",
            "items(rows, key = { it.id }) { row -> Row(Modifier.animateItem()) { } }",
            "animationSpec = spring(stiffness = Spring.StiffnessLow)",
            "OutlinedTextField(value = v, onValueChange = { v = it })",
            "TextField(value, { })",
            "Switch(checked = on, onCheckedChange = null)",
            "    RadioButton(selected = true, onClick = null)",
            "LinearProgressIndicator()",
            "import androidx.compose.animation.core.Animatable",
        )
        moving.forEach { assertTrue(it, moves(it)) }
        val still = listOf(
            "// It never animates (the DC-1's e-paper)",
            " * no animation in the source",
            ".toggleable(value = checked, role = Role.Switch, onValueChange = onChange),",
            ".selectable(selected = selected, role = Role.RadioButton, onClick = onClick),",
            "BasicTextField(value = value, onValueChange = onValueChange)",
            "Field(value = link, onValueChange = { link = it }, label = \"Link\", placeholder = \"https://…\")",
            "LocalOverscrollFactory provides if (still) null else overscroll,",
        )
        still.forEach { assertFalse(it, moves(it)) }
    }

    private val animationApi = Regex(
        "\\b(animate\\w*|Animat\\w+|\\w*Transition|Crossfade|fadeIn|fadeOut|slideIn\\w*|slideOut\\w*|expandIn|expandHorizontally|" +
            "expandVertically|shrinkOut|shrinkHorizontally|shrinkVertically|scaleIn|scaleOut|tween|spring|keyframes\\w*|" +
            "repeatable|infiniteRepeatable|snap)\\b|\\bandroidx\\.compose\\.animation\\b",
    )
    private val movingMaterial = Regex(
        "(?<![.\\w])(OutlinedTextField|TextField|Switch|Checkbox|TriStateCheckbox|RadioButton|Slider|RangeSlider|" +
            "CircularProgressIndicator|LinearProgressIndicator|DropdownMenu|ExposedDropdownMenuBox|ModalBottomSheet|" +
            "BottomSheetScaffold|Snackbar|SnackbarHost|TabRow|ScrollableTabRow|PrimaryTabRow|SecondaryTabRow|NavigationBar|" +
            "NavigationRail|FloatingActionButton|ExtendedFloatingActionButton|PullToRefreshBox|TooltipBox|SegmentedButton|" +
            "SwipeToDismissBox|SearchBar|DockedSearchBar|DatePicker|TimePicker)\\s*\\(",
    )

    /** Whether a line of the app's source animates: code only (a line comment, or a KDoc or block comment line, is not). */
    private fun moves(line: String): Boolean {
        val code = line.trim()
        if (code.startsWith("*") || code.startsWith("/*") || code.startsWith("//")) return false
        val withoutComment = code.replace(Regex("\\s//.*$"), "")
        return animationApi.containsMatchIn(withoutComment) || movingMaterial.containsMatchIn(withoutComment)
    }

    /** A tap or a focus changes the screen once, then it holds still: the phone's pairing-code field (F27, Comfort off). */
    @Test
    fun thePhonesFieldsHoldStill() {
        ScreenKit.labOff(app)
        MainScreen.SENDER_UNPAIRED.prepare(app)
        MainScreen.SENDER_UNPAIRED.open(compose)
        val field = compose.onNode(hasSetTextAction() and hasText("Pairing code"))
        val moved = ScreenKit.motionAfter(compose) { field.performClick() }
        assertTrue("the pairing-code field moved:\n${moved.joinToString("\n")}", moved.isEmpty())
        field.assertIsFocused()
        // Focused and empty, it shows the code's form at once.
        compose.onNodeWithText("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", useUnmergedTree = true).assertExists()
    }

    /** The DC-1 Inbox never animates (F27, F15): showing the pairing code, and its Settings' fields. */
    @Test
    fun theInboxHoldsStill() {
        ScreenKit.labOff(app)
        MainScreen.INBOX.prepare(app)
        MainScreen.INBOX.open(compose)
        // The test relay is closed, so the live connection retries now and then and the status line under the title
        // changes, moving everything below it: places are measured from the section's title.
        val shown = ScreenKit.motionAfter(compose, from = "Pair a phone or computer") {
            compose.onNodeWithText("Show pairing code").performClick()
        }
        assertTrue("showing the pairing code moved:\n${shown.joinToString("\n")}", shown.isEmpty())
        compose.onNodeWithText("Hide").assertIsDisplayed()

        compose.onNodeWithText("Settings").performClick()
        compose.waitForIdle()
        for (label in listOf("Daylight name (shown to senders)", "Relay URL")) {
            val field = compose.onNode(hasSetTextAction() and hasText(label))
            val moved = ScreenKit.motionAfter(compose) { field.performClick() }
            assertTrue("$label moved:\n${moved.joinToString("\n")}", moved.isEmpty())
            field.assertIsFocused()
        }
    }

    @Test
    fun theShareCardStaysForSomeoneWhoNeedsTime() {
        assertFalse(ShareActivity.needsTime(app))
        app.setComfort(true)
        assertTrue(ShareActivity.needsTime(app))
        app.setComfort(false)
        val am = shadowOf(app.getSystemService(AccessibilityManager::class.java))
        am.setEnabled(true)
        am.setTouchExplorationEnabled(true)
        assertTrue("TalkBack", ShareActivity.needsTime(app))
    }

    // -------------------------------------------------------------------------------- announcements and labels

    @Test
    fun deliveredIsAnnouncedOnThePhone() {
        MainScreen.SENDER.prepare(app)
        MainScreen.SENDER.open(compose)
        assertPolite(compose.onNode(hasText("Delivered ✓")).fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion))
        assertPolite(compose.onNode(hasText("Sending…")).fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion))
    }

    @Test
    fun inYourReaderIsAnnouncedOnTheInbox() {
        MainScreen.INBOX.prepare(app)
        MainScreen.INBOX.open(compose)
        val nodes = compose.onAllNodes(hasText(com.daylight.share.inbox.InboxItem.IN_YOUR_READER, substring = true)).fetchSemanticsNodes()
        assertTrue(nodes.isNotEmpty())
        nodes.forEach { assertPolite(it.config.getOrNull(SemanticsProperties.LiveRegion)) }
        val handed = compose.onAllNodes(hasText(com.daylight.share.inbox.InboxItem.HANDED_TO_READER, substring = true)).fetchSemanticsNodes()
        assertTrue(handed.isNotEmpty())
        handed.forEach { assertPolite(it.config.getOrNull(SemanticsProperties.LiveRegion)) }
    }

    private fun assertPolite(mode: LiveRegionMode?) = assertEquals(LiveRegionMode.Polite, mode)

    /** Typed-code pairing is always there (F27): a labelled field on the phone, the code in words on the Inbox. */
    @Test
    fun theTypedCodeIsAlwaysOffered() {
        MainScreen.SENDER_UNPAIRED.prepare(app)
        MainScreen.SENDER_UNPAIRED.open(compose)
        compose.onNode(hasSetTextAction() and hasText("Pairing code")).assertIsDisplayed()
    }

    @Test
    fun theInboxShowsItsCodeInWords() {
        MainScreen.INBOX_NEW.prepare(app)
        MainScreen.INBOX_NEW.open(compose)
        val groups = ScreenKit.inboxPairing.code.split('-')
        compose.onNodeWithText(groups.take(4).joinToString("-")).assertIsDisplayed()
        compose.onNodeWithText(groups.drop(4).joinToString("-")).assertIsDisplayed()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf(com.daylight.share.ui.QR_DESCRIPTION))).assertExists()
    }

    // ------------------------------------------------------------------- the Inbox's sentences (CHANGES-v1.1 5.5)

    @Test
    fun theRelaySaveShowsTheChecksSentenceAndKeepsTheRelay() {
        MainScreen.INBOX_SETTINGS.prepare(app)
        MainScreen.INBOX_SETTINGS.open(compose)
        compose.onNode(hasSetTextAction() and hasText("Relay URL")).performTextReplacement("http://127.0.0.1:9/elsewhere")
        compose.onNodeWithText("Save relay").performClick()
        compose.waitUntil(20_000) { compose.onAllNodes(hasText(RelayProbe.UNREACHABLE)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(RelayProbe.UNREACHABLE).assertIsDisplayed()
        assertEquals(ScreenKit.NOWHERE, app.prefs.inboxRelay)
    }

    @Test
    fun theInboxSaysWhyItCannotReceive() {
        MainScreen.INBOX.prepare(app)
        app.inbox.sync.value = app.inbox.sync.value.copy(storeFull = true)
        app.prefs.inboxRelayWarning = RelayProbe.TOO_SMALL
        compose.activity.resumes.intValue++ // the warning is read on resume
        MainScreen.INBOX.open(compose)
        compose.onNodeWithText(InboxText.OUT_OF_SPACE).assertIsDisplayed()
        compose.onNodeWithText(RelayProbe.TOO_SMALL).assertIsDisplayed()
    }
}
