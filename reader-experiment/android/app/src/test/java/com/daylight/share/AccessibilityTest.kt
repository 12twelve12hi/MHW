package com.daylight.share

import android.view.accessibility.AccessibilityManager
import androidx.activity.compose.setContent
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/**
 * The accessibility baseline (LAB-PLAN F27; not a Lab feature) on every main screen of both roles: the Accessibility
 * Test Framework's checks (F27.2), a label on every control, announced status changes, and with Comfort at the largest
 * text on a 360 dp phone no text cut short and no control under 56 dp (F27.4). The window is tall, so every row of a
 * list is laid out and checked.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h16000dp")
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
        screen.prepare(app)
        screen.open(compose)
        compose.enableAccessibilityChecks()

        // As shipped (Comfort off, the system's text size).
        compose.onRoot().tryPerformAccessibilityChecks()
        val unlabelled = ScreenKit.unlabelledControls(compose)
        assertTrue("${screen.file}: controls without a label:\n${unlabelled.joinToString("\n")}", unlabelled.isEmpty())

        // Comfort at the largest text size, on a 360 dp phone (F27.4).
        app.setComfort(true)
        ScreenKit.showAtLargestText(compose)
        screen.open(compose)
        val cut = ScreenKit.textOverflows(compose)
        assertTrue("${screen.file}, Comfort at ${ScreenKit.LARGEST_FONT_SCALE}x text: text cut short or clipped:\n${cut.joinToString("\n")}", cut.isEmpty())
        val small = ScreenKit.smallControls(compose, COMFORT_TARGET.value)
        assertTrue("${screen.file}, Comfort: controls under ${COMFORT_TARGET.value.toInt()} dp:\n${small.joinToString("\n")}", small.isEmpty())
        compose.onRoot().tryPerformAccessibilityChecks()
        val unlabelledComfort = ScreenKit.unlabelledControls(compose)
        assertTrue("${screen.file}, Comfort: controls without a label:\n${unlabelledComfort.joinToString("\n")}", unlabelledComfort.isEmpty())
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
        row.assertIsOn()
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

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    fun comfortScalesTextAndTargetsAndTheInboxNeverAnimates() {
        var baseScale = 0f
        var scale = 0f
        var baseText = 0.dp
        var text = 0.dp
        var target: Dp = 0.dp
        var ripple: Any? = "unread"
        compose.runOnUiThread {
            compose.activity.setContent {
                baseScale = LocalDensity.current.fontScale
                baseText = with(LocalDensity.current) { 18.sp.toDp() }
                DaylightTheme(comfort = true) {
                    scale = LocalDensity.current.fontScale
                    text = with(LocalDensity.current) { 18.sp.toDp() }
                    target = LocalMinimumInteractiveComponentSize.current
                    ripple = LocalRippleConfiguration.current
                }
            }
        }
        compose.waitForIdle()
        assertEquals(baseScale * COMFORT_TEXT_SCALE, scale, 0.001f)
        assertEquals(baseText.value * COMFORT_TEXT_SCALE, text.value, 0.01f)
        assertEquals(56.dp, target)
        assertNull("Comfort: no ripples", ripple)

        // The phone role without Comfort keeps the usual feedback; the Inbox role never animates.
        app.setRole(Role.SENDER)
        compose.runOnUiThread { compose.activity.setContent { DaylightTheme { ripple = LocalRippleConfiguration.current } } }
        compose.waitForIdle()
        assertNotNull(ripple)
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.setRole(Role.INBOX)
        compose.runOnUiThread { compose.activity.setContent { DaylightTheme { ripple = LocalRippleConfiguration.current; target = LocalMinimumInteractiveComponentSize.current } } }
        compose.waitForIdle()
        assertNull("the Inbox: no ripples", ripple)
        assertEquals(48.dp, target)
    }

    /** "No AnimatedVisibility or crossfades" (F27): the app's own code animates nothing, in either role. */
    @Test
    fun theAppHasNoAnimations() {
        val src = File("src/main/java")
        assertTrue("run from the app module (cwd ${File(".").absolutePath})", src.isDirectory)
        val banned = Regex("\\b(AnimatedVisibility|AnimatedContent|Crossfade|updateTransition|rememberInfiniteTransition|animateItem|animate[A-Z]\\w*AsState|Animatable)\\b")
        val found = src.walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, line -> if (banned.containsMatchIn(line)) "${f.name}:${i + 1}: ${line.trim()}" else null }
        }.toList()
        assertTrue("animations in the app:\n${found.joinToString("\n")}", found.isEmpty())
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
