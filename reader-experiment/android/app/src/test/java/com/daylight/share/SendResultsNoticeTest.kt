package com.daylight.share

import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.Notices
import com.daylight.share.ui.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * F04 (LAB-PLAN 3.3): tapping a "Send results" notice opens the app at the row. The home screen opens scrolled to it,
 * with its details shown, even when a dozen newer rows come first; with Lab off the extra is ignored.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SendResultsNoticeTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    private val title = "The one that expired"

    private fun shown(text: String) = compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()

    /** A dozen newer rows, then the expired one, and its notice: -> what tapping the notice opens. */
    private fun noticeIntent(): Intent {
        PhoneKit.phone(app, relay)
        PhoneKit.grantNotifications(app)
        val now = System.currentTimeMillis()
        val expired = PhoneKit.row(99, title, Status.EXPIRED, now - 10 * PhoneKit.MIN)
        PhoneKit.writeRows(app, (1..12).map { PhoneKit.row(it, "Newer item $it", Status.SENT, now - it * 30_000L) } + expired)
        Notices.failed(app, expired)
        val n = PhoneKit.notifications(app).single()
        assertEquals(LabText.fill(LabText["shareInPlace.failedTitle"], mapOf("title" to title, "name" to "Kitchen Daylight")), PhoneKit.titleOf(n))
        val tapped = shadowOf(n.contentIntent).savedIntent
        assertEquals(MainActivity::class.java.name, tapped.component?.className)
        assertEquals(expired.id, tapped.getStringExtra(MainActivity.EXTRA_ROW))
        return Intent(app, MainActivity::class.java).putExtras(tapped)
    }

    @Test
    fun tappingAFailureNoticeOpensTheAppAtTheRow() {
        val tapped = noticeIntent()
        // Opened as usual, the list starts at the top: the expired row is far below.
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(5_000) { shown("Daylight Share") }
            compose.waitForIdle()
            assertTrue("not on screen at first", !shown(title))
        }
        // From the notice: the list goes to the row, which shows its details.
        ActivityScenario.launch<MainActivity>(tapped).use {
            compose.waitUntil(10_000) { shown(title) }
            compose.waitForIdle()
            compose.onNodeWithText(title).assertIsDisplayed()
            compose.onNodeWithText("Newer item 1").assertDoesNotExist()
        }
    }

    @Test
    fun withLabOffTheNoticesExtraIsIgnored() {
        val tapped = noticeIntent()
        app.setLab(false)
        ActivityScenario.launch<MainActivity>(tapped).use {
            compose.waitUntil(5_000) { shown("Daylight Share") }
            compose.waitForIdle()
            assertTrue(!shown(title))
        }
    }
}
