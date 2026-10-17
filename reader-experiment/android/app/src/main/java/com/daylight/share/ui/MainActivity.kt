package com.daylight.share.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.Role
import com.daylight.share.core.Pairing
import com.daylight.share.core.ShareException
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.Live
import com.daylight.share.logi
import kotlinx.coroutines.launch

/** The app: role choice, the Daylight Inbox, the sender, settings. Also opens `daylightshare://pair` links. */
class MainActivity : ComponentActivity() {
    private lateinit var app: App

    /** Bumped on every resume, so permission-dependent UI re-reads its state. */
    val resumes = mutableIntStateOf(0)

    /** A one-line message at the top ("Paired with …", errors). */
    val notice = mutableStateOf<String?>(null)

    /** A pairing link opened on a device that is set up as the Inbox: asks before switching. */
    private val pendingPair = mutableStateOf<Pairing?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = App.of(this)
        if (savedInstanceState == null) handleLink(intent)
        setContent {
            DaylightTheme {
                Surface(Modifier.fillMaxSize()) {
                    Box(Modifier.safeDrawingPadding()) { Root() }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    override fun onStart() {
        super.onStart()
        Live.acquire(LIVE_HOLDER)
    }

    override fun onResume() {
        super.onResume()
        resumes.intValue++
        when (app.prefs.role) {
            Role.INBOX -> {
                Handoff.dispatch(this)
                lifecycleScope.launch { if (app.inbox.pollOnce() > 0) Handoff.dispatch(this@MainActivity) }
            }
            Role.SENDER -> lifecycleScope.launch { app.sender.tick() }
            null -> Unit
        }
    }

    override fun onStop() {
        Live.release(LIVE_HOLDER)
        super.onStop()
    }

    private fun handleLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW || data.scheme != Pairing.SCHEME) return
        when (data.host) {
            "pair" -> {
                val p = try {
                    Pairing.parse(data.toString())
                } catch (e: ShareException) {
                    notice.value = "That pairing link doesn’t work: ${e.message}"
                    return
                }
                if (app.prefs.role == Role.INBOX) pendingPair.value = p else pairSender(p)
            }
            "setup" -> if (BuildConfig.DEBUG) debugSetup(data.toString()) else notice.value = "Setup links work in debug builds only."
        }
    }

    fun pairSender(p: Pairing) {
        app.sender.pair(p)
        if (app.prefs.role != Role.SENDER) app.setRole(Role.SENDER)
        notice.value = "Paired with ${p.name.ifEmpty { "your Daylight" }}. Share links and files with “Send to Daylight”."
        lifecycleScope.launch { app.sender.refresh() }
    }

    /**
     * Debug builds only, for automated tests:
     * `daylightshare://setup?role=inbox|sender&c=<code>[&r=<relay>][&n=<name>][&instant=1][&auto=1]`.
     * Sets the role and uses that pairing secret (instead of generating one) and relay; `instant` turns on Instant
     * delivery, `auto` lets the Inbox hand documents over in the background too.
     */
    private fun debugSetup(link: String) {
        val q = Pairing.parseQuery(link.substringAfter('?', "").substringBefore('#'))
        val p = try {
            Pairing(Pairing.parseCode(q["c"]), q["r"] ?: "", q["n"] ?: "")
        } catch (e: ShareException) {
            notice.value = "setup: ${e.message}"
            logi("setup failed: ${e.message}")
            return
        }
        q["n"]?.takeIf { it.isNotBlank() }?.let { app.prefs.deviceName = it }
        q["instant"]?.let { app.prefs.instantDelivery = it == "1" || it == "true" }
        q["auto"]?.let { app.prefs.autoDocuments = it == "1" || it == "true" }
        when (q["role"]) {
            "sender" -> {
                app.sender.pair(p)
                app.setRole(Role.SENDER)
            }
            else -> {
                app.prefs.role = Role.INBOX
                app.inbox.usePairing(p)
                app.setRole(Role.INBOX)
            }
        }
        logi("setup: role=${app.prefs.role} relay=${p.relay} inbox=${p.keys.inboxTopic} instant=${app.prefs.instantDelivery} auto=${app.prefs.autoDocuments}")
        notice.value = "Set up as ${if (app.prefs.role == Role.INBOX) "the Daylight Inbox" else "a sender"} (relay ${p.relay})."
    }

    @Composable
    private fun Root() {
        val role by app.role.collectAsStateWithLifecycle()
        var settings by remember { mutableStateOf(false) }
        BackHandler(enabled = settings) { settings = false }
        when {
            role == null -> RoleScreen(this, onPick = { r -> app.setRole(r) })
            settings -> SettingsScreen(this, onBack = { settings = false })
            role == Role.INBOX -> InboxScreen(this, onSettings = { settings = true })
            else -> SenderScreen(this, onSettings = { settings = true })
        }
        val pair = pendingPair.value
        if (pair != null) {
            AlertDialog(
                onDismissRequest = { pendingPair.value = null },
                title = { Text("Send from this device?") },
                text = { Text("This device is set up as the Daylight Inbox. Pairing it with ${pair.name.ifEmpty { "that Daylight" }} makes it a sender instead; it stops receiving.") },
                confirmButton = {
                    TextButton(onClick = {
                        pendingPair.value = null
                        InstantDeliveryService.stop(this)
                        pairSender(pair)
                    }) { Text("Switch to sending") }
                },
                dismissButton = { TextButton(onClick = { pendingPair.value = null }) { Text("Cancel") } },
            )
        }
    }

    companion object {
        private const val LIVE_HOLDER = "screen"
    }
}
