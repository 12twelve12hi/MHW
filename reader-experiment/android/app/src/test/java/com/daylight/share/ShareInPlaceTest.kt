package com.daylight.share

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.lab.LabText
import com.daylight.share.sender.SendWorker
import com.daylight.share.sender.ShareActivity
import com.daylight.share.sender.ShareInPlace
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.io.RandomAccessFile
import java.time.Duration

/**
 * Share in place on the phone (LAB-PLAN F04; F04.4, F04.5), with what rides on its card: F03's link-only hint once,
 * F11's "Send as excerpt" (6.5 Q1 = b) and headline + link shares that stay links (F11.5), the F02 entry point under
 * the too-big sentence, F04's Use switch, and process death during the countdown. The clock is Robolectric's; the
 * outbox is real, on a relay in memory.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ShareInPlaceTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun share(text: String, subject: String? = null): ActivityScenario<ShareActivity> {
        val i = Intent(app, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        subject?.let { i.putExtra(Intent.EXTRA_SUBJECT, it) }
        return ActivityScenario.launch(i)
    }

    private fun waitMs(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun ActivityScenario<ShareActivity>.activity(): ShareActivity {
        var a: ShareActivity? = null
        onActivity { a = it }
        return a!!
    }

    private fun rows(): List<OutboxRow> = PhoneKit.store(app).load().first

    private val card: String get() = LabText.fill(LabText["shareInPlace.card"], mapOf("name" to "Kitchen Daylight"))

    /** F04.4: nothing goes during the 1.5 s countdown; then the item is in the outbox, its job asked for, the card gone. */
    @Test
    fun theCardSendsAfterTheCountdownAndFinishes() {
        PhoneKit.phone(app, relay)
        share("A great read https://example.com/story?utm_source=x").use { s ->
            val a = s.activity()
            compose.onNodeWithText(card).assertIsDisplayed()
            compose.onNode(hasText(LabText["shareInPlace.options"]) and hasClickAction()).assertIsDisplayed()
            waitMs(1_000)
            assertTrue("nothing during the countdown", rows().isEmpty())
            assertFalse(a.isFinishing)
            waitMs(ShareInPlace.COUNTDOWN_MS - 1_000)
            // The rest happens without moving the clock: within 1 s of the countdown's end.
            PhoneKit.until(what = "the card to finish") { a.isFinishing }
            val row = rows().single()
            assertEquals(Kind.URL, row.kind)
            assertEquals("https://example.com/story", row.url)
            assertEquals("A great read", row.title)
            assertEquals("https://example.com/story?utm_source=x", row.header.extras[ItemHeader.X_ORIG])
            assertTrue(PhoneKit.jobs().contains(SendWorker.name(row.id)))
            assertTrue("remembered for its notice", app.prefs.labInPlaceIds().contains(row.id))
        }
    }

    /** F04.5: Options stops the countdown and shows the choices; nothing goes until Send, with the edited title. */
    @Test
    fun optionsStopsTheCountdown() {
        PhoneKit.phone(app, relay)
        share("Plain title https://example.com/options").use { s ->
            val a = s.activity()
            waitMs(500)
            compose.onNode(hasText(LabText["shareInPlace.options"]) and hasClickAction()).performClick()
            waitMs(5_000)
            assertTrue(rows().isEmpty())
            assertFalse(a.isFinishing)
            compose.onNode(hasSetTextAction()).performTextReplacement("My own title")
            compose.onNode(hasText(LabText["shareInPlace.send"]) and hasClickAction()).performClick()
            PhoneKit.until(what = "the card to finish") { a.isFinishing }
            assertEquals("My own title", rows().single().title)
        }
    }

    /** F04.5 and F27.5: with Comfort (or "Always show Options before sending") the card opens with Send and no countdown. */
    @Test
    fun noTimerForSomeoneWhoNeedsTime() {
        for (how in listOf("comfort", "always")) {
            PhoneKit.phone(app, relay)
            app.setComfort(how == "comfort")
            app.prefs.labAlwaysOptions = how == "always"
            share("Take your time https://example.com/$how").use { s ->
                val a = s.activity()
                compose.onNode(hasText(LabText["shareInPlace.send"]) and hasClickAction()).assertIsDisplayed()
                waitMs(10_000)
                assertTrue("$how: nothing without Send", rows().none { it.url.endsWith(how) })
                compose.onNode(hasText(LabText["shareInPlace.send"]) and hasClickAction()).performClick()
                PhoneKit.until(what = "the card to finish") { a.isFinishing }
                assertTrue(rows().any { it.url == "https://example.com/$how" })
            }
        }
        app.setComfort(false)
        app.prefs.labAlwaysOptions = false
    }

    /**
     * Process death during the countdown: nothing is queued (the card goes, and with it the countdown; a card recreated
     * from saved state closes at once), and the next share works.
     */
    @Test
    fun aCardThatGoesDuringTheCountdownSendsNothing() {
        PhoneKit.phone(app, relay)
        share("Gone https://example.com/gone").use { s ->
            waitMs(500)
            s.moveToState(Lifecycle.State.DESTROYED)
            waitMs(5_000)
            assertTrue(rows().isEmpty())
        }
        val again = Robolectric.buildActivity(
            ShareActivity::class.java,
            Intent(app, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Again https://example.com/again"),
        ).create(Bundle())
        assertTrue("recreated after process death: it closes", again.get().isFinishing)
        waitMs(5_000)
        assertTrue(rows().isEmpty())
        share("Next https://example.com/next").use { s ->
            val a = s.activity()
            waitMs(ShareInPlace.COUNTDOWN_MS)
            PhoneKit.until(what = "the card to finish") { a.isFinishing }
            assertEquals("https://example.com/next", rows().single().url)
        }
    }

    /** F03.3: the first link-only share shows the hint once (the card stays until OK); later ones do not. */
    @Test
    fun theLinkOnlyHintShowsOnce() {
        PhoneKit.phone(app, relay)
        app.prefs.labLinkOnlyShown = false
        val hint = LabText["linkOnly.android"]
        share("https://example.com/first").use { s ->
            val a = s.activity()
            waitMs(ShareInPlace.COUNTDOWN_MS)
            PhoneKit.until(what = "the hint") { compose.onAllNodes(hasText(hint)).fetchSemanticsNodes().isNotEmpty() }
            assertEquals(1, rows().size)
            waitMs(10_000)
            assertFalse("it stays to be read", a.isFinishing)
            compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
            PhoneKit.until { a.isFinishing }
        }
        assertTrue(app.prefs.labLinkOnlyShown)
        share("https://example.com/second").use { s ->
            val a = s.activity()
            waitMs(ShareInPlace.COUNTDOWN_MS)
            PhoneKit.until(what = "the card to finish") { a.isFinishing }
            assertTrue(compose.onAllNodes(hasText(hint)).fetchSemanticsNodes().isEmpty())
        }
    }

    /** F11 (6.5 Q1 = b) and F11.5: a headline + link stays a link; "Send as excerpt" makes it an excerpt, explicitly. */
    @Test
    fun aHeadlineAndLinkIsALinkUnlessSentAsAnExcerpt() {
        PhoneKit.phone(app, relay)
        val nyt = "Opinion | The Real Reason Inflation Is Still Too High, According to Economists https://nyti.ms/3XyZabc"
        share(nyt).use { s ->
            val a = s.activity()
            waitMs(ShareInPlace.COUNTDOWN_MS)
            PhoneKit.until(what = "the card to finish") { a.isFinishing }
            val row = rows().single()
            assertEquals(Kind.URL, row.kind)
            assertEquals("https://nyti.ms/3XyZabc", row.url)
            assertEquals("Opinion | The Real Reason Inflation Is Still Too High, According to Economists", row.title)
        }
        val quote = "“The quick brown fox jumps over the lazy dog, again and again.” https://example.com/fox"
        share(quote).use { s ->
            val a = s.activity()
            compose.onNode(hasText(LabText["shareInPlace.options"]) and hasClickAction()).performClick()
            compose.onNode(hasText(LabText["shareInPlace.sendLink"])).assertIsDisplayed()
            compose.onNode(hasText(LabText["shareInPlace.sendAsExcerpt"])).performClick()
            compose.onNode(hasText(LabText["shareInPlace.send"]) and hasClickAction()).performClick()
            // The first excerpt from this device says, once, that it waits for a tap.
            PhoneKit.until(what = "the excerpt line") { compose.onAllNodes(hasText(LabText["excerpt.waitsOnce"])).fetchSemanticsNodes().isNotEmpty() }
            val row = rows().first { it.kind == Kind.FILE }
            assertEquals("text/html", row.header.mime)
            assertTrue(row.name, row.name.startsWith("Excerpt - "))
            assertEquals("excerpt", row.header.extras[ItemHeader.X_CAP])
            assertTrue(row.url, row.url.startsWith("https://example.com/fox#:~:text="))
            compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
            PhoneKit.until { a.isFinishing }
        }
        assertTrue(app.prefs.labExcerptNoteShown)
    }

    /** F02e.1: a file over 9 MB shows the too-big sentence and, under it, "Send files over 9 MB ›" with its gate. */
    @Test
    fun aFileOver9MbOffersTheF02EntryPoint() {
        PhoneKit.phone(app, relay)
        // Outside the app's own files (which are never sent): a 14.2 MB file, sparse.
        val big = File(System.getProperty("java.io.tmpdir"), "k4-big-${System.nanoTime()}.pdf")
        RandomAccessFile(big, "rw").use { it.setLength(14_200_000) }
        try {
            val i = Intent(app, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, Uri.fromFile(big))
            ActivityScenario.launch<ShareActivity>(i).use { s ->
                val a = s.activity()
                waitMs(ShareInPlace.COUNTDOWN_MS)
                val tooBig = "Too big to send. Files can be up to 9 MB; this one is 14.2 MB."
                PhoneKit.until(what = "the too-big sentence") { compose.onAllNodes(hasText(tooBig)).fetchSemanticsNodes().isNotEmpty() }
                compose.onNode(hasText(LabText["bigFiles"]) and hasClickAction()).performClick()
                val sentence = LabText.needsMessage("needs-server", platform = "android")!!
                PhoneKit.until(10_000, "the needs-server sentence") { compose.onAllNodes(hasText(sentence)).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithText(LabText.button("needs-server")!!).assertIsDisplayed()
                assertTrue(rows().isEmpty())
                assertFalse("the card stays", a.isFinishing)
            }
        } finally {
            big.delete()
        }
    }

    /** F04's Use switch off: the v1.1 card, which stays until the item is sent. */
    @Test
    fun withShareInPlaceOffTheCardIsV11s() {
        PhoneKit.phone(app, relay)
        app.prefs.setLabUse("F04", false)
        share("Old way https://example.com/v11").use { s ->
            compose.onNodeWithText("Sending to Kitchen Daylight…").assertIsDisplayed()
            PhoneKit.until(what = "the result") { compose.onAllNodes(hasText("Sent · waiting for your Daylight")).fetchSemanticsNodes().isNotEmpty() }
            assertEquals("https://example.com/v11", rows().single().url)
            assertTrue("no share-in-place job", PhoneKit.jobs().none { it.startsWith("send-") })
            s.activity()
        }
        app.prefs.setLabUse("F04", true)
    }
}
