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

    /** How many of our activities are started (visible), and the one in front. */
    private var started = 0
    @Volatile var front: Activity? = null
        private set
    val inForeground: Boolean get() = started > 0

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        roleFlow.value = prefs.role
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
