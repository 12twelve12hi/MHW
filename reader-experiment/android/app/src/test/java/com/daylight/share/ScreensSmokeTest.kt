package com.daylight.share

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Pairing
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxText
import com.daylight.share.inbox.Path
import com.daylight.share.sender.Shared
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * Starts the real app (App + MainActivity + Compose) in each role and lets it compose and lay out, so a crash on
 * first open shows up here rather than on the Daylight. The relay is a closed local port: nothing leaves the JVM.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ScreensSmokeTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val nowhere = "http://127.0.0.1:9"

    private fun showMain(): MainActivity {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
        val a = controller.get()
        assertNotNull(a.window.decorView)
        controller.pause().stop().destroy()
        shadowOf(Looper.getMainLooper()).idle()
        return a
    }

    @Test
    fun roleChoice() {
        assertEquals(null, app.prefs.role)
        showMain()
    }

    @Test
    fun inboxWithItemsInEveryState() {
        app.prefs.inboxRelay = nowhere
        app.setRole(Role.INBOX)
        val base = InboxItem(id = "0".repeat(32), kind = "url", url = "https://example.com/a", title = "A link", from = "iPhone", received = System.currentTimeMillis())
        app.inbox.put(base)
        app.inbox.put(base.copy(id = "1".repeat(32), kind = "file", url = null, name = "paper.pdf", mime = "application/pdf", size = 123_456, state = InboxItem.OPEN))
        app.inbox.put(base.copy(id = "2".repeat(32), kind = "page", state = InboxItem.IN_READER, deliveredTo = "com.daylightcomputer.reader", via = Path.SAVE_PAGE.key, readerStatus = "saved"))
        showMain()
        // And the pairing link the QR code shows parses back.
        val p = app.inbox.ensurePairing()
        assertEquals(p.compactCode, Pairing.parse(p.link()).compactCode)
    }

    @Test
    fun senderUnpairedThenPaired() {
        app.setRole(Role.SENDER)
        showMain()
        app.sender.pair(Pairing(Pairing.generate().secret, nowhere, "Test Daylight"))
        runBlocking {
            app.sender.add(Shared.Link("https://example.com/x", "X"))
            app.sender.add(Shared.Text("Some notes", "Notes"))
        }
        assertEquals(2, app.sender.rows.value.size)
        showMain()
    }

    private fun openLink(link: String) = Robolectric.buildActivity(
        MainActivity::class.java,
        android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(link)).setClass(app, MainActivity::class.java),
    ).setup().also { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)) }

    @Test
    fun aPairingLinkAsksBeforePairing() {
        val p = Pairing(Pairing.generate().secret, nowhere, "Linked Daylight")
        val controller = openLink(p.link())
        // A link from outside the app never pairs by itself (PROTOCOL 1.3 "Confirmation").
        assertNull(app.sender.pairing())
        val pending = controller.get().pendingPair.value!!
        assertEquals("Pair with Linked Daylight?", pending.confirmation.title)
        assertEquals("Code starts ${p.code.take(4)}. Check it matches the code on your Daylight.", pending.confirmation.lines[0])
        assertEquals("Sends through 127.0.0.1:9.", pending.confirmation.lines[1])
        assertEquals("Pair", pending.confirmation.button)
        controller.get().confirmPairing()
        assertEquals(Role.SENDER, app.prefs.role)
        assertEquals("Linked Daylight", app.sender.pairing()?.name)
        controller.pause().stop().destroy()
    }

    @Test
    fun aLinkWithAnotherSecretAsksToSwitchAndTheSameSecretUpdatesQuietly() {
        app.setRole(Role.SENDER)
        val mine = Pairing(Pairing.generate().secret, nowhere, "Kitchen Daylight")
        app.sender.pair(mine)
        runBlocking { app.sender.add(Shared.Link("https://example.com/pending", "Pending")) }
        val outboxDir = java.io.File(app.filesDir, "outbox/${mine.keys.inboxTopic}")
        assertTrue(outboxDir.isDirectory)

        // The same secret through another relay: applied at once, the outbox kept, the notice names the relay.
        val moved = Pairing(mine.secret, "http://127.0.0.2:9/ntfy", "Kitchen Daylight")
        val c1 = openLink(moved.link())
        assertNull(c1.get().pendingPair.value)
        assertEquals("http://127.0.0.2:9/ntfy", app.sender.pairing()?.relay)
        assertEquals("Pairing updated: now sending through 127.0.0.2:9.", c1.get().notice.value)
        runBlocking { app.sender.refresh() }
        assertEquals(1, app.sender.rows.value.size)
        c1.pause().stop().destroy()

        // Another secret: asks, "Switch"; until then nothing changes. Switching deletes the old outbox.
        val other = Pairing(Pairing.generate().secret, nowhere, "Office Daylight")
        val c2 = openLink(other.link())
        val pending = c2.get().pendingPair.value!!
        assertEquals("Switch", pending.confirmation.button)
        assertTrue(pending.confirmation.lines.contains("This replaces Kitchen Daylight. Items not yet delivered to it will not be sent."))
        assertTrue(app.sender.pairing()!!.sameSecret(mine))
        c2.get().confirmPairing()
        assertTrue(app.sender.pairing()!!.sameSecret(other))
        // (A background check still running on the old outbox may leave an empty folder behind, never its rows.)
        assertTrue(com.daylight.share.core.FileOutboxStore(outboxDir).load().first.isEmpty())
        runBlocking { app.sender.refresh() }
        assertTrue(app.sender.rows.value.isEmpty())
        c2.pause().stop().destroy()
    }

    @Test
    fun aLinkOnTheInboxAsksBeforeMakingItASender() {
        app.prefs.inboxRelay = nowhere
        app.setRole(Role.INBOX)
        val p = Pairing(Pairing.generate().secret, nowhere, "Another Daylight")
        val c = openLink(p.link())
        assertEquals(Role.INBOX, app.prefs.role)
        val pending = c.get().pendingPair.value!!
        assertTrue(pending.inboxRole)
        c.get().pendingPair.value = null // Cancel
        assertEquals(Role.INBOX, app.prefs.role)
        assertNull(app.sender.pairing())
        c.pause().stop().destroy()
    }

    @Test
    fun theInboxShowsWhyItCannotReceive() {
        app.prefs.inboxRelay = nowhere
        app.setRole(Role.INBOX)
        app.inbox.sync.value = app.inbox.sync.value.copy(error = InboxText.LIMITED, storeFull = true)
        app.prefs.inboxRelayChecked = nowhere
        app.prefs.inboxRelayWarning = com.daylight.share.core.RelayProbe.TOO_SMALL
        showMain()
    }
}
