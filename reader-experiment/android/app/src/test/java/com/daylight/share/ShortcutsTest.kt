package com.daylight.share

import androidx.core.content.pm.ShortcutManagerCompat
import androidx.test.core.app.ApplicationProvider
import com.daylight.share.core.Pairing
import com.daylight.share.sender.Shared
import com.daylight.share.sender.Shortcuts
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

/**
 * F08 (LAB-PLAN 3.3; card K4): your Daylight in the share sheet's Direct Share row. One long-lived dynamic shortcut,
 * id "daylight", pushed on a send with the Daylight's name (short label cut to 10 characters with "…"), updated when
 * the name changes, removed on Unpair, when Lab or F08's Use switch goes off and in the Inbox role; `shortcuts.xml`
 * makes its category a share target of the share activity.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ShortcutsTest {
    private val app: App = ApplicationProvider.getApplicationContext()
    private val relay = FakeRelay()

    @After
    fun tearDown() = PhoneKit.reset()

    private fun shortcut() = ShortcutManagerCompat.getDynamicShortcuts(app).singleOrNull { it.id == Shortcuts.ID }

    private fun send(url: String) = runBlocking { app.sender.add(Shared.Link(url, null)) }

    private fun settle() = Thread.sleep(300) // the Lab and role collectors run on the app's scope

    @Test
    fun aSendPushesTheShortcutWithTheDaylightsName() {
        PhoneKit.phone(app, relay)
        assertEquals(null, shortcut())
        send("https://example.com/one")
        val s = shortcut()!!
        assertEquals("Kitchen D…", s.shortLabel.toString())
        assertEquals("Kitchen Daylight", s.longLabel.toString())
        assertTrue(s.categories!!.contains(Shortcuts.CATEGORY))
        assertTrue(s.isLongLived)

        // A new name (the same Daylight): the labels follow.
        app.sender.pair(Pairing(LabKit.vectorPairing.secret, LabKit.vectorPairing.relay, "Den"))
        assertEquals("Den", shortcut()!!.shortLabel.toString())
    }

    @Test
    fun theShortLabelIsCutAtTenCharacters() {
        assertEquals("Daylight", Shortcuts.shortLabel("Daylight"))
        assertEquals("ABCDEFGHIJ", Shortcuts.shortLabel("ABCDEFGHIJ"))
        assertEquals("ABCDEFGHI…", Shortcuts.shortLabel("ABCDEFGHIJK"))
    }

    @Test
    fun unpairLabOffAndTheUseSwitchRemoveIt() {
        PhoneKit.phone(app, relay)
        send("https://example.com/a")
        assertTrue(Shortcuts.exists(app))
        app.sender.unpair()
        assertFalse("Unpair removes it", Shortcuts.exists(app))

        app.sender.pair(LabKit.vectorPairing)
        send("https://example.com/b")
        assertTrue(Shortcuts.exists(app))
        app.setLab(false)
        settle()
        assertFalse("Lab off removes it", Shortcuts.exists(app))
        send("https://example.com/c")
        assertFalse("not pushed with Lab off", Shortcuts.exists(app))

        app.setLab(true)
        app.prefs.setLabUse("F08", false)
        send("https://example.com/d")
        assertFalse("not with F08's Use switch off", Shortcuts.exists(app))
        app.prefs.setLabUse("F08", true)
        send("https://example.com/e")
        assertTrue(Shortcuts.exists(app))

        app.setRole(Role.INBOX)
        settle()
        assertFalse("not in the Inbox role", Shortcuts.exists(app))
    }

    /** The share target in res/xml/shortcuts.xml: the share activity, the category, the types. */
    @Test
    fun theShareTargetIsDeclared() {
        val xml = app.resources.getXml(R.xml.shortcuts)
        var target: String? = null
        val categories = ArrayList<String>()
        val types = ArrayList<String>()
        val ns = "http://schemas.android.com/apk/res/android"
        while (xml.next() != XmlPullParser.END_DOCUMENT) {
            if (xml.eventType != XmlPullParser.START_TAG) continue
            when (xml.name) {
                "share-target" -> target = xml.getAttributeValue(ns, "targetClass")
                "category" -> categories += xml.getAttributeValue(ns, "name")
                "data" -> types += xml.getAttributeValue(ns, "mimeType")
            }
        }
        assertEquals("com.daylight.share.sender.ShareActivity", target)
        assertEquals(listOf(Shortcuts.CATEGORY), categories)
        assertTrue(types.containsAll(listOf("text/plain", "application/pdf", "application/epub+zip", "*/*")))
    }
}
