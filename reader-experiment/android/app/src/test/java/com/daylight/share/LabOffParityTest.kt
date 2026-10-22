package com.daylight.share

import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import com.daylight.share.ui.DaylightTheme
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.Section
import com.daylight.share.ui.SwitchRow
import com.daylight.share.ui.TextAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Lab-off parity (LAB-PLAN 1.7, F00.2): with Lab off, what a screen reader gets from each main screen (the Compose
 * semantics tree: types, labels and values, in order) equals the baseline recorded from the last non-Lab build, the
 * P0 close-out (protocol 1.1 and the F27 baseline with Comfort). Comfort is off and the text at its usual size.
 *
 * The baselines are `src/test/lab-off-baseline/<screen>.json`. They change only together with a non-Lab change of the
 * screen; then the test writes the new tree to `build/lab-off-baseline/` (also when one is missing) to review and copy
 * over. While the folder has no baseline at all, a screen without one is recorded and skipped; once it has any, every
 * screen must have one. The Lab switch's card (test tag "lab-switch", [ScreenKit.LAB_SWITCH_TAG]) is the one thing Lab
 * off adds: it is left out of the compared tree, and checked to hold only the switch, off (LAB-PLAN 1.1).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h6000dp")
class LabOffParityTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: App get() = compose.activity.application as App

    @Test fun roleChoice() = compare(MainScreen.ROLE_CHOICE)
    @Test fun senderUnpaired() = compare(MainScreen.SENDER_UNPAIRED)
    @Test fun sender() = compare(MainScreen.SENDER)
    @Test fun senderSettings() = compare(MainScreen.SENDER_SETTINGS)
    @Test fun inboxNew() = compare(MainScreen.INBOX_NEW)
    @Test fun inbox() = compare(MainScreen.INBOX)
    @Test fun inboxSettings() = compare(MainScreen.INBOX_SETTINGS)

    private fun compare(screen: MainScreen) {
        ScreenKit.labOff(app)
        screen.prepare(app)
        screen.open(compose)
        val actual = stableTree()
        ScreenKit.labCard(compose.onRoot().fetchSemanticsNode())?.let { card ->
            val problems = ScreenKit.labOffCardProblems(card, ScreenKit.labText("lab"), ScreenKit.labText("switchFooter"))
            if (problems.isNotEmpty()) fail("${screen.file}: with Lab off, only the Lab switch shows (LAB-PLAN 1.1):\n${problems.joinToString("\n")}")
        }
        val dir = File(System.getProperty("dls.labOffBaselines") ?: error("dls.labOffBaselines not set"))
        val file = File(dir, "${screen.file}.json")
        if (!file.isFile) {
            val recorded = record(screen, actual)
            val any = dir.listFiles { f -> f.extension == "json" }.orEmpty().isNotEmpty()
            if (any) fail("No Lab-off baseline for ${screen.file}: ${file.path} is missing. This run's tree is in $recorded.")
            println("lab-off-baseline: recorded ${screen.file} into $recorded (no baselines committed yet)")
            assumeTrue("no Lab-off baselines yet; recorded ${screen.file} into $recorded", false)
        }
        val expected = file.readText().replace("\r\n", "\n")
        if (expected != actual) {
            val recorded = record(screen, actual)
            fail("${screen.file} differs from its Lab-off baseline (${file.path}); this run's tree is in $recorded.\n${diff(expected, actual)}")
        }
    }

    /**
     * The Lab card check sees what the comparison leaves out: with Lab off, the card may hold the switch (and its
     * footer, or a title "Lab"), but not "What's in Lab ›" or anything else.
     */
    @Test
    fun theLabCardMayHoldOnlyTheSwitch() {
        val lab = ScreenKit.labText("lab")
        val footer = ScreenKit.labText("switchFooter")
        val more = mutableStateOf(false)
        val on = mutableStateOf(false)
        compose.runOnUiThread {
            compose.activity.setContent {
                DaylightTheme {
                    Column {
                        Section(lab, Modifier.testTag(ScreenKit.LAB_SWITCH_TAG)) {
                            SwitchRow(lab, on.value, detail = footer) { }
                            if (more.value) TextAction("What’s in Lab ›") { }
                        }
                        SwitchRow("Comfort", false) { }
                    }
                }
            }
        }
        fun problems(): List<String> {
            compose.waitForIdle()
            val root = compose.onRoot().fetchSemanticsNode()
            val tree = ScreenKit.tree(root)
            assertEquals("the card is left out of the compared tree", listOf("Comfort"), tree.map { it.label })
            return ScreenKit.labOffCardProblems(ScreenKit.labCard(root)!!, lab, footer)
        }
        assertEquals(emptyList<String>(), problems())
        more.value = true
        // The problems quote nodes as JSON, with non-ASCII as \u escapes.
        assertTrue(problems().joinToString("\n"), problems().any { it.startsWith("shown with Lab off") && it.contains("\"Button\"") && it.contains("in Lab") })
        more.value = false
        on.value = true
        assertTrue(problems().joinToString("\n"), problems().any { it.startsWith("the Lab switch is not off") })
    }

    /**
     * The tree once it holds still: two snapshots a moment apart that agree, while the Inbox is not polling (its live
     * connection to the closed test relay retries now and then, which disables "Check now" for a moment).
     */
    private fun stableTree(): String {
        var last: String? = null
        repeat(20) {
            compose.waitForIdle()
            val tree = ScreenKit.toJson(ScreenKit.tree(compose.onRoot().fetchSemanticsNode()))
            if (tree == last && !app.inbox.sync.value.checking) return tree
            last = tree
            Thread.sleep(150)
        }
        error("the tree did not hold still:\n$last")
    }

    private fun record(screen: MainScreen, tree: String): File {
        val out = File(System.getProperty("dls.labOffRecorded") ?: "build/lab-off-baseline", "${screen.file}.json")
        out.parentFile?.mkdirs()
        out.writeText(tree)
        return out
    }

    /** The first lines that differ, with their numbers. */
    private fun diff(expected: String, actual: String): String {
        val e = expected.lines()
        val a = actual.lines()
        val out = ArrayList<String>()
        for (i in 0 until maxOf(e.size, a.size)) {
            val x = e.getOrNull(i)
            val y = a.getOrNull(i)
            if (x != y) {
                out += "line ${i + 1}:\n  baseline: ${x ?: "(none)"}\n  now:      ${y ?: "(none)"}"
                if (out.size >= 8) break
            }
        }
        return out.joinToString("\n")
    }
}
