package com.daylight.share.sender

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import com.daylight.share.App
import com.daylight.share.Role
import com.daylight.share.Work
import com.daylight.share.core.ShareException
import com.daylight.share.core.Status
import com.daylight.share.core.Text
import com.daylight.share.logw
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
 */
class ShareActivity : ComponentActivity() {
    private val text = mutableStateOf("Preparing…")
    private val action = mutableStateOf<Pair<String, () -> Unit>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { DaylightTheme { StatusCard(text.value, action.value, onDismiss = ::finish) } }
        if (savedInstanceState != null) {
            finish() // recreated after process death: the share's grant is gone
            return
        }
        val app = App.of(this)
        val shared = parse(intent)
        val pairing = app.sender.pairing()
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
            for (s in shared) {
                try {
                    ids += app.sender.add(s).id
                } catch (e: ShareException) {
                    error = e.message
                } catch (e: Exception) {
                    logw("share failed", e)
                    error = "Couldn’t read that (${e.message ?: e.javaClass.simpleName})."
                }
            }
            if (ids.isEmpty()) {
                fail(error ?: "Nothing was sent.")
                return@launch
            }
            // Publish in the app's scope so it carries on if the card goes away; WorkManager backs it up.
            val job = app.scope.async { ids.map { app.sender.publish(it) } }
            Work.syncNow(app)
            val rows = withTimeoutOrNull(12_000) { job.await() }
            val what = if (ids.size == 1) "" else "${ids.size} items "
            when {
                rows == null -> text.value = "Still sending ${what}to $daylight in the background."
                rows.all { it?.status == Status.SENT } -> text.value = "Sent ${what}to $daylight ✓"
                else -> text.value = "Not sent yet: ${rows.firstNotNullOfOrNull { it?.error?.ifBlank { null } } ?: "no connection"}. It will be sent when you’re online."
            }
            if (error != null) text.value += "\n$error"
            delay(if (rows != null && rows.all { it?.status == Status.SENT } && error == null) 1_200 else 3_000)
            finish()
        }
    }

    private fun fail(msg: String) {
        text.value = msg
        lifecycleScope.launch {
            delay(3_500)
            finish()
        }
    }

    private fun openApp() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    companion object {
        /** Reads the share Intent (untrusted): streams first, else the first URL in the text, else the text itself. */
        fun parse(intent: Intent?): List<Shared> {
            if (intent == null) return emptyList()
            val type = runCatching { intent.type }.getOrNull()
            val uris = LinkedHashSet<Uri>()
            runCatching { IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) }.getOrNull()?.let(uris::add)
            runCatching { IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) }.getOrNull()?.forEach { it?.let(uris::add) }
            if (uris.isEmpty()) {
                runCatching { intent.clipData }.getOrNull()?.let { cd ->
                    for (i in 0 until minOf(cd.itemCount, 50)) cd.getItemAt(i)?.uri?.let(uris::add)
                }
            }
            if (uris.isNotEmpty()) return uris.take(50).map { Shared.Stream(it, type) }
            val raw = runCatching { intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() }.getOrNull()?.trim().orEmpty()
            val subject = runCatching {
                intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent.getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString()
            }.getOrNull()?.trim()?.ifEmpty { null }
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
    }
}
