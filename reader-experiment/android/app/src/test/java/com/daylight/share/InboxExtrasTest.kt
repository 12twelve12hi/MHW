package com.daylight.share

import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.BytesBody
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Pairing
import com.daylight.share.core.RelayClient
import com.daylight.share.core.lab.LabText
import com.daylight.share.inbox.HandoffActivity
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxLab
import com.daylight.share.inbox.WaitingCard
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The DC-1 Inbox's items in Wave 1 (LAB-PLAN 2.3, F01, F03, F11; card K5): the header's extras reach `InboxItem` and
 * stay there (Lab on or off), v1.1's `items.json` is unchanged for items without Lab fields, the kind line of each
 * kind, "Cleaned from {host}", and "Sender sees: {label}" with the same words as the sender's row for every state the
 * Inbox records. Items arrive from a sender through a relay in memory ([FakeRelay]).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InboxExtrasTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @Before
    fun setUp() {
        HandoffActivity.running = false
        HandoffActivity.requestedAt = 0L
        HandoffActivity.claim = null
        WaitingCard.forget()
        app.inbox.http = relay
        app.labReporter.autoFlush = false
        app.prefs.inboxRelay = ScreenKit.NOWHERE
        app.prefs.inboxRelayChecked = ScreenKit.NOWHERE
        app.setRole(Role.INBOX)
    }

    /** A paired sender on the Inbox's pairing, publishing to the relay in memory. */
    private fun sender(): Outbox {
        val p = app.inbox.ensurePairing()
        return Outbox(Pairing(p.secret, p.relay, "iPhone"), FileOutboxStore(File(app.filesDir, "test-sender")), RelayClient(p.relay, relay))
    }

    @Test
    fun theHeadersExtrasReachTheItemAndStay() {
        val s = sender()
        val page = s.add(
            OutgoingItem(Kind.PAGE, url = "https://example.com/article", title = "An article", from = "iPhone",
                extras = mapOf(ItemHeader.X_CAP to "clean", ItemHeader.X_ORIG to "https://example.com/article?utm_source=feed")),
            BytesBody("<!doctype html><html><body><p>Hello</p></body></html>".toByteArray()),
        )
        s.publish(page.id)
        val plain = s.add(OutgoingItem(Kind.URL, url = "https://example.com/plain", title = "Plain", from = "iPhone"), null)
        s.publish(plain.id)
        assertEquals(2, runBlocking { app.inbox.pollOnce() })

        val got = app.inbox.get(page.id)!!
        // x-orig as the web URL rule reads it (LAB-PROTOCOL 2.3).
        val orig = com.daylight.share.core.Text.webUrl("https://example.com/article?utm_source=feed")
        assertEquals(mapOf(ItemHeader.X_CAP to "clean", ItemHeader.X_ORIG to orig), got.extras)
        assertEquals("Clean article · from iPhone", InboxLab.kindLine(got))
        assertEquals("Cleaned from example.com", InboxLab.cleanedFrom(got))
        // A v1.1 item: no extras, and items.json holds exactly v1.1's fields for it.
        val v11 = app.inbox.get(plain.id)!!
        assertTrue(v11.extras.isEmpty())
        assertNull(InboxLab.cleanedFrom(v11))
        assertFalse(v11.toJson().keys.any { it in setOf("extras", "held", "labState", "lane") })

        // Kept with Lab off too (Lab off never deletes Lab data), and read back from items.json.
        app.setLab(false)
        val again = InboxItem.fromJson(app.inbox.get(page.id)!!.toJson())!!
        assertEquals(got.extras, again.extras)
    }

    @Test
    fun labFieldsRoundTripAndUnknownExtrasAreDropped() {
        val item = InboxItem(
            id = "a".repeat(32), kind = Kind.FILE, name = "Excerpt - a passage.html", mime = "text/html", size = 2_000, from = "Mac",
            extras = mapOf(ItemHeader.X_CAP to "excerpt"), held = true, labState = "held",
        )
        // Through items.json's text, as the Inbox stores it.
        @Suppress("UNCHECKED_CAST")
        val stored = com.daylight.share.core.Json.parse(com.daylight.share.core.Json.write(item.toJson())) as Map<String, Any?>
        val back = InboxItem.fromJson(stored)!!
        assertEquals(item, back)
        // Only x-cap and x-orig are read back; anything else in the stored map is dropped.
        val m = LinkedHashMap(stored)
        m["extras"] = mapOf(ItemHeader.X_CAP to "excerpt", "x-note" to "nope")
        assertEquals(mapOf(ItemHeader.X_CAP to "excerpt"), InboxItem.fromJson(m)!!.extras)
    }

    /** F03, F11: one line per kind, exactly LAB_TEXT's; an unknown x-cap reads as none. */
    @Test
    fun eachKindHasItsLine() {
        fun line(kind: String, cap: String? = null, from: String? = "iPhone", size: Long = 0) =
            InboxLab.kindLine(InboxItem("b".repeat(32), kind, size = size, from = from, extras = cap?.let { mapOf(ItemHeader.X_CAP to it) } ?: emptyMap()))
        assertEquals("Page as you saw it · from iPhone", line(Kind.PAGE))
        assertEquals("Page as you saw it · from iPhone", line(Kind.PAGE, "seen"))
        assertEquals("Page as you saw it · from iPhone", line(Kind.PAGE, "nonsense"))
        assertEquals("Clean article · from iPhone", line(Kind.PAGE, "clean"))
        assertEquals("Excerpt · from iPhone", line(Kind.FILE, "excerpt", size = 3_000))
        assertEquals("Test article", line(Kind.PAGE, "test", from = null))
        assertEquals("Link (the Reader downloads it) · from iPhone", line(Kind.URL))
        assertEquals(LabText.inboxKindLine(Kind.FILE, size = 1_234_567, from = "Mac"), line(Kind.FILE, from = "Mac", size = 1_234_567))
        assertTrue(line(Kind.FILE, from = "Mac", size = 1_234_567).startsWith("Document · "))
    }

    /** F01: "Sender sees: {label}", the sender's own words for each state the Inbox records. */
    @Test
    fun senderSeesTheSendersWords() {
        val link = InboxItem("c".repeat(32), Kind.URL, url = "https://example.com/c", from = "iPhone")
        val pdf = InboxItem("d".repeat(32), Kind.FILE, name = "paper.pdf", from = "iPhone")
        fun sees(i: InboxItem, s: String?) = InboxLab.senderSees(i.copy(labState = s))
        assertEquals("Sender sees: On your Daylight ✓", sees(link, null))
        assertEquals("Sender sees: Waiting for a tap on your Daylight", sees(link, "waiting"))
        assertEquals("Sender sees: Kept for later on your Daylight", sees(pdf, "held"))
        assertEquals("Sender sees: In Daylight Share on your Daylight", sees(pdf, "inbox"))
        assertEquals("Sender sees: Handed to the Reader", sees(pdf, "handed"))
        assertEquals("Sender sees: In your Reader’s queue", sees(link, "queued"))
        assertEquals("Sender sees: In your Reader ✓", sees(link, "reader"))
        for (s in listOf(null, "waiting", "held", "inbox", "handed", "queued", "reader")) {
            val label = com.daylight.share.core.lab.LabRowText.of(
                com.daylight.share.core.Status.DELIVERED, "", link.kind, 0, 0, 0,
                com.daylight.share.core.lab.LabRowText.Context(lab = true, inboxLab = true, state = s),
            ).label
            assertEquals(LabText.fill(LabText["senderSees"], mapOf("label" to label)), sees(link, s))
        }
        // No sender holds the ids of server-lane items or of the Reader hand-off test.
        assertNull(InboxLab.senderSees(link.copy(lane = InboxItem.LANE_SERVER)))
        assertNull(InboxLab.senderSees(link.copy(lane = InboxItem.LANE_LOCAL)))
    }

    /** The state the Inbox records for its senders is the one its details show (F01). */
    @Test
    fun theRecordedStateIsRemembered() {
        val item = InboxItem("e".repeat(32), Kind.URL, url = "https://example.com/e", title = "E", from = "Mac", received = 1_000)
        app.inbox.put(item)
        app.labReporter.announced(listOf(item))
        assertEquals("waiting", app.inbox.get(item.id)!!.labState)
        app.labReporter.held(listOf(item.id))
        assertEquals("held", app.inbox.get(item.id)!!.labState)
        // A lower rank is not recorded, so it is not shown either.
        app.labReporter.announced(listOf(app.inbox.get(item.id)!!))
        assertEquals("held", app.inbox.get(item.id)!!.labState)
        app.labReporter.handedOff(app.inbox.get(item.id)!!, "saved")
        assertEquals("reader", app.inbox.get(item.id)!!.labState)
        assertEquals("Sender sees: In your Reader ✓", InboxLab.senderSees(app.inbox.get(item.id)!!))
        // Server-lane items record nothing.
        val server = item.copy(id = "f".repeat(32), lane = InboxItem.LANE_SERVER)
        app.inbox.put(server)
        app.labReporter.handedOff(server, "saved")
        assertNull(app.inbox.get(server.id)!!.labState)
    }

    /** Keep for later marks only waiting items; Add to Reader (requeue) and a hand-off clear the mark. */
    @Test
    fun keptForLaterIsAWaitingItemsMark() {
        val waiting = InboxItem("1".repeat(32), Kind.URL, url = "https://example.com/1", from = "Mac")
        val done = waiting.copy(id = "2".repeat(32), state = InboxItem.IN_READER)
        app.inbox.put(waiting)
        app.inbox.put(done)
        assertEquals(listOf(waiting.id), app.inbox.markHeld(listOf(waiting.id, done.id)))
        assertTrue(InboxLab.keptForLater(app.inbox.get(waiting.id)!!, lab = true))
        assertFalse("with Lab off it is v1.1's waiting item", InboxLab.keptForLater(app.inbox.get(waiting.id)!!, lab = false))
        assertFalse(app.inbox.get(done.id)!!.held)
        app.inbox.requeue(waiting.id)
        assertFalse(app.inbox.get(waiting.id)!!.held)
    }

    @Test
    fun quietHoursAreTenAtNightToSevenInTheMorning() {
        for (h in 0..23) assertEquals("$h:00", h >= 22 || h < 7, InboxLab.quietHour(h))
    }

    /** F26: a refused SAVE_PAGE counts for a week, until the Reader takes one again. */
    @Test
    fun aRefusedReadLaterIsRememberedUntilTheReaderTakesOneAgain() {
        val now = 1_792_483_200_000L
        assertFalse(InboxLab.readLaterRefusedLately(app, now))
        InboxLab.noteSavePage(app, "refused", now)
        assertTrue(InboxLab.readLaterRefusedLately(app, now + 1_000))
        assertFalse("not lately after a week", InboxLab.readLaterRefusedLately(app, now + InboxLab.READ_LATER_LATELY_MS))
        InboxLab.noteSavePage(app, "duplicate", now + 2_000)
        assertFalse(InboxLab.readLaterRefusedLately(app, now + 3_000))
    }
}
