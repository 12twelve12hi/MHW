package com.daylight.share

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Pairing
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.Path
import com.daylight.share.sender.Shared
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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

    @Test
    fun pairingLinkOpensTheSender() {
        val p = Pairing(Pairing.generate().secret, nowhere, "Linked Daylight")
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(p.link()))
            .setClass(app, MainActivity::class.java)
        val controller = Robolectric.buildActivity(MainActivity::class.java, intent).setup()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
        assertEquals(Role.SENDER, app.prefs.role)
        assertEquals("Linked Daylight", app.sender.pairing()?.name)
        controller.pause().stop().destroy()
    }
}
