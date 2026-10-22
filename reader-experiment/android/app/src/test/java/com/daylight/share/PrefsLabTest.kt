package com.daylight.share

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.Pairing
import com.daylight.share.core.Status
import com.daylight.share.core.server.FileServerStore
import com.daylight.share.core.server.ServerKeys
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The Lab switch's setting (LAB-PLAN 1.2, 1.3, F00.1, F00.4, F27.6): a missing key means on and the first start of a
 * build with Lab writes it; the one-time note only in builds with F01 or F04, once; the switch is the device's, never
 * part of a pairing; and turning Lab off changes no sending, no history, no pairing and no server pin.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PrefsLabTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val sp get() = app.getSharedPreferences("daylight-share", Context.MODE_PRIVATE)

    @Test
    fun aMissingKeyMeansOnAndTheFirstStartWritesIt() {
        // App.onCreate ran on an empty store, as on a fresh install: Lab is on, and written down.
        assertTrue(sp.contains("lab"))
        assertTrue(app.prefs.lab)
        assertTrue(app.labOn.value)

        // An upgrade from the last non-Lab build has no key: it reads as on, and the first start writes it, once.
        sp.edit().remove("lab").commit()
        assertTrue("a missing key means on", Prefs(app).lab)
        assertTrue(Prefs(app).ensureLabDefault())
        assertTrue(sp.getBoolean("lab", false))
        assertFalse("written once", Prefs(app).ensureLabDefault())

        // Turned off, it stays off: a later start does not turn it on again, and every reader sees it.
        app.setLab(false)
        assertFalse(Prefs(app).ensureLabDefault())
        assertFalse(Prefs(app).lab)
        assertFalse(app.labOn.value)
        app.setLab(true)
        assertTrue(Prefs(app).lab)
        assertTrue(app.labOn.value)
    }

    @Test
    fun theOneTimeNoteNeedsABuildWithF01OrF04AndShowsOnce() {
        // The Inbox's W1 build (K5) has it, as the phone's (K4) does.
        assertTrue("a W1 build shows the one-time note", LAB_NOTE_ENABLED)
        assertTrue(app.prefs.labNoteDue())
        assertFalse("a W0 build shows none", app.prefs.labNoteDue(enabled = false))
        assertTrue("a build with F01 or F04 shows it", app.prefs.labNoteDue(enabled = true))
        app.setLab(false)
        assertFalse("not with Lab off", app.prefs.labNoteDue(enabled = true))
        app.setLab(true)
        app.prefs.labNoteShown = true
        assertFalse("once", app.prefs.labNoteDue(enabled = true))
        assertTrue(Prefs(app).labNoteShown)
    }

    @Test
    fun theSwitchBelongsToTheDeviceNotToAPairing() {
        app.setRole(Role.SENDER)
        app.setLab(false)
        val a = Pairing(Pairing.generate().secret, ScreenKit.NOWHERE, "A")
        app.sender.pair(a)
        assertFalse(app.prefs.lab)
        assertFalse("never in a pairing link", a.link().contains("lab"))
        app.sender.unpair()
        assertFalse(app.prefs.lab)
        app.sender.pair(Pairing(Pairing.generate().secret, ScreenKit.NOWHERE, "B"))
        assertFalse("re-pairing leaves it", app.prefs.lab)
        app.setLab(true)
        app.sender.pair(Pairing(Pairing.generate().secret, ScreenKit.NOWHERE, "C"))
        assertTrue(app.prefs.lab)
    }

    /** F27.6: Comfort is not under Lab; turning Lab off or on leaves it as it was. */
    @Test
    fun labLeavesComfortAsItIs() {
        app.setComfort(true)
        app.setLab(false)
        assertTrue(app.prefs.comfort)
        app.setLab(true)
        assertTrue(app.prefs.comfort)
        app.setComfort(false)
        app.setLab(false)
        assertFalse(app.prefs.comfort)
    }

    /**
     * F00.4: an item queued offline goes once the network is back, with Lab turned off meanwhile; the history, the
     * pairing, the ledger and the server pin are all still there.
     */
    @Test
    fun labOffChangesNoSending() {
        val relay = FakeRelay()
        app.sender.http = relay
        app.setRole(Role.SENDER)
        val p = Pairing(Pairing.generate().secret, ScreenKit.NOWHERE, "Kitchen Daylight")
        app.sender.pair(p)
        val pin = linkedMapOf("origin" to "https://daylight-0123456789ab.example.workers.dev", "fingerprint" to "0123abcd")
        FileServerStore(File(app.filesDir, "server.json")).set(ServerKeys.PIN, pin)

        relay.offline = true
        val row = runBlocking {
            val r = app.sender.add(com.daylight.share.sender.Shared.Link("https://example.com/queued", "Queued offline"))
            app.sender.publish(r.id)
        }!!
        assertEquals(Status.FAILED, row.status)
        assertEquals("network", row.errorCode)
        val ledger = File(app.filesDir, "outbox/${p.keys.inboxTopic}/lab.json").apply { parentFile!!.mkdirs(); writeText("{\"heard\":1}") }

        app.setLab(false)
        relay.offline = false
        runBlocking { app.sender.retry(row.id) }

        val after = app.sender.rows.value.single { it.id == row.id }
        assertEquals(Status.SENT, after.status)
        assertEquals(1, relay.messages(p.keys.inboxTopic).size)
        assertTrue(app.sender.pairing()!!.sameSecret(p))
        assertTrue("the ledger stays", ledger.isFile)
        assertEquals(pin, FileServerStore(File(app.filesDir, "server.json")).get(ServerKeys.PIN))
        assertNotNull(FileOutboxStore(File(app.filesDir, "outbox/${p.keys.inboxTopic}")).load().first.singleOrNull { it.id == row.id })
        assertFalse(app.prefs.lab)
    }

    @Test
    fun theSendersLedgerHearsTheAckTopicWithLabOnOrOff() {
        val relay = FakeRelay()
        app.sender.http = relay
        app.setRole(Role.SENDER)
        app.setLab(false)
        val p = Pairing(Pairing.generate().secret, ScreenKit.NOWHERE, "Kitchen Daylight")
        app.sender.pair(p)
        relay.publish(
            p.keys.ackTopic,
            com.daylight.share.core.lab.LabFrame.build(p.keys, com.daylight.share.core.lab.LabInboxInfo(1, "android/1.0.9", listOf("st", "tap"))),
        )
        runBlocking { app.sender.tick() }
        val snap = app.sender.ledger()!!.snapshot()
        assertTrue("recorded with Lab off (LAB-PLAN 1.3), so turning Lab on shows it at once", snap.inboxLab)
        assertEquals(listOf("st", "tap"), snap.caps)
    }
}
