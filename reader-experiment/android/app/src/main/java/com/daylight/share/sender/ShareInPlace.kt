package com.daylight.share.sender

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
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.daylight.share.App
import com.daylight.share.core.ShareException
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.lab.Normalise
import com.daylight.share.logi
import com.daylight.share.logw
import com.daylight.share.ui.BigFilesEntry
import com.daylight.share.ui.Buttons
import com.daylight.share.ui.Choice
import com.daylight.share.ui.Field
import com.daylight.share.ui.Ink
import com.daylight.share.ui.Paper
import com.daylight.share.ui.PrimaryButton
import com.daylight.share.ui.SecondaryButton
import com.daylight.share.ui.TextAction
import com.daylight.share.ui.announced
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Share in place (LAB-PLAN F04, Android): the share card reads "Sending to {name}" with **Options** for 1.5 s. Doing
 * nothing sends; Options stops the countdown and shows the choices (an editable title; for text with a link, "Send
 * link" or "Send as excerpt", F11 after 6.5 Q1) and **Send**. With Comfort, TalkBack or Switch Access on, or "Always
 * show Options before sending", the card opens with the choices and Send, and nothing goes until Send (WCAG 2.2.1).
 *
 * While the countdown runs, shared files are copied into private storage (the grant lives with this activity). At the
 * countdown's end (or Send) the items go into the outbox (offline: waiting for a connection, F07), each is remembered
 * for its "Send results" notice and then handed to its `send-<id>` job ([SendWorker]), and the card closes. Tapping
 * outside it before that, Back, Close in Options or the card going sends nothing, and the copies made meanwhile are
 * deleted ([discard]); process death during the countdown queues nothing (no half rows; what it left in
 * `outbox-incoming` goes at the next start, [SenderRepo.sweepIncoming]). A refused share (too big, unreadable) shows
 * its sentence on the card, with the F02 entry point under the too-big one. The first link-only share on this device
 * shows F03's hint once, and the first excerpt "Excerpts wait for a tap on your Daylight for now."; the card then
 * stays until OK.
 */
class ShareInPlace(
    private val activity: ShareActivity,
    private val app: App,
    private val items: List<Shared>,
    private val name: String,
    private val sourceApp: String?,
    private val noTimer: Boolean,
) {
    /** The countdown in ms (1.5 s). */
    private val countdownMs = COUNTDOWN_MS

    var optionsOpen by mutableStateOf(noTimer)
        private set
    var sending by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var bigFiles by mutableStateOf(false)
        private set
    var hint by mutableStateOf<String?>(null)
        private set
    var title by mutableStateOf("")
    var asExcerpt by mutableStateOf(false)
    private var titleEdited = false

    /** One shared text (or link) can become an excerpt: it has a link and text besides it (F11). */
    val canExcerpt: Boolean = items.singleOrNull()?.let { s ->
        s is Shared.Text && Normalise.classifyShare(s.text, "", s.subject ?: "", "").let { it.kind == Normalise.Kinds.LINK && it.text.isNotEmpty() }
    } ?: false

    /** Only one item has a title to edit. */
    val titled: Boolean = items.size == 1

    private val copies: List<Deferred<Result<SenderRepo.Copy>>?>
    private var countdown: Job? = null

    /** Whether [commit] took the copies (it deletes what it does not store); until then [discard] does. */
    private var committed = false

    init {
        copies = items.map { s ->
            if (s is Shared.Stream) activity.lifecycleScope.async { runCatching { app.sender.copy(s.uri, s.mime) } } else null
        }
        title = defaultTitle()
        // A file's title comes with its copy.
        copies.singleOrNull()?.let { c ->
            activity.lifecycleScope.launch {
                val t = c.await().getOrNull()?.title
                if (!titleEdited && t != null) title = t
            }
        }
        if (!noTimer) {
            countdown = activity.lifecycleScope.launch {
                delay(countdownMs)
                commit()
            }
        }
        logi("lab: share in place, ${items.size} item(s)${if (noTimer) ", Options first (no countdown)" else ""}")
    }

    private fun defaultTitle(): String {
        val s = items.singleOrNull() ?: return ""
        if (s is Shared.Stream) return ""
        return runCatching { app.sender.intake(s, ShareOptions(asExcerpt = asExcerpt, sourceApp = sourceApp)).item.title }.getOrNull().orEmpty()
    }

    fun editTitle(t: String) {
        title = t
        titleEdited = true
    }

    fun chooseExcerpt(on: Boolean) {
        asExcerpt = on
        if (!titleEdited) title = defaultTitle()
    }

    /** Options: the countdown stops and the choices show, with Send. */
    fun openOptions() {
        countdown?.cancel()
        countdown = null
        optionsOpen = true
    }

    /**
     * Tapping outside the card: before the countdown ends nothing is sent. Once sending, the card stays until the items
     * are in the outbox (a file is still being copied while the share's grant lives with this card); then it closes by
     * itself.
     */
    fun dismiss() {
        if (sending && error == null && hint == null) return
        countdown?.cancel()
        activity.finish()
    }

    /**
     * The card goes without [commit] having taken the copies (tapped outside, Back, Close, or destroyed): the copies
     * still running stop, and the files already copied are deleted. Nothing was stored, so nothing else is left.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun discard() {
        if (committed) return
        countdown?.cancel()
        countdown = null
        for (c in copies) {
            if (c == null) continue
            // A copy still running stops between chunks and deletes what it wrote (SenderRepo.copy); one that had
            // finished (now, or just before the cancel) is deleted here.
            c.cancel()
            c.invokeOnCompletion { cause -> if (cause == null) runCatching { c.getCompleted().getOrNull()?.file?.delete() } }
        }
    }

    /**
     * Puts the items into the outbox and hands each to its `send-<id>` job, in the app's scope so it finishes if the
     * card goes; then closes the card, or shows what went wrong, or the one-time hint. Each item is remembered for its
     * "Send results" notice before its job is asked for, so a job that ends at once still finds it (F04.6).
     */
    fun commit() {
        if (sending) return
        countdown?.cancel()
        countdown = null
        sending = true
        committed = true
        optionsOpen = false
        val edited = title.trim().takeIf { titled && titleEdited && it.isNotEmpty() }
        val excerpt = asExcerpt
        app.scope.launch {
            val ids = ArrayList<String>()
            var failed: String? = null
            var tooBig = false
            var excerptSent = false
            items.forEachIndexed { i, s ->
                var copy: SenderRepo.Copy? = null
                try {
                    copy = copies[i]?.await()?.getOrThrow()
                    val row = app.sender.add(s, ShareOptions(title = edited, asExcerpt = excerpt, copied = copy, sourceApp = sourceApp))
                    ids += row.id
                    if (excerpt) excerptSent = true
                    app.sender.noteInPlace(listOf(row.id))
                    if (!FlushWorker.waiting(row)) SendWorker.enqueue(app, row.id)
                } catch (e: ShareException) {
                    failed = e.message
                    if (e.code == "too-large") tooBig = true
                } catch (e: Exception) {
                    logw("share failed", e)
                    failed = "Couldn’t read that (${e.message ?: e.javaClass.simpleName})."
                } finally {
                    // Stored, the copy has moved into the outbox; refused (or the pairing changed), it goes.
                    copy?.file?.delete()
                }
            }
            val once = when {
                ids.isEmpty() -> null
                excerptSent && !app.prefs.labExcerptNoteShown -> LabText["excerpt.waitsOnce"].also { app.prefs.labExcerptNoteShown = true }
                !excerpt -> PhoneLab.linkOnlyHintOnce(app, items)
                else -> null
            }
            withContext(Dispatchers.Main) {
                when {
                    failed != null -> {
                        error = if (ids.isEmpty()) failed else "${ids.size} of ${items.size} on the way. $failed"
                        bigFiles = tooBig
                    }
                    once != null -> hint = once
                    else -> activity.finish()
                }
            }
        }
    }

    /** The card. */
    @Composable
    fun Content() {
        val none = remember { MutableInteractionSource() }
        Box(
            Modifier
                .fillMaxSize()
                .clickable(interactionSource = none, indication = null) { dismiss() }
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
                    Text(LabText.fill(LabText["shareInPlace.card"], mapOf("name" to name)), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
                    val e = error
                    val h = hint
                    when {
                        e != null -> {
                            Text(e, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
                            if (bigFiles) BigFilesEntry(app)
                            Buttons { SecondaryButton("Close") { activity.finish() } }
                        }
                        h != null -> {
                            Text(h, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
                            Buttons { TextAction(LabText.NOTE_BUTTON) { activity.finish() } }
                        }
                        optionsOpen -> OptionsContent()
                        !sending -> Buttons { SecondaryButton(LabText["shareInPlace.options"]) { openOptions() } }
                    }
                }
            }
        }
    }

    @Composable
    private fun OptionsContent() {
        if (titled) {
            Field(
                value = title, onValueChange = ::editTitle,
                label = LabText["shareInPlace.title"],
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (canExcerpt) {
            Column(Modifier.selectableGroup()) {
                Choice(LabText["shareInPlace.sendLink"], !asExcerpt) { chooseExcerpt(false) }
                Choice(LabText["shareInPlace.sendAsExcerpt"], asExcerpt) { chooseExcerpt(true) }
            }
        }
        Buttons {
            PrimaryButton(LabText["shareInPlace.send"]) { commit() }
            SecondaryButton("Close") { dismiss() }
        }
    }

    companion object {
        /** The countdown: the card sends 1.5 s after it opens unless Options is tapped (F04). */
        const val COUNTDOWN_MS = 1_500L
    }
}
