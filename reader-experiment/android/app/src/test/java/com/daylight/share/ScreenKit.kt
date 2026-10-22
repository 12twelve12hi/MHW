package com.daylight.share

import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.ext.junit.rules.ActivityScenarioRule
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Pairing
import com.daylight.share.core.Status
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxText
import com.daylight.share.inbox.Path
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.robolectric.Shadows.shadowOf
import java.io.File

/** The compose rule of the screen tests: the real app's MainActivity. */
typealias AppRule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

/**
 * The app's main screens in fixed states, for the screen tests (F27) and the Lab-off parity baselines (LAB-PLAN 1.7):
 * the same pairings, rows and items every run, and nothing that sends or hands over while a test looks. Each screen is
 * shown by the real app ([MainActivity] and its Root): [prepare] sets the app's state, [open] navigates.
 */
enum class MainScreen(val file: String) {
    ROLE_CHOICE("role-choice"),
    SENDER_UNPAIRED("sender-unpaired"),
    SENDER("sender"),
    SENDER_SETTINGS("sender-settings"),
    INBOX_NEW("inbox-new"),
    INBOX("inbox"),
    INBOX_SETTINGS("inbox-settings");

    val inbox: Boolean get() = name.startsWith("INBOX")

    /** Sets the app's state for this screen (the activity is already up, on the role choice). */
    fun prepare(app: App) {
        app.prefs.askedNotifications = true // no permission prompt over the screen
        when (this) {
            ROLE_CHOICE -> Unit
            SENDER_UNPAIRED -> {
                app.prefs.deviceName = "Test phone"
                app.setRole(Role.SENDER)
            }
            SENDER, SENDER_SETTINGS -> {
                app.prefs.deviceName = "Test phone"
                app.sender.pair(ScreenKit.senderPairing)
                ScreenKit.writeOutbox(app, ScreenKit.outboxRows(System.currentTimeMillis()))
                app.setRole(Role.SENDER)
                runBlocking { app.sender.refresh() }
            }
            INBOX_NEW, INBOX, INBOX_SETTINGS -> {
                ScreenKit.installReader(app)
                app.prefs.deviceName = "Test Daylight"
                app.prefs.inboxRelay = ScreenKit.NOWHERE
                app.prefs.inboxRelayChecked = ScreenKit.NOWHERE // no background relay check
                app.inbox.usePairing(ScreenKit.inboxPairing)
                if (this != INBOX_NEW) ScreenKit.inboxItems(System.currentTimeMillis()).forEach(app.inbox::put)
                app.setRole(Role.INBOX)
            }
        }
    }

    /** Navigates to this screen once the app shows its role's home screen. */
    fun open(compose: AppRule) {
        compose.waitForIdle()
        if (this == SENDER_SETTINGS || this == INBOX_SETTINGS) {
            compose.onNodeWithText("Settings").performClick()
            compose.waitForIdle()
        }
    }
}

object ScreenKit {
    const val NOWHERE = "http://127.0.0.1:9"
    private const val MIN = 60_000L
    private const val DAY = 86_400_000L

    /** The largest font scale Android offers (Settings › Display › Font size): 200 %. */
    const val LARGEST_FONT_SCALE = 2.0f

    val senderPairing = Pairing(ByteArray(16) { (it + 1).toByte() }, NOWHERE, "Kitchen Daylight")
    val inboxPairing = Pairing(ByteArray(16) { (0x40 + it).toByte() }, NOWHERE, "Test Daylight")

    fun id(n: Int): String = "%032x".format(n)

    /** One outbox row in every state of CHANGES-v1.1 2.5, none of them due for a re-send while a test runs. */
    fun outboxRows(now: Long): List<OutboxRow> {
        fun header(n: Int, kind: String, title: String, name: String? = null, size: Long = 120_000L) = ItemHeader(
            id = id(n), kind = kind, url = if (kind == Kind.FILE) null else "https://example.com/item-$n", title = title,
            name = name, mime = when (kind) {
                Kind.PAGE -> "text/html"
                Kind.FILE -> "application/pdf"
                else -> null
            },
            size = if (kind == Kind.URL) null else size, sha256 = if (kind == Kind.URL) null else "0".repeat(64),
            sent = "2026-10-20T10:00:00.000Z", from = "Test phone", app = "android/test",
        )
        return listOf(
            OutboxRow(header(1, Kind.URL, "A link being sent"), created = now - MIN, status = Status.SENDING, attemptStarted = now),
            OutboxRow(header(2, Kind.PAGE, "A page on its way"), created = now - 2 * MIN, status = Status.SENT, lastPublish = now),
            OutboxRow(header(3, Kind.FILE, "Delivered paper", "paper.pdf", 123_456), created = now - 3 * MIN, status = Status.DELIVERED, lastPublish = now - 2 * MIN, delivered = now - MIN, deliveredBy = "Kitchen Daylight", attachment = true),
            OutboxRow(header(4, Kind.URL, "Offline when shared"), created = now - 4 * MIN, status = Status.FAILED, errorCode = "network", attempts = 1, lastPublish = now),
            OutboxRow(header(5, Kind.FILE, "Big report", "report.pdf", 8_000_000), created = now - 5 * MIN, status = Status.FAILED, errorCode = "full", slowFails = 1, attempts = 1, lastPublish = now, attachment = true),
            OutboxRow(header(6, Kind.PAGE, "Refused page"), created = now - 6 * MIN, status = Status.FAILED, errorCode = "refused", slowFails = 1, attempts = 1, lastPublish = now),
            OutboxRow(header(7, Kind.URL, "Waiting for a while"), created = now - 2 * DAY, status = Status.SENT, lastPublish = now),
            OutboxRow(header(8, Kind.URL, "Never picked up"), created = now - 2 * DAY - MIN, status = Status.EXPIRED, lastPublish = now - DAY),
            OutboxRow(header(9, Kind.FILE, "Too much at once", "slides.pdf"), created = now - 2 * DAY - 2 * MIN, status = Status.EXPIRED, errorCode = "full", slowFails = 3, lastPublish = now - DAY, attachment = true),
            OutboxRow(header(10, Kind.URL, "Turned down"), created = now - 2 * DAY - 3 * MIN, status = Status.EXPIRED, errorCode = "refused", slowFails = 3, lastPublish = now - DAY),
            OutboxRow(header(11, Kind.FILE, "A huge book", "book.pdf", 14_200_000), created = now - 2 * DAY - 4 * MIN, status = Status.EXPIRED, errorCode = "too-large"),
            OutboxRow(header(12, Kind.FILE, "Gone from this phone", "gone.pdf"), created = now - 2 * DAY - 5 * MIN, status = Status.EXPIRED, errorCode = "gone", lastPublish = now - DAY),
        )
    }

    fun writeOutbox(app: App, rows: List<OutboxRow>) {
        FileOutboxStore(File(app.filesDir, "outbox/${senderPairing.keys.inboxTopic}")).save(rows.sortedByDescending { it.created }, "all")
    }

    /** Received items in the states the Inbox shows once the Reader has had them (none waits: nothing hands over). */
    fun inboxItems(now: Long): List<InboxItem> {
        val received = now - 90 * MIN
        return listOf(
            InboxItem(id(105), Kind.FILE, name = "notes.epub", mime = "application/epub+zip", title = "Notes", size = 45_000, from = "Mac", received = received, file = "${id(105)}/notes.epub", state = InboxItem.OPEN),
            InboxItem(id(104), Kind.URL, url = "https://example.com/shared", title = "A shared link", from = "iPhone", received = received, state = InboxItem.IN_READER, deliveredTo = ReaderApps.MAIN, via = Path.SEND_LINK.key, readerStatus = "ok", handedAt = received),
            InboxItem(id(103), Kind.FILE, name = "paper.pdf", mime = "application/pdf", title = "Paper", size = 123_456, from = "iPhone", received = received, file = "${id(103)}/paper.pdf", state = InboxItem.IN_READER, deliveredTo = ReaderApps.MAIN, via = Path.SEND_FILE.key, readerStatus = "sent", handedAt = received),
            InboxItem(id(102), Kind.PAGE, url = "https://example.com/page", title = "A page as you saw it", size = 50_000, from = "Mac", received = received, state = InboxItem.IN_READER, deliveredTo = ReaderApps.MAIN, via = Path.SAVE_PAGE.key, readerStatus = "duplicate", handedAt = received),
            InboxItem(id(101), Kind.URL, url = "https://example.com/article", title = "An article", from = "iPhone", received = received, state = InboxItem.IN_READER, deliveredTo = ReaderApps.MAIN, via = Path.SAVE_PAGE.key, readerStatus = "saved", handedAt = received),
        )
    }

    /** The Daylight Reader as the hand-off tests model it: SAVE_PAGE, and ImportActivity for shared links and documents. */
    fun installReader(app: App) {
        val pm = shadowOf(app.packageManager)
        val main = ReaderApps.MAIN
        val save = ComponentName(main, "$main.SavePageActivity")
        pm.addActivityIfNotPresent(save)
        pm.addIntentFilterForActivity(save, IntentFilter(ReaderApps.ACTION_SAVE_PAGE).apply { addCategory(Intent.CATEGORY_DEFAULT) })
        val import = ComponentName(main, "$main.ImportActivity")
        pm.addActivityIfNotPresent(import)
        pm.addIntentFilterForActivity(import, IntentFilter().apply {
            addAction(Intent.ACTION_SEND)
            addAction(Intent.ACTION_SEND_MULTIPLE)
            addCategory(Intent.CATEGORY_DEFAULT)
            for (t in listOf("text/plain", "application/pdf", "application/epub+zip")) addDataType(t)
        })
    }

    /** Shows the app at the largest system font scale (linear: stricter than Android 14's non-linear scaling). */
    fun showAtLargestText(compose: AppRule) {
        compose.runOnUiThread {
            compose.activity.setContent { LargestText { compose.activity.AppContent() } }
        }
        compose.waitForIdle()
    }

    @Composable
    private fun LargestText(content: @Composable () -> Unit) {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, LARGEST_FONT_SCALE), content = content)
    }

    // ------------------------------------------------------------------------------------------ what the tests read

    /**
     * Every laid-out text (unmerged: each Text on its own) that is cut short or spills out of its box: the visual
     * overflow of F27.4, measured against the text's own box. ([TextLayoutResult.hasVisualOverflow] itself cannot be
     * read here: the semantics action lays the text out again at its constraint's full width, so a single line that is
     * narrower than its column always reads as overflowing.)
     */
    fun textOverflows(compose: AppRule): List<String> {
        val out = ArrayList<String>()
        val nodes = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true)
            .fetchSemanticsNodes()
        for (n in nodes) {
            val results = ArrayList<TextLayoutResult>()
            n.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
            for (r in results) {
                val widest = (0 until r.lineCount).maxOfOrNull { r.getLineRight(it) - r.getLineLeft(it) } ?: 0f
                val how = listOfNotNull(
                    if (r.multiParagraph.didExceedMaxLines) "is cut short after ${r.lineCount} lines" else null,
                    if (widest > r.size.width + 0.5f) "is ${widest.toInt()} px wide in a ${r.size.width} px box" else null,
                    if (r.multiParagraph.height > r.size.height + 0.5f) "is ${r.multiParagraph.height.toInt()} px tall in a ${r.size.height} px box" else null,
                )
                if (how.isNotEmpty()) out += "\"${r.layoutInput.text}\" ${how.joinToString(" and ")}"
            }
        }
        return out
    }

    /** Every control (merged tree) whose touch target is under [minDp] in either direction. */
    fun smallControls(compose: AppRule, minDp: Float): List<String> {
        val dp = compose.density.density
        return compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            .mapNotNull { n ->
                // The touch target: the node's box, or its layout's when minimumInteractiveComponentSize pads it.
                val w = maxOf(n.boundsInRoot.width, n.layoutInfo.width.toFloat()) / dp
                val h = maxOf(n.boundsInRoot.height, n.layoutInfo.height.toFloat()) / dp
                if (w < minDp - 0.5f || h < minDp - 0.5f) "${describe(n)?.label ?: "(no label)"}: $w x $h dp" else null
            }
    }

    /** Every control (merged tree: a button, a switch, a choice, a text field) without words for a screen reader. */
    fun unlabelledControls(compose: AppRule): List<String> =
        tree(compose.onRoot().fetchSemanticsNode()).filter { it.isControl && it.label.isNullOrBlank() }.map { it.toString() }

    /**
     * The Accessibility Test Framework's error rules, applied to the Compose semantics tree (the framework itself sees
     * only the Android views under Robolectric, not Compose's nodes): every control has words for a screen reader
     * (SpeakableTextPresentCheck), a touch target of at least [minTargetDp] (TouchTargetSizeCheck), its own place
     * (DuplicateClickableBoundsCheck), and a text field is named by its label, not a content description
     * (EditableContentDescCheck).
     */
    fun accessibilityProblems(compose: AppRule, minTargetDp: Float = 48f): List<String> {
        val out = ArrayList<String>()
        unlabelledControls(compose).forEach { out += "no label: $it" }
        smallControls(compose, minTargetDp).forEach { out += "touch target under $minTargetDp dp: $it" }
        compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            .groupBy { it.boundsInRoot.run { listOf(left, top, right, bottom).map { v -> v.toInt() } } }
            .filterValues { it.size > 1 }
            .forEach { (bounds, nodes) -> out += "controls on the same spot $bounds: ${nodes.map { describe(it)?.label }}" }
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.SetText)).fetchSemanticsNodes()
            .filter { !it.config.getOrNull(SemanticsProperties.ContentDescription).isNullOrEmpty() }
            .forEach { out += "text field with a content description: ${describe(it)?.label}" }
        return out
    }

    // ---------------------------------------------------------------------------- the semantics tree (LAB-PLAN 1.7)

    /**
     * One node of what a screen reader gets: its [type] (the role, or TextField, Clickable, List, Scroll, Image, Text),
     * its [label] (content description and texts, one per line), its [value] (state, selection, the field's text), and
     * whether it is disabled, announced when it changes ([live]) or a heading.
     */
    data class A11yNode(
        val type: String,
        val label: String?,
        val value: String?,
        val enabled: Boolean = true,
        val live: Boolean = false,
        val heading: Boolean = false,
    ) {
        val isControl: Boolean get() = type in CONTROL_TYPES

        fun toJson(): String {
            val fields = ArrayList<String>()
            fields += "\"type\": ${quote(type)}"
            label?.let { fields += "\"label\": ${quote(it)}" }
            value?.let { fields += "\"value\": ${quote(it)}" }
            if (!enabled) fields += "\"enabled\": false"
            if (live) fields += "\"live\": \"polite\""
            if (heading) fields += "\"heading\": true"
            return fields.joinToString(", ", "{", "}")
        }
    }

    private val CONTROL_TYPES = setOf("Button", "Checkbox", "Switch", "RadioButton", "Tab", "DropdownList", "TextField", "Clickable")

    /** Subtrees left out of the tree by test tag: the Lab switch card (K1), the one difference Lab off keeps. */
    val SKIPPED_TAGS = setOf("lab-switch")

    /** The merged semantics tree under [root], in traversal order, flattened; containers without words are left out. */
    fun tree(root: SemanticsNode): List<A11yNode> {
        val out = ArrayList<A11yNode>()
        fun walk(n: SemanticsNode) {
            if (n.config.getOrNull(SemanticsProperties.TestTag) in SKIPPED_TAGS) return
            describe(n)?.let(out::add)
            n.children.forEach(::walk)
        }
        walk(root)
        return out
    }

    fun describe(n: SemanticsNode): A11yNode? {
        val c = n.config
        val role = c.getOrNull(SemanticsProperties.Role)
        val texts = c.getOrNull(SemanticsProperties.Text)?.map { it.text }.orEmpty()
        val descriptions = c.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        val type = when {
            role != null -> role.toString()
            SemanticsActions.SetText in c -> "TextField"
            SemanticsActions.OnClick in c -> "Clickable"
            SemanticsProperties.CollectionInfo in c -> "List"
            SemanticsActions.ScrollBy in c -> "Scroll"
            descriptions.isNotEmpty() && texts.isEmpty() -> "Image"
            texts.isNotEmpty() || descriptions.isNotEmpty() -> "Text"
            else -> return null
        }
        val label = (descriptions + texts).filter { it.isNotEmpty() }.joinToString("\n") { scrub(it) }.ifEmpty { null }
        val values = ArrayList<String>()
        c.getOrNull(SemanticsProperties.StateDescription)?.let { values += it }
        when (c.getOrNull(SemanticsProperties.ToggleableState)) {
            ToggleableState.On -> values += "on"
            ToggleableState.Off -> values += "off"
            ToggleableState.Indeterminate -> values += "indeterminate"
            null -> Unit
        }
        c.getOrNull(SemanticsProperties.Selected)?.let { values += if (it) "selected" else "not selected" }
        c.getOrNull(SemanticsProperties.EditableText)?.let { values += scrub(it.text) }
        return A11yNode(
            type = type,
            label = label,
            value = values.joinToString(", ").ifEmpty { null },
            enabled = SemanticsProperties.Disabled !in c,
            live = c.getOrNull(SemanticsProperties.LiveRegion) != null,
            heading = SemanticsProperties.Heading in c,
        )
    }

    private val WHEN = Regex("just now|\\b\\d+ (?:min|mins|minutes?|hours?|hrs?|days?) ago\\b|\\b[Yy]esterday\\b")
    private val VERSION = Regex("^Daylight Share \\S+ \\(\\d+\\)( debug)?$")
    private val SYNC_STATUS = Regex("^(Connected · .*|Checking…|Checked .*|Not checked yet)$")
    private val INBOX_SENTENCES = setOf(InboxText.OFFLINE, InboxText.LIMITED, InboxText.OUT_OF_SPACE, InboxText.RELAY_ERROR)
    private val RELAY_ERROR = Regex("^The relay isn’t working right now \\(error \\d+\\)\\. It will keep trying\\.$")

    /**
     * The words that change from run to run, replaced: relative times ("5 min ago"), the version line in About, and the
     * Inbox's connection line (the live connection to the test relay comes and goes while a test runs).
     */
    fun scrub(text: String): String = when {
        VERSION.matches(text) -> "Daylight Share <version>"
        SYNC_STATUS.matches(text) || text in INBOX_SENTENCES || RELAY_ERROR.matches(text) -> "<connection status>"
        else -> WHEN.replace(text, "<when>")
    }

    /** The tree as JSON: one node per line, non-ASCII as \u escapes (the CI log carries it unchanged). */
    fun toJson(nodes: List<A11yNode>): String = nodes.joinToString(",\n", "[\n", "\n]\n") { "  " + it.toJson() }

    fun quote(s: String): String {
        val sb = StringBuilder("\"")
        for (ch in s) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch == '\n' -> sb.append("\\n")
                ch < ' ' || ch.code > 0x7e -> sb.append("\\u%04x".format(ch.code))
                else -> sb.append(ch)
            }
        }
        return sb.append('"').toString()
    }
}
