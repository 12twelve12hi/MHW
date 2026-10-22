package com.daylight.share

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.daylight.share.core.lab.LabText
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The first run of a build with Lab (LAB-PLAN F00.1, F00.7), both roles: Lab is on, the one-time note shows only in
 * a build whose role has F01 or F04 (the phone from K4; not the Inbox yet), an upgrade keeps its pairing and history, and nothing on any screen reachable without tapping a Lab feature or
 * opening the Daylight server section names a secret or says how to set something up. What's in Lab shows short states
 * only. No server is deployed: the relay (in memory) has nothing on the server's config topic.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class LabFirstRunTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()

    private fun assertNoSetupWords(where: String) {
        compose.waitForIdle()
        val found = LabKit.setupWords(compose)
        assertTrue("$where says how to set something up before anything was tapped:\n${found.joinToString("\n")}", found.isEmpty())
    }

    private fun openSettings() {
        compose.onNodeWithText("Settings").performClick()
        compose.waitForIdle()
    }

    /** Opens What's in Lab from Settings and waits until the server's short state is under its heading. */
    private fun openWhatsInLab(short: String) {
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText(short)).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun back() {
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
    }

    @Test
    fun aFreshInstallHasLabOnAndTheNoteShowsWhereTheBuildHasF01OrF04() {
        LabKit.useRelay(app, relay)
        assertTrue(app.prefs.lab)
        assertTrue(app.getSharedPreferences("daylight-share", Context.MODE_PRIVATE).contains("lab"))
        assertFalse(app.prefs.labNoteShown)
        // The phone's W1 build has F01 and F04 (K4), and so does the Inbox's (K5, which records what its senders'
        // timeline shows): the note shows in both roles until it is dismissed.
        MainScreen.SENDER.prepare(app)
        MainScreen.SENDER.open(compose)
        compose.onNodeWithText(LabText.NOTE).assertIsDisplayed()
        MainScreen.INBOX.prepare(app)
        MainScreen.INBOX.open(compose)
        compose.onNodeWithText(LabText.NOTE).assertIsDisplayed()
        openSettings()
        compose.onNode(isToggleable() and hasText(LabText.SWITCH_FOOTER)).assertIsOn()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").assertIsDisplayed()
        compose.onNodeWithText("${LabText.SERVER_ROW} ›", substring = true).assertIsDisplayed()
    }

    /** An upgrade from the last non-Lab build: its first start turns Lab on and keeps the pairing and the history. */
    @Test
    fun anUpgradeKeepsThePairingAndTheHistory() {
        LabKit.useRelay(app, relay)
        MainScreen.SENDER.prepare(app)
        val rows = app.sender.rows.value.map { it.id }
        assertTrue(rows.isNotEmpty())
        // The last non-Lab build had no Lab key.
        app.getSharedPreferences("daylight-share", Context.MODE_PRIVATE).edit().remove("lab").commit()
        val prefs = Prefs(app)
        assertTrue(prefs.ensureLabDefault())
        assertTrue(prefs.lab)
        assertTrue("a W1 build shows the note after an upgrade too", prefs.labNoteDue())
        assertFalse("a W0 build shows none", prefs.labNoteDue(enabled = false))
        assertTrue(prefs.senderPairing()!!.sameSecret(ScreenKit.senderPairing))
        runBlocking { app.sender.refresh() }
        assertEquals(rows, app.sender.rows.value.map { it.id })
    }

    /** F00.7 on the phone, paired and not: its screens, Settings and What's in Lab. */
    @Test
    fun thePhoneSaysNothingAboutSetupUntilAskedTo() {
        LabKit.useRelay(app, relay)
        MainScreen.SENDER_UNPAIRED.prepare(app)
        MainScreen.SENDER_UNPAIRED.open(compose)
        assertNoSetupWords("the phone, unpaired")
        openSettings()
        assertNoSetupWords("Settings, unpaired")
        openWhatsInLab(LabText.serverHeadingShort("needs-pairing"))
        assertNoSetupWords("What's in Lab, unpaired")
        back()
        back()

        MainScreen.SENDER.prepare(app)
        compose.waitForIdle()
        assertNoSetupWords("the phone, paired")
        openSettings()
        compose.waitUntil(10_000) {
            compose.onAllNodes(hasText(LabText.serverRowSubtitle("needs-server"))).fetchSemanticsNodes().isNotEmpty()
        }
        assertNoSetupWords("Settings, paired")
        openWhatsInLab(LabText.serverHeadingShort("needs-server"))
        assertNoSetupWords("What's in Lab, paired")
        // Every server feature is listed, as LAB-DECISIONS asks, with nothing but its name and sentence.
        for (id in LabText.SERVER_FEATURE_ORDER) compose.onNodeWithText(LabText.featureName(id), substring = true).assertIsDisplayed()
    }

    /** F00.7 on the DC-1 Inbox: its screens, Settings and What's in Lab. */
    @Test
    fun theInboxSaysNothingAboutSetupUntilAskedTo() {
        LabKit.useRelay(app, relay)
        MainScreen.INBOX_NEW.prepare(app)
        MainScreen.INBOX_NEW.open(compose)
        assertNoSetupWords("the Inbox, new")
        MainScreen.INBOX.prepare(app)
        compose.waitForIdle()
        assertNoSetupWords("the Inbox")
        openSettings()
        compose.waitUntil(10_000) {
            compose.onAllNodes(hasText(LabText.serverRowSubtitle("needs-server"))).fetchSemanticsNodes().isNotEmpty()
        }
        assertNoSetupWords("the Inbox's Settings")
        openWhatsInLab(LabText.serverHeadingShort("needs-server"))
        assertNoSetupWords("the Inbox's What's in Lab")
    }

    /** The check sees what it looks for: a needs-setup sentence and a secret's name. */
    @Test
    fun theSetupWordsCheckSeesSetupWords() {
        val sentence = LabText.needsMessage("needs-server", platform = "android")!!
        assertTrue(LabKit.setupSentences.any { sentence.contains(it) })
        assertTrue(LabKit.setupSentences.any { com.daylight.share.core.server.ServerMessages.STATE_MESSAGES.getValue("needs-key").contains(it) })
        assertFalse(LabKit.setupSentences.any { LabText.serverHeadingShort("needs-server").contains(it) })
        assertFalse(LabKit.setupSentences.any { LabText.SWITCH_FOOTER.contains(it) })
    }
}
