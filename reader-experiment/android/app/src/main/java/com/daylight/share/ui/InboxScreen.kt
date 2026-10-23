package com.daylight.share.ui

import android.Manifest
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.Relay
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.lab.SetupCheck
import com.daylight.share.inbox.Arrivals
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.InboxHealth
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxLab
import com.daylight.share.inbox.InboxText
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.Live
import com.daylight.share.inbox.Path
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.Routes
import com.daylight.share.sender.ActivityLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.semantics.Role as A11yRole

/** Lab: the Inbox screen's Instant delivery switch, which Setup check's "Open setting" opens ([MainActivity.inboxFocus]). */
const val INBOX_FOCUS_INSTANT = "instantDelivery"

/** Lab: the Inbox screen's arrival notice settings (F15), which F15's row in What's in Lab opens ([MainActivity.inboxFocus]). */
const val INBOX_FOCUS_ARRIVALS = "F15"

/**
 * A setting another Lab screen asked this screen to open (LAB-PLAN 1.5 "Open setting": "it opens that setting with its
 * footer and never changes it by itself"; 1.4: a tap on a feature opens it). [opened] is its key while the screen
 * shows; [mark] puts the marks on it, so it comes into view at once (no motion, F27), takes focus and carries
 * [LAB_OPENED_SETTING_TAG]. Nothing is marked otherwise, so the screen is unchanged (Lab-off parity).
 */
@Stable
internal class OpenedSetting {
    var opened by mutableStateOf<String?>(null)
    val shows = BringIntoViewRequester()
    val focuses = FocusRequester()

    @OptIn(ExperimentalFoundationApi::class)
    fun mark(key: String, modifier: Modifier = Modifier): Modifier =
        if (opened == key) modifier.bringIntoViewRequester(shows).focusRequester(focuses).testTag(LAB_OPENED_SETTING_TAG) else modifier
}

/**
 * Takes each request in [asked] (and clears it): with [enabled], marks that setting, runs [first] (a list scrolls to
 * the item that holds it, so it is composed), then brings it into view and focuses it. The requests are collected in
 * one effect, so clearing [asked] does not cancel the one being answered.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun rememberOpenedSetting(asked: MutableState<String?>, enabled: Boolean, first: suspend () -> Unit = {}): OpenedSetting {
    val s = remember { OpenedSetting() }
    val on by rememberUpdatedState(enabled)
    val before by rememberUpdatedState(first)
    LaunchedEffect(asked) {
        snapshotFlow { asked.value }.filterNotNull().collect { key ->
            asked.value = null
            if (!on) return@collect
            s.opened = key
            withFrameNanos { }
            before()
            // After the layout that placed it: into view, then focused.
            withFrameNanos { }
            runCatching { s.shows.bringIntoView() }
            runCatching { s.focuses.requestFocus() }
        }
    }
    return s
}

/** The Daylight Inbox: the pairing code, how items reach the Reader, and what arrived. */
@Composable
fun InboxScreen(activity: MainActivity, onSettings: () -> Unit) {
    val app = App.of(activity)
    val received by app.inbox.items.collectAsStateWithLifecycle()
    val pairing by app.inbox.pairingFlow.collectAsStateWithLifecycle()
    val sync by app.inbox.sync.collectAsStateWithLifecycle()
    val live by Live.state.collectAsStateWithLifecycle()
    val resumes = activity.resumes.intValue
    val targets = remember(resumes) { ReaderApps.targets(activity) }
    val overlay = remember(resumes) { Settings.canDrawOverlays(activity) }
    val unrestricted = remember(resumes) {
        activity.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(activity.packageName) == true
    }
    val notifOk = remember(resumes) { Handoff.notificationsAllowed(activity) }
    val channelImportance = remember(resumes) { Handoff.itemsChannelImportance(activity) }
    var instant by remember { mutableStateOf(app.prefs.instantDelivery) }
    var docMode by remember { mutableStateOf(app.prefs.documentMode) }
    var showPairing by remember { mutableStateOf<Boolean?>(null) }
    var confirmReset by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val notice = activity.notice.value
    // The one-time background relay check's warning (it never changes the saved relay): shown until the relay changes.
    val relayWarning = remember(resumes, pairing) { app.prefs.inboxRelayWarning?.takeIf { app.prefs.inboxRelayChecked == app.prefs.inboxRelay } }

    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { activity.resumes.intValue++ }
    fun openSettings(action: String, extra: Pair<String, String>? = null, fallback: String) {
        try {
            val i = Intent(action).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            extra?.let { i.putExtra(it.first, it.second) }
            activity.startActivity(i)
        } catch (e: ActivityNotFoundException) {
            activity.notice.value = fallback
        }
    }
    LaunchedEffect(Unit) {
        if (!notifOk && !app.prefs.askedNotifications && Build.VERSION.SDK_INT >= 33) {
            app.prefs.askedNotifications = true
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    val pairingOpen = showPairing ?: received.isEmpty()
    // Lab (LAB-PLAN 1.2): the one-time note, from the first W1 build, while Lab is on.
    val lab by app.labOn.collectAsStateWithLifecycle()
    val labNote = lab && app.prefs.labNoteDue()
    // Lab (F15): the health card's line and its one warning (Instant delivery stopped, notifications off, the poll's error).
    val stopped = remember(resumes, live, instant) { InboxHealth.stopped(app) }
    // Lab: K6: who receives for this pairing (the handover to the Lab Reader).
    val handover by app.handover.state.collectAsStateWithLifecycle()
    // Lab (1.5, 1.4; K5 review): Setup check's "Open setting" for Instant delivery, and F15's row, open this screen at
    // that setting with its footer. "Getting items to the Reader" comes after these items (keep the count in step).
    val list = rememberLazyListState()
    val deliverItem = listOf(true, lab, handover.elsewhere != null, notice != null, labNote, sync.storeFull, relayWarning != null, true).count { it }
    val opened = rememberOpenedSetting(activity.inboxFocus, lab) { list.scrollToItem(deliverItem) }

    ScreenList(list) {
        item {
            HeaderRow(title = {
                Text("Daylight Inbox", style = MaterialTheme.typography.headlineSmall)
                Text(
                    when {
                        // A limit reported while connected stays visible (what it held back arrives later).
                        live == Live.State.LIVE && sync.error != null -> "Connected · ${sync.error}"
                        live == Live.State.LIVE -> "Connected · items arrive right away"
                        sync.checking -> "Checking…"
                        sync.error != null -> sync.error!!
                        sync.lastCheck > 0 -> "Checked ${ago(sync.lastCheck)}"
                        else -> "Not checked yet"
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }) {
                SecondaryButton("Settings") { onSettings() }
            }
        }
        // Lab (F15): the Inbox's health, at the top.
        if (lab) item {
            InboxHealthCard(
                activity,
                line = InboxHealth.line(sync.lastCheck, live == Live.State.LIVE, instant, System.currentTimeMillis()),
                warning = InboxHealth.warning(stopped, notifOk, sync.error),
                pollError = sync.error,
                onTurnOn = {
                    instant = true
                    InboxHealth.turnOn(activity)
                    activity.resumes.intValue++
                },
            )
        }
        // Lab: K6 (LAB-PLAN 5.3.4): while the Lab Reader receives for this Daylight, the Inbox says so.
        if (handover.elsewhere != null) item { com.daylight.share.inbox.handover.HandoverLine(activity) }
        if (notice != null) item {
            Section {
                Text(notice, modifier = Modifier.announced())
                TextAction("OK") { activity.notice.value = null }
            }
        }
        if (labNote) item { LabOneTimeNote(app) }
        if (sync.storeFull) item {
            Section { Text(InboxText.OUT_OF_SPACE) }
        }
        if (relayWarning != null) item {
            Section("The relay") {
                Text(relayWarning)
                Text("Change it in Settings › Relay, or use ntfy.sh.", style = MaterialTheme.typography.bodySmall)
            }
        }

        item {
            val p = pairing
            Section("Pair a phone or computer") {
                if (!pairingOpen) {
                    Text("Phones paired with this Daylight send here. To add another, show the code.", style = MaterialTheme.typography.bodyMedium)
                    SecondaryButton("Show pairing code") { showPairing = true }
                } else if (p != null) {
                    Text("On your phone, open Daylight Share and scan this code (or point the camera app at it). On a computer, type the code.", style = MaterialTheme.typography.bodyMedium)
                    QrCode(p.link(), Modifier.widthIn(max = 300.dp).fillMaxWidth().align(Alignment.CenterHorizontally))
                    val groups = p.code.split('-')
                    Mono(groups.take(4).joinToString("-"), Modifier.align(Alignment.CenterHorizontally))
                    Mono(groups.drop(4).joinToString("-"), Modifier.align(Alignment.CenterHorizontally))
                    Text(
                        "Name: ${p.name.ifEmpty { "Daylight" }}" + if (p.relay != Limits.DEFAULT_RELAY) " · relay ${Relay.host(p.relay)}" else " · relay ntfy.sh",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(LIMITS_LINE, style = MaterialTheme.typography.bodySmall)
                    Buttons {
                        SecondaryButton("Reset pairing") { confirmReset = true }
                        if (received.isNotEmpty()) SecondaryButton("Hide") { showPairing = false }
                    }
                }
            }
        }

        item {
            Section("Getting items to the Reader") {
                if (targets.isEmpty()) {
                    Text("Daylight Reader isn’t installed. Items stay here; open them with another app.", style = MaterialTheme.typography.bodyMedium)
                }
                // One control (label, line and state together), and static: the Inbox never animates (F27).
                Box(opened.mark(INBOX_FOCUS_INSTANT, Modifier.fillMaxWidth())) {
                    SwitchRow(
                        "Instant delivery", instant,
                        detail = "Keeps a connection open so items arrive within seconds (a small notification stays). Off: every 15 minutes, and whenever this screen is open.",
                    ) {
                        instant = it
                        app.prefs.instantDelivery = it
                        if (it) InstantDeliveryService.start(activity) else InstantDeliveryService.stop(activity)
                    }
                }
                if (instant && !unrestricted) {
                    Text("With the screen off, Android pauses connections to save battery. Let Daylight Share run unrestricted to keep Instant delivery instant.", style = MaterialTheme.typography.bodySmall)
                    SecondaryButton("Allow running in the background") {
                        try {
                            activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}")))
                        } catch (e: ActivityNotFoundException) {
                            activity.notice.value = "Open Settings › Apps › Daylight Share › Battery and choose Unrestricted."
                        }
                    }
                }
                HorizontalDivider(color = Ink)
                // Android blocks apps from opening other apps from the background, unless "Display over other apps" is on.
                Text("Android lets the Inbox open the Reader only while you’re looking at it, unless you allow “Display over other apps”; without it, new items wait for a tap on a notification.", style = MaterialTheme.typography.bodyMedium)
                if (!overlay) {
                    PrimaryButton("Allow “Display over other apps”") {
                        try {
                            activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}")))
                        } catch (e: ActivityNotFoundException) {
                            activity.notice.value = "Open Settings › Apps › Daylight Share › Display over other apps."
                        }
                    }
                } else {
                    Text("Allowed ✓ Links and pages go to the Reader as they arrive; documents that wait for a tap get a card over the Reader.", style = MaterialTheme.typography.bodyMedium)
                }
                HorizontalDivider(color = Ink)
                Text("Documents", style = MaterialTheme.typography.bodyLarge)
                Text("When a PDF or another document arrives while you use another app:", style = MaterialTheme.typography.bodySmall)
                Column(Modifier.selectableGroup()) {
                    for (m in DocumentMode.entries) {
                        Choice(m.label, docMode == m, detail = documentModeDetail(m)) {
                            docMode = m
                            app.prefs.documentMode = m
                        }
                    }
                }
                if (docMode.automatic && !overlay) {
                    Text("This needs “Display over other apps” (above). Until then, documents wait for a tap on their notification.", style = MaterialTheme.typography.bodySmall)
                }
                if (!notifOk) {
                    Text("Notifications are off, so items that wait for a tap stay here unseen until you open the Inbox.", style = MaterialTheme.typography.bodySmall)
                    SecondaryButton("Allow notifications") {
                        if (Build.VERSION.SDK_INT >= 33 &&
                            (!app.prefs.askedNotifications || activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
                        ) {
                            app.prefs.askedNotifications = true
                            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            openSettings(Settings.ACTION_APP_NOTIFICATION_SETTINGS, fallback = "Open Settings › Apps › Daylight Share › Notifications.")
                        }
                    }
                } else if (channelImportance != null && channelImportance < NotificationManager.IMPORTANCE_HIGH) {
                    Text(
                        if (channelImportance == NotificationManager.IMPORTANCE_NONE) "Notifications for new items are turned off, so items that wait for a tap stay here unseen."
                        else "Notifications for new items don’t pop up over the Reader. Set “New items” to pop on screen to see them while you read.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    SecondaryButton("Notification settings") {
                        openSettings(
                            Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, Settings.EXTRA_CHANNEL_ID to App.CH_ITEMS,
                            fallback = "Open Settings › Apps › Daylight Share › Notifications › New items.",
                        )
                    }
                }
                // Lab (F15): "Arrival notices" and "Quiet hours", with the Inbox's other ways of getting items to the Reader.
                if (lab) {
                    HorizontalDivider(color = Ink)
                    ArrivalSettings(app, opened.mark(INBOX_FOCUS_ARRIVALS, Modifier.fillMaxWidth()))
                }
            }
        }

        item {
            HeaderRow(title = { Text("Received", style = MaterialTheme.typography.titleLarge) }) {
                SecondaryButton("Check now", enabled = !sync.checking) {
                    scope.launch { if (app.inbox.pollOnce() > 0) Handoff.dispatch(activity) }
                }
            }
        }
        if (received.isEmpty()) item {
            Text("Nothing yet. Share a link or a file from a paired phone with “Send to Daylight”.", style = MaterialTheme.typography.bodyMedium)
        }
        items(received, key = { it.id }) { item -> ItemRow(activity, item, targets.isNotEmpty(), lab) }
    }

    if (confirmReset) {
        DaylightDialog(
            title = "Reset pairing?",
            text = "This makes a new code. Every phone and computer paired with this Daylight has to pair again.",
            confirm = "Reset",
            onConfirm = {
                confirmReset = false
                app.inbox.resetPairing()
                showPairing = true
            },
            onDismiss = { confirmReset = false },
        )
    }
}

private fun documentModeDetail(m: DocumentMode): String = when (m) {
    DocumentMode.ASK -> "A card over the Reader (with “Display over other apps”) and a notification show its name. Tap Add to Reader to add it; the Reader opens it. Later keeps it here."
    DocumentMode.QUIET -> "Hands documents over together, for a Reader that adds a batch to its library without opening it. Today’s Daylight Reader doesn’t yet: it opens a single document, and for two or more it shows its library, which closes the document you’re reading."
    DocumentMode.OPEN -> "The Reader imports each document and opens it, even while you read something else."
}

/** Lab (F01): the test tag of an Inbox item's details (opened by a tap on its title). */
const val INBOX_DETAILS_TAG = "inbox-details"

/**
 * One received item. With Lab on (K5): a tap on the title shows its details (when it arrived and its size, "Cleaned
 * from {host}" for a link its sender cleaned, and F01's "Sender sees: {label}"); the line under the title is its kind
 * from its extras (F03, F11: "Page as you saw it", "Excerpt", "Link (the Reader downloads it)", … · from {from}); an
 * item kept for later says so ("Kept for later", F15). With Lab off it is v1.1's row.
 */
@Composable
private fun ItemRow(activity: MainActivity, item: InboxItem, readerInstalled: Boolean, lab: Boolean = false) {
    val app = App.of(activity)
    var open by remember(item.id) { mutableStateOf(false) }
    Section {
        if (lab) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = target())
                    .clickable(role = A11yRole.Button) { open = !open },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(item.displayTitle, style = MaterialTheme.typography.titleMedium, maxLines = titleLines(3), overflow = TextOverflow.Ellipsis)
            }
        } else {
            Text(item.displayTitle, style = MaterialTheme.typography.titleMedium, maxLines = titleLines(3), overflow = TextOverflow.Ellipsis)
        }
        val kind = when (item.kind) {
            Kind.URL -> "Link"
            Kind.PAGE -> "Web page"
            else -> (item.name?.substringAfterLast('.', "")?.uppercase()?.ifEmpty { null } ?: "Document")
        }
        val meta = listOfNotNull(
            kind,
            item.from?.let { "from $it" },
            ago(item.received),
            sizeText(item.size).ifEmpty { null },
        ).joinToString(" · ")
        // Lab (F03, F11): the kind line from the item's extras; v1.1: kind, sender, when and size.
        Text(if (lab) InboxLab.kindLine(item) else meta, style = MaterialTheme.typography.bodySmall)
        if (item.kind != Kind.FILE && item.url != null && item.title != null) {
            Text(item.url, style = MaterialTheme.typography.bodySmall, maxLines = titleLines(1), overflow = TextOverflow.Ellipsis)
        }
        // "In your Reader ✓" only when the Reader confirmed it (SAVE_PAGE: saved or duplicate); documents get no answer.
        val status = when (item.state) {
            InboxItem.IN_READER -> {
                val how = when (item.readerStatus) {
                    "duplicate" -> "already there"
                    "queued" -> "saving"
                    "started" -> "waiting for the Reader’s answer"
                    else -> null
                }
                val via = when (item.via) {
                    Path.SAVE_PAGE.key -> if (item.kind == Kind.PAGE) "as the page you saw" else "read later"
                    Path.SEND_LINK.key -> "shared link"
                    Path.VIEW_LINK.key -> "save link"
                    Path.SEND_MULTIPLE.key -> "with other documents"
                    else -> null
                }
                item.readerLabel + listOfNotNull(how, via).joinToString(", ").let { if (it.isEmpty()) "" else " ($it)" } +
                    (item.deliveredTo?.let { " · " + ReaderApps.label(activity, it) } ?: "")
            }
            // Lab (F15): kept for later on purpose; it waits for Add to Reader.
            else -> if (InboxLab.keptForLater(item, lab)) LabText["arrivals.keptForLater"] else item.readerLabel
        }
        // Announced when it changes ("In your Reader ✓"); it wraps, never truncates (F27).
        Text(status, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
        // Lab (F01, 2.3): the item's details, under its status, while open.
        if (lab && open) {
            Column(Modifier.fillMaxWidth().testTag(INBOX_DETAILS_TAG)) {
                Text(listOfNotNull(ago(item.received).ifEmpty { null }, sizeText(item.size).ifEmpty { null }).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                InboxLab.cleanedFrom(item)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                InboxLab.senderSees(item)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            }
        }
        // Handed over without the Reader's confirmation (a document, a shared link, or no answer yet): the Reader may
        // have dropped it (DEVICE-CHECKS.md, round 2), so it can be handed over again.
        val unconfirmed = item.state == InboxItem.IN_READER && !item.confirmedInReader
        val canHandOver = item.kind != Kind.FILE || item.file != null
        if (unconfirmed) {
            Text(InboxText.unconfirmedHint(item.kind), style = MaterialTheme.typography.bodySmall)
        }
        Buttons {
            if (readerInstalled && canHandOver && item.state != InboxItem.IN_READER) {
                PrimaryButton("Add to Reader") {
                    app.inbox.requeue(item.id)
                    Handoff.dispatch(activity)
                }
            } else if (readerInstalled && canHandOver && unconfirmed) {
                SecondaryButton("Add to Reader again") {
                    app.inbox.requeue(item.id)
                    Handoff.dispatch(activity)
                }
            }
            if (item.state != InboxItem.WAITING) {
                SecondaryButton("Open with…") {
                    val chooser = Routes.openWith(activity, item, app.inbox.fileOf(item))
                    if (chooser == null) activity.notice.value = "The content of this item is no longer stored."
                    else try {
                        activity.startActivity(chooser)
                    } catch (e: ActivityNotFoundException) {
                        activity.notice.value = "No app can open this."
                    }
                }
            }
            TextAction("Remove") { app.inbox.remove(item.id) }
        }
    }
}

// ------------------------------------------------------------------------------------------- Lab on the Inbox (K5)

/** The test tag of the Inbox's health card (F15). */
const val INBOX_HEALTH_TAG = "inbox-health"

/** The test tag of Setup check's Reader hand-off result (F26). */
const val INBOX_READER_TEST_TAG = "inbox-reader-test"

/**
 * The Inbox's health (F15), at the top of the Inbox with Lab on: "Last checked {rel} · Instant delivery on" (or
 * "off"), and one warning at a time: "Instant delivery stopped. …" with **Turn on**; notifications off ("Needs
 * notifications", with **Open Settings**); or the last poll's error, in the Inbox's own sentence. Every state is in
 * words, and nothing moves.
 */
@Composable
private fun InboxHealthCard(activity: MainActivity, line: String?, warning: InboxHealth.Warning?, pollError: String?, onTurnOn: () -> Unit) {
    if (line == null && warning == null) return
    Section(modifier = Modifier.testTag(INBOX_HEALTH_TAG)) {
        line?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        when (warning) {
            InboxHealth.Warning.STOPPED -> {
                Text(LabText["arrivals.stopped"], style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
                SecondaryButton(LabText["arrivals.turnOn"]) { onTurnOn() }
            }
            InboxHealth.Warning.NOTIFICATIONS -> {
                // The short state: the full sentence is the gate's, under F15's row when tapped (1.5, F00.7).
                Text(LabText.short("needs-notifications") ?: "", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
                SecondaryButton(LabText.button("needs-notifications") ?: "") { openNotificationSettings(activity) }
            }
            InboxHealth.Warning.POLL -> Text(pollError ?: "", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
            null -> Unit
        }
    }
}

/**
 * F15's settings on the Inbox screen: "Arrival notices" (Off, Quiet, Alert) and "Quiet hours" with its footer (LAB_TEXT's
 * `arrivals.quietHoursFooter`, Oct 22: the 22:00–07:00 it covers). [modifier] marks them when F15's row opened them.
 */
@Composable
private fun ArrivalSettings(app: App, modifier: Modifier = Modifier) {
    var mode by remember { mutableStateOf(InboxLab.arrivals(app)) }
    var quiet by remember { mutableStateOf(app.prefs.labQuietHours) }
    Column(modifier, verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp)) {
        Text(LabText["arrivals.setting"], style = MaterialTheme.typography.bodyLarge)
        Column(Modifier.selectableGroup()) {
            for (m in Arrivals.entries) {
                Choice(m.label, mode == m) {
                    mode = m
                    app.prefs.labArrivals = m.key
                }
            }
        }
        SwitchRow(LabText["arrivals.quietHours"], quiet, detail = LabText["arrivals.quietHoursFooter"]) {
            quiet = it
            app.prefs.labQuietHours = it
        }
    }
}

/**
 * Setup check on the DC-1 Inbox (F26): one line per check, "✓ {check}" or "! {check}", each unmet one with the button
 * that opens the right settings ("Open Settings": Android's notification, channel, overlay and battery settings;
 * "Open setting": Instant delivery on the Inbox screen, "Deliver to" in Settings); **Test the Reader hand-off**,
 * which hands the bundled test article to the Reader through the normal hand-off and shows the result ("✓ In your
 * Reader", or the item's own words until then); the activity log and Copy diagnostics, redacted.
 */
@Composable
fun InboxSetupCheck(activity: MainActivity, onBack: () -> Unit, onHome: () -> Unit, onSettings: () -> Unit) {
    val app = App.of(activity)
    val received by app.inbox.items.collectAsStateWithLifecycle()
    val sync by app.inbox.sync.collectAsStateWithLifecycle()
    val resumes = activity.resumes.intValue
    val scope = rememberCoroutineScope()
    var testId by remember { mutableStateOf(app.prefs.labReaderTestId) }
    var testError by remember { mutableStateOf<String?>(null) }
    var showLog by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val checks = remember(resumes) { InboxLab.checks(activity, batteryExempt(activity)) }
    val S = "setup"

    fun readerTest() {
        testError = null
        val item = InboxLab.startReaderTest(activity)
        if (item == null) testError = InboxText.OUT_OF_SPACE else testId = item.id
    }

    fun fix(id: String) {
        when (id) {
            "notifications" -> openNotificationSettings(activity)
            "newItemsChannel" -> openSystem(activity, Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, App.CH_ITEMS))
            "overlay" -> openSystem(activity, Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}")))
            "batteryOptimisation" -> openBatterySettings(activity)
            // 1.5 "Open setting": the setting comes into view with its footer (K5 review), never changed by itself.
            "instantDelivery" -> {
                activity.inboxFocus.value = INBOX_FOCUS_INSTANT
                onHome()
            }
            "reader" -> {
                activity.settingsFocus.value = SETTINGS_FOCUS_DELIVER_TO
                onSettings()
            }
            // The Reader turned pages down: its steps say what to change there, then test again (LAB-PLAN 1.6, Oct 22).
            "readerReadLater" -> readerTest()
        }
    }

    ScreenColumn(padding = 16.dp) {
        HeaderRow(title = {
            Text(LabText["$S.title"], style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        }) {
            SecondaryButton("Done") { onBack() }
        }
        Section {
            checks.forEachIndexed { i, c ->
                if (i > 0) HorizontalDivider(color = Ink)
                InboxCheckLine(LabText["$S.checks.${c.id}"], c.ok, checkButton(c.id), checkSteps(c.id)) { fix(c.id) }
            }
        }

        Section {
            PrimaryButton(LabText["$S.readerTest"]) { readerTest() }
            testError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }
            val test = received.firstOrNull { it.id == testId }
            if (test != null) {
                val inReader = test.confirmedInReader
                Column(Modifier.fillMaxWidth().testTag(INBOX_READER_TEST_TAG)) {
                    Text(
                        if (inReader) LabText.fill(LabText["$S.ok"], mapOf("check" to LabText["$S.inReader"])) else LabText["$S.inReader"],
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    // Until the Reader confirms it: the item's own words ("Waiting", "Handed to the Reader", …).
                    if (!inReader) Text(test.readerLabel, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
                }
            }
        }

        Section {
            SecondaryButton(LabText["$S.activity"]) { showLog = !showLog }
            if (showLog) {
                val lines = remember(showLog, received) { ActivityLog.read(activity).map(SetupCheck::activityLine) }
                Text(lines.joinToString("\n").ifEmpty { LabText["diagnostics.noEvents"] }, style = MaterialTheme.typography.bodySmall)
            }
            SecondaryButton(LabText["$S.copyDiagnostics"]) {
                scope.launch {
                    val report = inboxDiagnostics(app, sync.lastCheck)
                    copyText(activity, LabText["$S.copyDiagnostics"], report)
                    copied = true
                }
            }
            if (copied) Text(LabText["$S.copied"], style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
        }
    }
}

/**
 * The button of an unmet check (F26.3): "Open Settings" for Android's settings, "Open setting" for this app's own
 * (Instant delivery, Deliver to). The Reader's read-later is the Reader's own setting: its steps say where, and its
 * button is **Test the Reader hand-off** (LAB_TEXT's `setup.steps.readerReadLater` and `setup.readerTest`, Oct 22).
 */
private fun checkButton(id: String): String? = when (id) {
    "notifications", "newItemsChannel", "overlay", "batteryOptimisation" -> LabText.button("needs-notifications")
    "instantDelivery", "reader" -> LabText.button("needs-quick-sends")
    "readerReadLater" -> LabText["setup.readerTest"]
    else -> null
}

/** The steps under an unmet check, for a setting this app cannot open (the Reader's own), or null. */
private fun checkSteps(id: String): String? = if (id == "readerReadLater") LabText["setup.steps.readerReadLater"] else null

/** Opens one of Android's settings screens; when the device has none for it, the app's details. */
private fun openSystem(context: Context, intent: Intent) {
    try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        runCatching {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/** One check: "✓ {check}" or "! {check}", and for an unmet one its [steps] and its [button]. */
@Composable
private fun InboxCheckLine(check: String, ok: Boolean, button: String?, steps: String? = null, onFix: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(LabText.fill(LabText[if (ok) "setup.ok" else "setup.notOk"], mapOf("check" to check)), style = MaterialTheme.typography.bodyLarge)
        if (!ok && steps != null) Text(steps, style = MaterialTheme.typography.bodyMedium)
        if (!ok && button != null) SecondaryButton(button) { onFix() }
    }
}

/**
 * Copy diagnostics on the Inbox (F26): the app, version and platform ("inbox"), Lab on or off, the caps this Daylight
 * says it has, its last check, no outbox (it sends none), the relay as "ntfy.sh" or "custom relay", and the last 50
 * events, all through `SetupCheck.diagnosticsReport` (redacted).
 */
private suspend fun inboxDiagnostics(app: App, lastCheck: Long): String = withContext(Dispatchers.IO) {
    SetupCheck.diagnosticsReport(
        app = LabText.appName(InboxLab.PLATFORM),
        version = BuildConfig.VERSION_NAME,
        platform = InboxLab.PLATFORM,
        lab = app.prefs.lab,
        caps = runCatching { app.labReporter.caps() }.getOrDefault(emptyList()),
        checkedIn = lastCheck.takeIf { it > 0 },
        statuses = emptyList(),
        relay = app.prefs.inboxRelay,
        log = ActivityLog.read(app),
        now = System.currentTimeMillis(),
    )
}
