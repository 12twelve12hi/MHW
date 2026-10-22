package com.daylight.share

import androidx.annotation.VisibleForTesting
import com.daylight.share.core.Http
import com.daylight.share.core.Pairing
import com.daylight.share.core.Relay
import com.daylight.share.core.UrlConnectionHttp
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabGate
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.server.DaylightServer
import com.daylight.share.core.server.FileServerStore
import com.daylight.share.core.server.ServerCode
import com.daylight.share.core.server.ServerConfig
import com.daylight.share.core.server.ServerKeys
import com.daylight.share.core.server.ServerMessages
import com.daylight.share.core.server.ServerState
import com.daylight.share.core.server.ServerStateSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/**
 * The one-time Lab note (LAB-PLAN 1.2) shows only in builds where the app has F01 or F04: from the first W1 build
 * (K4, K5). A W0 build shows none. This is the Inbox's, on from its W1 build (K5: it records the states its senders'
 * delivery timeline shows, F01); the phone's is `LAB_NOTE_ENABLED_PHONE` (K4).
 */
const val LAB_NOTE_ENABLED = true

/**
 * Lab on this device, both roles (LAB-PLAN 1, 2.6; card K1): the gates (1.5), What's in Lab (1.4) and the Daylight
 * server (2.6). Every word comes from `LabText` (LAB_TEXT) or the server module (`ServerMessages`, DESIGN 14).
 *
 * - **The phone** finds its Daylight server ([DaylightServer], discovery only with Lab on) and keeps its state in
 *   `files/server.json`, one file outside the per-pairing outbox, so the pin outlives a pairing change and
 *   `pairing-mismatch` can show. A pairing with another secret locks the old pairing's server first, Lab on or off
 *   ([beforePairing]); Unpair and a new pairing forget a typed Server address and the cached status ([beforeUnpair]).
 * - **The DC-1 Inbox** gets the server lane in Wave S: until then its server state is `needs-server` and its section
 *   shows the Server code and how to set the server up.
 *
 * Blocking calls run off the main thread; the screens call the suspending ones.
 */
class LabRepo(private val app: App) {
    /** A whole-server answer: [state] ("ready" or one of [SERVER_WIDE]), its [message], and what the server said. */
    data class Probe(
        val state: String,
        val message: String?,
        val config: ServerConfig? = null,
        val status: Map<String, Any?>? = null,
        val moved: String? = null,
    )

    /** One row of What's in Lab: [short] is the short state, or null (none shown: not known yet, or as the heading's). */
    data class Row(val id: String, val name: String, val sentence: String, val short: String?)

    /**
     * What's in Lab (1.4): [header] the Inbox's Lab state (phone, paired), the [features] this build has, then the
     * server group: [serverShort] its line under the heading (null while not known), and [serverRows].
     */
    data class Overview(val header: String?, val features: List<Row>, val serverShort: String?, val serverRows: List<Row>, val fresh: Boolean)

    /** The Daylight server section (2.6). */
    data class ServerView(
        val paired: Boolean,
        val state: String,
        /** "Ready", or the state's long message (DESIGN 14.1, with the secret names). */
        val message: String,
        /** The server's origin ("" while none is found): "Your server" reads `hostLineText(host, fingerprint)`. */
        val host: String = "",
        val fingerprint: String = "",
        /** The server's delivery mode, "lab" or "v1"; null while no server is found (no Delivery line). */
        val delivery: String? = null,
        val v1Notice: String? = null,
        /** "Your Daylight server moved to {host}. Use it?" while a move waits for an answer. */
        val moved: String? = null,
        val serverCode: String = "",
        val labInbox: String? = null,
        val aiToday: String? = null,
        val manualUrl: String = "",
        /** Whether the Server address field is offered (the phone; the Inbox's server lane comes in Wave S). */
        val addressField: Boolean = false,
    )

    /** After re-pairing with a server known (DESIGN 12.7): the locked text, the new Server code and the re-run help. */
    data class Repaired(val message: String, val serverCode: String, val rerun: String)

    /** The HTTP of the server client (tests plug in a fake relay and server); null: the app's own. */
    @VisibleForTesting
    @Volatile
    internal var http: Http? = null

    /** The gate's deadline (LAB-PLAN 1.5: 5 s); tests shorten it. */
    @VisibleForTesting
    @Volatile
    internal var deadlineMs: Long = Lab.GATE_DEADLINE_MS

    @VisibleForTesting
    internal var clock: () -> Long = System::currentTimeMillis

    private val store by lazy { FileServerStore(File(app.filesDir, "server.json")) }
    private var cached: Pair<String, DaylightServer>? = null

    private val inbox: Boolean get() = app.prefs.role == Role.INBOX

    /** LAB_TEXT's platform: "inbox" in the Inbox role, else "android". */
    val platform: String get() = if (inbox) PLATFORM_INBOX else PLATFORM_PHONE

    /** {app} in the Lab texts: "Daylight Share". */
    val appName: String get() = LabText.appName(platform)

    /** The Lab features this build has in What's in Lab, for this role (W0: none yet; W1 adds them). */
    val features: List<String> get() = if (inbox) INBOX_FEATURES else PHONE_FEATURES

    private fun httpOf(): Http = http ?: UrlConnectionHttp("DaylightShare/${BuildConfig.VERSION_NAME} (sender)")

    /** The phone's Daylight server for its pairing; null on the Inbox (Wave S) and while unpaired. */
    fun server(): DaylightServer? {
        if (inbox) return null
        val p = app.sender.pairing() ?: return null
        synchronized(this) {
            val key = p.link()
            cached?.takeIf { it.first == key }?.let { return it.second }
            val s = DaylightServer(p, store, httpOf()) { clock() }
            cached = key to s
            return s
        }
    }

    /** This device's pairing: the phone's, or the Inbox's own. */
    private fun pairing(): Pairing? = if (inbox) app.inbox.ensurePairing() else app.sender.pairing()

    /** The Server code to show and copy (2.6; the `daylightserver://` link form off ntfy.sh), or "" when not paired. */
    fun serverCode(): String {
        val p = pairing() ?: return ""
        return runCatching { ServerCode.format(ServerCode.deriveSeed(p.secret), Relay.normalize(p.relay)) }.getOrDefault("")
    }

    // ----------------------------------------------------------------------------------------------- the server state

    /**
     * The whole server, blocking (2.6): discovery (the pin, a move, the API level), then GET /v1/status (cached 10
     * minutes; [force] asks now, and reads the config topic now). Discovery runs only with Lab on. Remembers the
     * answer for the "Daylight server ›" row and What's in Lab's cached states.
     */
    fun probe(force: Boolean = false): Probe {
        if (inbox) return localProbe("needs-server")
        if (app.sender.pairing() == null) return Probe(NEEDS_PAIRING, needs(NEEDS_PAIRING))
        // Discovery runs only with Lab on (DESIGN 4.3); the gates and screens ask only then.
        if (!app.prefs.lab) return Probe("error", null)
        val p = probeNow(force)
        remember(p.state)
        return p
    }

    private fun probeNow(force: Boolean): Probe {
        val s = server() ?: return Probe(NEEDS_PAIRING, needs(NEEDS_PAIRING))
        val d = try {
            s.discover(force)
        } catch (e: Exception) {
            return of(s.noteError("", e))
        }
        if (d == null) {
            val pin = store.get(ServerKeys.PIN) as? Map<*, *>
            return localProbe(if (pin != null && pin["fingerprint"] != s.values.fingerprint) "pairing-mismatch" else "needs-server")
        }
        if (d.config.api < ServerCode.SERVER_API_MIN) return localProbe("server-outdated").copy(config = d.config, moved = d.moved)
        if (d.config.api > ServerCode.SERVER_API) return localProbe("app-outdated").copy(config = d.config, moved = d.moved)
        return try {
            Probe("ready", null, d.config, s.status(force), d.moved)
        } catch (e: Exception) {
            of(s.noteError("", e)).copy(config = d.config, moved = d.moved)
        }
    }

    private fun localProbe(state: String) = Probe(state, ServerMessages.localMessage(state))

    private fun of(s: ServerState): Probe = Probe(if (s.state in SERVER_WIDE) s.state else "error", s.message)

    private fun remember(state: String) {
        if (inbox || state == NEEDS_PAIRING || !(state == "ready" || state in SERVER_WIDE)) return
        app.prefs.labServerState = state
        // The new pairing's server answers: the re-pairing card has done its job.
        if (state == "ready" && app.prefs.labRepairedAt != 0L) app.prefs.labRepairedAt = 0L
    }

    /** [probe] within the gate's 5 s (1.5): a server that has not answered by then is OFFLINE (it goes on meanwhile). */
    suspend fun probeInTime(force: Boolean = false): Probe {
        val job = app.scope.async(Dispatchers.IO) { probe(force) }
        return withTimeoutOrNull(deadlineMs) { job.await() } ?: localProbe("OFFLINE")
    }

    /**
     * The last answer, without asking anyone (1.5: What's in Lab's cached states): while it is 10 minutes old or less,
     * with the module's cached status for a ready server. -> null when there is none.
     */
    fun cachedProbe(): Probe? {
        if (inbox) return localProbe("needs-server")
        if (app.sender.pairing() == null) return Probe(NEEDS_PAIRING, needs(NEEDS_PAIRING))
        val state = app.prefs.labServerState ?: return null
        val age = clock() - app.prefs.labServerAt
        if (age < 0 || age > ServerCode.STATUS_REFRESH_MS) return null
        if (state != "ready") return if (state in SERVER_WIDE) localProbe(state) else null
        @Suppress("UNCHECKED_CAST")
        val status = store.get(ServerKeys.STATUS) as? Map<String, Any?> ?: return null
        return Probe("ready", null, status = status)
    }

    /** The state of the whole server for the heading and the row: [Probe.state] when it is one, else ready. */
    fun headingState(p: Probe): String = if (p.state in SERVER_WIDE) p.state else "ready"

    /** A server feature's state from a whole-server answer (2.6). */
    fun featureState(p: Probe, key: String): ServerState =
        if (p.state != "ready") ServerState(p.state, p.message ?: ServerMessages.localMessage(p.state))
        else ServerMessages.stateFromStatus(p.status, key)

    /**
     * The "Daylight server ›" row's subtitle (1.1): "Optional · {short state}". [refresh]: ask the server when the
     * last answer is over 10 minutes old (within 5 s). -> null while nothing is known.
     */
    suspend fun serverSubtitle(refresh: Boolean): String? = withContext(Dispatchers.IO) {
        if (!app.prefs.lab) return@withContext null
        val last = cachedProbe()
        val state = last?.state ?: if (refresh) probeInTime().state else app.prefs.labServerState
        state?.let { LabText.serverRowSubtitle(headingState(Probe(it, null))) }
    }

    // ------------------------------------------------------------------------------------------------------- gates

    /**
     * A feature's gate (1.5, 2.7.2), blocking: Lab on, paired, the Inbox's capability, then for a server feature the
     * server's state within 5 s ([probe], or the whole-server answer [p] when given), and `later` while this build
     * does not have the feature.
     */
    fun gate(feature: String, p: Probe? = null): LabGate.Result {
        val heard = if (inbox) null else runCatching { app.sender.ledger()?.snapshot() }.getOrNull()
        return LabGate.run(
            feature,
            LabGate.Context(
                lab = app.prefs.lab,
                paired = pairing() != null,
                hasCap = { heard?.hasCap(it) == true },
                // The phone's own checks (K4): F04's notices need notifications; the Inbox's (K5): so do F15's.
                local = { com.daylight.share.sender.PhoneLab.localCheck(app, it) ?: com.daylight.share.inbox.InboxLab.localCheck(app, it) },
                server = if (inbox) null else ServerStateSource { key -> featureState(p ?: probe(), key) },
                serverMessage = ServerMessages::localMessage,
                built = { it in BUILT },
                app = appName,
                platform = platform,
                deadlineMs = deadlineMs,
            ),
        )
    }

    /** [gate] off the main thread. */
    suspend fun gateNow(feature: String): LabGate.Result = withContext(Dispatchers.IO) { gate(feature) }

    // ----------------------------------------------------------------------------------------------- what's in Lab

    private fun row(id: String, short: String?) = Row(id, LabText.featureName(id), LabText.featureSentence(id) ?: "", short)

    /** What's in Lab with nothing asked: the cached states (or no short states while none is recent). */
    suspend fun overviewCached(): Overview = withContext(Dispatchers.IO) { overviewOf(cachedProbe()) }

    /**
     * What's in Lab as it opens (1.4, 1.5): the ack topic is read (the header is then current) and the server is
     * asked, both at once and each within 5 s.
     */
    suspend fun overviewFresh(): Overview = withContext(Dispatchers.IO) {
        val acks = if (!inbox && app.sender.pairing() != null) app.scope.async(Dispatchers.IO) { runCatching { app.sender.tick() } } else null
        val p = probeInTime(force = true)
        acks?.let { withTimeoutOrNull(deadlineMs) { it.await() } }
        overviewOf(p)
    }

    private fun overviewOf(p: Probe?): Overview {
        val header = if (inbox) null else app.sender.ledger()?.let { l ->
            runCatching { l.snapshot() }.getOrNull()?.let { LabText.inboxLabText(it.inboxLab, it.checkedIn, clock()) }
        }
        if (p == null) {
            return Overview(header, features.map { row(it, null) }, null, LabText.SERVER_FEATURE_ORDER.map { row(it, null) }, fresh = false)
        }
        val heading = headingState(p)
        return Overview(
            header,
            features.map { row(it, gate(it, p).short ?: LabText.READY) },
            LabText.serverHeadingShort(heading),
            LabText.SERVER_FEATURE_ORDER.map { row(it, LabText.serverFeatureShort(gate(it, p).state, heading)) },
            fresh = true,
        )
    }

    // ------------------------------------------------------------------------------------------ the server section

    /** The Daylight server section (2.6), asking the server now (within 5 s). */
    suspend fun serverView(): ServerView = withContext(Dispatchers.IO) {
        val code = serverCode()
        if (inbox) return@withContext ServerView(true, "needs-server", ServerMessages.localMessage("needs-server"), serverCode = code)
        val s = server() ?: return@withContext ServerView(false, NEEDS_PAIRING, needs(NEEDS_PAIRING))
        val p = probeInTime(force = true)
        val config = p.config ?: runCatching { ServerConfig.fromJson(store.get(ServerKeys.CONFIG)) }.getOrNull()?.takeIf { it.fingerprint == s.values.fingerprint }
        val status = p.status
        val usage = ((status?.get("usage") as? Map<*, *>)?.get("ai")) as? Map<*, *>
        ServerView(
            paired = true,
            state = p.state,
            message = if (p.state == "ready") LabText.READY else p.message ?: ServerMessages.localMessage(p.state),
            host = config?.server.orEmpty(),
            fingerprint = ServerCode.showFingerprint(s.values.fingerprint),
            delivery = config?.delivery,
            v1Notice = if (config?.delivery == "v1") ServerMessages.noticeText("v1") else null,
            moved = (p.moved ?: pendingMove(s))?.let { LabText.serverMovedText(it) },
            serverCode = code,
            labInbox = status?.let { LabText.labInboxSeenText((it["inbox"] as? Map<*, *>)?.get("lastSeen"), clock()) },
            aiToday = usage?.let { LabText.aiTodayText(it["usd"], it["limitUsd"]) },
            manualUrl = store.get(ServerKeys.MANUAL_URL) as? String ?: "",
            addressField = true,
        )
    }

    /**
     * The server's new address while the user hasn't said yes to the move (server/pendingMove): only while the cached
     * config still names it and no Server address is typed. -> the origin, or null.
     */
    private fun pendingMove(s: DaylightServer): String? = runCatching {
        if (store.get(ServerKeys.MANUAL_URL) != null) return null
        val move = store.get(ServerKeys.PENDING_MOVE) as? Map<*, *> ?: return null
        val pin = store.get(ServerKeys.PIN) as? Map<*, *> ?: return null
        val config = store.get(ServerKeys.CONFIG) as? Map<*, *> ?: return null
        val fp = s.values.fingerprint
        val origin = move["origin"] as? String ?: return null
        if (move["fingerprint"] != fp || pin["fingerprint"] != fp || pin["origin"] == origin) return null
        if (config["server"] == origin && config["fingerprint"] == fp) origin else null
    }.getOrNull()

    /** "Use it" on "Your Daylight server moved to {host}. Use it?" -> whether it moved. */
    suspend fun confirmMove(): Boolean = withContext(Dispatchers.IO) {
        val s = server() ?: return@withContext false
        if (!app.prefs.lab) return@withContext false
        val moved = runCatching { s.confirmMove() }.getOrDefault(false)
        app.prefs.labServerState = null
        moved
    }

    /** The Server address field (2.6): a typed origin, checked with GET /v1/hello and /v1/status; empty clears it. -> the sentence to show when refused, else null. */
    suspend fun setServerAddress(url: String): String? = withContext(Dispatchers.IO) {
        val s = server() ?: return@withContext needs(NEEDS_PAIRING)
        if (!app.prefs.lab) return@withContext LabText.fill(LabText["labOff"], mapOf("app" to appName))
        app.prefs.labServerState = null
        try {
            if (url.isBlank()) s.clearManualUrl() else s.setManualUrl(url)
            null
        } catch (e: Exception) {
            e.message ?: ServerMessages.localMessage("OFFLINE")
        }
    }

    // ------------------------------------------------------------------------------------------ pairing changes

    /**
     * Before the phone pairs with [next] (2.6 "Re-pairing"): with another secret than [old], a Daylight server that knows
     * the old pairing (a pin, or a typed address) is locked first, Lab on or off (DESIGN 3.4), in the background; the
     * typed address and the cached status are forgotten (they are the old server's), and the re-pairing card shows the
     * new Server code and the re-run help (DESIGN 12.7). A pairing after Unpair forgets them too. The pin stays: it
     * tells `pairing-mismatch`. Never throws; never waits for the network.
     */
    fun beforePairing(old: Pairing?, next: Pairing) {
        if (old != null && old.sameSecret(next)) return
        synchronized(this) { cached = null }
        val known = runCatching { store.get(ServerKeys.PIN) != null || store.get(ServerKeys.MANUAL_URL) != null }.getOrDefault(false)
        app.prefs.labServerState = null
        val client = httpOf()
        val outgoing = old ?: next
        app.scope.launch(Dispatchers.IO) {
            if (old != null && known) {
                val locked = withTimeoutOrNull(LOCK_WAIT_MS) {
                    app.scope.async(Dispatchers.IO) { DaylightServer(old, store, client).lockBeforeRepair() }.await()
                }
                logi("lab: re-pairing; the old pairing's Daylight server was ${if (locked == true) "locked" else "not reached (the lock request failed)"}")
            }
            runCatching { DaylightServer(outgoing, store, client).clearManualUrl() }
        }
        if (old != null && known) app.prefs.labRepairedAt = clock()
    }

    /** Before Unpair: a typed Server address and the cached status are forgotten; the pin stays; nothing is locked. */
    fun beforeUnpair(current: Pairing?) {
        synchronized(this) { cached = null }
        app.prefs.labServerState = null
        app.prefs.labRepairedAt = 0L
        if (current != null) runCatching { DaylightServer(current, store, httpOf()).clearManualUrl() }
    }

    /** The re-pairing card (DESIGN 12.7) while Lab is on, until OK or a ready server; null otherwise. */
    fun repaired(): Repaired? {
        if (!app.prefs.lab || inbox || app.prefs.labRepairedAt == 0L || app.sender.pairing() == null) return null
        return Repaired(ServerMessages.localMessage("locked"), serverCode(), ServerMessages.RERUN_HELP)
    }

    /** OK on the re-pairing card. */
    fun repairedSeen() {
        app.prefs.labRepairedAt = 0L
    }

    private fun needs(state: String): String = LabText.needsMessage(state, app = appName, platform = platform) ?: ""

    companion object {
        const val PLATFORM_PHONE = "android"
        const val PLATFORM_INBOX = "inbox"
        const val NEEDS_PAIRING = "needs-pairing"

        /** What's in Lab's features on the phone (W1, K4): `PhoneLab.FEATURES`. */
        val PHONE_FEATURES: List<String> = com.daylight.share.sender.PhoneLab.FEATURES

        /** … and on the DC-1 Inbox (W1, K5): arrival notices and Setup check, `InboxLab.FEATURES`. */
        val INBOX_FEATURES: List<String> = com.daylight.share.inbox.InboxLab.FEATURES

        /** The Lab features this build runs (the gate's `built`): a server feature that is ready but not built is `later`. */
        val BUILT: Set<String> get() = (PHONE_FEATURES + INBOX_FEATURES).toSet()

        /** The states of the whole server (not of one feature): the What's in Lab heading's and the row's. */
        val SERVER_WIDE = setOf(NEEDS_PAIRING, "needs-server", "pairing-mismatch", "server-outdated", "app-outdated", "locked", "OFFLINE", "error")

        /** How long the re-pairing lock may take before it is given up (it goes on in the background). */
        const val LOCK_WAIT_MS = 10_000L

        /** {host}: an origin without its scheme and anything from the first '/' after it. */
        fun hostOf(origin: String): String = origin.substringAfter("://").substringBefore('/')
    }
}
