package com.daylight.share

import android.content.ClipboardManager
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.isRoot
import com.daylight.share.core.Bytes
import com.daylight.share.core.Json
import com.daylight.share.core.Limits
import com.daylight.share.core.Pairing
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.server.ServerMessages
import java.io.File

/** What the Lab screen tests share (K1): the vector pairing, a relay in memory, the words on screen, the clipboard. */
object LabKit {
    @Suppress("UNCHECKED_CAST")
    val serverVectors: Map<String, Any?> by lazy {
        val path = System.getProperty("dls.serverVectors") ?: error("dls.serverVectors not set")
        Json.parse(File(path).readText()) as Map<String, Any?>
    }

    /** The shared Lab vectors (`share/vectors/lab-vectors.json`). */
    @Suppress("UNCHECKED_CAST")
    val labVectors: Map<String, Any?> by lazy {
        val path = System.getProperty("dls.labVectors") ?: error("dls.labVectors not set")
        Json.parse(File(path).readText()) as Map<String, Any?>
    }

    /** The server vectors' pairing (on ntfy.sh, whose Server code is `derived.serverCode`). */
    val vectorPairing: Pairing by lazy { Pairing(Bytes.fromHex(serverVectors["secretHex"] as String), Limits.DEFAULT_RELAY, "Kitchen Daylight") }

    @Suppress("UNCHECKED_CAST")
    val vectorServerCode: String get() = (serverVectors["derived"] as Map<String, Any?>)["serverCode"] as String

    /** Sends every relay and server request of [app] to [relay]; the Inbox's Lab frames go only when a test flushes. */
    fun useRelay(app: App, relay: FakeRelay) {
        app.sender.http = relay
        app.inbox.http = relay
        app.lab.http = relay
        app.labReporter.autoFlush = false
    }

    /** Every text on screen (each Text on its own, the app's window and any dialog), field contents included. */
    fun texts(compose: AppRule): List<String> {
        val nodes = compose.onAllNodes(SemanticsMatcher("anything") { true }, useUnmergedTree = true).fetchSemanticsNodes() +
            compose.onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes()
        return nodes.flatMap { n ->
            n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } +
                n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
                listOfNotNull(n.config.getOrNull(SemanticsProperties.EditableText)?.text)
        }.distinct()
    }

    /** A secret's name (CLOUDFLARE_API_TOKEN, ANTHROPIC_API_KEY, DAYLIGHT_SERVER_CODE, …). */
    private val SECRET_NAME = Regex("\\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\\b")

    /**
     * The start of every needs-setup sentence (LAB_TEXT's `needs.*` and "Turn on Lab in …", the server module's state
     * messages) and of the re-run help: the words that say how to set something up.
     */
    val setupSentences: List<String> by lazy {
        (LabText.strings.filterKeys { it.startsWith("needs.") }.values + LabText["labOff"] + ServerMessages.STATE_MESSAGES.values + ServerMessages.RERUN_HELP)
            .map { it.substringBefore('{').trim().take(40) }
            .filter { it.length >= 12 }
            .distinct()
    }

    /** The texts on screen that name a secret or say how to set something up (F00.7). */
    fun setupWords(compose: AppRule): List<String> = texts(compose).filter { t ->
        SECRET_NAME.containsMatchIn(t) || setupSentences.any { t.contains(it) }
    }

    fun clipboard(app: App): String? =
        app.getSystemService(ClipboardManager::class.java)?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
}
