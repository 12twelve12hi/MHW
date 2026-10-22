package com.daylight.share.sender

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import androidx.annotation.VisibleForTesting
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.daylight.share.App
import com.daylight.share.Role
import com.daylight.share.core.Json
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabText
import com.daylight.share.core.lab.Normalise
import com.daylight.share.core.lab.SetupCheck
import java.io.File

/**
 * The one-time Lab note on the phone (LAB-PLAN 1.2): it shows in builds where the app has F01 or F04, and the phone
 * has both from this build (K4). The Inbox's own note waits for its W1 build (`LAB_NOTE_ENABLED`, K5).
 */
const val LAB_NOTE_ENABLED_PHONE = true

/**
 * Lab on the phone, Wave 1 (LAB-PLAN 3.3; card K4): what the phone's features share. Every word comes from LAB_TEXT
 * (`LabText`); with Lab off nothing here runs and every screen is v1.1's.
 */
object PhoneLab {
    /** LAB_TEXT's platform for the phone. */
    const val PLATFORM = "android"

    /**
     * The phone's Lab features in What's in Lab (1.4), in LAB_TEXT's order: the delivery timeline, share in place, works
     * offline, the Direct Share row, automation, a selection as an excerpt (F11, after 6.5 Q1: "Send as excerpt" in the
     * share card's Options), clean links, Setup check and the copied link.
     *
     * Not F03: 1.4 lists "Pages as you see them" for the iPhone, Chrome and Safari only. Its name, sentence and Use
     * footer speak of pages captured as you see them, which the phone never sends (it sends links). The phone has only
     * F03's link-only hint (3.3 F03), shown once whenever Lab is on ([linkOnlyHintOnce]) and then listed in Setup check.
     */
    val FEATURES: List<String> = run {
        val phone = setOf("F01", "F04", "F07", "F08", "F09", "F11", "F16", "F26", "F33")
        LabText.FEATURE_ORDER.filter { it in phone }
    }

    /** The phone's features with a Use switch (6.5 Q5): share in place, the Direct Share row, clean links, the copied link. */
    val USE: List<String> = Lab.USE_FEATURES.filter { it in FEATURES }

    /** Whether a share is one link and nothing else came through: a link, or text whose only content is a link and its headline (F03). */
    fun linkOnly(items: List<Shared>): Boolean = items.singleOrNull()?.let { s ->
        s is Shared.Link || (s is Shared.Text && Normalise.classifyShare(s.text, "", s.subject ?: "", "").kind == Normalise.Kinds.LINK)
    } ?: false

    /**
     * F03's link-only hint (3.3 F03, Android): "Only the link came through. For pages behind a login, send from your
     * computer’s browser with the Send to Daylight extension.", for the first such share on this device with Lab on,
     * on whichever card the share used (share in place's, or the v1.1 card with F04's Use switch off). Marks it shown,
     * so Setup check lists it from then on. -> the hint, or null.
     */
    fun linkOnlyHintOnce(app: App, items: List<Shared>): String? {
        if (!app.prefs.lab || app.prefs.labLinkOnlyShown || !linkOnly(items)) return null
        app.prefs.labLinkOnlyShown = true
        return LabText["linkOnly.android"]
    }

    /** Quick sends from other apps (F09): at most this many a minute; past that, the confirmation shows. */
    const val QUICK_SENDS_PER_MINUTE = 10

    /** Whether [feature] is in use: Lab on and, for a feature with a Use switch, that switch on (6.5 Q5). */
    fun useOn(app: App, feature: String): Boolean = LabText.labUseOn(app.prefs.lab, app.prefs.labUseMap(), feature)

    /** The phone's Lab jobs asked for ("send-<id>", "flush"), for tests; null: not recorded. */
    @VisibleForTesting
    @Volatile
    var jobs: MutableList<String>? = null

    /** Records a job asked for (tests only). */
    internal fun noteJob(name: String) {
        jobs?.let { synchronized(it) { it += name } }
    }

    /** Whether this device is online, for tests; null: ask Android. */
    @VisibleForTesting
    @Volatile
    var onlineOverride: Boolean? = null

    /**
     * Whether this device has a network that reaches the internet (F07; `ConnectivityManager`). When Android cannot
     * say, it counts as online: the publish then finds out, and a network failure waits for a connection.
     */
    fun online(context: Context): Boolean {
        onlineOverride?.let { return it }
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        return try {
            val n = cm.activeNetwork
            val caps = n?.let { cm.getNetworkCapabilities(it) }
            @Suppress("DEPRECATION")
            val connected = cm.activeNetworkInfo?.isConnected == true
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true || connected
        } catch (e: Exception) {
            true
        }
    }

    /** {host} in "Send {host} to {name}?" and the automation sheet: the URL's host without "www.", or "". */
    fun host(url: String?): String =
        runCatching { Uri.parse(url ?: "").host.orEmpty().removePrefix("www.") }.getOrDefault("")

    /** {name}: the pairing's name, else "your Daylight" (LAB_TEXT shareInPlace.yourDaylight). */
    fun daylightName(app: App): String = app.sender.pairing()?.name?.ifEmpty { null } ?: LabText["shareInPlace.yourDaylight"]

    /** Whether this app may post notifications (the Android 13 permission and the app's switch in Android's settings). */
    fun notificationsOn(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** The phone's own check for a feature's gate (1.5): F04's failure notices need notifications. */
    fun localCheck(app: App, feature: String): String? = when {
        app.prefs.role != Role.SENDER -> null
        feature == "F04" && !notificationsOn(app) -> "needs-notifications"
        else -> null
    }
}

/**
 * The activity log of Setup check (F26): the last 200 events, `{time, type, id8, kind, status, http}` and nothing
 * else (no title, name, URL or `from`), in `files/lab-activity.json`. Written with Lab on only.
 */
object ActivityLog {
    private val lock = Any()

    private fun file(context: Context) = File(context.filesDir, "lab-activity.json")

    fun read(context: Context): List<SetupCheck.Event> = synchronized(lock) {
        val f = file(context)
        if (!f.isFile) return emptyList()
        val list = runCatching { (Json.parse(f.readText()) as? Map<*, *>)?.get("events") as? List<*> }.getOrNull() ?: return emptyList()
        list.mapNotNull { SetupCheck.Event.fromJson(it as? Map<*, *>) }
    }

    /** Appends one event (Lab on only); never throws. */
    fun add(app: App, type: String, id: String? = "", kind: String? = "", status: String? = "", http: Int = 0) {
        if (!app.prefs.lab) return
        runCatching {
            synchronized(lock) {
                val log = SetupCheck.appendActivity(read(app), SetupCheck.activityEvent(System.currentTimeMillis(), type, id, kind, status, http))
                val f = file(app)
                val tmp = File(f.parentFile, f.name + ".tmp")
                tmp.writeText(Json.write(linkedMapOf("events" to log.map { it.toJson() })))
                if (!tmp.renameTo(f)) {
                    f.delete()
                    tmp.renameTo(f)
                }
            }
        }
    }
}
