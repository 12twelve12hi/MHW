package com.daylight.share

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
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
import com.daylight.share.core.lab.SetupCheck
import com.daylight.share.inbox.HandoffActivity
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxLab
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.WaitingCard
import com.daylight.share.ui.INBOX_READER_TEST_TAG
import com.daylight.share.ui.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSettings
import java.io.File

/**
 * The DC-1 Inbox's What's in Lab and Setup check (LAB-PLAN 1.4, F15, F26; card K5): its two features with their short
 * states (arrival notices need notifications), Setup check's checks ("✓ {check}" or "! {check}") and the button of each
 * unmet one (F26.3), **Test the Reader hand-off** through the normal hand-off with its result, the activity log, and
 * Copy diagnostics with no URL, title, pairing code or topic (F26.2).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class InboxSetupCheckTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    @Before
    fun reset() {
        HandoffActivity.running = false
        HandoffActivity.requestedAt = 0L
        HandoffActivity.claim = null
        HandoffActivity.lastImportHandoff = 0L
        WaitingCard.forget()
        // FileProvider caches its roots in a static map; every Robolectric test has a new files folder.
        FileProvider::class.java.declaredFields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && Map::class.java.isAssignableFrom(it.type) }
            .forEach { f ->
                f.isAccessible = true
                (f.get(null) as? MutableMap<*, *>)?.clear()
            }
    }

    private fun waitForText(text: String, ms: Long = 10_000) =
        compose.waitUntil(ms) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun inbox() {
        LabKit.useRelay(app, relay)
        app.prefs.labNoteShown = true
        MainScreen.INBOX.prepare(app)
        compose.waitForIdle()
    }

    private fun openWhatsInLab() {
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        waitForText(LabText.serverHeadingShort("needs-server"))
    }

    private fun openSetupCheck() {
        openWhatsInLab()
        compose.onNode(hasText(LabText.featureName("F26")) and hasClickAction()).performClick()
        waitForText(LabText["setup.readerTest"])
    }

    private fun line(check: String, ok: Boolean) = LabText.fill(LabText[if (ok) "setup.ok" else "setup.notOk"], mapOf("check" to LabText["setup.checks.$check"]))

    private fun grant() {
        shadowOf(app as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        compose.runOnUiThread { compose.activity.resumes.intValue++ }
        compose.waitForIdle()
    }

    @Test
    fun whatsInLabListsTheInboxsFeatures() {
        assertEquals(listOf("F15", "F26"), InboxLab.FEATURES)
        inbox()
        openWhatsInLab()
        for (id in InboxLab.FEATURES) {
            compose.onNodeWithText(LabText.featureName(id)).assertIsDisplayed()
            compose.onNodeWithText(LabText.featureSentence(id)!!).assertIsDisplayed()
        }
        // Arrival notices need notifications: its short state, and a tap shows the sentence with Open Settings.
        waitForText(LabText.short("needs-notifications")!!)
        compose.onNode(hasText(LabText.featureName("F15")) and hasClickAction()).performClick()
        waitForText(LabText.needsMessage("needs-notifications", platform = InboxLab.PLATFORM)!!, 6_000)
        compose.onNodeWithText(LabText.button("needs-notifications")!!).assertIsDisplayed()
        assertTrue(LabText.needsMessage("needs-notifications", platform = "inbox")!!.contains("Daylight Share"))
    }

    @Test
    fun arrivalNoticesHaveTheirSettingsOnTheInboxScreen() {
        inbox()
        compose.onNodeWithText(LabText["arrivals.setting"]).performScrollTo().assertIsDisplayed()
        for (key in listOf("off", "quiet", "alert")) compose.onNodeWithText(LabText["arrivals.$key"]).assertIsDisplayed()
        assertEquals("quiet", app.prefs.labArrivals)
        compose.onNodeWithText(LabText["arrivals.alert"]).performClick()
        assertEquals("alert", app.prefs.labArrivals)
        assertFalse(app.prefs.labQuietHours)
        compose.onNodeWithText(LabText["arrivals.quietHours"]).performScrollTo().performClick()
        assertTrue(app.prefs.labQuietHours)
        // Lab off: gone (and kept as they are).
        app.setLab(false)
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText(LabText["arrivals.setting"])).fetchSemanticsNodes().isEmpty())
        assertEquals("alert", app.prefs.labArrivals)
    }

    /** F26.3: each unmet check has its button, and it opens the right place. */
    @Test
    fun eachUnmetCheckHasItsButton() {
        inbox()
        ShadowSettings.setCanDrawOverlays(false)
        openSetupCheck()
        for (c in listOf("notifications", "newItemsChannel", "overlay", "batteryOptimisation", "instantDelivery")) {
            compose.onNodeWithText(line(c, false)).assertIsDisplayed()
        }
        // The Reader is installed (ScreenKit's, which answers SAVE_PAGE), and its read-later has not refused anything.
        compose.onNodeWithText(line("reader", true)).assertIsDisplayed()
        compose.onNodeWithText(line("readerReadLater", true)).assertIsDisplayed()
        // Four "Open Settings" (notifications, the channel, the overlay, battery) and one "Open setting" (Instant delivery).
        assertEquals(4, compose.onAllNodes(hasText(LabText.button("needs-notifications")!!) and hasClickAction()).fetchSemanticsNodes().size)
        assertEquals(1, compose.onAllNodes(hasText(LabText.button("needs-quick-sends")!!) and hasClickAction()).fetchSemanticsNodes().size)

        // The overlay's opens Android's "Display over other apps" for this app.
        generateSequence { shadowOf(app as Application).nextStartedActivity }.toList()
        compose.onAllNodes(hasText(LabText.button("needs-notifications")!!) and hasClickAction())[2].performClick()
        val opened = shadowOf(app as Application).nextStartedActivity
        assertEquals(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, opened.action)
        assertEquals("package:${app.packageName}", opened.dataString)

        // Granted: met. Instant delivery's "Open setting" goes to the Inbox screen, where its switch is.
        grant()
        ShadowSettings.setCanDrawOverlays(true)
        compose.runOnUiThread { compose.activity.resumes.intValue++ }
        compose.waitForIdle()
        compose.onNodeWithText(line("notifications", true)).assertIsDisplayed()
        compose.onNodeWithText(line("overlay", true)).assertIsDisplayed()
        compose.onNode(hasText(LabText.button("needs-quick-sends")!!) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Instant delivery").assertIsDisplayed()

        // A refused read-later lately: unmet. It is the Reader's own setting, so its steps say where (LAB_TEXT's
        // setup.steps.readerReadLater, Oct 22), and its button is Test the Reader hand-off (setup.readerTest).
        InboxLab.noteSavePage(app, "refused")
        openSetupCheck()
        compose.onNodeWithText(line("readerReadLater", false)).assertIsDisplayed()
        compose.onNodeWithText(LabText["setup.steps.readerReadLater"]).assertIsDisplayed()
        assertTrue(LabText["setup.steps.readerReadLater"].startsWith("The Reader turned down the last pages it was handed."))
        val tests = compose.onAllNodes(hasText(LabText["setup.readerTest"]) and hasClickAction())
        assertEquals("the check's button and the section's", 2, tests.fetchSemanticsNodes().size)
        val stepsBox = compose.onNodeWithText(LabText["setup.steps.readerReadLater"]).fetchSemanticsNode().boundsInRoot
        val under = tests.fetchSemanticsNodes().indexOfFirst { it.boundsInRoot.top >= stepsBox.bottom - 1 && it.boundsInRoot.top - stepsBox.bottom < 80 }
        assertTrue("the check's button is under its steps", under >= 0)
        tests[under].performClick()
        compose.waitForIdle()
        assertNotNull("it runs the Reader hand-off test", app.prefs.labReaderTestId)
    }

    /** F26: with no Reader that saves pages, "Open setting" opens Settings, where Deliver to is. */
    @Test
    fun noReaderOpensDeliverTo() {
        LabKit.useRelay(app, relay)
        app.prefs.labNoteShown = true
        app.prefs.askedNotifications = true
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        app.setRole(Role.INBOX)
        compose.waitForIdle()
        openSetupCheck()
        compose.onNodeWithText(line("reader", false)).assertIsDisplayed()
        compose.onAllNodes(hasText(LabText.button("needs-quick-sends")!!) and hasClickAction())[1].performClick()
        compose.waitForIdle()
        waitForText("Deliver to")
    }

    /** F26: Test the Reader hand-off: the bundled article through the normal hand-off, then "✓ In your Reader". */
    @Test
    fun theReaderHandOffTestShowsItsResult() {
        inbox()
        grant()
        openSetupCheck()
        compose.onNodeWithText(LabText["setup.readerTest"]).performClick()
        compose.waitForIdle()
        val id = app.prefs.labReaderTestId!!
        val item = app.inbox.get(id)!!
        assertEquals(Kind.PAGE, item.kind)
        assertEquals(SetupCheck.TEST_URL_PREFIX + id, item.url)
        assertEquals(mapOf(ItemHeader.X_CAP to "test"), item.extras)
        assertEquals(InboxItem.LANE_LOCAL, item.lane)
        assertTrue(File(app.inbox.filesRoot, item.file!!).readText().contains(LabText["testArticle.heading"]))
        assertEquals("Test article", InboxLab.kindLine(item))
        compose.onNodeWithText(LabText["setup.inReader"]).assertIsDisplayed()
        compose.onNode(hasTestTag(INBOX_READER_TEST_TAG)).assertIsDisplayed()

        // The normal hand-off: the Inbox is in front, so a hand-off of what waits starts; it saves the page.
        val started = generateSequence { shadowOf(compose.activity).nextStartedActivity }.toList()
        val handoff = started.firstOrNull { it.component?.className == HandoffActivity::class.java.name }
        assertNotNull("a hand-off started: $started", handoff)
        val c = Robolectric.buildActivity(HandoffActivity::class.java, handoff).setup()
        shadowOf(Looper.getMainLooper()).idle()
        val save = shadowOf(c.get()).nextStartedActivityForResult
        assertEquals(ReaderApps.ACTION_SAVE_PAGE, save.intent.action)
        assertEquals(item.url, save.intent.getStringExtra(Intent.EXTRA_TEXT))
        shadowOf(c.get()).receiveResult(save.intent, Activity.RESULT_OK, Intent().putExtra(ReaderApps.EXTRA_STATUS, "saved"))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(app.inbox.get(id)!!.confirmedInReader)
        waitForText(LabText.fill(LabText["setup.ok"], mapOf("check" to LabText["setup.inReader"])))
        compose.onNode(hasText(LabText.fill(LabText["setup.ok"], mapOf("check" to LabText["setup.inReader"])))).assertIsDisplayed()
        compose.onNodeWithText(LabText["setup.readerTest"]).assertIsDisplayed()
        assertTrue(compose.onAllNodes(hasText(LabText["setup.inReader"])).fetchSemanticsNodes().isEmpty())

        // No sender holds its id: no state for the senders, and no "Saved to the Reader" (Setup check shows it).
        @Suppress("UNCHECKED_CAST")
        val pending = app.labReporter.inbox()!!.debugState()["pending"] as List<Map<String, Any?>>
        assertTrue(pending.none { it["i"] == id })
    }

    /** F26.2: the activity log holds no title, URL or name; Copy diagnostics has no URL, title, pairing code or topic. */
    @Test
    fun theLogAndTheDiagnosticsKeepNothingPrivate() {
        inbox()
        grant()
        openSetupCheck()
        compose.onNodeWithText(LabText["setup.readerTest"]).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(LabText["setup.activity"]).performClick()
        compose.waitForIdle()
        val id = app.prefs.labReaderTestId!!
        val log = com.daylight.share.sender.ActivityLog.read(app).map(SetupCheck::activityLine)
        assertTrue(log.toString(), log.any { it.contains(" test ${id.take(8)} page ") })
        for (l in log) {
            assertFalse(l, l.contains("daylight.invalid") || l.contains("Test article") || l.contains("example.com"))
        }
        compose.onNodeWithText(log.last(), substring = true).assertIsDisplayed()

        compose.onNodeWithText(LabText["setup.copyDiagnostics"]).performClick()
        waitForText(LabText["setup.copied"])
        val copied = LabKit.clipboard(app)!!
        assertTrue(copied, copied.startsWith(LabText["diagnostics.heading"]))
        assertTrue(copied, copied.contains("(inbox)"))
        val p = app.inbox.ensurePairing()
        for (secret in listOf("daylight.invalid", "https://", "Test article", p.compactCode, p.code, p.keys.inboxTopic, p.keys.ackTopic)) {
            assertFalse("diagnostics carry \"$secret\":\n$copied", copied.contains(secret))
        }
    }
}
