package com.daylight.share

import android.Manifest
import android.app.Application
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.daylight.share.core.lab.LabText
import com.daylight.share.ui.LAB_OPENED_SETTING_TAG
import com.daylight.share.ui.MainActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * K5 review (LAB-PLAN 1.5 "Open setting: it opens that setting with its footer"; 1.4 "a tap opens the feature") on the
 * DC-1 Inbox, in a window as short as a DC-1 in landscape leaves (480 dp), where each setting starts below the fold:
 * Setup check's "Open setting" for Instant delivery opens the Inbox screen at that switch with its footer, the one for
 * the Reader opens Settings at "Deliver to" with its words, and F15's row in What's in Lab, when ready, opens the Inbox
 * screen at the arrival notice settings with Quiet hours' footer. None of them changes the setting.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w800dp-h480dp")
class OpenSettingInViewTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    private val instantFooter = "Keeps a connection open so items arrive within seconds (a small notification stays). Off: every 15 minutes, and whenever this screen is open."

    private fun waitForText(text: String, ms: Long = 10_000) =
        compose.waitUntil(ms) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun line(check: String, ok: Boolean) = LabText.fill(LabText[if (ok) "setup.ok" else "setup.notOk"], mapOf("check" to LabText["setup.checks.$check"]))

    /** A new Inbox (its pairing code open, so "Getting items to the Reader" starts well below the fold). */
    private fun inbox(reader: Boolean = true) {
        LabKit.useRelay(app, relay)
        app.prefs.labNoteShown = true
        app.prefs.instantDelivery = false
        if (reader) {
            MainScreen.INBOX_NEW.prepare(app)
        } else {
            app.prefs.askedNotifications = true
            app.prefs.inboxRelay = ScreenKit.NOWHERE
            app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
            app.setRole(Role.INBOX)
        }
        compose.waitForIdle()
    }

    private fun openWhatsInLab() {
        compose.onNode(hasText("Settings") and hasClickAction()).performClick()
        compose.onNode(hasText("${LabText.WHATS_IN_LAB} ›") and hasClickAction()).performClick()
        waitForText(LabText.serverHeadingShort("needs-server"))
    }

    private fun openSetupCheck() {
        openWhatsInLab()
        compose.onNode(hasText(LabText.featureName("F26")) and hasClickAction()).performClick()
        waitForText(LabText["setup.readerTest"])
    }

    /** The "Open setting" right under the check line [check]. */
    private fun openSettingUnder(check: String) {
        val lineBox = compose.onNode(hasText(check)).performScrollTo().fetchSemanticsNode().boundsInRoot
        val buttons = compose.onAllNodes(hasText(LabText.button("needs-quick-sends")!!) and hasClickAction())
        val i = buttons.fetchSemanticsNodes().withIndex().filter { it.value.boundsInRoot.top >= lineBox.bottom - 1 }.minBy { it.value.boundsInRoot.top }.index
        buttons[i].performScrollTo().performClick()
        compose.waitForIdle()
    }

    private fun opened(): SemanticsNodeInteraction {
        compose.waitUntil(5_000) { compose.onAllNodes(hasTestTag(LAB_OPENED_SETTING_TAG)).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        return compose.onNode(hasTestTag(LAB_OPENED_SETTING_TAG))
    }

    /** All of [n] is inside the window: not cut at the top or the bottom. */
    private fun assertWhollyInView(what: String, n: SemanticsNodeInteraction) {
        n.assertIsDisplayed()
        val b = n.fetchSemanticsNode().boundsInRoot
        val root = compose.onRoot().fetchSemanticsNode().boundsInRoot
        assertTrue("$what at $b is not wholly in the window $root", b.top >= root.top - 1 && b.bottom <= root.bottom + 1)
    }

    @Test
    fun instantDeliverysOpenSettingShowsItWithItsFooter() {
        inbox()
        openSetupCheck()
        openSettingUnder(line("instantDelivery", false))
        waitForText("Instant delivery")
        assertWhollyInView("Instant delivery", opened())
        compose.onNode(hasText(instantFooter)).assertIsDisplayed()
        assertFalse("never changed by itself", app.prefs.instantDelivery)
    }

    @Test
    fun theReadersOpenSettingShowsDeliverTo() {
        inbox(reader = false)
        openSetupCheck()
        openSettingUnder(line("reader", false))
        waitForText("Deliver to")
        assertWhollyInView("Deliver to", opened())
        compose.onNode(hasText("Deliver to")).assertIsDisplayed()
        compose.onNode(hasText("Automatic", substring = true) and hasClickAction()).assertIsDisplayed()
        assertTrue("never changed by itself", app.prefs.deliverTo.isEmpty())
    }

    @Test
    fun arrivalNoticesRowOpensItsSettings() {
        inbox()
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        compose.runOnUiThread { compose.activity.resumes.intValue++ }
        openWhatsInLab()
        compose.onNode(hasText(LabText.featureName("F15")) and hasClickAction()).performClick()
        waitForText(LabText["arrivals.quietHoursFooter"])
        assertWhollyInView("Arrival notices", opened())
        compose.onNode(hasText(LabText["arrivals.setting"])).assertIsDisplayed()
        compose.onNode(hasText(LabText["arrivals.quietHoursFooter"])).assertIsDisplayed()
        assertFalse("never changed by itself", app.prefs.labQuietHours)
    }
}
