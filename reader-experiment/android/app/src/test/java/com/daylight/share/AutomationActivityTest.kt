package com.daylight.share

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Looper
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.AutomationActivity
import com.daylight.share.sender.SendWorker
import com.daylight.share.ui.LAB_OPENED_SETTING_TAG
import com.daylight.share.ui.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * F09 on Android (LAB-PLAN 3.3; card K4): `com.daylight.share.action.SEND_URL` and `daylightshare://send`. A
 * confirmation sheet ("Send to {name}?", title and host, Send and Cancel) unless quick sends are allowed (at most 10 a
 * minute); `RESULT_OK` with the id and status; the Lab-off, unpaired and not-a-link answers; and a web page cannot send
 * silently.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AutomationActivityTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @Before
    fun setUp() = AutomationActivity.resetQuickSends()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun sendUrl(text: String, title: String? = null, quick: Boolean = false): Intent =
        Intent(AutomationActivity.ACTION_SEND_URL).setClass(app, AutomationActivity::class.java)
            .putExtra(Intent.EXTRA_TEXT, text)
            .apply { title?.let { putExtra(Intent.EXTRA_TITLE, it) } }
            .putExtra(AutomationActivity.EXTRA_QUICK, quick)

    private fun idle() = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))

    private fun rows() = PhoneKit.store(app).load().first

    /** The sheet's activity (held, so its result can be read after it finished). */
    private fun ActivityScenario<AutomationActivity>.activity(): AutomationActivity {
        var a: AutomationActivity? = null
        onActivity { a = it }
        return a!!
    }

    /** The result [a] set so far: (code, data), whether or not it has finished. */
    private fun answer(a: AutomationActivity): Pair<Int, Intent?> = shadowOf(a).resultCode to shadowOf(a).resultIntent

    @Test
    fun theSheetAsksFirstAndAnswersWithTheIdAndStatus() {
        PhoneKit.phone(app, relay)
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://www.example.com/story?utm_source=feed", "A story")).use { s ->
            val a = s.activity()
            compose.onNodeWithText(LabText.fill(LabText["automation.confirmTitle"], mapOf("name" to "Kitchen Daylight"))).assertIsDisplayed()
            compose.onNodeWithText("A story").assertIsDisplayed()
            compose.onNodeWithText("example.com").assertIsDisplayed()
            assertTrue("nothing before Send", rows().isEmpty())
            compose.onNode(hasText(LabText["automation.send"]) and hasClickAction()).performClick()
            PhoneKit.until(what = "a result") { answer(a).first == Activity.RESULT_OK && a.isFinishing }
            val row = rows().single()
            assertEquals("https://www.example.com/story", row.url)
            assertEquals(row.id, answer(a).second!!.getStringExtra(AutomationActivity.RESULT_ID))
            assertEquals(row.status, answer(a).second!!.getStringExtra(AutomationActivity.RESULT_STATUS))
            assertTrue(PhoneKit.jobs().contains(SendWorker.name(row.id)))
        }
    }

    @Test
    fun cancelSendsNothing() {
        PhoneKit.phone(app, relay)
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://example.com/no")).use { s ->
            val a = s.activity()
            compose.onNode(hasText(LabText["automation.cancel"]) and hasClickAction()).performClick()
            idle()
            assertTrue(a.isFinishing)
            assertEquals(Activity.RESULT_CANCELED, answer(a).first)
            assertTrue(rows().isEmpty())
        }
    }

    /** F09.3: quick=1 skips the sheet only with "Allow quick sends from other apps" on; asked for while off, the sheet says how. */
    @Test
    fun quickSendsNeedTheSetting() {
        PhoneKit.phone(app, relay)
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://example.com/q", quick = true)).use { s ->
            val a = s.activity()
            compose.onNode(hasText(LabText["automation.send"]) and hasClickAction()).assertIsDisplayed()
            compose.onNodeWithText(LabText.needsMessage("needs-quick-sends", platform = "android")!!).assertIsDisplayed()
            compose.onNodeWithText(LabText.button("needs-quick-sends")!!).assertIsDisplayed()
            assertTrue(rows().isEmpty())
        }
        app.prefs.labQuickSends = true
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://example.com/quick", quick = true)).use { s ->
            val a = s.activity()
            PhoneKit.until(what = "a quick result") { answer(a).first == Activity.RESULT_OK && a.isFinishing }
            assertEquals("https://example.com/quick", rows().single().url)
        }
    }

    /**
     * 1.5: the needs-quick-sends note's "Open setting" opens What's in Lab at "Allow quick sends from other apps",
     * brought into view with its footer, and never turns it on by itself.
     */
    @Test
    fun openSettingOpensTheQuickSendsSetting() {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://example.com/q", quick = true)).use { s ->
            val a = s.activity()
            compose.onNode(hasText(LabText.button("needs-quick-sends")!!) and hasClickAction()).performClick()
            PhoneKit.until(what = "the sheet to finish") { a.isFinishing }
        }
        var started: Intent? = null
        while (true) {
            val i = shadowOf(app).nextStartedActivity ?: break
            if (i.component?.className == MainActivity::class.java.name) started = i
        }
        assertEquals(AutomationActivity.quickSendsSetting(app).getStringExtra(MainActivity.EXTRA_LAB_PAGE), started!!.getStringExtra(MainActivity.EXTRA_LAB_PAGE))
        assertEquals("F09", started.getStringExtra(MainActivity.EXTRA_LAB_FOCUS))
        ActivityScenario.launch<MainActivity>(Intent(app, MainActivity::class.java).putExtras(started)).use {
            compose.waitUntil(10_000) { compose.onAllNodes(hasTestTag(LAB_OPENED_SETTING_TAG)).fetchSemanticsNodes().isNotEmpty() }
            compose.waitForIdle()
            compose.onNode(hasTestTag(LAB_OPENED_SETTING_TAG)).assertIsDisplayed()
            compose.onNode(isToggleable() and hasText(LabText["automation.quickSends"])).assertIsDisplayed().assertIsOff()
            compose.onNodeWithText(LabText["automation.quickSendsFooter"], substring = true).assertIsDisplayed()
            assertFalse(app.prefs.labQuickSends)
        }
    }

    /** At most 10 quick sends a minute; past that, the sheet shows. */
    @Test
    fun quickSendsAreLimited() {
        val t = 1_000_000L
        repeat(10) { assertTrue(AutomationActivity.quickAllowed(t + it)) }
        assertFalse(AutomationActivity.quickAllowed(t + 30_000))
        assertTrue("a minute later", AutomationActivity.quickAllowed(t + 61_000))
    }

    @Test
    fun withLabOffItSaysToTurnLabOn() {
        PhoneKit.phone(app, relay)
        app.setLab(false)
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://example.com/off")).use { s ->
            val a = s.activity()
            compose.onNodeWithText(LabText.fill(LabText["labOff"], mapOf("app" to "Daylight Share"))).assertIsDisplayed()
            assertEquals("lab-off", answer(a).second!!.getStringExtra(AutomationActivity.RESULT_STATUS))
            assertTrue(rows().isEmpty())
        }
    }

    @Test
    fun unpairedItSaysToPairFirst() {
        PhoneKit.phone(app, relay)
        app.sender.unpair()
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("https://example.com/x")).use { s ->
            val a = s.activity()
            compose.onNodeWithText(LabText.needsMessage("needs-pairing", platform = "android")!!).assertIsDisplayed()
            assertEquals("needs-pairing", answer(a).second!!.getStringExtra(AutomationActivity.RESULT_STATUS))
        }
    }

    @Test
    fun somethingThatIsNotALinkIsRefused() {
        PhoneKit.phone(app, relay)
        ActivityScenario.launchActivityForResult<AutomationActivity>(sendUrl("just some words")).use { s ->
            val a = s.activity()
            compose.onNodeWithText(LabText["automation.notWebAddress"]).assertIsDisplayed()
            assertEquals(Activity.RESULT_CANCELED, answer(a).first)
            assertEquals("refused", answer(a).second!!.getStringExtra(AutomationActivity.RESULT_STATUS))
            assertTrue(rows().isEmpty())
        }
    }

    /** The URL scheme: MainActivity routes daylightshare://send to the sheet; only url, title, text and quick are read. */
    @Test
    fun theUrlSchemeOpensTheSheet() {
        val link = Uri.parse("daylightshare://send?url=https%3A%2F%2Fexample.com%2Fscheme&title=From%20a%20script&quick=1&file=%2Fsdcard%2Fx.pdf")
        val r = AutomationActivity.request(AutomationActivity.fromLink(app, link))
        assertEquals(AutomationActivity.Request("https://example.com/scheme", "From a script", "", true), r)

        PhoneKit.phone(app, relay)
        Robolectric.buildActivity(MainActivity::class.java, Intent(Intent.ACTION_VIEW, link).setClass(app, MainActivity::class.java)).setup()
        val started = shadowOf(app).nextStartedActivity
        assertEquals(AutomationActivity::class.java.name, started.component?.className)
        // A web page cannot send silently: with quick sends off the sheet asks.
        ActivityScenario.launchActivityForResult<AutomationActivity>(started).use {
            compose.onNode(hasText(LabText["automation.send"]) and hasClickAction()).assertIsDisplayed()
            assertTrue(rows().isEmpty())
        }
    }
}
