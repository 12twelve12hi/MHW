package com.daylight.share.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.Prefs
import com.daylight.share.Role
import com.daylight.share.core.Limits
import com.daylight.share.core.Relay
import com.daylight.share.core.ShareException
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.ReaderApps

/** First launch: which device is this? */
@Composable
fun RoleScreen(activity: MainActivity, onPick: (Role) -> Unit) {
    val suggestInbox = remember { Prefs.looksLikeDaylight(activity) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Daylight Share", style = MaterialTheme.typography.headlineSmall)
        Text("Send articles, web pages and documents from your phone to your Daylight, where they go into the Daylight Reader.", style = MaterialTheme.typography.bodyLarge)
        Text("Which device is this?", style = MaterialTheme.typography.titleLarge)
        val inbox: @Composable () -> Unit = {
            Section(if (suggestInbox) "This is my Daylight (suggested)" else "This is my Daylight") {
                Text("Receive what your phone sends and hand it to the Daylight Reader. Shows a code your phone scans once.")
                PrimaryButton("This is my Daylight", Modifier.fillMaxWidth()) { onPick(Role.INBOX) }
            }
        }
        val sender: @Composable () -> Unit = {
            Section(if (suggestInbox) "Send from this phone" else "Send from this phone (suggested)") {
                Text("Adds “Send to Daylight” to the share menu, for links and files.")
                PrimaryButton("Send from this phone", Modifier.fillMaxWidth()) { onPick(Role.SENDER) }
            }
        }
        if (suggestInbox) { inbox(); sender() } else { sender(); inbox() }
        Text("You can change this later in Settings.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun SettingsScreen(activity: MainActivity, onBack: () -> Unit) {
    val app = App.of(activity)
    val role by app.role.collectAsStateWithLifecycle()
    var name by remember { mutableStateOf(app.prefs.deviceName) }
    val currentRelay = if (role == Role.INBOX) app.prefs.inboxRelay else app.sender.pairing()?.relay ?: Limits.DEFAULT_RELAY
    var relay by remember(role) { mutableStateOf(currentRelay) }
    var relayError by remember { mutableStateOf<String?>(null) }
    var confirmRole by remember { mutableStateOf<Role?>(null) }
    var deliverTo by remember { mutableStateOf(app.prefs.deliverTo) }
    var saved by remember { mutableStateOf<String?>(null) }
    @Suppress("UNUSED_VARIABLE") val tick = activity.resumes.intValue

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Settings", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            SecondaryButton("Done") { onBack() }
        }
        saved?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }

        Section("This device") {
            Choice("This is my Daylight (Inbox)", role == Role.INBOX) { if (role != Role.INBOX) confirmRole = Role.INBOX }
            Choice("Send from this device", role == Role.SENDER) { if (role != Role.SENDER) confirmRole = Role.SENDER }
            OutlinedTextField(
                value = name, onValueChange = { name = it.take(60) }, singleLine = true,
                label = { Text(if (role == Role.INBOX) "Daylight name (shown to senders)" else "Device name (shown on the Daylight)") },
                modifier = Modifier.fillMaxWidth(),
            )
            SecondaryButton("Save name") {
                app.prefs.deviceName = name
                if (role == Role.INBOX) app.inbox.refreshPairing()
                name = app.prefs.deviceName
                saved = "Saved."
            }
        }

        Section("Relay") {
            Text(
                if (role == Role.INBOX) "Items travel through an ntfy relay, end-to-end encrypted. Changing it changes the pairing code: senders pair again."
                else "The ntfy relay your Daylight uses. It comes with the pairing; change it only if your Daylight did.",
                style = MaterialTheme.typography.bodyMedium,
            )
            OutlinedTextField(
                value = relay, onValueChange = { relay = it; relayError = null }, singleLine = true, label = { Text("Relay URL") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                isError = relayError != null, modifier = Modifier.fillMaxWidth(),
            )
            relayError?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SecondaryButton("Save relay") {
                    try {
                        val r = Relay.normalize(relay)
                        if (role == Role.INBOX) {
                            app.prefs.inboxRelay = r
                            app.inbox.refreshPairing()
                        } else {
                            app.sender.setRelay(r)
                        }
                        relay = r
                        saved = "Relay saved."
                    } catch (e: ShareException) {
                        relayError = e.message
                    }
                }
                SecondaryButton("Use ntfy.sh") { relay = Limits.DEFAULT_RELAY }
            }
        }

        if (role == Role.INBOX) {
            val readers = remember(activity.resumes.intValue) { ReaderApps.installed(activity) }
            val apps = remember(activity.resumes.intValue) { ReaderApps.candidates(activity) }
            Section("Deliver to") {
                Text("Which app gets the items. Automatic is the Daylight Reader; any other app that takes saved pages or documents (such as a side-by-side test copy of the Reader) can be chosen here. What the chosen app doesn’t take goes to Automatic.", style = MaterialTheme.typography.bodyMedium)
                Choice(
                    "Automatic",
                    deliverTo.isEmpty(),
                    detail = if (readers.isEmpty()) "No Daylight Reader found" else ReaderApps.label(activity, readers.first()),
                ) {
                    deliverTo = ""
                    app.prefs.deliverTo = ""
                }
                for (c in apps) {
                    val takes = listOfNotNull(if (c.links) "links and pages" else null, if (c.documents) "documents" else null).joinToString(" and ")
                    val rest = when {
                        !c.documents -> "; documents go to Automatic"
                        !c.links -> "; links and pages go to Automatic"
                        else -> ""
                    }
                    Choice(c.label, deliverTo == c.pkg, detail = "${c.pkg} · takes $takes$rest") {
                        deliverTo = c.pkg
                        app.prefs.deliverTo = c.pkg
                    }
                }
                if (deliverTo.isNotEmpty() && apps.none { it.pkg == deliverTo }) Text("$deliverTo is not installed; using Automatic.", style = MaterialTheme.typography.bodySmall)
            }
        }

        if (role == Role.SENDER && app.sender.pairing() != null) {
            Section("Pairing") {
                Text("Paired with ${app.sender.pairing()?.name?.ifEmpty { "a Daylight" }}.")
                SecondaryButton("Unpair") {
                    app.sender.unpair()
                    saved = "Unpaired."
                }
            }
        }

        Section("About") {
            Text("Daylight Share ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})${if (BuildConfig.DEBUG) " debug" else ""}")
            Text("Protocol: Daylight Share v1 over ntfy, AES-256-GCM end to end.", style = MaterialTheme.typography.bodySmall)
        }
    }

    val target = confirmRole
    if (target != null) {
        AlertDialog(
            onDismissRequest = { confirmRole = null },
            title = { Text(if (target == Role.INBOX) "Make this the Daylight Inbox?" else "Send from this device?") },
            text = {
                Text(
                    if (target == Role.INBOX) "It will receive items and hand them to the Daylight Reader. Phones pair with the code it shows."
                    else "It stops receiving. Its pairing code stays, in case you switch back."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmRole = null
                    if (target == Role.SENDER) InstantDeliveryService.stop(activity)
                    app.setRole(target)
                    onBack()
                }) { Text("Switch") }
            },
            dismissButton = { TextButton(onClick = { confirmRole = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun Choice(label: String, selected: Boolean, detail: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick, colors = RadioButtonDefaults.colors(selectedColor = Ink, unselectedColor = Ink))
        Column(Modifier.widthIn(min = 0.dp).padding(start = 4.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}
