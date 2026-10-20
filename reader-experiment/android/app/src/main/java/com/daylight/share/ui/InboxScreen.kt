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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.InboxItem
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

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Daylight Inbox", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        when {
                            live == Live.State.LIVE -> "Connected · items arrive right away"
                            sync.checking -> "Checking…"
                            sync.error != null -> "Offline: ${sync.error}"
                            sync.lastCheck > 0 -> "Checked ${ago(sync.lastCheck)}"
                            else -> "Not checked yet"
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                SecondaryButton("Settings") { onSettings() }
            }
        }
        if (notice != null) item {
            Section {
                Text(notice)
                TextButton(onClick = { activity.notice.value = null }) { Text("OK") }
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
                        "Name: ${p.name.ifEmpty { "Daylight" }}" + if (p.relay != Limits.DEFAULT_RELAY) " · relay ${p.relay}" else "",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Instant delivery", style = MaterialTheme.typography.bodyLarge)
                        Text("Keeps a connection open so items arrive within seconds (a small notification stays). Off: every 15 minutes, and whenever this screen is open.", style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(
                        checked = instant,
                        onCheckedChange = {
                            instant = it
                            app.prefs.instantDelivery = it
                            if (it) InstantDeliveryService.start(activity) else InstantDeliveryService.stop(activity)
                        },
                        colors = SwitchDefaults.colors(checkedTrackColor = Ink, checkedThumbColor = Paper, uncheckedBorderColor = Ink, uncheckedThumbColor = Ink),
                    )
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
                    Text("Allowed ✓ Links and pages go to the Reader as they arrive.", style = MaterialTheme.typography.bodyMedium)
                }
                HorizontalDivider(color = Ink)
                Text("Documents", style = MaterialTheme.typography.bodyLarge)
                Text("When a PDF or another document arrives while you use another app:", style = MaterialTheme.typography.bodySmall)
                for (m in DocumentMode.entries) {
                    Choice(m.label, docMode == m, detail = documentModeDetail(m)) {
                        docMode = m
                        app.prefs.documentMode = m
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Received", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
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
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Reset pairing?") },
            text = { Text("This makes a new code. Every phone and computer paired with this Daylight has to pair again.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    app.inbox.resetPairing()
                    showPairing = true
                }) { Text("Reset") }
            },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Cancel") } },
        )
    }
}

private fun documentModeDetail(m: DocumentMode): String = when (m) {
    DocumentMode.ASK -> "A notification pops up with its name; tap it to add the document to the Reader, which opens it."
    DocumentMode.QUIET -> "Handed over as a batch (several at once go to the library instead of opening). The Daylight Reader still opens a document that arrives on its own."
    DocumentMode.OPEN -> "The Reader imports each document and opens it, even while you read something else."
}

@Composable
private fun ItemRow(activity: MainActivity, item: InboxItem, readerInstalled: Boolean) {
    val app = App.of(activity)
    Section {
        Text(item.displayTitle, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
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
            Text(item.url, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val status = when (item.state) {
            InboxItem.IN_READER -> {
                val how = when (item.readerStatus) {
                    "saved" -> "saved"
                    "duplicate" -> "already there"
                    "queued" -> "saving"
                    "started" -> "handing over"
                    else -> null
                }
                val via = when (item.via) {
                    Path.SAVE_PAGE.key -> if (item.kind == Kind.PAGE) "as the page you saw" else "read later"
                    Path.SEND_LINK.key -> "shared link"
                    Path.VIEW_LINK.key -> "save link"
                    Path.SEND_MULTIPLE.key -> "with other documents"
                    else -> null
                }
                "In Reader ✓" + listOfNotNull(how, via).joinToString(", ").let { if (it.isEmpty()) "" else " ($it)" } +
                    (item.deliveredTo?.let { " · " + ReaderApps.label(activity, it) } ?: "")
            }
            InboxItem.OPEN -> "Open — not in the Reader"
            else -> "Waiting"
        }
        Text(status, style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (readerInstalled && item.state != InboxItem.IN_READER) {
                PrimaryButton("Add to Reader") {
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
            TextButton(onClick = { app.inbox.remove(item.id) }) { Text("Remove") }
        }
    }
}
