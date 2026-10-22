package com.daylight.share

import android.app.Activity
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import com.daylight.share.core.Limits
import com.daylight.share.core.Pairing
import com.daylight.share.core.Relay
import com.daylight.share.core.RelayProbe
import com.daylight.share.core.Text
import com.daylight.share.inbox.DocumentMode
import com.daylight.share.inbox.InboxRepo
import com.daylight.share.inbox.InstantDeliveryService
import com.daylight.share.inbox.LabReporter
import com.daylight.share.inbox.Live
import com.daylight.share.sender.SenderRepo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Logcat tag for everything (the emulator test greps "received <id> kind=... -> handed to <pkg> via <path> status=..."). */
const val TAG = "DaylightShare"

/** The app: one process-wide graph, notification channels, background work. */
class App : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var prefs: Prefs
        private set
    val inbox: InboxRepo by lazy { InboxRepo(this) }
    val sender: SenderRepo by lazy { SenderRepo(this) }

    /** Lab on this device (LAB-PLAN 1, 2.6): the gates, What's in Lab and the Daylight server. */
    val lab: LabRepo by lazy { LabRepo(this) }

    /** The Inbox's Lab frames (F17): its hellos and item states on the ack topic. */
    val labReporter: LabReporter by lazy { LabReporter(this) }

    // Lab: K6
    /** The handover to the Lab Reader (LAB-PLAN 5.3.4): who receives for the Inbox's pairing, and the resume rule. */
    val handover: com.daylight.share.inbox.handover.Handover by lazy { com.daylight.share.inbox.handover.Handover(this) }

    /** How many of our activities are started (visible), and the one in front. */
    private var started = 0
    @Volatile var front: Activity? = null
        private set
    val inForeground: Boolean get() = started > 0

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        if (prefs.ensureLabDefault()) logi("lab: on (first start of a build with Lab)")
        roleFlow.value = prefs.role
        comfortFlow.value = prefs.comfort
        labFlow.value = prefs.lab
        createChannels()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) { started++ }
            override fun onActivityStopped(activity: Activity) { started = maxOf(0, started - 1) }
            override fun onActivityResumed(activity: Activity) { front = activity }
            override fun onActivityPaused(activity: Activity) { if (front === activity) front = null }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
        Live.start(this)
        onRoleChanged()
    }

    /**
     * A custom Inbox relay saved before protocol 1.1 is checked once in the background (CHANGES-v1.1 finding 21). A
     * failure only shows its sentence as a warning on the Inbox screen: the saved relay and the pairing code never
     * change here. A check that could not reach the relay, or that it answered with 429 or a 5xx, is not recorded, so
     * the next start tries again.
     */
    fun checkInboxRelayOnce() {
        val relay = prefs.inboxRelay
        if (relay == Limits.DEFAULT_RELAY || prefs.inboxRelayChecked == relay) return
        scope.launch(Dispatchers.IO) {
            val failure = inbox.checkRelay(relay)
            if (prefs.inboxRelay != relay) return@launch // changed meanwhile: Save checked it
            // Unreachable, or busy (429, 5xx: "Try again later"): not recorded, so the next start checks again. A
            // relay that stays broken shows the Inbox's own sentence for the failing polls meanwhile.
            if (failure != null && (failure.reason == RelayProbe.REASON_NETWORK || failure.status == 429 || failure.status >= 500)) {
                logi("relay check of $relay: ${failure.message}; trying again at the next start")
                return@launch
            }
            prefs.inboxRelayChecked = relay
            prefs.inboxRelayWarning = failure?.message
            logi("relay check of $relay: " + (failure?.message ?: "ok"))
        }
    }

    /** Schedules the periodic work for the current role, polls once, and starts or stops Instant delivery. */
    fun onRoleChanged() {
        when (prefs.role) {
            Role.INBOX -> {
                inbox.ensurePairing()
                checkInboxRelayOnce()
                Work.schedulePeriodic(this)
                Work.syncNow(this)
                if (prefs.instantDelivery) InstantDeliveryService.start(this) else InstantDeliveryService.stop(this)
            }
            Role.SENDER -> {
                InstantDeliveryService.stop(this)
                Work.schedulePeriodic(this)
                if (sender.pairing() != null) Work.syncNow(this)
            }
            null -> {
                InstantDeliveryService.stop(this)
                Work.cancelPeriodic(this)
            }
        }
        roleFlow.value = prefs.role
    }

    private val roleFlow = MutableStateFlow<Role?>(null)

    /** The current role, for the UI. Change it with [setRole]. */
    val role: StateFlow<Role?> get() = roleFlow

    fun setRole(role: Role?) {
        prefs.role = role
        onRoleChanged()
    }

    private val comfortFlow = MutableStateFlow(false)

    /** Comfort (F27, not a Lab setting): every screen follows it. Change it with [setComfort]. */
    val comfort: StateFlow<Boolean> get() = comfortFlow

    fun setComfort(on: Boolean) {
        prefs.comfort = on
        comfortFlow.value = on
    }

    private val labFlow = MutableStateFlow(true)

    /**
     * The Lab switch (LAB-PLAN 1.2's one reading: [Prefs.lab] with this flow). Change it with [setLab]. Comfort is not
     * under Lab and Lab never reads it (F27.6).
     */
    val labOn: StateFlow<Boolean> get() = labFlow

    /**
     * Turns Lab on or off: [Prefs.lab] first, then, on the Inbox, its hello (on) or its one `lab: 0` frame (off) on a
     * worker (F17). Nothing else changes: the pairing, the outbox and history, the ledger, the server pin and notices
     * stay (1.3).
     */
    fun setLab(on: Boolean) {
        val changed = prefs.lab != on
        prefs.lab = on
        labFlow.value = on
        if (!changed) return
        logi("lab: ${if (on) "on" else "off"}")
        labReporter.labSwitched()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java)
        // HIGH, so a new item pops up over the full-screen Reader on the Daylight (DEFAULT only adds a status-bar icon,
        // which the Reader hides). A channel's importance cannot be raised once created, hence a new id; the old one goes.
        nm.deleteNotificationChannel(CH_ARRIVALS_OLD)
        nm.createNotificationChannel(NotificationChannel(CH_ITEMS, "New items", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Items that arrived and wait for a tap to go to the Reader"
            setShowBadge(true)
        })
        nm.createNotificationChannel(NotificationChannel(CH_INSTANT, "Instant delivery", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Shown while Instant delivery keeps a connection open"
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_SYNC, "Sending and checking", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown briefly on older Android versions while items are sent"
            setShowBadge(false)
        })
    }

    companion object {
        /** New items that wait for a tap (one notification per item, grouped). */
        const val CH_ITEMS = "new-items"
        /** Before: the same, at default importance. */
        private const val CH_ARRIVALS_OLD = "arrivals"
        const val CH_INSTANT = "instant"
        const val CH_SYNC = "sync"

        lateinit var instance: App
            private set

        fun of(context: Context): App = context.applicationContext as App
    }
}

enum class Role { INBOX, SENDER }

/** Settings, in one SharedPreferences file (private app storage; the pairing secrets live here too). */
class Prefs(private val context: Context) {
    private val sp = context.getSharedPreferences("daylight-share", Context.MODE_PRIVATE)

    var role: Role?
        get() = sp.getString("role", null)?.let { runCatching { Role.valueOf(it) }.getOrNull() }
        set(v) = sp.edit().putString("role", v?.name).apply()

    /** This device's name: sent as `from` by senders, shown as the Daylight's name by the Inbox. */
    var deviceName: String
        get() = sp.getString("deviceName", null)?.takeIf { it.isNotBlank() } ?: defaultDeviceName()
        set(v) = sp.edit().putString("deviceName", Text.cleanName(v)).apply()

    // The Inbox's own pairing (the Daylight side).
    var inboxCode: String?
        get() = sp.getString("inboxCode", null)
        set(v) = sp.edit().putString("inboxCode", v).apply()
    var inboxRelay: String
        get() = sp.getString("inboxRelay", null) ?: com.daylight.share.core.Limits.DEFAULT_RELAY
        set(v) = sp.edit().putString("inboxRelay", Relay.normalize(v)).apply()

    /** The Inbox relay the relay check last passed or failed for (set by Save, or by the one-time background check). */
    var inboxRelayChecked: String?
        get() = sp.getString("inboxRelayChecked", null)
        set(v) = sp.edit().putString("inboxRelayChecked", v).apply()

    /** The background relay check's sentence when it failed (shown on the Inbox screen), else null. */
    var inboxRelayWarning: String?
        get() = sp.getString("inboxRelayWarning", null)
        set(v) = sp.edit().putString("inboxRelayWarning", v).apply()

    // The sender's pairing (the Daylight it sends to).
    var senderLink: String?
        get() = sp.getString("senderLink", null)
        set(v) = sp.edit().putString("senderLink", v).apply()

    var instantDelivery: Boolean
        get() = sp.getBoolean("instant", false)
        set(v) = sp.edit().putBoolean("instant", v).apply()

    /**
     * How documents reach the Reader while the Inbox is in the background ("Documents" on the Inbox screen). Unset:
     * [DocumentMode.DEFAULT]; the earlier switch "Open documents as they arrive", when on, reads as [DocumentMode.OPEN].
     */
    var documentMode: DocumentMode
        get() = DocumentMode.parse(sp.getString("docMode", null)) ?: if (sp.getBoolean("autoDocs", false)) DocumentMode.OPEN else DocumentMode.DEFAULT
        set(v) = sp.edit().putString("docMode", v.key).remove("autoDocs").apply()

    /** The Reader package to deliver to; empty = automatic. */
    var deliverTo: String
        get() = sp.getString("deliverTo", "") ?: ""
        set(v) = sp.edit().putString("deliverTo", v).apply()

    var askedNotifications: Boolean
        get() = sp.getBoolean("askedNotif", false)
        set(v) = sp.edit().putBoolean("askedNotif", v).apply()

    // Accessibility (F27; not a Lab setting, and Lab never reads it).
    /** Comfort: larger text and buttons, more contrast, no motion. Off by default; Lab on or off leaves it as it is. */
    var comfort: Boolean
        get() = sp.getBoolean("comfort", false)
        set(v) = sp.edit().putBoolean("comfort", v).apply()

    // Lab: K1 (LAB-PLAN 1.2). The switch belongs to this device: never synced, never in a pairing link, and pairing,
    // unpairing and re-pairing leave it as it is.

    /** The Lab switch: a missing key means on ([ensureLabDefault] writes it at the first start of a build with Lab). */
    var lab: Boolean
        get() = sp.getBoolean("lab", true)
        set(v) = sp.edit().putBoolean("lab", v).apply()

    /** The one-time Lab note was dismissed (it shows only in builds with [LAB_NOTE_ENABLED]). */
    var labNoteShown: Boolean
        get() = sp.getBoolean("labNoteShown", false)
        set(v) = sp.edit().putBoolean("labNoteShown", v).apply()

    /** The first start of a build with Lab writes `lab = true` when the key is missing (fresh installs and upgrades). Returns whether it wrote it. */
    fun ensureLabDefault(): Boolean {
        if (sp.contains("lab")) return false
        sp.edit().putBoolean("lab", true).apply()
        return true
    }

    /** Whether the one-time note shows now: only in a build with [enabled] (F01 or F04), with Lab on, until dismissed. */
    fun labNoteDue(enabled: Boolean = LAB_NOTE_ENABLED): Boolean = enabled && lab && !labNoteShown

    /** The phone's last Daylight server answer for the whole server ("ready" or a server-wide state) and when (ms). */
    var labServerState: String?
        get() = sp.getString("labServerState", null)
        set(v) = sp.edit().putString("labServerState", v).putLong("labServerAt", if (v == null) 0L else System.currentTimeMillis()).apply()
    val labServerAt: Long get() = sp.getLong("labServerAt", 0L)

    /**
     * When this phone re-paired with another Daylight while it knew a Daylight server (LAB-PLAN 2.6, DESIGN 12.7): the
     * Daylight server card shows the new Server code and the re-run help until OK, or until the new server answers.
     */
    var labRepairedAt: Long
        get() = sp.getLong("labRepairedAt", 0L)
        set(v) = sp.edit().putLong("labRepairedAt", v).apply()

    /** The Inbox's items whose `waiting` state was recorded (F17: never again for the same id). */
    fun labWaitingIds(): Set<String> = sp.getStringSet("labWaiting", null)?.toSet() ?: emptySet()

    fun setLabWaitingIds(ids: Set<String>) {
        sp.edit().putStringSet("labWaiting", HashSet(ids)).apply()
    }

    /** When the Inbox last ran its Lab state digest (with the v1.1 ack digest's 11 hours), ms. */
    var labDigestAt: Long
        get() = sp.getLong("labDigestAt", 0L)
        set(v) = sp.edit().putLong("labDigestAt", v).apply()

    /** The ids of waiting items in a notice state ([NOTICE_ANNOUNCED], [NOTICE_DISMISSED], [NOTICE_LATER]). */
    fun noticeIds(state: String): Set<String> = sp.getStringSet("notice.$state", null)?.toSet() ?: emptySet()

    fun addNoticeIds(state: String, ids: Collection<String>) {
        val cur = noticeIds(state)
        if (cur.containsAll(ids)) return
        sp.edit().putStringSet("notice.$state", HashSet(cur + ids)).apply()
    }

    /** Forgets the notice state of items that no longer wait (handed over, removed, kept in the Inbox). */
    fun keepNoticeIds(waiting: Set<String>) {
        val e = sp.edit()
        var changed = false
        for (state in NOTICE_STATES) {
            val cur = noticeIds(state)
            val kept = cur.filterTo(HashSet()) { it in waiting }
            if (kept.size != cur.size) {
                e.putStringSet("notice.$state", kept)
                changed = true
            }
        }
        if (changed) e.apply()
    }

    // Lab: K4 (the phone's Wave 1 features, LAB-PLAN 3.3). Like the switch, these belong to the device: never synced,
    // never in a pairing link, and Lab off leaves them as they are (1.3).

    /** A feature's Use switch in What's in Lab (6.5 Q5): `labUse.<feature>`; a missing one means on. */
    fun labUse(feature: String): Boolean = sp.getBoolean("labUse.$feature", true)

    fun setLabUse(feature: String, on: Boolean) = sp.edit().putBoolean("labUse.$feature", on).apply()

    /** Every Use switch, for `LabText.labUseOn`. */
    fun labUseMap(): Map<String, Boolean> = com.daylight.share.core.lab.Lab.USE_FEATURES.associateWith { labUse(it) }

    /** F04: "Always show Options before sending" (off by default). */
    var labAlwaysOptions: Boolean
        get() = sp.getBoolean("labAlwaysOptions", false)
        set(v) = sp.edit().putBoolean("labAlwaysOptions", v).apply()

    /** F04: "Tell me when a send fails" (on by default). */
    var labTellFails: Boolean
        get() = sp.getBoolean("labTellFails", true)
        set(v) = sp.edit().putBoolean("labTellFails", v).apply()

    /** F04: "Tell me when it’s in my Reader" (off by default). */
    var labTellReader: Boolean
        get() = sp.getBoolean("labTellReader", false)
        set(v) = sp.edit().putBoolean("labTellReader", v).apply()

    /** F09: "Allow quick sends from other apps" (off by default). */
    var labQuickSends: Boolean
        get() = sp.getBoolean("labQuickSends", false)
        set(v) = sp.edit().putBoolean("labQuickSends", v).apply()

    /** F03: the link-only hint was shown on this device (once; then it lives in Setup check). */
    var labLinkOnlyShown: Boolean
        get() = sp.getBoolean("labLinkOnlyShown", false)
        set(v) = sp.edit().putBoolean("labLinkOnlyShown", v).apply()

    /** F11: "Excerpts wait for a tap on your Daylight for now." was shown after this device's first excerpt. */
    var labExcerptNoteShown: Boolean
        get() = sp.getBoolean("labExcerptNoteShown", false)
        set(v) = sp.edit().putBoolean("labExcerptNoteShown", v).apply()

    /** F04: a share in place happened and the app has not asked for notifications since (Android 13 and later). */
    var labAskNotices: Boolean
        get() = sp.getBoolean("labAskNotices", false)
        set(v) = sp.edit().putBoolean("labAskNotices", v).apply()

    /** F07: when the last offline flush pass ran (ms); passes are at least 3 minutes apart. */
    var labFlushAt: Long
        get() = sp.getLong("labFlushAt", 0L)
        set(v) = sp.edit().putLong("labFlushAt", v).apply()

    /** F26: the id of the last test article, which Setup check follows along the timeline. */
    var labTestId: String?
        get() = sp.getString("labTestId", null)
        set(v) = sp.edit().putString("labTestId", v).apply()

    /** F04: items shared in place whose failure or arrival in the Reader may still be told (a notice each, once). */
    fun labInPlaceIds(): Set<String> = sp.getStringSet("labInPlace", null)?.toSet() ?: emptySet()

    fun setLabInPlaceIds(ids: Set<String>) {
        sp.edit().putStringSet("labInPlace", HashSet(ids)).apply()
    }

    // Lab: K5 (the DC-1 Inbox's Wave 1 features, LAB-PLAN 3.3). Like the switch, these belong to the device: never
    // synced, never in a pairing link, and Lab off leaves them as they are (1.3).

    /** F15: "Arrival notices": "off", "quiet" (default) or "alert" (`inbox.Arrivals`). */
    var labArrivals: String
        get() = sp.getString("labArrivals", null) ?: "quiet"
        set(v) = sp.edit().putString("labArrivals", v).apply()

    /** F15: "Quiet hours" (off by default): arrival notices go silently from 22:00 to 07:00. */
    var labQuietHours: Boolean
        get() = sp.getBoolean("labQuietHours", false)
        set(v) = sp.edit().putBoolean("labQuietHours", v).apply()

    /** F15: Instant delivery's last heartbeat (ms), written every minute while its service runs with Lab on. */
    var labInstantBeat: Long
        get() = sp.getLong("labInstantBeat", 0L)
        set(v) = sp.edit().putLong("labInstantBeat", v).apply()

    /** F15: when the "Instant delivery stopped" notice was last posted (ms); at most once every 12 hours. */
    var labHealthNoticeAt: Long
        get() = sp.getLong("labHealthNoticeAt", 0L)
        set(v) = sp.edit().putLong("labHealthNoticeAt", v).apply()

    /** F15: the Inbox's items that already had a notice (a waiting item's, or "Saved to the Reader"): never another. */
    fun labNoticedIds(): Set<String> = sp.getStringSet("labNoticed", null)?.toSet() ?: emptySet()

    fun setLabNoticedIds(ids: Set<String>) {
        sp.edit().putStringSet("labNoticed", HashSet(ids)).apply()
    }

    /** F26: when the Reader last refused SAVE_PAGE (its read-later turned off), ms; 0 after it took one again. */
    var labReadLaterRefusedAt: Long
        get() = sp.getLong("labReadLaterRefusedAt", 0L)
        set(v) = sp.edit().putLong("labReadLaterRefusedAt", v).apply()

    /** F26: the id of the last "Test the Reader hand-off" item, whose result Setup check shows. */
    var labReaderTestId: String?
        get() = sp.getString("labReaderTestId", null)
        set(v) = sp.edit().putString("labReaderTestId", v).apply()

    // Lab: K6 (the handover to the Lab Reader, LAB-PLAN 5.3.4; `inbox.handover.Handover`). Like the switch, these belong
    // to the device: never synced, never in a pairing link. Lab off leaves a handover as it is: the Lab Reader still
    // receives for the pairing, and two receivers would both take every item.

    /** "Let Daylight Reader (lab) receive" armed the pairing's grant until then (ms; 0: not armed). */
    var labHandoverArmedUntil: Long
        get() = sp.getLong("labHandoverArmedUntil", 0L)
        set(v) = sp.edit().putLong("labHandoverArmedUntil", v).apply()

    /** The package that receives for this Daylight's pairing instead of the Inbox (the Lab Reader), or null. */
    var receivingElsewhere: String?
        get() = sp.getString("receivingElsewhere", null)
        set(v) = sp.edit().putString("receivingElsewhere", v).apply()

    /** The inbox topic of the pairing that was handed over: another pairing (Reset pairing) ends the handover. */
    var labHandoverTopic: String?
        get() = sp.getString("labHandoverTopic", null)
        set(v) = sp.edit().putString("labHandoverTopic", v).apply()

    /** The Lab Reader's last answer to `receiving` ("receiving", "not-receiving", "unreachable"), or null. */
    var labHandoverReach: String?
        get() = sp.getString("labHandoverReach", null)
        set(v) = sp.edit().putString("labHandoverReach", v).apply()

    /** The last time the Lab Reader may have been receiving (ms): the handover, then each answer but "not receiving". */
    var labHandoverSeenAt: Long
        get() = sp.getLong("labHandoverSeenAt", 0L)
        set(v) = sp.edit().putLong("labHandoverSeenAt", v).apply()

    fun senderPairing(): Pairing? = senderLink?.let { runCatching { Pairing.parse(it) }.getOrNull() }

    private fun defaultDeviceName(): String {
        val global = runCatching { Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
        val n = Text.cleanName(global ?: "").ifEmpty { Text.cleanName("${Build.MODEL}") }
        return if (looksLikeDaylight(context) && !n.contains("Daylight", ignoreCase = true)) "Daylight" else n.ifEmpty { "Android" }
    }

    companion object {
        /** Waiting items that were announced (a notification, the card): they never alert again. */
        const val NOTICE_ANNOUNCED = "announced"
        /** Waiting items whose notification the user swiped away: not announced again. */
        const val NOTICE_DISMISSED = "dismissed"
        /** Waiting items the card was answered "Later" for: the card does not show them again. */
        const val NOTICE_LATER = "later"
        private val NOTICE_STATES = listOf(NOTICE_ANNOUNCED, NOTICE_DISMISSED, NOTICE_LATER)

        /** A Daylight tablet: the Reader is installed, or the maker or model says so. */
        fun looksLikeDaylight(context: Context): Boolean {
            val reader = try {
                context.packageManager.getPackageInfo("com.daylightcomputer.reader", 0)
                true
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
            val build = "${Build.MANUFACTURER} ${Build.BRAND} ${Build.MODEL} ${Build.PRODUCT}"
            return reader || build.contains("daylight", ignoreCase = true)
        }
    }
}

internal fun logi(msg: String) = Log.i(TAG, msg)
internal fun logw(msg: String, e: Throwable? = null) = Log.w(TAG, msg, e)
