package com.daylight.share.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.LAB_NOTE_ENABLED
import com.daylight.share.LabRepo
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.server.ServerMessages
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/*
 * Lab's screens (LAB-PLAN 1.1, 1.4, 1.5, 2.6; card K1), both roles: the Lab card at the top of Settings, What's in
 * Lab, the needs-setup note, the Daylight server section, the one-time note and the re-pairing card. Every word comes
 * from LAB_TEXT (`LabText`) or the server module (`ServerMessages`). Nothing here moves (F27): notes appear and go at
 * once, and nothing is ever greyed out: a feature that is not set up explains itself when tapped.
 */

/** The test tag of the Lab card in Settings: with Lab off it holds only the switch (LabOffParityTest leaves it out). */
const val LAB_CARD_TAG = "lab-switch"

/** The test tag of a needs-setup note ([LabNote]). */
const val LAB_NOTE_TAG = "lab-note"

/** The pages under the Lab card. */
enum class LabPage { WHATS_IN_LAB, SERVER }

/**
 * The Lab card, first in Settings (1.1): the switch with its footer and, while Lab is on, "What’s in Lab ›" and
 * "Daylight server ›" ("Optional · {short state}"). With Lab off only the switch shows. Later Lab tasks add their
 * rows inside this card only (LAB-PLAN 6.3).
 */
@Composable
fun LabCard(activity: MainActivity, onOpen: (LabPage) -> Unit) {
    val app = App.of(activity)
    val lab by app.labOn.collectAsStateWithLifecycle()
    val role by app.role.collectAsStateWithLifecycle()
    var subtitle by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(lab, role, activity.resumes.intValue) {
        if (!lab) {
            subtitle = null
            return@LaunchedEffect
        }
        // The last answer at once; the server is asked when it is over 10 minutes old (within 5 s).
        subtitle = app.lab.serverSubtitle(refresh = false)
        subtitle = app.lab.serverSubtitle(refresh = true)
    }
    Section(modifier = Modifier.testTag(LAB_CARD_TAG)) {
        SwitchRow(LabText.LAB, lab, detail = LabText.SWITCH_FOOTER) { app.setLab(it) }
        if (lab) {
            LabNavRow("${LabText.WHATS_IN_LAB} ›") { onOpen(LabPage.WHATS_IN_LAB) }
            LabNavRow("${LabText.SERVER_ROW} ›", detail = subtitle) { onOpen(LabPage.SERVER) }
        }
    }
}

/** A row that opens a page: its words (and a line under them) as one button. */
@Composable
private fun LabNavRow(label: String, detail: String? = null, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = target())
            .clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** What's in Lab or the Daylight server section; back to Settings when Lab goes off meanwhile. */
@Composable
fun LabScreen(activity: MainActivity, page: LabPage, onBack: () -> Unit) {
    val app = App.of(activity)
    val lab by app.labOn.collectAsStateWithLifecycle()
    LaunchedEffect(lab) { if (!lab) onBack() }
    if (!lab) return
    when (page) {
        LabPage.WHATS_IN_LAB -> WhatsInLab(activity, onBack)
        LabPage.SERVER -> ServerSection(activity, onBack)
    }
}

/** The note under a tapped feature: its [text], its one [button] (or none), and [followUp] ("Copied"). */
private data class Note(val feature: String, val text: String, val button: String? = null, val checking: Boolean = false, val followUp: String? = null)

/**
 * What's in Lab (1.4): the Inbox's Lab state as the header line (the phone), one row per Lab feature this build has
 * with its short state, then the server features under "With your Daylight server (optional)" with the server's short
 * state under the heading; a server feature's row shows its own short state only when it differs. It shows the
 * cached states at once and asks the server and the ack topic as it opens (each within 5 s). A tap runs the feature's
 * gate: when something is missing, exactly one sentence shows under the row (1.5) until OK, another control or
 * leaving the screen.
 */
@Composable
private fun WhatsInLab(activity: MainActivity, onBack: () -> Unit) {
    val app = App.of(activity)
    var overview by remember { mutableStateOf<LabRepo.Overview?>(null) }
    var refreshing by remember { mutableStateOf(true) }
    var note by remember { mutableStateOf<Note?>(null) }
    var tapped by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        overview = app.lab.overviewCached()
        overview = app.lab.overviewFresh()
        refreshing = false
    }

    fun tap(row: LabRepo.Row) {
        val n = ++tapped
        note = null
        scope.launch {
            val gate = scope.async { app.lab.gateNow(row.id) }
            // A cached answer comes at once; otherwise the note says so while the server is asked (at most 5 s).
            val quick = withTimeoutOrNull(QUICK_MS) { gate.await() }
            if (quick == null && tapped == n) note = Note(row.id, LabText.CHECKING, checking = true)
            val r = quick ?: gate.await()
            if (tapped != n) return@launch
            // Ready: in W0 no Lab feature runs yet (the server features are `later` once the server is ready).
            note = if (r.ready) null else Note(row.id, r.message ?: "", r.button)
        }
    }

    fun noteButton(n: Note) {
        if (n.button == LabText.button("needs-server")) {
            copyText(activity, LabText["serverSection.serverCode"], app.lab.serverCode())
            note = n.copy(followUp = LabText["setup.copied"])
        }
    }

    ScreenColumn(padding = 16.dp) {
        HeaderRow(title = {
            Text(LabText.WHATS_IN_LAB, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        }) {
            SecondaryButton("Done") {
                tapped++
                note = null
                onBack()
            }
        }
        val o = overview
        o?.header?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        if (o != null && o.features.isNotEmpty()) {
            Section {
                for (f in o.features) {
                    LabFeatureRow(f, note?.takeIf { it.feature == f.id }, onTap = { tap(f) }, onButton = ::noteButton, onOk = {
                        tapped++
                        note = null
                    })
                }
            }
        }
        if (o != null) {
            Section(LabText.SERVER_HEADING) {
                Text(
                    if (o.serverShort == null && refreshing) LabText.CHECKING else o.serverShort ?: "",
                    style = MaterialTheme.typography.bodyMedium,
                )
                for (f in o.serverRows) {
                    HorizontalDivider(color = Ink)
                    LabFeatureRow(f, note?.takeIf { it.feature == f.id }, onTap = { tap(f) }, onButton = ::noteButton, onOk = {
                        tapped++
                        note = null
                    })
                }
            }
        }
    }
}

/** How long a gate may take before its note says "Checking your Daylight server…". */
private const val QUICK_MS = 300L

/**
 * One feature of What's in Lab: one button with its name, its sentence and its short state (a screen reader reads them
 * together), never greyed out; then [use], W1's Use switch for the features that have one (LAB-PLAN 6.5 Q5); then
 * its [note] when it was tapped.
 */
@Composable
private fun LabFeatureRow(
    row: LabRepo.Row,
    note: Note?,
    onTap: () -> Unit,
    onButton: (Note) -> Unit,
    onOk: () -> Unit,
    use: (@Composable () -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = target())
                .clickable(role = Role.Button, onClick = onTap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                Text(row.name, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold))
                Text(row.sentence, style = MaterialTheme.typography.bodyMedium)
                row.short?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        }
        use?.invoke()
        if (note != null) {
            LabNote(
                note.text,
                button = note.button,
                onButton = { onButton(note) },
                followUp = note.followUp,
                onOk = if (note.checking) null else onOk,
            )
        }
    }
}

/**
 * The needs-setup note (1.5): exactly one sentence, directly under the tapped control, announced to screen readers
 * (polite), never a toast and never a dialog. It may carry one [button] that fixes it from here ("Copy Server code"),
 * and OK closes it ([onOk]; none while the server is still being asked). [followUp] says what the button did.
 */
@Composable
fun LabNote(text: String, button: String? = null, onButton: (() -> Unit)? = null, followUp: String? = null, onOk: (() -> Unit)? = null) {
    Column(
        Modifier
            .fillMaxWidth()
            .testTag(LAB_NOTE_TAG)
            .padding(top = 4.dp, bottom = 4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
        followUp?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }
        if ((button != null && onButton != null) || onOk != null) {
            Buttons(Modifier.padding(top = 6.dp)) {
                if (button != null && onButton != null) SecondaryButton(button) { onButton() }
                if (onOk != null) TextAction(LabText.NOTE_BUTTON) { onOk() }
            }
        }
    }
}

/**
 * The Daylight server section (2.6): where setup happens, so it carries the long texts, every word from
 * LAB_TEXT.serverSection or the server module. The state ("Ready", or the state's message with the secret names);
 * while the state is needs-server, "Turn it on" with the five steps numbered and where every step is; "Your server"
 * (`hostLineText`), "Delivery" with the Lab or v1 line and then the v1 notice; when the Lab Inbox was last seen and
 * today's AI use; a move to answer; the Server code with Copy; the optional Server address with its footer; the re-run
 * help. On the Inbox the server lane comes in Wave S: its section shows the steps and the Server code.
 */
@Composable
private fun ServerSection(activity: MainActivity, onBack: () -> Unit) {
    val app = App.of(activity)
    var view by remember { mutableStateOf<LabRepo.ServerView?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var copied by remember { mutableStateOf(false) }
    var moveAnswered by remember { mutableStateOf(false) }
    var address by remember { mutableStateOf("") }
    var addressError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(reload) {
        val v = app.lab.serverView()
        view = v
        address = v.manualUrl
    }

    ScreenColumn(padding = 16.dp) {
        HeaderRow(title = {
            Text(LabText.SERVER_ROW, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        }) {
            SecondaryButton("Done") { onBack() }
        }
        val v = view
        if (v == null) {
            Text(LabText.CHECKING, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
        } else {
            ServerSectionBody(
                activity, v, copied, moveAnswered, address, addressError, saving,
                onCopy = { copied = true },
                onMove = { yes ->
                    if (yes) {
                        scope.launch {
                            app.lab.confirmMove()
                            reload++
                        }
                    } else {
                        moveAnswered = true
                    }
                },
                onAddress = { address = it; addressError = null },
                onSave = {
                    saving = true
                    addressError = null
                    scope.launch {
                        val failure = app.lab.setServerAddress(address.trim())
                        saving = false
                        if (failure != null) addressError = failure else reload++
                    }
                },
            )
        }
    }
}

@Composable
private fun ServerSectionBody(
    activity: MainActivity,
    v: LabRepo.ServerView,
    copied: Boolean,
    moveAnswered: Boolean,
    address: String,
    addressError: String?,
    saving: Boolean,
    onCopy: () -> Unit,
    onMove: (Boolean) -> Unit,
    onAddress: (String) -> Unit,
    onSave: () -> Unit,
) {
    Section {
        Text(v.message, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
    }
    // "Turn it on" (2.6): the five steps, numbered, only while the server is not set up; step 2 is the server module's
    // RERUN_HELP, word for word. The list is LAB_TEXT's own (never its joined form split on ",").
    if (v.state == "needs-server") {
        Section(LabText["serverSection.stepsHeading"]) {
            LabText.SERVER_STEPS.forEachIndexed { i, step ->
                Text("${i + 1}. $step", style = MaterialTheme.typography.bodyMedium)
            }
            Text(LabText["serverSection.stepsMore"], style = MaterialTheme.typography.bodySmall)
        }
    }
    val where = LabText.hostLineText(v.host, v.fingerprint)
    if (where.isNotEmpty() || v.delivery != null || v.labInbox != null || v.aiToday != null) {
        Section {
            if (where.isNotEmpty()) {
                SubHeading(LabText["serverSection.hostLabel"])
                Text(where, style = MaterialTheme.typography.bodyMedium)
            }
            // The delivery mode, then under v1 delivery the v1 notice (DESIGN 14.3).
            if (v.delivery == "lab" || v.delivery == "v1") {
                SubHeading(LabText["serverSection.deliveryLabel"])
                Text(
                    LabText[if (v.delivery == "v1") "serverSection.deliveryV1" else "serverSection.deliveryLab"],
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            v.v1Notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            v.labInbox?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            v.aiToday?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
    }
    val moved = v.moved
    if (moved != null && !moveAnswered) {
        Section {
            Text(moved, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
            Buttons {
                PrimaryButton(LabText["serverSection.setupConfirm"]) { onMove(true) }
                // Cancel changes nothing; the question comes again next time.
                SecondaryButton(LabText["serverSection.setupCancel"]) { onMove(false) }
            }
        }
    }
    if (v.serverCode.isNotEmpty()) {
        Section(LabText["serverSection.serverCode"]) {
            Text(v.serverCode, style = MaterialTheme.typography.bodyLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace))
            SecondaryButton(LabText["serverSection.copy"]) {
                copyText(activity, LabText["serverSection.serverCode"], v.serverCode)
                onCopy()
            }
            if (copied) Text(LabText["setup.copied"], style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
        }
    }
    if (v.addressField) {
        Section(LabText["serverSection.serverAddress"]) {
            Field(
                value = address, onValueChange = onAddress,
                label = LabText["serverSection.serverAddress"],
                placeholder = LabText["serverSection.addressPlaceholder"],
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                errorText = addressError,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(LabText["serverSection.addressFooter"], style = MaterialTheme.typography.bodySmall)
            addressError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }
            SecondaryButton(LabText["serverSection.addressSave"], enabled = !saving) { onSave() }
        }
    }
    Text(ServerMessages.RERUN_HELP, style = MaterialTheme.typography.bodySmall)
}

/**
 * The one-time Lab note (1.2, 1.6): "Lab is on. New features to try are in Settings › Lab, where you can turn it
 * off." with OK, once, and only in builds with [enabled] ([LAB_NOTE_ENABLED]: from the first W1 build). The phone shows
 * it on its home screen, the Inbox on the Inbox.
 */
@Composable
fun LabOneTimeNote(app: App, enabled: Boolean = LAB_NOTE_ENABLED) {
    val lab by app.labOn.collectAsStateWithLifecycle()
    var dismissed by remember { mutableStateOf(false) }
    if (dismissed || !lab || !app.prefs.labNoteDue(enabled)) return
    Section {
        Text(LabText.NOTE, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
        TextAction(LabText.NOTE_BUTTON) {
            app.prefs.labNoteShown = true
            dismissed = true
        }
    }
}

/**
 * After this phone re-paired with another Daylight while it knew a Daylight server (2.6, DESIGN 12.7): the locked
 * text, the new pairing's Server code with Copy, the re-run help, and OK. Lab on only.
 */
@Composable
fun LabRepairedCard(activity: MainActivity, repaired: LabRepo.Repaired, onOk: () -> Unit) {
    var copied by remember { mutableStateOf(false) }
    Section(LabText.SERVER_ROW) {
        Text(repaired.message, style = MaterialTheme.typography.bodyMedium)
        Text(repaired.serverCode, style = MaterialTheme.typography.bodyLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace))
        Buttons {
            SecondaryButton(LabText["serverSection.copy"]) {
                copyText(activity, LabText["serverSection.serverCode"], repaired.serverCode)
                copied = true
            }
            TextAction(LabText.NOTE_BUTTON) { onOk() }
        }
        if (copied) Text(LabText["setup.copied"], style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
        Text(repaired.rerun, style = MaterialTheme.typography.bodySmall)
    }
}

/** A small heading inside a section ("Your server", "Delivery"): bold, and a heading for a screen reader. */
@Composable
private fun SubHeading(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), modifier = Modifier.semantics { heading() })
}

/** Puts [text] on the clipboard under [label] (Android 13 and later say so themselves). */
fun copyText(context: Context, label: String, text: String) {
    runCatching { context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(label, text)) }
}
