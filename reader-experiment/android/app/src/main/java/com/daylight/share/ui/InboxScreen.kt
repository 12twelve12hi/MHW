package com.daylight.share.ui

import android.Manifest
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.Relay
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.InboxItem
import com.daylight.share.inbox.InboxText
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.Live
import com.daylight.share.inbox.Path
import com.daylight.share.inbox.ReaderApps
import com.daylight.share.inbox.Routes
import kotlinx.coroutines.launch

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

    ScreenList {
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
                SwitchRow(
                    "Instant delivery", instant,
                    detail = "Keeps a connection open so items arrive within seconds (a small notification stays). Off: every 15 minutes, and whenever this screen is open.",
                ) {
                    instant = it
                    app.prefs.instantDelivery = it
                    if (it) InstantDeliveryService.start(activity) else InstantDeliveryService.stop(activity)
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
        items(received, key = { it.id }) { item -> ItemRow(activity, item, targets.isNotEmpty()) }
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

@Composable
private fun ItemRow(activity: MainActivity, item: InboxItem, readerInstalled: Boolean) {
    val app = App.of(activity)
    Section {
        Text(item.displayTitle, style = MaterialTheme.typography.titleMedium, maxLines = titleLines(3), overflow = TextOverflow.Ellipsis)
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
        Text(meta, style = MaterialTheme.typography.bodySmall)
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
            else -> item.readerLabel
        }
        // Announced when it changes ("In your Reader ✓"); it wraps, never truncates (F27).
        Text(status, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
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
