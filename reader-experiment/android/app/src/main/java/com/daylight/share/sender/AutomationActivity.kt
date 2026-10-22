package com.daylight.share.sender

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.daylight.share.App
import com.daylight.share.Role
import com.daylight.share.core.ShareException
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.lab.Normalise
import com.daylight.share.logi
import com.daylight.share.ui.Buttons
import com.daylight.share.ui.DaylightTheme
import com.daylight.share.ui.Ink
import com.daylight.share.ui.LabNote
import com.daylight.share.ui.LabPage
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.Paper
import com.daylight.share.ui.PrimaryButton
import com.daylight.share.ui.SecondaryButton
import com.daylight.share.ui.announced
import kotlinx.coroutines.launch

/**
 * F09 on Android (LAB-PLAN 3.3): other apps, scripts and Shortcuts-style tools send a link to the Daylight.
 *
 * - The intent action [ACTION_SEND_URL] with `EXTRA_TEXT` (the link, or text with one), `EXTRA_TITLE` and the boolean
 *   [EXTRA_QUICK]. It answers `startActivityForResult` with `RESULT_OK` and the extras [RESULT_ID] and [RESULT_STATUS]
 *   (`RESULT_CANCELED` with [RESULT_STATUS] and [RESULT_MESSAGE] otherwise).
 * - The link `daylightshare://send?url=<u>&title=<t>[&text=<s>][&quick=1]`, which `MainActivity` routes here. It never
 *   takes a file path.
 *
 * Both open a confirmation sheet ("Send to {name}?", the title and the host, Send and Cancel). Quick sends skip it only
 * while "Allow quick sends from other apps" is on (off by default), at most 10 a minute; asked for while it is off, the
 * sheet says how to turn it on. What comes in goes through smart intake (F16). With Lab off it answers "Turn on Lab in
 * Daylight Share to use this."; unpaired, the needs-pairing sentence; in the Inbox role, that it receives instead.
 */
class AutomationActivity : ComponentActivity() {
    /** What the sheet shows. */
    private val view = mutableStateOf<Sheet?>(null)

    private sealed interface Sheet {
        /** A sentence and Close: why nothing can be sent. */
        data class Refused(val text: String) : Sheet
        /** The confirmation; [quickOff]: quick send was asked for while the setting is off. */
        data class Confirm(val title: String, val itemTitle: String, val host: String, val quickOff: Boolean) : Sheet
    }

    private var pending: Shared? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { DaylightTheme { view.value?.let { SheetContent(it) } } }
        if (savedInstanceState != null) {
            finish()
            return
        }
        val app = App.of(this)
        val req = request(intent)
        logi("lab: automation ${if (req.quick) "quick " else ""}send asked for")
        val refused = refusal(app)
        if (refused != null) {
            answer(Activity.RESULT_CANCELED, status = refused.first, message = refused.second)
            view.value = Sheet.Refused(refused.second)
            return
        }
        val shared = Shared.Text(listOf(req.url, req.text).filter { it.isNotBlank() }.joinToString(" "), req.title.ifBlank { null })
        val intake = try {
            app.sender.intake(shared)
        } catch (e: ShareException) {
            null
        }
        if (intake == null || intake.kind != Normalise.Kinds.LINK) {
            val msg = LabText["automation.notWebAddress"]
            answer(Activity.RESULT_CANCELED, status = "refused", message = msg)
            view.value = Sheet.Refused(msg)
            return
        }
        pending = shared
        if (req.quick && app.prefs.labQuickSends && quickAllowed()) {
            send(app)
            return
        }
        view.value = Sheet.Confirm(
            LabText.fill(LabText["automation.confirmTitle"], mapOf("name" to PhoneLab.daylightName(app))),
            intake.item.title.orEmpty(), PhoneLab.host(intake.item.url), quickOff = req.quick && !app.prefs.labQuickSends,
        )
        // Until Send: a result for a caller that gives up (Cancel, Back, a tap outside).
        answer(Activity.RESULT_CANCELED, status = "cancelled", message = null)
    }

    /** Why nothing can be sent from here: (status, sentence), or null. */
    private fun refusal(app: App): Pair<String, String>? = when {
        !app.prefs.lab -> "lab-off" to LabText.fill(LabText["labOff"], mapOf("app" to LabText.appName(PhoneLab.PLATFORM)))
        app.prefs.role == Role.INBOX -> "inbox" to "This device is set up as the Daylight Inbox, so it receives instead of sending."
        app.sender.pairing() == null -> "needs-pairing" to (LabText.needsMessage("needs-pairing", platform = PhoneLab.PLATFORM) ?: "")
        else -> null
    }

    private fun send(app: App) {
        val s = pending ?: return
        pending = null
        lifecycleScope.launch {
            try {
                val row = app.sender.add(s)
                if (!FlushWorker.waiting(row)) SendWorker.enqueue(app, row.id)
                answer(Activity.RESULT_OK, id = row.id, status = row.status, message = null)
                logi("lab: automation send ${row.id.take(8)} ${row.status}")
                finish()
            } catch (e: ShareException) {
                answer(Activity.RESULT_CANCELED, status = "refused", message = e.message)
                view.value = Sheet.Refused(e.message ?: "")
            }
        }
    }

    private fun answer(code: Int, id: String? = null, status: String, message: String?) {
        setResult(code, Intent().apply {
            id?.let { putExtra(RESULT_ID, it) }
            putExtra(RESULT_STATUS, status)
            message?.let { putExtra(RESULT_MESSAGE, it) }
        })
    }

    @Composable
    private fun SheetContent(sheet: Sheet) {
        val none = remember { MutableInteractionSource() }
        Box(
            Modifier
                .fillMaxSize()
                .clickable(interactionSource = none, indication = null) { finish() }
                .navigationBarsPadding()
                .padding(16.dp),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Card(
                modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().clickable(interactionSource = none, indication = null) { },
                shape = RoundedCornerShape(6.dp),
                border = BorderStroke(2.dp, Ink),
                colors = CardDefaults.cardColors(containerColor = Paper, contentColor = Ink),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Daylight Share", style = MaterialTheme.typography.bodySmall)
                    when (sheet) {
                        is Sheet.Refused -> {
                            Text(sheet.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
                            Buttons { SecondaryButton("Close") { finish() } }
                        }
                        is Sheet.Confirm -> {
                            Text(sheet.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
                            if (sheet.itemTitle.isNotEmpty()) Text(sheet.itemTitle, style = MaterialTheme.typography.bodyLarge)
                            if (sheet.host.isNotEmpty()) Text(sheet.host, style = MaterialTheme.typography.bodyMedium)
                            Buttons {
                                PrimaryButton(LabText["automation.send"]) { send(App.of(this@AutomationActivity)) }
                                SecondaryButton(LabText["automation.cancel"]) { finish() }
                            }
                            if (sheet.quickOff) {
                                LabNote(
                                    LabText.needsMessage("needs-quick-sends", platform = PhoneLab.PLATFORM) ?: "",
                                    button = LabText.button("needs-quick-sends"),
                                    onButton = { openQuickSendsSetting() },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /** "Open setting": What's in Lab, where "Allow quick sends from other apps" is under Shortcuts and automation. */
    private fun openQuickSendsSetting() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_LAB_PAGE, LabPage.WHATS_IN_LAB.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    /** What a caller asked for. */
    data class Request(val url: String, val title: String, val text: String, val quick: Boolean)

    companion object {
        const val ACTION_SEND_URL = "com.daylight.share.action.SEND_URL"
        const val EXTRA_QUICK = "com.daylight.share.extra.QUICK"
        private const val EXTRA_URL = "com.daylight.share.extra.URL"
        const val RESULT_ID = "id"
        const val RESULT_STATUS = "status"
        const val RESULT_MESSAGE = "message"

        /** The times of the last quick sends in this process (at most [PhoneLab.QUICK_SENDS_PER_MINUTE] a minute). */
        private val quickTimes = ArrayDeque<Long>()

        /** Whether one more quick send fits in the last minute; counts it when it does. */
        @Synchronized
        fun quickAllowed(now: Long = System.currentTimeMillis()): Boolean {
            while (quickTimes.isNotEmpty() && now - quickTimes.first() > 60_000) quickTimes.removeFirst()
            if (quickTimes.size >= PhoneLab.QUICK_SENDS_PER_MINUTE) return false
            quickTimes.addLast(now)
            return true
        }

        /** Forgets the quick sends counted so far (tests). */
        @Synchronized
        fun resetQuickSends() = quickTimes.clear()

        /** The request in an intent: the action's extras, or a `daylightshare://send` link's parameters. */
        fun request(intent: Intent?): Request {
            if (intent == null) return Request("", "", "", false)
            val url = runCatching { intent.getStringExtra(EXTRA_URL) }.getOrNull()
            if (url != null) {
                // Routed from a daylightshare://send link.
                return Request(url, intent.getStringExtra(Intent.EXTRA_TITLE).orEmpty(), runCatching { intent.getStringExtra(Intent.EXTRA_TEXT) }.getOrNull().orEmpty(), intent.getBooleanExtra(EXTRA_QUICK, false))
            }
            val text = runCatching { intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() }.getOrNull().orEmpty()
            val title = runCatching { intent.getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString() }.getOrNull().orEmpty()
            val quick = runCatching { intent.getBooleanExtra(EXTRA_QUICK, false) }.getOrDefault(false)
            return Request("", title, text, quick)
        }

        /**
         * `daylightshare://send?url=<u>&title=<t>[&text=<s>][&quick=1]` -> the intent that opens this sheet. Only these
         * parameters are read; the link never takes a file path.
         */
        fun fromLink(context: Context, link: Uri): Intent {
            fun q(name: String) = runCatching { link.getQueryParameter(name) }.getOrNull().orEmpty()
            return Intent(context, AutomationActivity::class.java)
                .putExtra(EXTRA_URL, q("url"))
                .putExtra(Intent.EXTRA_TITLE, q("title"))
                .putExtra(Intent.EXTRA_TEXT, q("text"))
                .putExtra(EXTRA_QUICK, q("quick") == "1")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
