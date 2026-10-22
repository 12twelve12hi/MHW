package com.daylight.share

import android.content.Intent
import android.os.Looper
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.sender.ShareActivity
import com.daylight.share.ui.COMFORT_TARGET
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * The share card ("Send to Daylight" in the share sheet) for someone who needs time (F27, WCAG 2.2.1): with Comfort it
 * stays up, with a Close button as tall as Comfort's targets, until it is closed; as shipped it closes by itself.
 * ([ShareActivity.needsTime], which also covers TalkBack and Switch Access, is tested in [AccessibilityTest].)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ShareCardTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app: App = ApplicationProvider.getApplicationContext()

    /** Shares text without anything Daylight Share can send: the card says so, then closes (or stays). */
    private fun shareNothing(): ActivityScenario<ShareActivity> =
        ActivityScenario.launch(Intent(app, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain"))

    private fun waitMs(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun ActivityScenario<ShareActivity>.activity(): ShareActivity {
        var a: ShareActivity? = null
        onActivity { a = it }
        return a!!
    }

    @Test
    fun withComfortTheCardStaysUntilClosed() {
        app.setComfort(true)
        shareNothing().use { scenario ->
            val card = scenario.activity()
            compose.onNodeWithText(NOTHING).assertIsDisplayed()
            val close = compose.onNode(hasText("Close") and hasClickAction())
            close.assertIsDisplayed().assertHeightIsAtLeast(COMFORT_TARGET)
            waitMs(30_000)
            assertFalse("still up after 30 s", card.isFinishing)
            close.performClick()
            waitMs(500)
            assertTrue("Close closes it", card.isFinishing)
        }
    }

    @Test
    fun asShippedTheCardClosesByItself() {
        shareNothing().use { scenario ->
            val card = scenario.activity()
            compose.onNodeWithText(NOTHING).assertIsDisplayed()
            compose.onNode(hasText("Close")).assertDoesNotExist()
            assertFalse(card.isFinishing)
            waitMs(4_000)
            assertTrue("closed after 3.5 s", card.isFinishing)
        }
    }

    private companion object {
        const val NOTHING = "There’s nothing here Daylight Share can send."
    }
}
