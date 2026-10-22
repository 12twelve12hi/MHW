package com.daylight.share.ui

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
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
import com.daylight.share.sender.Shared
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
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

    LaunchedEffect(pairing) { app.sender.refresh() }

    fun sendShared(s: Shared) {
        busy = true
        message = null
        scope.launch {
            try {
                val row = app.sender.add(s)
                val r = app.sender.publish(row.id) ?: row
                message = RowText.of(r).line
                if (s is Shared.Link) link = ""
            } catch (e: ShareException) {
                message = e.message
            } finally {
                busy = false
            }
        }
    }

    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) sendShared(Shared.Stream(uri, null))
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
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
        if (pairing == null) {
            item { PairSection(activity) }
        } else {
            item {
                Section("Send a link") {
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
                }
            }
            item {
                HeaderRow(title = { Text("Sent", style = MaterialTheme.typography.titleLarge) }) {
                    SecondaryButton("Check deliveries") { scope.launch { app.sender.tick() } }
                }
            }
            if (rows.isEmpty()) item {
                Text("Nothing sent yet.", style = MaterialTheme.typography.bodyMedium)
            }
            items(rows, key = { it.id }) { row -> OutboxRowView(row, onRetry = { scope.launch { app.sender.retry(row.id) } }, onRemove = { scope.launch { app.sender.remove(row.id) } }) }
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
