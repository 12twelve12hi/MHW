package com.daylight.share

import androidx.activity.compose.setContent
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.Pairing
import com.daylight.share.core.Relay
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabFrame
import com.daylight.share.core.lab.LabInboxInfo
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.server.FileServerStore
import com.daylight.share.core.server.ServerCode
import com.daylight.share.core.server.ServerKeys
import com.daylight.share.core.server.ServerMessages
import com.daylight.share.ui.DaylightTheme
import com.daylight.share.ui.LAB_NOTE_TAG
import com.daylight.share.ui.LabOneTimeNote
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
import java.io.File

/**
 * What's in Lab, the needs-setup notes and the Daylight server section (LAB-PLAN 1.4, 1.5, 2.6; F00.3, F00.5, F00.6,
 * F17.2), both roles, against a relay in memory with no Daylight server deployed: short states without a tap; a tap on
 * a feature that is not set up shows exactly its sentence under it, announced, never greyed out, with OK and "Copy
 * Server code"; offline, or with a relay that never answers, the OFFLINE sentence within 5 s; the Server code equals the
 * server vectors' and Copy puts it on the clipboard; a sender that never heard a hello says "Needs Lab on your
 * Daylight" and keeps "Delivered ✓"; the one-time note and the re-pairing card.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class LabNoteTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App
    private val relay = FakeRelay()
    private val androidName = LabText.appName("android")

    /** The phone, paired with the server vectors' pairing (on ntfy.sh, all of it in memory). */
    private fun vectorPhone() {
        LabKit.useRelay(app, relay)
        app.prefs.askedNotifications = true
        app.prefs.deviceName = "Test phone"
        app.prefs.labNoteShown = true // the phone's one-time note (K4) is LabOneTimeNote's test, below
        app.sender.pair(LabKit.vectorPairing)
        app.setRole(Role.SENDER)
        compose.waitForIdle()
    }

    private fun openSettings() {
        compose.onNodeWithText("Settings").performClick()
        compose.waitForIdle()
    }

    private fun waitForText(text: String, ms: Long = 10_000) =
        compose.waitUntil(ms) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun openWhatsInLab(short: String) {
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").performClick()
        waitForText(short)
    }

    private fun row(feature: String) = compose.onNode(hasText(LabText.featureName(feature)) and hasClickAction())

    private fun notes() = compose.onAllNodes(hasTestTag(LAB_NOTE_TAG)).fetchSemanticsNodes()

    private fun politeness(text: String): LiveRegionMode? =
        compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion)

    // ----------------------------------------------------------------------------------------------- what's in Lab

    @Test
    fun serverFeaturesShowShortStatesAndExplainThemselvesWhenTapped() {
        vectorPhone()
        openSettings()
        openWhatsInLab(LabText.serverHeadingShort("needs-server"))
        compose.onNodeWithText(LabText.SERVER_HEADING).assertIsDisplayed()
        // F17.2: no hello heard yet.
        // The header line (F01's row says the same as its short state).
        compose.onNode(hasText(LabText.short("needs-inbox")!!) and !hasClickAction()).assertIsDisplayed()
        // Every server feature, never greyed out; each row's state is the heading's, so none shows its own.
        for (id in LabText.SERVER_FEATURE_ORDER) {
            row(id).assertIsDisplayed().assertIsEnabled()
            compose.onNode(hasText(LabText.featureSentence(id)!!, substring = true) and hasClickAction()).assertIsDisplayed()
        }
        assertTrue("no note before a tap", notes().isEmpty())

        // A tap: exactly the needs-server sentence, under the row, announced, with Copy Server code and OK.
        row("F37").performClick()
        val sentence = LabText.needsMessage("needs-server", app = androidName, platform = "android")!!
        waitForText(sentence, 6_000)
        assertEquals(1, notes().size)
        assertEquals(LiveRegionMode.Polite, politeness(sentence))
        val rowBox = row("F37").fetchSemanticsNode().boundsInRoot
        val noteBox = notes().single().boundsInRoot
        val next = row("F19").fetchSemanticsNode().boundsInRoot
        assertTrue("the note is directly under the tapped row", noteBox.top >= rowBox.bottom - 1 && noteBox.bottom <= next.top + 1)
        compose.onNodeWithText(LabText.button("needs-server")!!).performClick()
        compose.waitForIdle()
        assertEquals(LabKit.vectorServerCode, LabKit.clipboard(app))
        compose.onNodeWithText(LabText["setup.copied"]).assertIsDisplayed()
        compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
        compose.waitForIdle()
        assertTrue("OK closes it", notes().isEmpty())

        // Another control closes a note: one note at a time, under the row tapped last.
        row("F02").performClick()
        waitForText(sentence, 6_000)
        row("F36").performClick()
        compose.waitUntil(6_000) { notes().size == 1 && notes().single().boundsInRoot.top >= row("F36").fetchSemanticsNode().boundsInRoot.bottom - 1 }
        // Leaving the screen closes it.
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
        assertTrue(notes().isEmpty())
    }

    /** F00.6: offline, the OFFLINE sentence; a relay that never answers gives OFFLINE at 5 s, saying "Checking…" first. */
    @Test
    fun anUnreachableServerIsOfflineWithinFiveSeconds() {
        vectorPhone()
        relay.offline = true
        openSettings()
        openWhatsInLab(LabText.serverHeadingShort("OFFLINE"))
        val offline = ServerMessages.STATE_MESSAGES.getValue("OFFLINE")
        row("F37").performClick()
        waitForText(offline, 6_000)

        relay.offline = false
        relay.hangMs = 20_000
        compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
        val start = System.currentTimeMillis()
        row("F02").performClick()
        waitForText(LabText.CHECKING, 3_000)
        waitForText(offline, 9_000)
        val took = System.currentTimeMillis() - start
        assertTrue("OFFLINE after the 5 s deadline, not later: $took ms", took in 4_500..8_000)
    }

    /** The Inbox: the server lane comes in Wave S, so every server feature is "Not set up" and says how to set it up. */
    @Test
    fun theInboxListsTheServerFeaturesAsNotSetUp() {
        LabKit.useRelay(app, relay)
        MainScreen.INBOX.prepare(app)
        MainScreen.INBOX.open(compose)
        openSettings()
        waitForText(LabText.serverRowSubtitle("needs-server"))
        openWhatsInLab(LabText.serverHeadingShort("needs-server"))
        assertTrue("no header line on the Daylight itself", compose.onAllNodes(hasText(LabText.short("needs-inbox")!!)).fetchSemanticsNodes().isEmpty())
        row("F36").performClick()
        val sentence = LabText.needsMessage("needs-server", platform = "inbox")!!
        waitForText(sentence, 6_000)
        compose.onNodeWithText(LabText.button("needs-server")!!).performClick()
        val p = app.inbox.ensurePairing()
        assertEquals(ServerCode.format(ServerCode.deriveSeed(p.secret), Relay.normalize(p.relay)), LabKit.clipboard(app))
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("${LabText.SERVER_ROW} ›", substring = true).performClick()
        waitForText(ServerMessages.STATE_MESSAGES.getValue("needs-server"))
        compose.onNodeWithText(app.lab.serverCode()).assertIsDisplayed()
        compose.onNodeWithText(ServerMessages.RERUN_HELP).assertIsDisplayed()
    }

    // ------------------------------------------------------------------------------------------ the server section

    /** F00.5: the Server code shown for the vector pairing equals the server vectors', and Copy puts it on the clipboard. */
    @Test
    fun theServerSectionShowsTheServerCodeAndCopiesIt() {
        vectorPhone()
        openSettings()
        waitForText(LabText.serverRowSubtitle("needs-server"))
        compose.onNodeWithText("${LabText.SERVER_ROW} ›", substring = true).performClick()
        waitForText(LabKit.vectorServerCode)
        // Where setup happens: the long text, with the secrets' names, and the re-run help.
        compose.onNodeWithText(ServerMessages.STATE_MESSAGES.getValue("needs-server")).assertIsDisplayed()
        compose.onNodeWithText(ServerMessages.RERUN_HELP).assertIsDisplayed()
        compose.onNodeWithText(ServerCode.showFingerprint((LabKit.serverVectors["derived"] as Map<*, *>)["fingerprint"] as String), substring = true).assertIsDisplayed()
        compose.onNodeWithText(LabText["serverSection.copy"]).performClick()
        compose.waitForIdle()
        assertEquals(LabKit.vectorServerCode, LabKit.clipboard(app))
        compose.onNodeWithText(LabText["setup.copied"]).assertIsDisplayed()
    }

    /**
     * 2.6 "The rest of the server section's copy": every line in LAB_TEXT.serverSection's words. While the server is
     * not set up, "Turn it on" and the five steps, numbered, pinned element by element against the Lab vectors' list
     * (never the joined string split on ","), then where every step is; "Your server" with hostLineText; "Delivery"
     * with the v1 line and then the v1 notice; the Server address field's placeholder, Save and footer.
     */
    @Test
    fun theServerSectionSpeaksLabTextsWords() {
        vectorPhone()
        openSettings()
        waitForText(LabText.serverRowSubtitle("needs-server"))
        compose.onNodeWithText("${LabText.SERVER_ROW} ›", substring = true).performClick()
        waitForText(LabKit.vectorServerCode)

        // Not set up: "Turn it on" and the five steps, numbered, as the vectors' list has them.
        val steps = (((LabKit.labVectors["labText"] as Map<*, *>)["serverSection"] as Map<*, *>)["steps"] as List<*>).map { it as String }
        assertEquals(5, steps.size)
        assertEquals(steps, LabText.SERVER_STEPS)
        compose.onNodeWithText(LabText["serverSection.stepsHeading"]).assertIsDisplayed()
        steps.forEachIndexed { i, step -> compose.onNodeWithText("${i + 1}. $step").assertIsDisplayed() }
        compose.onNodeWithText(LabText["serverSection.stepsMore"]).assertIsDisplayed()
        // Step 2 is the server module's re-run help, word for word.
        assertEquals(ServerMessages.RERUN_HELP, steps[1])
        // No server found yet: "Your server" is the fingerprint alone, and there is no Delivery line.
        val derived = LabKit.serverVectors["derived"] as Map<*, *>
        val fingerprint = ServerCode.showFingerprint(derived["fingerprint"] as String)
        compose.onNodeWithText(LabText["serverSection.hostLabel"]).assertIsDisplayed()
        compose.onNodeWithText(LabText.hostLineText("", fingerprint)).assertIsDisplayed()
        assertTrue(compose.onAllNodes(hasText(LabText["serverSection.deliveryLabel"])).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithText(LabText["serverSection.addressFooter"]).assertIsDisplayed()
        compose.onNodeWithText(LabText["serverSection.addressSave"]).assertIsDisplayed()
        // The placeholder shows in the focused, empty field.
        compose.onNode(hasSetTextAction()).performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        compose.onNodeWithText(LabText["serverSection.addressPlaceholder"]).assertExists()
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()

        // A server this pairing knows, with v1 delivery: "Your server" with its host, "Delivery" with the v1 line and
        // then the v1 notice; the steps go (its state is no longer needs-server).
        val origin = "https://daylight-0123456789ab.example.workers.dev"
        FileServerStore(File(app.filesDir, "server.json")).set(
            ServerKeys.CONFIG,
            linkedMapOf("server" to origin, "api" to ServerCode.SERVER_API, "fingerprint" to derived["fingerprint"], "delivery" to "v1", "sent" to "2026-10-22T08:00:00.000Z", "id" to "c1"),
        )
        compose.onNodeWithText("${LabText.SERVER_ROW} ›", substring = true).performClick()
        waitForText(LabText.hostLineText(origin, fingerprint))
        compose.onNodeWithText(LabText["serverSection.deliveryLabel"]).assertIsDisplayed()
        compose.onNodeWithText(LabText["serverSection.deliveryV1"]).assertIsDisplayed()
        compose.onNodeWithText(ServerMessages.noticeText("v1")!!).assertIsDisplayed()
        assertTrue(compose.onAllNodes(hasText(LabText["serverSection.stepsHeading"])).fetchSemanticsNodes().isEmpty())
    }

    // ------------------------------------------------------------------------------------------- F17.2 on the phone

    @Test
    fun aSenderThatNeverHeardAHelloShowsDeliveredAndNeedsLabOnTheDaylight() {
        vectorPhone()
        val p = LabKit.vectorPairing
        val now = System.currentTimeMillis()
        FileOutboxStore(File(app.filesDir, "outbox/${p.keys.inboxTopic}")).save(ScreenKit.outboxRows(now).filter { it.status == Status.DELIVERED }, "all")
        runBlocking { app.sender.refresh() }
        compose.waitForIdle()
        compose.onNodeWithText("Delivered ✓").assertIsDisplayed()
        openSettings()
        openWhatsInLab(LabText.serverHeadingShort("needs-server"))
        // The header line (F01's row says the same as its short state).
        compose.onNode(hasText(LabText.short("needs-inbox")!!) and !hasClickAction()).assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()

        // The Daylight turns Lab on: its hello reaches the ack topic, and What's in Lab says so when it opens again.
        relay.publish(p.keys.ackTopic, LabFrame.build(p.keys, LabInboxInfo(1, "android/1.0.99", listOf("st", "tap"), poll = now)))
        openWhatsInLab(LabText.inboxLabText(true, now, now))
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
        // W1's timeline (F01, K4): a Daylight with Lab on and no state yet for the row reads "On your Daylight ✓".
        compose.waitUntil(5_000) { compose.onAllNodes(hasText(LabText["rows.delivered.label"])).fetchSemanticsNodes().isNotEmpty() }
    }

    // ------------------------------------------------------------------------------------- the switch and its card

    @Test
    fun turningLabOffLeavesOnlyTheSwitch() {
        vectorPhone()
        openSettings()
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").assertIsDisplayed()
        compose.onNode(isToggleable() and hasText(LabText.SWITCH_FOOTER)).performClick()
        compose.waitForIdle()
        assertFalse(app.prefs.lab)
        compose.onNode(isToggleable() and hasText(LabText.SWITCH_FOOTER)).assertIsOff()
        assertTrue(compose.onAllNodes(hasText("${LabText.WHATS_IN_LAB} ›")).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodes(hasText("${LabText.SERVER_ROW} ›", substring = true)).fetchSemanticsNodes().isEmpty())
        compose.onNode(isToggleable() and hasText(LabText.SWITCH_FOOTER)).performClick()
        compose.waitForIdle()
        assertTrue(app.prefs.lab)
        compose.onNodeWithText("${LabText.WHATS_IN_LAB} ›").assertIsDisplayed()
    }

    /** 1.2: the one-time note shows only in a build with F01 or F04, once, until OK. */
    @Test
    fun theOneTimeNoteShowsOnceInABuildThatHasIt() {
        compose.runOnUiThread { compose.activity.setContent { DaylightTheme { LabOneTimeNote(app, enabled = false) } } }
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText(LabText.NOTE)).fetchSemanticsNodes().isEmpty())

        compose.runOnUiThread { compose.activity.setContent { DaylightTheme { LabOneTimeNote(app, enabled = true) } } }
        compose.waitForIdle()
        compose.onNodeWithText(LabText.NOTE).assertIsDisplayed()
        assertEquals(LiveRegionMode.Polite, politeness(LabText.NOTE))
        compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText(LabText.NOTE)).fetchSemanticsNodes().isEmpty())
        assertTrue(app.prefs.labNoteShown)
        compose.runOnUiThread { compose.activity.setContent { DaylightTheme { LabOneTimeNote(app, enabled = true) } } }
        compose.waitForIdle()
        assertTrue("once", compose.onAllNodes(hasText(LabText.NOTE)).fetchSemanticsNodes().isEmpty())
    }

    /**
     * 2.6 "Re-pairing" (DESIGN 12.7): re-pairing while a Daylight server is known shows the new Server code and the
     * re-run help on the phone until OK; with Lab off, nothing shows.
     */
    @Test
    fun rePairingWithAServerKnownShowsTheNewServerCode() {
        vectorPhone()
        FileServerStore(File(app.filesDir, "server.json")).set(ServerKeys.PIN, linkedMapOf("origin" to "https://daylight-0123456789ab.example.workers.dev", "fingerprint" to "5138e08d"))
        val next = Pairing(Pairing.generate().secret, ScreenKit.NOWHERE, "Office Daylight")
        compose.runOnUiThread { app.sender.pair(next) }
        compose.waitForIdle()
        val code = app.lab.serverCode()
        compose.onNodeWithText(ServerMessages.STATE_MESSAGES.getValue("locked")).assertIsDisplayed()
        compose.onNodeWithText(code).assertIsDisplayed()
        compose.onNodeWithText(ServerMessages.RERUN_HELP).assertIsDisplayed()

        app.setLab(false)
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText(ServerMessages.STATE_MESSAGES.getValue("locked"))).fetchSemanticsNodes().isEmpty())
        app.setLab(true)
        compose.waitForIdle()
        compose.onNodeWithText(ServerMessages.STATE_MESSAGES.getValue("locked")).assertIsDisplayed()
        compose.onNodeWithText(LabText.NOTE_BUTTON).performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText(ServerMessages.STATE_MESSAGES.getValue("locked"))).fetchSemanticsNodes().isEmpty())
        assertEquals(0L, app.prefs.labRepairedAt)
    }
}
