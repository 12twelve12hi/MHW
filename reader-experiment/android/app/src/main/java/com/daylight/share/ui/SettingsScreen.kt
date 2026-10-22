package com.daylight.share.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.ReaderApps
import kotlinx.coroutines.launch

/** First launch: which device is this? */
@Composable
fun RoleScreen(activity: MainActivity, onPick: (Role) -> Unit) {
    val suggestInbox = remember { Prefs.looksLikeDaylight(activity) }
    ScreenColumn(padding = 20.dp) {
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
    var checking by remember { mutableStateOf(false) }
    val comfort by app.comfort.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    @Suppress("UNUSED_VARIABLE") val tick = activity.resumes.intValue

    ScreenColumn(padding = 16.dp) {
        HeaderRow(title = { Text("Settings", style = MaterialTheme.typography.headlineSmall) }) {
            SecondaryButton("Done") { onBack() }
        }
        saved?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }

        // The accessibility baseline (F27): every build has it, Lab on or off.
        Section {
            SwitchRow(A11yText.COMFORT, comfort, detail = A11yText.COMFORT_FOOTER) { app.setComfort(it) }
        }

        Section("This device") {
            Column(Modifier.selectableGroup()) {
                Choice("This is my Daylight (Inbox)", role == Role.INBOX) { if (role != Role.INBOX) confirmRole = Role.INBOX }
                Choice("Send from this device", role == Role.SENDER) { if (role != Role.SENDER) confirmRole = Role.SENDER }
            }
            Field(
                value = name, onValueChange = { name = it.take(60) },
                label = if (role == Role.INBOX) "Daylight name (shown to senders)" else "Device name (shown on the Daylight)",
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
                else "The ntfy relay your Daylight uses. It comes with the pairing; change it only if your Daylight did. Items not yet delivered are sent through the new one.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(RELAY_LIMITS, style = MaterialTheme.typography.bodySmall)
            Field(
                value = relay, onValueChange = { relay = it; relayError = null }, label = "Relay URL",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                errorText = relayError, modifier = Modifier.fillMaxWidth(),
            )
            relayError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }
            if (checking) Text("Checking the relay: sending a 2 MB test file through it…", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
            Buttons {
                SecondaryButton("Save relay", enabled = !checking) {
                    if (role != Role.INBOX) {
                        // Same secret, another relay: the outbox stays and pending items go through the new relay.
                        // Unpaired, there is no relay to change: it comes with the pairing.
                        val failure = app.sender.saveRelay(relay)
                        if (failure != null) {
                            relayError = failure
                        } else {
                            relay = app.sender.pairing()?.relay ?: relay
                            saved = "Relay saved."
                        }
                        return@SecondaryButton
                    }
                    val before = app.prefs.inboxRelay
                    checking = true
                    relayError = null
                    scope.launch {
                        // A relay other than ntfy.sh must take the largest frame a sender makes and give it back.
                        val failure = app.inbox.saveRelay(relay)
                        checking = false
                        if (failure != null) {
                            relayError = failure // the relay in use stays
                            return@launch
                        }
                        relay = app.prefs.inboxRelay
                        saved = if (relay == before) "Relay saved." else "Relay saved. Scan the code again on your phones: it now carries the new relay."
                    }
                }
                SecondaryButton("Use ntfy.sh", enabled = !checking) { relay = Limits.DEFAULT_RELAY }
            }
        }

        if (role == Role.INBOX) {
            val readers = remember(activity.resumes.intValue) { ReaderApps.installed(activity) }
            val apps = remember(activity.resumes.intValue) { ReaderApps.candidates(activity) }
            Section("Deliver to") {
                Text("Which app gets the items. Automatic is the Daylight Reader; any other app that takes saved pages or documents (such as a side-by-side test copy of the Reader) can be chosen here. What the chosen app doesn’t take goes to Automatic.", style = MaterialTheme.typography.bodyMedium)
                Column(Modifier.selectableGroup()) {
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
        DaylightDialog(
            title = if (target == Role.INBOX) "Make this the Daylight Inbox?" else "Send from this device?",
            text = if (target == Role.INBOX) "It will receive items and hand them to the Daylight Reader. Phones pair with the code it shows."
            else "It stops receiving. Its pairing code stays, in case you switch back.",
            confirm = "Switch",
            onConfirm = {
                confirmRole = null
                if (target == Role.SENDER) InstantDeliveryService.stop(activity)
                app.setRole(target)
                onBack()
            },
            onDismiss = { confirmRole = null },
        )
    }
}

/** The accessibility baseline's words (F27; `LAB_TEXT.comfort` and `comfortFooter` in share/js/daylight-lab.js). */
object A11yText {
    const val COMFORT = "Comfort"
    const val COMFORT_FOOTER = "Larger text and buttons, more contrast, no motion."
}

/** What the relay takes and keeps (PROTOCOL 3.5), said plainly. */
const val RELAY_LIMITS = "ntfy.sh, the default relay, is free and needs no account. It keeps links for 12 hours and files for 3 hours, takes files in parts of up to 2 MB (Send to Daylight sends files of up to 9 MB that way), and lets each network send about 250 messages and 200 MB a day. Another ntfy server works if anyone can use it without a login and it accepts files of at least 2 MB; the Inbox checks that before saving it."
