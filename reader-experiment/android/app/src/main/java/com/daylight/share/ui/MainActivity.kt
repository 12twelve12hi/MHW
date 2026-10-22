package com.daylight.share.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
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
import com.daylight.share.core.PairingConfirmation
import com.daylight.share.core.ShareException
import com.daylight.share.inbox.DocumentMode
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

    /** A pairing that waits for the user's answer (PROTOCOL 1.3 "Confirmation"), with what the dialog says. */
    class PendingPairing(val pairing: Pairing, val confirmation: PairingConfirmation, val inboxRole: Boolean)

    /** The pairing the dialog asks about, or null. */
    val pendingPair = mutableStateOf<PendingPairing?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = App.of(this)
        if (savedInstanceState == null) handleLink(intent)
        setContent { AppContent() }
    }

    /** Everything this activity shows, in the app's theme (tests host it at other text sizes). */
    @Composable
    internal fun AppContent() {
        DaylightTheme {
            Surface(Modifier.fillMaxSize()) {
                Box(Modifier.safeDrawingPadding()) { Root() }
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
        if (data.scheme != Pairing.SCHEME || (intent.action != null && intent.action != Intent.ACTION_VIEW)) return
        when (data.host) {
            "pair" -> {
                val p = try {
                    Pairing.parse(data.toString())
                } catch (e: ShareException) {
                    notice.value = "That pairing link doesn’t work: ${e.message}"
                    return
                }
                offerPairing(p, PairingConfirmation.Source.LINK)
            }
            "setup" -> if (BuildConfig.DEBUG) debugSetup(data.toString()) else notice.value = "Setup links work in debug builds only."
        }
    }

    /**
     * A pairing that arrived from a link ([PairingConfirmation.Source.LINK]: the camera, a tapped link) or from the
     * app's own pairing screen ([PairingConfirmation.Source.APP]). It is applied at once only when the confirmation
     * rule says so (the same secret as the current pairing, or a code typed here while unpaired); otherwise the dialog
     * asks first. A device set up as the Inbox always asks, because pairing makes it a sender.
     */
    fun offerPairing(p: Pairing, source: PairingConfirmation.Source) {
        val current = app.sender.pairing()
        val inbox = app.prefs.role == Role.INBOX
        // On the Inbox the question is also whether to stop receiving: ask even for the same secret.
        val c = PairingConfirmation.of(if (inbox && current?.sameSecret(p) == true) null else current, p, if (inbox) PairingConfirmation.Source.LINK else source)
        logi("pairing from ${source.name.lowercase()}: ${if (c.ask) "asking (${c.button})" else "applied"}${if (inbox) " (inbox)" else ""}")
        if (c.ask) pendingPair.value = PendingPairing(p, c, inbox) else pairSender(p, c.notice)
    }

    /** The dialog's button: pairs with the pairing it asked about. */
    fun confirmPairing() {
        val pending = pendingPair.value ?: return
        pendingPair.value = null
        if (pending.inboxRole) InstantDeliveryService.stop(this)
        pairSender(pending.pairing, null)
    }

    fun pairSender(p: Pairing, updated: String? = null) {
        app.sender.pair(p)
        if (app.prefs.role != Role.SENDER) app.setRole(Role.SENDER)
        notice.value = updated ?: "Paired with ${p.name.ifEmpty { "your Daylight" }}. Share links and files with “Send to Daylight”."
        lifecycleScope.launch { app.sender.refresh() }
    }

    /**
     * Debug builds only, for automated tests:
     * `daylightshare://setup?role=inbox|sender&c=<code>[&r=<relay>][&n=<name>][&instant=1][&auto=1][&docs=ask|quiet|open][&to=<package>][&comfort=0|1][&lab=0|1]`.
     * Sets the role and uses that pairing secret (instead of generating one) and relay; `instant` turns on Instant
     * delivery; `docs` sets "Documents" (`auto=1` is `docs=open`, `auto=0` is `docs=ask`); `to` sets "Deliver to"
     * (empty: Automatic); `comfort` sets Comfort (F27); `lab` sets the Lab switch (LAB-PLAN 1.7), before the role, so
     * the Inbox's first Lab frame follows it.
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
        // No permission prompt over the Inbox in automated runs (grant POST_NOTIFICATIONS with adb if needed).
        app.prefs.askedNotifications = true
        q["instant"]?.let { app.prefs.instantDelivery = it == "1" || it == "true" }
        q["auto"]?.let { app.prefs.documentMode = if (it == "1" || it == "true") DocumentMode.OPEN else DocumentMode.ASK }
        q["docs"]?.let { v -> DocumentMode.parse(v)?.let { app.prefs.documentMode = it } }
        q["to"]?.let { app.prefs.deliverTo = it.trim() }
        q["comfort"]?.let { app.setComfort(it == "1" || it == "true") }
        q["lab"]?.let { app.setLab(it == "1" || it == "true") }
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
        logi("setup: role=${app.prefs.role} relay=${p.relay} inbox=${p.keys.inboxTopic} instant=${app.prefs.instantDelivery} docs=${app.prefs.documentMode.key} to=${app.prefs.deliverTo.ifEmpty { "auto" }} comfort=${if (app.prefs.comfort) 1 else 0} lab=${if (app.prefs.lab) 1 else 0}")
        notice.value = "Set up as ${if (app.prefs.role == Role.INBOX) "the Daylight Inbox" else "a sender"} (relay ${p.relay})."
    }

    @Composable
    private fun Root() {
        val role by app.role.collectAsStateWithLifecycle()
        var settings by remember { mutableStateOf(false) }
        var labPage by remember { mutableStateOf<LabPage?>(null) }
        BackHandler(enabled = settings) { if (labPage != null) labPage = null else settings = false }
        val page = labPage
        when {
            role == null -> RoleScreen(this, onPick = { r -> app.setRole(r) })
            settings && page != null -> LabScreen(this, page, onBack = { labPage = null })
            settings -> SettingsScreen(this, onBack = { settings = false }, onLab = { labPage = it })
            role == Role.INBOX -> InboxScreen(this, onSettings = { settings = true })
            else -> SenderScreen(this, onSettings = { settings = true })
        }
        val pending = pendingPair.value
        if (pending != null) {
            val c = pending.confirmation
            val lines = c.lines + if (pending.inboxRole) listOf(INBOX_LINE) else emptyList()
            DaylightDialog(
                title = c.title ?: "Pair with a Daylight?",
                text = lines.joinToString("\n\n"),
                confirm = c.button ?: "Pair",
                onConfirm = { confirmPairing() },
                onDismiss = { pendingPair.value = null },
            )
        }
    }

    companion object {
        private const val LIVE_HOLDER = "screen"

        /** Added to the pairing question on a device set up as the Inbox. */
        const val INBOX_LINE = "This device is set up as the Daylight Inbox. Pairing makes it a sender instead; it stops receiving."
    }
}
