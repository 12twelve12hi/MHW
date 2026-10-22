package com.daylight.share.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabGate
import com.daylight.share.core.lab.LabRowText
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.lab.SetupCheck
import com.daylight.share.sender.ActivityLog
import com.daylight.share.sender.PhoneLab
import com.daylight.share.sender.Shortcuts
import com.daylight.share.core.ShareException
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/*
 * Lab on the phone, Wave 1 (LAB-PLAN 3.3; card K4): what What's in Lab draws on the phone's rows (the Use switches of
 * 6.5 Q5, F04's and F09's settings), the F02 entry point under a too-big sentence, and Setup check (F26). Every word
 * comes from LAB_TEXT (`LabText`). Nothing here shows with Lab off.
 */

/** The test tag of Setup check's test-article lines. */
const val LAB_TEST_TAG = "lab-test"

/**
 * The switches under a phone feature's row in What's in Lab: its Use switch (6.5 Q5: on by default; the footer says
 * what turning it off does), F04's three settings and F09's "Allow quick sends from other apps" with its footer.
 * -> null for a feature with none.
 */
fun phoneRowExtras(app: App, feature: String): (@Composable () -> Unit)? {
    val use = feature in PhoneLab.USE
    if (!use && feature != "F04" && feature != "F09") return null
    return { PhoneRowExtras(app, feature, use) }
}

@Composable
private fun PhoneRowExtras(app: App, feature: String, use: Boolean) {
    Column(Modifier.fillMaxWidth()) {
        if (use) {
            var on by remember(feature) { mutableStateOf(app.prefs.labUse(feature)) }
            SwitchRow(LabText["use.label"], on, detail = LabText.useFooter(feature), a11yLabel = LabText.useA11y(feature)) {
                app.prefs.setLabUse(feature, it)
                on = it
                // F08 off: your Daylight leaves the share sheet's top row (it comes back with the next send).
                if (feature == "F08" && !it) Shortcuts.remove(app)
            }
        }
        when (feature) {
            "F04" -> {
                var always by remember { mutableStateOf(app.prefs.labAlwaysOptions) }
                var fails by remember { mutableStateOf(app.prefs.labTellFails) }
                var reader by remember { mutableStateOf(app.prefs.labTellReader) }
                SwitchRow(LabText["shareInPlace.alwaysOptions"], always) { app.prefs.labAlwaysOptions = it; always = it }
                SwitchRow(LabText["shareInPlace.tellFails"], fails) { app.prefs.labTellFails = it; fails = it }
                SwitchRow(LabText["shareInPlace.tellReader"], reader) { app.prefs.labTellReader = it; reader = it }
            }
            "F09" -> {
                var quick by remember { mutableStateOf(app.prefs.labQuickSends) }
                SwitchRow(LabText["automation.quickSends"], quick, detail = LabText["automation.quickSendsFooter"]) {
                    app.prefs.labQuickSends = it
                    quick = it
                }
            }
        }
    }
}

/** Opens this app's notification settings (the needs-notifications note's "Open Settings"). */
fun openNotificationSettings(context: Context) {
    val i = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(i)
    } catch (e: ActivityNotFoundException) {
        runCatching {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/** Opens Android's battery optimisation list (Setup check's unmet "Battery optimisation"). */
fun openBatterySettings(context: Context) {
    runCatching { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/** Whether Android leaves this app out of battery optimisation. */
fun batteryExempt(context: Context): Boolean =
    runCatching { context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true }.getOrDefault(false)

/**
 * The F02 entry point (LAB-PLAN 3.1): under the v1.1 too-big sentence, with Lab on, "Send files over 9 MB ›". It runs
 * the gate of Files over 9 MB: the needs-server sentence (with Copy Server code) until a Daylight server exists, and
 * `later` once one is ready (this app gets F02 in Wave S). "Checking your Daylight server…" shows while the server is
 * asked (at most 5 s).
 */
@Composable
fun BigFilesEntry(app: App) {
    val context = LocalContext.current
    var note by remember { mutableStateOf<LabGate.Result?>(null) }
    var checking by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var asked by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth()) {
        SecondaryButton(LabText["bigFiles"]) {
            val n = ++asked
            note = null
            copied = false
            scope.launch {
                val gate = scope.async { app.lab.gateNow("F02") }
                if (withTimeoutOrNull(300) { gate.await() } == null && asked == n) checking = true
                val r = gate.await()
                if (asked != n) return@launch
                checking = false
                note = r
            }
        }
        if (checking) LabNote(LabText.CHECKING)
        val r = note
        if (r != null && !r.ready) {
            LabNote(
                r.message ?: "",
                button = r.button,
                onButton = {
                    when (r.button) {
                        LabText.button("needs-server") -> {
                            copyText(context, LabText["serverSection.serverCode"], app.lab.serverCode())
                            copied = true
                        }
                        LabText.button("needs-notifications") -> openNotificationSettings(context)
                    }
                },
                followUp = if (copied) LabText["setup.copied"] else null,
                onOk = {
                    asked++
                    note = null
                },
            )
        }
    }
}

/**
 * Setup check on the phone (F26): one line per check, "✓ {check}" or "! {check}", each unmet one with the button that
 * opens the right settings (the pairing, Android's notification settings, its battery optimisation list); the hints
 * shown once (F03's link-only line, the first excerpt's); "Send a test article", followed along the timeline ("✓
 * Delivered", "✓ In your Reader", and the row's words until then); the activity log and Copy diagnostics, redacted.
 */
@Composable
fun PhoneSetupCheck(activity: MainActivity, onBack: () -> Unit, onExit: () -> Unit) {
    val app = App.of(activity)
    val scope = rememberCoroutineScope()
    val rows by app.sender.rows.collectAsStateWithLifecycle()
    val snap by app.sender.labSnapshot.collectAsStateWithLifecycle()
    var testError by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var showLog by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val resumes = activity.resumes.intValue
    val S = "setup"
    LaunchedEffect(Unit) { app.sender.refresh() }
    // The test article is followed while it is on its way (the ack topic every 30 s, as the timeline's faster checks).
    val testId = app.prefs.labTestId
    val testRow = rows.firstOrNull { it.id == testId }
    val testState = testRow?.let { snap?.state(it.id)?.s }
    LaunchedEffect(testId, testRow?.status, testState) {
        while (testRow != null && testState != "reader" && testRow.status != Status.EXPIRED) {
            delay(com.daylight.share.core.lab.Lab.FAST_CHECK_MS)
            if (app.inForeground) app.sender.tick()
        }
    }

    ScreenColumn(padding = 16.dp) {
        HeaderRow(title = {
            Text(LabText["$S.title"], style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        }) {
            SecondaryButton("Done") { onBack() }
        }
        val paired = app.sender.pairing() != null
        val notices = remember(resumes) { PhoneLab.notificationsOn(activity) }
        val battery = remember(resumes) { batteryExempt(activity) }
        Section {
            CheckLine(LabText["$S.checks.paired"], paired, LabText.button("needs-quick-sends")) { onExit() }
            HorizontalDivider(color = Ink)
            CheckLine(LabText["$S.checks.notifications"], notices, LabText.button("needs-notifications")) { openNotificationSettings(activity) }
            HorizontalDivider(color = Ink)
            CheckLine(LabText["$S.checks.batteryOptimisation"], battery, LabText.button("needs-notifications")) { openBatterySettings(activity) }
        }
        // Hints shown once stay listed here afterwards (F03, F11).
        val hints = listOfNotNull(
            LabText["linkOnly.android"].takeIf { app.prefs.labLinkOnlyShown },
            LabText["excerpt.waitsOnce"].takeIf { app.prefs.labExcerptNoteShown },
        )
        if (hints.isNotEmpty()) Section { for (h in hints) Text(h, style = MaterialTheme.typography.bodyMedium) }

        Section {
            PrimaryButton(LabText["$S.testSend"], enabled = paired && !sending) {
                sending = true
                testError = null
                scope.launch {
                    try {
                        app.sender.sendTestArticle()
                    } catch (e: ShareException) {
                        testError = e.message
                    } finally {
                        sending = false
                    }
                }
            }
            Text(LabText["$S.testFooter"], style = MaterialTheme.typography.bodySmall)
            testError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced()) }
            if (testRow != null) {
                val delivered = testRow.status == Status.DELIVERED
                val inReader = delivered && testState == "reader"
                Column(Modifier.testTag(LAB_TEST_TAG)) {
                    Text(if (delivered) LabText.fill(LabText["$S.ok"], mapOf("check" to LabText["$S.delivered"])) else LabText["$S.delivered"], style = MaterialTheme.typography.bodyLarge)
                    Text(if (inReader) LabText.fill(LabText["$S.ok"], mapOf("check" to LabText["$S.inReader"])) else LabText["$S.inReader"], style = MaterialTheme.typography.bodyLarge)
                    if (!inReader) {
                        val ctx = snap?.let { LabRowText.Context.of(true, it, testRow.id, PhoneLab.online(activity)) } ?: LabRowText.Context(true, online = PhoneLab.online(activity))
                        Text(LabRowText.of(testRow, System.currentTimeMillis(), ctx).label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
                    }
                }
            }
        }

        Section {
            SecondaryButton(LabText["$S.activity"]) { showLog = !showLog }
            if (showLog) {
                val lines = remember(showLog, rows) { ActivityLog.read(activity).map(SetupCheck::activityLine) }
                Text(lines.joinToString("\n").ifEmpty { LabText["diagnostics.noEvents"] }, style = MaterialTheme.typography.bodySmall)
            }
            SecondaryButton(LabText["$S.copyDiagnostics"]) {
                scope.launch {
                    val report = diagnostics(app)
                    copyText(activity, LabText["$S.copyDiagnostics"], report)
                    copied = true
                }
            }
            if (copied) Text(LabText["$S.copied"], style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
        }
    }
}

/** One check: "✓ {check}" or "! {check}", and for an unmet one its [button]. */
@Composable
private fun CheckLine(check: String, ok: Boolean, button: String?, onFix: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(LabText.fill(LabText[if (ok) "setup.ok" else "setup.notOk"], mapOf("check" to check)), style = MaterialTheme.typography.bodyLarge)
        if (!ok && button != null) SecondaryButton(button) { onFix() }
    }
}

/** Copy diagnostics (F26): already redacted by `SetupCheck.diagnosticsReport`. */
private suspend fun diagnostics(app: App): String = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val snap = runCatching { app.sender.ledger()?.snapshot() }.getOrNull()
    SetupCheck.diagnosticsReport(
        app = LabText.appName(PhoneLab.PLATFORM),
        version = BuildConfig.VERSION_NAME,
        platform = PhoneLab.PLATFORM,
        lab = app.prefs.lab,
        caps = snap?.caps ?: emptyList(),
        checkedIn = snap?.checkedIn,
        statuses = app.sender.rows.value.map { it.status },
        relay = app.sender.pairing()?.relay ?: "",
        log = ActivityLog.read(app),
        now = System.currentTimeMillis(),
    )
}
