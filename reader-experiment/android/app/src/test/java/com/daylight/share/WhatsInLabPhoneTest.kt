package com.daylight.share

import android.content.ClipboardManager
import android.provider.Settings
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.daylight.share.core.Kind
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.PhoneLab
import com.daylight.share.sender.Shared
import com.daylight.share.ui.LAB_TEST_TAG
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * What's in Lab on the phone in Wave 1 (LAB-PLAN 1.4, 6.5 Q5; card K4): the phone's features with their short states;
 * a Use switch on the features that change how sharing behaves, on by default, read as "Use {feature}", that turns
 * just that feature off; F04's and F09's settings on their rows; F04's needs-notifications note with Open Settings;
 * Setup check (F26: checks, the test article followed along the timeline, the activity log, Copy diagnostics redacted).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class WhatsInLabPhoneTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun waitForText(text: String, ms: Long = 10_000, substring: Boolean = false) =
        compose.waitUntil(ms) { compose.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty() }

    private fun openWhatsInLab() {
        compose.onNodeWithText("Settings").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        waitForText(LabText.serverHeadingShort("needs-server"))
    }

    private fun useSwitch(feature: String) = compose.onNode(isToggleable() and hasText(LabText.useA11y(feature)))

    @Test
    fun thePhoneListsItsFeaturesWithUseSwitches() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        openWhatsInLab()
        for (f in PhoneLab.FEATURES) compose.onNode(hasText(LabText.featureName(f)) and hasClickAction()).assertIsDisplayed()
        assertEquals(listOf("F01", "F03", "F04", "F07", "F08", "F09", "F11", "F16", "F26", "F33"), PhoneLab.FEATURES)
        // A Use switch on each feature that changes how sharing behaves, on by default, with its footer.
        assertEquals(listOf("F03", "F04", "F08", "F16", "F33"), PhoneLab.USE)
        for (f in PhoneLab.USE) {
            useSwitch(f).assertIsOn()
            compose.onNodeWithText(LabText.useFooter(f)!!, substring = true).assertIsDisplayed()
        }
        // No Use switch elsewhere: F01's row has none.
        assertTrue(compose.onAllNodes(isToggleable() and hasText(LabText.useA11y("F01"))).fetchSemanticsNodes().isEmpty())
        // F04's settings and F09's, off or on as the plan says.
        compose.onNode(isToggleable() and hasText(LabText["shareInPlace.alwaysOptions"])).assertIsOff()
        compose.onNode(isToggleable() and hasText(LabText["shareInPlace.tellFails"])).assertIsOn()
        compose.onNode(isToggleable() and hasText(LabText["shareInPlace.tellReader"])).assertIsOff()
        compose.onNode(isToggleable() and hasText(LabText["automation.quickSends"])).assertIsOff()
        compose.onNodeWithText(LabText["automation.quickSendsFooter"], substring = true).assertIsDisplayed()
        // The features that run show Ready; the timeline needs Lab on the Daylight (no hello yet).
        compose.onNode(hasText(LabText.featureName("F01")) and hasText(LabText.short("needs-inbox")!!)).assertIsDisplayed()
        compose.onNode(hasText(LabText.featureName("F16")) and hasText(LabText.READY)).assertIsDisplayed()
    }

    /** 6.5 Q5: turning F16's Use switch off leaves Lab on and just stops cleaning links. */
    @Test
    fun aUseSwitchTurnsJustItsFeatureOff() {
        PhoneKit.phone(app, relay)
        openWhatsInLab()
        useSwitch("F16").performClick()
        compose.waitForIdle()
        useSwitch("F16").assertIsOff()
        assertFalse(app.prefs.labUse("F16"))
        assertTrue(app.prefs.lab)
        val row = runBlocking { app.sender.add(Shared.Text("Read this https://example.com/a?utm_source=x&id=1", null)) }
        assertEquals("https://example.com/a?utm_source=x&id=1", row.url)
        assertNull("nothing cleaned, so no x-orig", row.header.extras[ItemHeader.X_ORIG])
        useSwitch("F16").performClick()
        compose.waitForIdle()
        val cleaned = runBlocking { app.sender.add(Shared.Text("Read this https://example.com/a?utm_source=x&id=1", null)) }
        assertEquals("https://example.com/a?id=1", cleaned.url)
    }

    /** F04 without notification permission: "Needs notifications", and the sentence with Open Settings when tapped. */
    @Test
    fun shareInPlaceNeedsNotificationsForItsNotices() {
        PhoneKit.phone(app, relay)
        PhoneKit.denyNotifications(app)
        openWhatsInLab()
        compose.onNode(hasText(LabText.featureName("F04")) and hasText(LabText.short("needs-notifications")!!)).assertIsDisplayed()
        compose.onNode(hasText(LabText.featureName("F04")) and hasClickAction()).performClick()
        val sentence = LabText.needsMessage("needs-notifications", platform = "android")!!
        assertEquals("Needs notifications for Daylight Share. Turn them on in Settings › Apps › Daylight Share › Notifications.", sentence)
        waitForText(sentence, 6_000)
        compose.onNodeWithText(LabText.button("needs-notifications")!!).performClick()
        compose.waitForIdle()
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, shadowOf(app).nextStartedActivity?.action)
    }

    /** F26: Setup check from its row; the test article is followed to Delivered and In your Reader; diagnostics redacted. */
    @Test
    fun setupCheckSendsATestArticleAndFollowsIt() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        openWhatsInLab()
        compose.onNode(hasText(LabText.featureName("F26")) and hasClickAction()).performClick()
        waitForText(LabText["setup.title"])
        compose.onNodeWithText(LabText.fill(LabText["setup.ok"], mapOf("check" to LabText["setup.checks.paired"]))).assertIsDisplayed()
        compose.onNodeWithText(LabText.fill(LabText["setup.ok"], mapOf("check" to LabText["setup.checks.notifications"]))).assertIsDisplayed()
        compose.onNodeWithText(LabText.fill(LabText["setup.notOk"], mapOf("check" to LabText["setup.checks.batteryOptimisation"]))).assertIsDisplayed()
        compose.onNodeWithText(LabText["setup.testFooter"]).assertIsDisplayed()

        compose.onNode(hasText(LabText["setup.testSend"]) and hasClickAction()).performClick()
        PhoneKit.until(what = "the test article") { app.prefs.labTestId != null && app.sender.rows.value.any { it.id == app.prefs.labTestId } }
        val id = app.prefs.labTestId!!
        val row = app.sender.rows.value.single { it.id == id }
        assertEquals(Kind.PAGE, row.kind)
        assertEquals("test", row.header.extras[ItemHeader.X_CAP])
        assertEquals("https://daylight.invalid/test/$id", row.url)
        compose.waitUntil(5_000) { compose.onAllNodes(hasTestTag(LAB_TEST_TAG)).fetchSemanticsNodes().isNotEmpty() }

        // The Daylight acks it and its Reader saves it: both lines tick.
        PhoneKit.ack(relay, listOf(id))
        PhoneKit.hello(relay, mapOf(id to "reader"))
        runBlocking { app.sender.tick() }
        waitForText(LabText.fill(LabText["setup.ok"], mapOf("check" to LabText["setup.delivered"])))
        waitForText(LabText.fill(LabText["setup.ok"], mapOf("check" to LabText["setup.inReader"])))

        // Copy diagnostics: no URL, title, code or topic.
        compose.onNode(hasText(LabText["setup.copyDiagnostics"]) and hasClickAction()).performClick()
        PhoneKit.until(what = "the copy") { compose.onAllNodes(hasText(LabText["setup.copied"])).fetchSemanticsNodes().isNotEmpty() }
        val copied = app.getSystemService(ClipboardManager::class.java).primaryClip!!.getItemAt(0).text.toString()
        assertTrue(copied, copied.startsWith(LabText["diagnostics.heading"]))
        for (secret in listOf("daylight.invalid", "Test article", LabKit.vectorPairing.keys.inboxTopic, LabKit.vectorPairing.compactCode)) {
            assertFalse("diagnostics carry $secret:\n$copied", copied.contains(secret))
        }
        // The activity log lists the test send, by type and id8 only.
        compose.onNode(hasText(LabText["setup.activity"]) and hasClickAction()).performClick()
        waitForText(id.take(8), 5_000, substring = true)
    }

    /** F03: once shown, the link-only hint stays listed in Setup check. */
    @Test
    fun aHintShownOnceStaysInSetupCheck() {
        PhoneKit.phone(app, relay)
        openWhatsInLab()
        compose.onNode(hasText(LabText.featureName("F26")) and hasClickAction()).performClick()
        waitForText(LabText["setup.title"])
        compose.onNodeWithText(LabText["linkOnly.android"]).assertIsDisplayed()
    }
}
