package com.daylight.share.sender

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.accessibility.AccessibilityManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import com.daylight.share.App
import com.daylight.share.Role
import com.daylight.share.Work
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.RowText
import com.daylight.share.core.ShareException
import com.daylight.share.core.Status
import com.daylight.share.core.Text
import com.daylight.share.core.lab.LabRowText
import com.daylight.share.logi
import com.daylight.share.logw
import com.daylight.share.ui.BigFilesEntry
import com.daylight.share.ui.DaylightTheme
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.StatusCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * "Send to Daylight" in the share sheet: links (the first http(s) URL in shared text), web pages' text, PDFs, EPUBs,
 * Markdown, HTML, DOCX and any other file (SEND and SEND_MULTIPLE). Shows a small card, copies what was shared while
 * the grant lasts, publishes it, and finishes; WorkManager re-sends and checks acks afterwards.
 *
 * With Lab on and F04's Use switch on, it shares in place ([ShareInPlace], LAB-PLAN F04): "Sending to {name}" with
 * Options for 1.5 s, then the item goes into the outbox, a `send-<id>` job publishes it, and the card goes. With Lab
 * on, links and text also go through smart intake (F16) and F11's rule, and a share while offline waits for a
 * connection (F07); F04 off is the v1.1 card, which stays until the item is sent.
 */
class ShareActivity : ComponentActivity() {
    private val text = mutableStateOf("Preparing…")
    private val action = mutableStateOf<Pair<String, () -> Unit>?>(null)
    /** The card stays, with Close, for someone who needs time to read it ([needsTime]). */
    private val stays = mutableStateOf(false)
    /** Lab: the F02 entry point under the too-big sentence ("Send files over 9 MB ›"). */
    private val bigFiles = mutableStateOf(false)
    /** Lab: share in place (F04), or null for the v1.1 card. */
    private val inPlace = mutableStateOf<ShareInPlace?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            DaylightTheme {
                val card = inPlace.value
                if (card != null) {
                    card.Content()
                } else {
                    val extra: (@Composable ColumnScope.() -> Unit)? = if (bigFiles.value) {
                        { BigFilesEntry(App.of(this@ShareActivity)) }
                    } else {
                        null
                    }
                    StatusCard(text.value, action.value, onDismiss = ::finish, close = action.value != null || stays.value, extra = extra)
                }
            }
        }
        if (savedInstanceState != null) {
            finish() // recreated after process death: the share's grant is gone
            return
        }
        val app = App.of(this)
        val lab = app.prefs.lab
        val shared = if (lab) parseLab(intent) else parse(intent)
        val pairing = app.sender.pairing()
        if (lab && intent?.getStringExtra(Intent.EXTRA_SHORTCUT_ID) == Shortcuts.ID) logi("lab: a share through the Direct Share shortcut")
        when {
            shared.isEmpty() -> fail("There’s nothing here Daylight Share can send.")
            app.prefs.role == Role.INBOX -> {
                text.value = "This device is set up as the Daylight Inbox, so it receives instead of sending."
                action.value = "Open Daylight Share" to { openApp() }
            }
            pairing == null -> {
                text.value = "Pair with your Daylight first: open Daylight Share on the Daylight and scan its code."
                action.value = "Pair now" to { openApp() }
            }
            PhoneLab.useOn(app, "F04") -> {
                if (app.prefs.role == null) app.setRole(Role.SENDER)
                inPlace.value = ShareInPlace(this, app, shared, PhoneLab.daylightName(app), sourceApp(), noTimer = needsTime(this) || app.prefs.labAlwaysOptions)
            }
            else -> send(app, shared, pairing.name.ifEmpty { "your Daylight" })
        }
    }

    private fun send(app: App, shared: List<Shared>, daylight: String) {
        if (app.prefs.role == null) app.setRole(Role.SENDER)
        text.value = "Sending to $daylight…"
        lifecycleScope.launch {
            // Copy into the outbox while this activity (and so the grant) is alive.
            val ids = ArrayList<String>()
            var error: String? = null
            var tooBig = false
            for (s in shared) {
                try {
                    ids += app.sender.add(s, ShareOptions(sourceApp = sourceApp())).id
                } catch (e: ShareException) {
                    error = e.message
                    if (e.code == "too-large") tooBig = true
                } catch (e: Exception) {
                    logw("share failed", e)
                    error = "Couldn’t read that (${e.message ?: e.javaClass.simpleName})."
                }
            }
            // Lab: the F02 entry point under the too-big sentence; the card then stays, with Close.
            val bigEntry = tooBig && app.prefs.lab
            if (ids.isEmpty()) {
                bigFiles.value = bigEntry
                fail(error ?: "Nothing was sent.", stay = bigEntry)
                return@launch
            }
            // Publish in the app's scope so it carries on if the card goes away; WorkManager backs it up.
            val job = app.scope.async { ids.map { app.sender.publish(it) } }
            Work.syncNow(app)
            val rows = withTimeoutOrNull(12_000) { job.await() }
            val allSent = rows != null && rows.all { it?.status == Status.SENT }
            text.value = if (app.prefs.lab) resultText(rows, ids.size, daylight, online = PhoneLab.online(app)) else resultText(rows, ids.size, daylight)
            if (error != null) text.value += "\n$error"
            bigFiles.value = bigEntry
            if (bigEntry) stays.value = true else closeAfter(if (allSent && error == null) 1_200 else 3_500)
        }
    }

    private fun fail(msg: String, stay: Boolean = false) {
        text.value = msg
        if (stay) {
            stays.value = true
            return
        }
        lifecycleScope.launch { closeAfter(3_500) }
    }

    /** Closes the card after [ms], or leaves it up with Close for someone who needs time to read it (F27, WCAG 2.2.1). */
    private suspend fun closeAfter(ms: Long) {
        if (needsTime(this)) {
            stays.value = true
            return
        }
        delay(ms)
        finish()
    }

    internal fun openApp() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    /** The app the share came from, by name, for a note's "— shared from {app} on {date}" (F11); null when unknown. */
    private fun sourceApp(): String? = runCatching {
        val pkg = referrer?.takeIf { it.scheme == "android-app" }?.host?.takeIf { it != packageName } ?: return null
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString().ifBlank { null }
    }.getOrNull()

    companion object {
        /**
         * Whether the card must not close by itself: Comfort is on, or TalkBack (touch exploration) or Switch Access is
         * running.
         */
        fun needsTime(context: Context): Boolean {
            if (App.of(context).prefs.comfort) return true
            val am = context.getSystemService(AccessibilityManager::class.java) ?: return false
            if (!am.isEnabled) return false
            if (am.isTouchExplorationEnabled) return true
            return runCatching {
                am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any { it.id.contains("switchaccess", ignoreCase = true) }
            }.getOrDefault(false)
        }

        /**
         * What the card says after a share (CHANGES-v1.1 2.5): the row's label, then its sentence ("Sent · waiting for
         * your Daylight", "Waiting to send. Couldn’t send right now. It will try again by itself."); for several items,
         * the count and the words of the first one that is not sent. [rows] is null while the publish still runs.
         */
        fun resultText(rows: List<OutboxRow?>?, count: Int, daylight: String): String {
            val what = if (count == 1) "" else "$count items "
            if (rows == null) return "Still sending ${what}to $daylight in the background."
            val shown = rows.filterNotNull()
            if (shown.isEmpty()) return "Nothing was sent."
            val worst = shown.firstOrNull { it.status != Status.SENT } ?: shown[0]
            val line = RowText.of(worst).line
            return if (count == 1) line else "$count items. $line"
        }

        /**
         * The same with Lab on (F01, F07): the row in the timeline's words, so a share while offline says "Waiting for
         * connection. It will send when this device is back online.".
         */
        fun resultText(rows: List<OutboxRow?>?, count: Int, daylight: String, online: Boolean): String {
            val what = if (count == 1) "" else "$count items "
            if (rows == null) return "Still sending ${what}to $daylight in the background."
            val shown = rows.filterNotNull()
            if (shown.isEmpty()) return "Nothing was sent."
            val worst = shown.firstOrNull { it.status != Status.SENT } ?: shown[0]
            val t = LabRowText.of(worst, System.currentTimeMillis(), LabRowText.Context(lab = true, online = online))
            val line = if (t.sentence == null) t.label else "${t.label.trimEnd('.', '…')}. ${t.sentence}"
            return if (count == 1) line else "$count items. $line"
        }

        /** Reads the share Intent (untrusted): streams first, else the first URL in the text, else the text itself. */
        fun parse(intent: Intent?): List<Shared> {
            if (intent == null) return emptyList()
            val type = runCatching { intent.type }.getOrNull()
            val uris = streams(intent)
            if (uris.isNotEmpty()) return uris.take(50).map { Shared.Stream(it, type) }
            val raw = runCatching { intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() }.getOrNull()?.trim().orEmpty()
            val subject = subjectOf(intent)
            if (raw.isEmpty()) return emptyList()
            val url = Text.findUrl(raw)
            if (url != null) {
                // "Title https://..." from apps that put both in the text.
                val rest = raw.replace(Regex(Regex.escape(url) + "[),.;!?]*"), " ").replace(Regex("\\s+"), " ").trim().trim('-', '—', ':', '|').trim()
                val title = subject ?: rest.takeIf { it.isNotEmpty() && it.length <= 300 && !it.contains("http") }
                return listOf(Shared.Link(url, title))
            }
            return listOf(Shared.Text(raw.take(5_000_000), subject))
        }

        /**
         * The same with Lab on: streams as v1.1; text as it came, with its subject, so smart intake (F16) and F11's rule
         * read the whole of it ("Opinion | headline https://nyti.ms/…" stays a link with the headline as its title).
         */
        fun parseLab(intent: Intent?): List<Shared> {
            if (intent == null) return emptyList()
            val type = runCatching { intent.type }.getOrNull()
            val uris = streams(intent)
            if (uris.isNotEmpty()) return uris.take(50).map { Shared.Stream(it, type) }
            val raw = runCatching { intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() }.getOrNull()?.trim().orEmpty()
            if (raw.isEmpty()) return emptyList()
            return listOf(Shared.Text(raw.take(5_000_000), subjectOf(intent)))
        }

        private fun streams(intent: Intent): LinkedHashSet<Uri> {
            val uris = LinkedHashSet<Uri>()
            runCatching { IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) }.getOrNull()?.let(uris::add)
            runCatching { IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) }.getOrNull()?.forEach { it?.let(uris::add) }
            if (uris.isEmpty()) {
                runCatching { intent.clipData }.getOrNull()?.let { cd ->
                    for (i in 0 until minOf(cd.itemCount, 50)) cd.getItemAt(i)?.uri?.let(uris::add)
                }
            }
            return uris
        }

        private fun subjectOf(intent: Intent): String? = runCatching {
            intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent.getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString()
        }.getOrNull()?.trim()?.ifEmpty { null }

        /** Runs [block] on the main thread (the card's state), from the app's scope. */
        internal suspend fun onMain(block: () -> Unit) = withContext(Dispatchers.Main) { block() }
    }
}
