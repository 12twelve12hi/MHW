package com.daylight.share

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.view.textclassifier.TextClassifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.daylight.share.core.lab.LabText
import com.daylight.share.ui.CopiedLink
import com.daylight.share.ui.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * F33 on the phone (LAB-PLAN 3.3; card K4): "Send copied link". On resume only the clipboard's description is read
 * (a `text/uri-list` clip, or on API 31+ a URL Android's classifier is at least 0.5 sure of); the link is read when the
 * chip is tapped, its host shown with Send and Cancel before anything goes; a non-URL gives no chip, or "No link on the
 * clipboard." once read. F33's Use switch off, or Lab off: no chip.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class CopiedLinkTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun clip(data: ClipData) = app.getSystemService(ClipboardManager::class.java).setPrimaryClip(data)

    private fun uriList(url: String) = ClipData(ClipDescription("link", arrayOf("text/uri-list")), ClipData.Item(url))

    private fun chips() = compose.onAllNodes(hasText(LabText["copiedLink.chip"]) and hasClickAction()).fetchSemanticsNodes()

    private fun resume() {
        compose.activity.resumes.intValue++
        compose.waitForIdle()
    }

    @Test
    fun aCopiedLinkIsOfferedReadOnTapAndSentAfterTheHostIsShown() {
        PhoneKit.phone(app, relay)
        clip(uriList("https://www.example.com/story?utm_medium=email"))
        resume()
        compose.waitUntil(5_000) { chips().isNotEmpty() }
        assertTrue("nothing sent before the tap", PhoneKit.store(app).load().first.isEmpty())
        compose.onNode(hasText(LabText["copiedLink.chip"]) and hasClickAction()).performClick()
        val ask = LabText.fill(LabText["copiedLink.confirm"], mapOf("host" to "example.com", "name" to "Kitchen Daylight"))
        compose.onNodeWithText(ask).assertIsDisplayed()
        assertTrue("nothing sent before Send", PhoneKit.store(app).load().first.isEmpty())
        compose.onNode(hasText(LabText["shareInPlace.send"]) and hasClickAction()).performClick()
        PhoneKit.until(what = "the row") { PhoneKit.store(app).load().first.isNotEmpty() }
        assertEquals("https://www.example.com/story", PhoneKit.store(app).load().first.single().url)
    }

    @Test
    fun cancelSendsNothing() {
        PhoneKit.phone(app, relay)
        clip(uriList("https://example.com/no"))
        resume()
        compose.waitUntil(5_000) { chips().isNotEmpty() }
        compose.onNode(hasText(LabText["copiedLink.chip"]) and hasClickAction()).performClick()
        compose.onNode(hasText(LabText["automation.cancel"]) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertTrue(PhoneKit.store(app).load().first.isEmpty())
    }

    /** F33.2: plain text that Android has not classified as a URL gives no chip; a non-URL read on tap says so. */
    @Test
    fun noChipForANonUrlClipboard() {
        PhoneKit.phone(app, relay)
        clip(ClipData.newPlainText("note", "Buy milk"))
        resume()
        assertTrue(chips().isEmpty())
        assertFalse(CopiedLink.offered(app))
        // A uri-list that holds no web link: offered by its type, but reading it finds none.
        clip(uriList("mailto:someone@example.com"))
        resume()
        compose.waitUntil(5_000) { chips().isNotEmpty() }
        compose.onNode(hasText(LabText["copiedLink.chip"]) and hasClickAction()).performClick()
        compose.onNodeWithText(LabText["copiedLink.noLink"]).assertIsDisplayed()
    }

    /** API 31+: a text clip that Android's classifier scores as a URL (0.5 or more) is offered; less is not. */
    @Test
    fun theClassifiersConfidenceDecides() {
        val sure = ClipDescription("t", arrayOf("text/plain"))
        val unsure = ClipDescription("t", arrayOf("text/plain"))
        val set = runCatching {
            val scores = ClipDescription::class.java.getDeclaredMethod("setConfidenceScores", Map::class.java).apply { isAccessible = true }
            val status = ClipDescription::class.java.getDeclaredMethod("setClassificationStatus", Int::class.javaPrimitiveType).apply { isAccessible = true }
            scores.invoke(sure, mapOf(TextClassifier.TYPE_URL to 0.9f))
            scores.invoke(unsure, mapOf(TextClassifier.TYPE_URL to 0.2f))
            status.invoke(sure, 3) // CLASSIFICATION_COMPLETE
            status.invoke(unsure, 3)
        }.isSuccess
        assumeTrue("this Android jar lets a test set the classifier's scores", set)
        PhoneKit.phone(app, relay)
        clip(ClipData(sure, ClipData.Item("look https://example.com/x")))
        assertTrue(CopiedLink.offered(app))
        clip(ClipData(unsure, ClipData.Item("look at this")))
        assertFalse(CopiedLink.offered(app))
    }

    @Test
    fun theUseSwitchAndLabOffHideTheChip() {
        PhoneKit.phone(app, relay)
        clip(uriList("https://example.com/hidden"))
        app.prefs.setLabUse("F33", false)
        resume()
        assertTrue(chips().isEmpty())
        app.prefs.setLabUse("F33", true)
        app.setLab(false)
        resume()
        assertTrue(chips().isEmpty())
        app.setLab(true)
        resume()
        compose.waitUntil(5_000) { chips().isNotEmpty() }
    }
}
