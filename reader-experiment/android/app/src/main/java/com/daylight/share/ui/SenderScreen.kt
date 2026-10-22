package com.daylight.share.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.textclassifier.TextClassifier
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role as A11yRole
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Pairing
import com.daylight.share.core.PairingConfirmation
import com.daylight.share.core.Relay
import com.daylight.share.core.RowText
import com.daylight.share.core.ShareException
import com.daylight.share.core.Status
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabLedger
import com.daylight.share.core.lab.LabRowText
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.lab.Normalise
import com.daylight.share.sender.FlushWorker
import com.daylight.share.sender.LAB_NOTE_ENABLED_PHONE
import com.daylight.share.sender.PhoneLab
import com.daylight.share.sender.Shared
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A phone's view: pair with the Daylight, send a link or a file, and see what was delivered. */
@Composable
fun SenderScreen(activity: MainActivity, onSettings: () -> Unit) {
    val app = App.of(activity)
    val pairing by app.sender.pairingFlow.collectAsStateWithLifecycle()
    val rows by app.sender.rows.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    val notice = activity.notice.value
    // Lab (LAB-PLAN 1.2, 2.6): the one-time note (from W1 builds) and the re-pairing card, only while Lab is on.
    val lab by app.labOn.collectAsStateWithLifecycle()
    val labNote = lab && app.prefs.labNoteDue(LAB_NOTE_ENABLED_PHONE)
    var repairedSeen by remember { mutableStateOf(false) }
    val repaired = remember(pairing, activity.resumes.intValue, lab, repairedSeen) { if (lab && !repairedSeen) app.lab.repaired() else null }
    // Lab (K4): the timeline's ledger, whether this phone is online (F07), the F02 entry point under a too-big sentence.
    val snapshot by app.sender.labSnapshot.collectAsStateWithLifecycle()
    val online by rememberOnline(activity)
    var tooBig by remember { mutableStateOf(false) }

    LaunchedEffect(pairing) { app.sender.refresh() }

    // F04: after a share in place, the app asks once for notifications (Android 13 and later), for "Send results".
    val askNotices = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(lab, activity.resumes.intValue) {
        if (lab && Build.VERSION.SDK_INT >= 33 && app.prefs.labAskNotices) {
            app.prefs.labAskNotices = false
            if (!PhoneLab.notificationsOn(activity)) runCatching { askNotices.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }

    // F01: faster checks while something is on its way (2.5): the ack topic every 30 s while the app is in front and a
    // row delivered in the last 10 minutes has no settled state.
    LaunchedEffect(lab, pairing) {
        if (!lab || pairing == null) return@LaunchedEffect
        while (true) {
            delay(Lab.FAST_CHECK_MS)
            val states = app.sender.labSnapshot.value?.states ?: emptyMap()
            if (app.inForeground && LabRowText.wantsFastChecks(app.sender.rows.value, System.currentTimeMillis(), states)) app.sender.tick()
        }
    }

    fun sendShared(s: Shared) {
        busy = true
        message = null
        tooBig = false
        scope.launch {
            try {
                val row = app.sender.add(s)
                val r = app.sender.publish(row.id) ?: row
                message = if (lab) labLine(r, online) else RowText.of(r).line
                if (s is Shared.Link) link = ""
            } catch (e: ShareException) {
                message = e.message
                tooBig = lab && e.code == "too-large"
            } finally {
                busy = false
            }
        }
    }

    // F33: the copied link. Only the clipboard's description is read on resume (no "pasted from" notice); the link is
    // read when the chip is tapped, and its host shown with Send and Cancel before anything goes.
    var clipOffered by remember { mutableStateOf(false) }
    var clipAsk by remember { mutableStateOf<String?>(null) }
    var clipText by remember { mutableStateOf<String?>(null) }
    var clipNone by remember { mutableStateOf(false) }
    LaunchedEffect(lab, pairing, activity.resumes.intValue) {
        clipOffered = lab && pairing != null && PhoneLab.useOn(app, "F33") && CopiedLink.offered(activity)
        if (!clipOffered) {
            clipAsk = null
            clipNone = false
        }
    }

    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) sendShared(Shared.Stream(uri, null))
    }

    ScreenList {
        item {
            HeaderRow(title = {
                Text("Daylight Share", style = MaterialTheme.typography.headlineSmall)
                val p = pairing
                Text(
                    if (p == null) "Not paired yet" else "Sending to ${p.name.ifEmpty { "your Daylight" }}" +
                        if (p.relay != Limits.DEFAULT_RELAY) " · through ${Relay.host(p.relay)}" else "",
                    style = MaterialTheme.typography.bodySmall,
                )
            }) {
                SecondaryButton("Settings") { onSettings() }
            }
        }
        if (notice != null) item {
            Section {
                Text(notice, modifier = Modifier.announced())
                TextAction("OK") { activity.notice.value = null }
            }
        }
        if (labNote) item { LabOneTimeNote(app, enabled = LAB_NOTE_ENABLED_PHONE) }
        if (repaired != null) item {
            LabRepairedCard(activity, repaired) {
                app.lab.repairedSeen()
                repairedSeen = true
            }
        }
        if (pairing == null) {
            item { PairSection(activity) }
        } else {
            item {
                Section("Send a link") {
                    if (clipOffered) {
                        CopiedLinkChip(
                            app, clipAsk, clipNone,
                            onTap = {
                                val r = CopiedLink.read(activity, clean = PhoneLab.useOn(app, "F16"))
                                clipNone = r == null
                                clipAsk = r?.let { LabText.fill(LabText["copiedLink.confirm"], mapOf("host" to PhoneLab.host(it.second), "name" to PhoneLab.daylightName(app))) }
                                clipText = r?.first
                            },
                            onSend = {
                                val t = clipText
                                clipAsk = null
                                clipText = null
                                if (t != null) sendShared(Shared.Text(t, null))
                            },
                            onCancel = {
                                clipAsk = null
                                clipText = null
                                clipNone = false
                            },
                        )
                    }
                    Field(
                        value = link, onValueChange = { link = it },
                        label = "Link",
                        placeholder = "https://…",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { if (link.isNotBlank() && !busy) sendShared(Shared.Link(link.trim(), null)) }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Buttons {
                        PrimaryButton("Send link", enabled = link.isNotBlank() && !busy) { sendShared(Shared.Link(link.trim(), null)) }
                        SecondaryButton("Send a file", enabled = !busy) {
                            try {
                                pickFile.launch(arrayOf("*/*"))
                            } catch (e: ActivityNotFoundException) {
                                message = "No file picker on this device."
                            }
                        }
                    }
                    Text("Anywhere else: Share › Send to Daylight.", style = MaterialTheme.typography.bodySmall)
                    Text(LIMITS_LINE, style = MaterialTheme.typography.bodySmall)
                    // The share's result ("Sent · waiting for your Daylight"), announced when it changes.
                    message?.let { Text(it, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced()) }
                    // Lab: the F02 entry point under the too-big sentence.
                    if (lab && tooBig && message != null) BigFilesEntry(app)
                }
            }
            if (!lab) {
                item {
                    HeaderRow(title = { Text("Sent", style = MaterialTheme.typography.titleLarge) }) {
                        SecondaryButton("Check deliveries") { scope.launch { app.sender.tick() } }
                    }
                }
                if (rows.isEmpty()) item {
                    Text("Nothing sent yet.", style = MaterialTheme.typography.bodyMedium)
                }
                items(rows, key = { it.id }) { row -> OutboxRowView(row, onRetry = { scope.launch { app.sender.retry(row.id) } }, onRemove = { scope.launch { app.sender.remove(row.id) } }) }
            } else {
                // Lab (F07, F01): what waits for a connection first, with Cancel; then the check-in header and the
                // history as the delivery timeline.
                val now = System.currentTimeMillis()
                val waiting = rows.filter { FlushWorker.waiting(it) || (it.status == Status.SENDING && !online) }
                val history = rows.filter { it !in waiting }
                val newest = history.maxByOrNull { it.created }?.id
                if (waiting.isNotEmpty()) {
                    item(key = "lab-queue") {
                        Text(
                            LabText.fill(LabText["queue.heading"], mapOf("n" to waiting.size)),
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.semantics { heading() },
                        )
                    }
                    items(waiting, key = { "q-" + it.id }) { row ->
                        LabRowView(row, labText(row, now, snapshot, online), showAll = true, remove = LabText["queue.cancel"],
                            onRetry = { scope.launch { app.sender.retry(row.id) } }, onRemove = { scope.launch { app.sender.remove(row.id) } })
                    }
                }
                item {
                    HeaderRow(title = { Text("Sent", style = MaterialTheme.typography.titleLarge) }) {
                        SecondaryButton("Check deliveries") { scope.launch { app.sender.tick() } }
                    }
                }
                // The check-in header (2.5): from acks and Lab frames alike; it never blocks sending.
                item(key = "lab-checked-in") {
                    Text(LabText.checkedInText(snapshot?.checkedIn, now), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag(LAB_CHECKED_IN_TAG))
                }
                if (history.isEmpty()) item {
                    Text("Nothing sent yet.", style = MaterialTheme.typography.bodyMedium)
                }
                items(history, key = { it.id }) { row ->
                    LabRowView(row, labText(row, now, snapshot, online), showAll = row.id == newest, remove = "Remove",
                        onRetry = { scope.launch { app.sender.retry(row.id) } }, onRemove = { scope.launch { app.sender.remove(row.id) } })
                }
            }
        }
    }
}

@Composable
private fun PairSection(activity: MainActivity) {
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scan = rememberLauncherForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@rememberLauncherForActivityResult
        try {
            activity.offerPairing(Pairing.parse(text), PairingConfirmation.Source.APP)
        } catch (e: ShareException) {
            error = "That QR code isn’t a Daylight pairing code."
        }
    }
    Section("Pair with your Daylight") {
        Text("On the Daylight, install Daylight Share and choose “This is my Daylight”. It shows a QR code and a typed code.", style = MaterialTheme.typography.bodyMedium)
        PrimaryButton("Scan the QR code", Modifier.fillMaxWidth()) {
            val options = ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Point at the code on your Daylight")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
            try {
                scan.launch(options)
            } catch (e: ActivityNotFoundException) {
                error = "The scanner could not start."
            }
        }
        Text("Or type the code:", style = MaterialTheme.typography.bodyMedium)
        Field(
            value = code, onValueChange = { code = it; error = null },
            label = "Pairing code",
            placeholder = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX",
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
            errorText = error,
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }
        SecondaryButton("Pair", enabled = code.isNotBlank()) {
            try {
                activity.offerPairing(Pairing.parse(code), PairingConfirmation.Source.APP)
            } catch (e: ShareException) {
                error = e.message
            }
        }
        Text("Scanning the code with the camera app works too: it opens Daylight Share.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun OutboxRowView(row: OutboxRow, onRetry: () -> Unit, onRemove: () -> Unit) {
    Section {
        val title = row.title.ifEmpty { if (row.kind == Kind.FILE) row.name else row.url }
        Text(title, style = MaterialTheme.typography.titleMedium, maxLines = titleLines(3), overflow = TextOverflow.Ellipsis)
        val kind = when (row.kind) {
            Kind.URL -> "Link"
            Kind.PAGE -> "Web page"
            else -> row.name.substringAfterLast('.', "").uppercase().ifEmpty { "Document" }
        }
        val delivered = if (row.status == Status.DELIVERED && row.delivered > 0) "delivered ${ago(row.delivered)}" + (row.deliveredBy.ifEmpty { null }?.let { " to $it" } ?: "") else null
        Text(listOfNotNull(kind, sizeText(row.size).ifEmpty { null }, ago(row.created).ifEmpty { null }, delivered).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
        // The same words on every surface (CHANGES-v1.1 2.5): the label, its sentence, and a button only when it helps.
        // The label is announced when it changes ("Delivered ✓"); it wraps, never truncates (F27).
        val text = RowText.of(row)
        Text(text.label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
        text.sentence?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Buttons {
            text.button?.let { SecondaryButton(it) { onRetry() } }
            TextAction("Remove") { onRemove() }
        }
    }
}

/** What senders can send, and what the relay keeps (ntfy.sh's limits; PROTOCOL 3.5). */
const val LIMITS_LINE = "Files can be up to 9 MB. They go through the relay in parts of under 2 MB; the relay keeps files for 3 hours and links for 12, so your phone sends again until your Daylight has them, for up to a week."


/** The test tag of the timeline's check-in header (F01). */
const val LAB_CHECKED_IN_TAG = "lab-checked-in"

/** The test tag of a timeline row's step line (F01; hidden from screen readers). */
const val LAB_STEP_LINE_TAG = "lab-step-line"

/** The share's result in the timeline's words (Lab on): "Waiting for connection. It will send when this device is back online.", … */
private fun labLine(row: OutboxRow, online: Boolean): String {
    val t = LabRowText.of(row, System.currentTimeMillis(), LabRowText.Context(lab = true, online = online))
    return if (t.sentence == null) t.label else "${t.label.trimEnd('.', '…')}. ${t.sentence}"
}

/** A row as the timeline shows it (2.5): `LabRowText` with what the ledger knows and whether this phone is online. */
private fun labText(row: OutboxRow, now: Long, snapshot: LabLedger.Snapshot?, online: Boolean): LabRowText {
    val ctx = snapshot?.let { LabRowText.Context.of(true, it, row.id, online) } ?: LabRowText.Context(lab = true, online = online)
    return LabRowText.of(row, now, ctx)
}

/**
 * One row of the delivery timeline (F01, LAB-PLAN 2.5): the title and the label always; the sentence and the step line
 * when [showAll] (the newest row) or the row is not final, and otherwise in its details, which a tap on the title
 * shows. A screen reader reads the label as "{label}. {sentence}", announced when it changes, with no step count; the
 * step line ("Sent ✓ · On your Daylight ✓ · In the Reader …") is hidden from it, as the label says it. v1.1's button
 * only where it helps (Retry now, Try again); every row can be removed ([remove]: "Remove", or "Cancel" in the queue).
 */
@Composable
private fun LabRowView(row: OutboxRow, t: LabRowText, showAll: Boolean, remove: String, onRetry: () -> Unit, onRemove: () -> Unit) {
    var open by remember(row.id) { mutableStateOf(false) }
    Section {
        val title = row.title.ifEmpty { if (row.kind == Kind.FILE) row.name else row.url }
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = target())
                .clickable(role = A11yRole.Button) { open = !open },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = titleLines(3), overflow = TextOverflow.Ellipsis)
        }
        val kind = when (row.kind) {
            Kind.URL -> "Link"
            Kind.PAGE -> "Web page"
            else -> row.name.substringAfterLast('.', "").uppercase().ifEmpty { "Document" }
        }
        val delivered = if (row.status == Status.DELIVERED && row.delivered > 0) "delivered ${ago(row.delivered)}" + (row.deliveredBy.ifEmpty { null }?.let { " to $it" } ?: "") else null
        Text(listOfNotNull(kind, sizeText(row.size).ifEmpty { null }, ago(row.created).ifEmpty { null }, delivered).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
        Text(t.label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced().semantics { contentDescription = t.a11yLabel })
        // Rules 1 and 4 (v1.1's rows) keep v1.1's layout: the sentence always. Final rows show it only in details.
        val full = showAll || !t.final || open
        if (full) {
            t.sentence?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.clearAndSetSemantics { }) }
            // The step line is hidden from screen readers (the label says it); its box carries only a test tag.
            t.stepLine?.let { Box(Modifier.testTag(LAB_STEP_LINE_TAG)) { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.clearAndSetSemantics { }) } }
        }
        Buttons {
            val button = when (t.action) {
                RowText.RETRY_NOW -> "Retry now"
                RowText.TRY_AGAIN -> "Try again"
                else -> null
            }
            button?.let { SecondaryButton(it) { onRetry() } }
            TextAction(remove) { onRemove() }
        }
    }
}

/**
 * The copied-link chip (F33): "Send copied link"; once tapped, "Send {host} to {name}?" with Send and Cancel ([ask]),
 * or "No link on the clipboard." ([none]).
 */
@Composable
private fun CopiedLinkChip(app: App, ask: String?, none: Boolean, onTap: () -> Unit, onSend: () -> Unit, onCancel: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        if (ask == null) {
            SecondaryButton(LabText["copiedLink.chip"]) { onTap() }
            if (none) Text(LabText["copiedLink.noLink"], style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
        } else {
            Text(ask, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
            Buttons {
                PrimaryButton(LabText["shareInPlace.send"]) { onSend() }
                SecondaryButton(LabText["automation.cancel"]) { onCancel() }
            }
        }
    }
}

/**
 * The clipboard for F33: [offered] reads only its description (no "pasted from" notice on Android 13), [read] the
 * text, when the chip is tapped.
 */
object CopiedLink {
    /** How sure Android's text classifier must be that the clip is a link (API 31 and later). */
    const val MIN_CONFIDENCE = 0.5f

    /** Whether the clipboard looks like a link: `text/uri-list`, or (API 31+) a URL with confidence ≥ 0.5. */
    fun offered(context: Context): Boolean {
        val d = runCatching { context.getSystemService(ClipboardManager::class.java)?.primaryClipDescription }.getOrNull() ?: return false
        if (d.hasMimeType("text/uri-list")) return true
        if (Build.VERSION.SDK_INT < 31) return false
        return runCatching { d.getConfidenceScore(TextClassifier.TYPE_URL) >= MIN_CONFIDENCE }.getOrDefault(false)
    }

    /**
     * Reads the clipboard (the tap): its text and the link smart intake finds in it (F16), or null when it holds no
     * link. -> (text, cleaned URL)
     */
    fun read(context: Context, clean: Boolean): Pair<String, String>? {
        val clip = runCatching { context.getSystemService(ClipboardManager::class.java)?.primaryClip }.getOrNull() ?: return null
        if (clip.itemCount == 0) return null
        val item = clip.getItemAt(0)
        val text = (item.text?.toString() ?: item.uri?.toString())?.trim()?.ifEmpty { null } ?: return null
        val r = Normalise.normaliseShare(text = text, clean = clean)
        if (r.kind != Normalise.Kinds.LINK || r.url == null) return null
        return text to r.url!!
    }
}

/** Whether this device is online (F07), kept current by Android's default-network callback while the screen shows. */
@Composable
private fun rememberOnline(context: Context): State<Boolean> {
    val state = remember { mutableStateOf(PhoneLab.online(context)) }
    DisposableEffect(Unit) {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val main = Handler(Looper.getMainLooper())
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post { state.value = PhoneLab.onlineOverride ?: true }
            }

            override fun onLost(network: Network) {
                main.post { state.value = PhoneLab.onlineOverride ?: false }
            }
        }
        runCatching { cm?.registerDefaultNetworkCallback(cb) }
        onDispose { runCatching { cm?.unregisterNetworkCallback(cb) } }
    }
    return state
}
