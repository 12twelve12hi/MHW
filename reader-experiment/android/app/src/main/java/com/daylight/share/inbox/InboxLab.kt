package com.daylight.share.inbox

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.annotation.VisibleForTesting
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.Role
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabRowText
import com.daylight.share.core.lab.LabText
import com.daylight.share.logi
import com.daylight.share.logw
import com.daylight.share.sender.ActivityLog
import com.daylight.share.ui.MainActivity
import java.util.Calendar

/*
 * The DC-1 Inbox's Wave 1 (LAB-PLAN 3.3; card K5): what its features share. Every word comes from LAB_TEXT
 * (`LabText`); with Lab off nothing here runs and every screen, notice and hand-off is v1.1's.
 *
 * - F01: "Sender sees: {label}" in an item's details, the same words as the sender's row ([InboxLab.senderSees]).
 * - F03, F11: each row's kind line from the item's extras ([InboxLab.kindLine]); the hello's cap `cap-kind`.
 * - F15: Add to Reader and Keep for later on a waiting item's notice and card, a swiped notice kept for later
 *   ([Handoff.keepForLater], [Handoff.onDismissed]), waiting excerpts from one sender grouped ("3 excerpts from
 *   iPhone"), "Saved to the Reader" for items handed over by themselves ([ArrivalNotices]), "Arrival notices" and
 *   "Quiet hours", and the Inbox's health ([InboxHealth]).
 * - F26: Setup check's checks and its Reader hand-off test ([InboxLab.checks], `InboxRepo.addReaderTest`).
 */

/** "Arrival notices" (F15): how a "Saved to the Reader" notice is posted. Quiet is the default. */
enum class Arrivals(val key: String) {
    OFF("off"),
    QUIET("quiet"),
    ALERT("alert");

    /** "Off", "Quiet" or "Alert" (LAB_TEXT arrivals.*). */
    val label: String get() = LabText["arrivals.$key"]

    companion object {
        val DEFAULT = QUIET

        fun parse(key: String?): Arrivals = entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}

object InboxLab {
    /** LAB_TEXT's platform for the DC-1 Inbox. */
    const val PLATFORM = "inbox"

    /** The Inbox's Lab features in What's in Lab (1.4), in LAB_TEXT's order: arrival notices and Setup check. */
    val FEATURES: List<String> = run {
        val inbox = setOf("F15", "F26")
        LabText.FEATURE_ORDER.filter { it in inbox }
    }

    /** The Inbox's own check for a feature's gate (1.5): arrival notices need notifications. */
    fun localCheck(app: App, feature: String): String? = when {
        app.prefs.role != Role.INBOX -> null
        feature == "F15" && !Handoff.notificationsAllowed(app) -> "needs-notifications"
        else -> null
    }

    /** Whether [item] is kept for later (F15): it waits, and with Lab on nothing hands it over until Add to Reader. */
    fun keptForLater(item: InboxItem, lab: Boolean): Boolean = lab && item.held && item.state == InboxItem.WAITING

    /** An excerpt (F11): a document whose `x-cap` is "excerpt". */
    fun isExcerpt(item: InboxItem): Boolean = item.extras[ItemHeader.X_CAP] == "excerpt"

    /**
     * The line under a row's title (F03, F11): "Page as you saw it", "Clean article", "Excerpt", "Test article", "Link
     * (the Reader downloads it)" or "Document · {MB} MB", then " · from {from}" (`LabText.inboxKindLine`).
     */
    fun kindLine(item: InboxItem): String = LabText.inboxKindLine(item.kind, item.extras, item.size, item.from)

    /** "Cleaned from {host}" (2.3) for an item whose sender cleaned its link (`x-orig`), else null. */
    fun cleanedFrom(item: InboxItem): String? = LabText.cleanedFromText(item.extras[ItemHeader.X_ORIG])

    /**
     * F01: "Sender sees: {label}", the label the sender's row shows for this item: the item is on the Daylight (its ack
     * went out), so it is the row of a delivered item from a Lab Daylight with the state this Inbox last recorded
     * ([InboxItem.labState]): "On your Daylight ✓" before any, then "Waiting for a tap on your Daylight", "Kept for
     * later on your Daylight", "Handed to the Reader", "In your Reader ✓", … Only items from a paired sender (the
     * pairing's lane) have one: no sender holds the others' ids.
     */
    fun senderSees(item: InboxItem, now: Long = System.currentTimeMillis()): String? {
        if (item.lane != InboxItem.LANE_PAIRING) return null
        val ctx = LabRowText.Context(lab = true, inboxLab = true, state = item.labState)
        val row = LabRowText.of(Status.DELIVERED, "", item.kind, item.size, item.received, now, ctx)
        return LabText.fill(LabText["senderSees"], mapOf("label" to row.label))
    }

    fun arrivals(app: App): Arrivals = Arrivals.parse(app.prefs.labArrivals)

    /** Quiet hours (F15): from 22:00 to 07:00, local time. */
    fun quietHour(hour: Int): Boolean = hour >= QUIET_FROM || hour < QUIET_UNTIL

    const val QUIET_FROM = 22
    const val QUIET_UNTIL = 7

    /** The clock of Quiet hours (tests set the time of day). */
    @VisibleForTesting
    @Volatile
    var clock: () -> Long = System::currentTimeMillis

    /** Whether notices go silently now: "Quiet hours" is on and it is between 22:00 and 07:00 here. */
    fun quietHoursNow(app: App, now: Long = clock()): Boolean =
        app.prefs.labQuietHours && quietHour(Calendar.getInstance().apply { timeInMillis = now }.get(Calendar.HOUR_OF_DAY))

    /** How long a refused SAVE_PAGE counts as "lately" for Setup check's "The Reader’s read-later" (F26). */
    const val READ_LATER_LATELY_MS = 7L * 24 * 3_600_000

    /** The Reader answered SAVE_PAGE with [status] (F26): a refusal is remembered until it takes one again. */
    fun noteSavePage(app: App, status: String, now: Long = System.currentTimeMillis()) {
        when (status) {
            "refused" -> app.prefs.labReadLaterRefusedAt = now
            "saved", "duplicate", "queued" -> if (app.prefs.labReadLaterRefusedAt != 0L) app.prefs.labReadLaterRefusedAt = 0L
        }
    }

    /** Whether the Reader refused SAVE_PAGE in the last week and has not taken one since. */
    fun readLaterRefusedLately(app: App, now: Long = System.currentTimeMillis()): Boolean {
        val at = app.prefs.labReadLaterRefusedAt
        return at > 0 && now - at in 0 until READ_LATER_LATELY_MS
    }

    /** One line of Setup check (F26): [id] is LAB_TEXT's `setup.checks.<id>`. */
    data class Check(val id: String, val ok: Boolean)

    /** The ids of the Inbox's checks, in Setup check's order (3.3 F26, DC-1 Inbox). */
    val CHECKS = listOf("notifications", "newItemsChannel", "overlay", "batteryOptimisation", "instantDelivery", "reader", "readerReadLater")

    /**
     * Setup check on the Inbox (F26): notifications, the "New items" channel at high importance, "Display over other
     * apps", battery optimisation, Instant delivery (on and running), a Reader that answers SAVE_PAGE for links (the
     * "Deliver to" choice or Automatic), and the Reader's read-later not refused lately.
     */
    fun checks(context: Context, batteryExempt: Boolean, now: Long = System.currentTimeMillis()): List<Check> {
        val app = App.of(context)
        val notifications = Handoff.notificationsAllowed(context)
        val channel = Handoff.itemsChannelImportance(context)
        val reader = runCatching {
            val target = ReaderApps.targetsFor(context, Kind.URL).firstOrNull()
            target != null && ReaderApps.takesSavePage(context, target)
        }.getOrDefault(false)
        return listOf(
            Check("notifications", notifications),
            Check("newItemsChannel", notifications && (channel == null || channel >= NotificationManager.IMPORTANCE_HIGH)),
            Check("overlay", Handoff.canHandOffInBackground(context)),
            Check("batteryOptimisation", batteryExempt),
            Check("instantDelivery", app.prefs.instantDelivery && !InboxHealth.stopped(app, now)),
            Check("reader", reader),
            Check("readerReadLater", !readLaterRefusedLately(app, now)),
        )
    }

    /**
     * Setup check's "Test the Reader hand-off" (F26): the bundled test article goes into the Inbox as a page and
     * through the normal hand-off (the Inbox is in front, so it goes now). -> the item, or null when it could not be
     * stored.
     */
    fun startReaderTest(activity: Activity): InboxItem? {
        val app = App.of(activity)
        val item = try {
            app.inbox.addReaderTest()
        } catch (e: Exception) {
            logw("lab: reader hand-off test not stored: ${e.message}")
            return null
        }
        app.prefs.labReaderTestId = item.id
        ActivityLog.add(app, "test", item.id, item.kind, "waiting")
        Handoff.dispatch(activity)
        return item
    }
}

/**
 * The Inbox's health (F15): the card at the top of the Inbox screen ("Last checked {rel} · Instant delivery on" and
 * one warning at a time) and, from the 15-minute job, the "Instant delivery stopped" notice in the channel "Inbox
 * health", at most once every 12 hours. Instant delivery's service writes a heartbeat every minute while it runs with
 * Lab on ([beat]); with none for 2 minutes and the service not running in this process, it has stopped.
 */
object InboxHealth {
    /** No heartbeat for this long: Instant delivery has stopped. */
    const val STALE_MS = 2 * 60_000L

    /** How often the service writes its heartbeat. */
    const val BEAT_MS = 60_000L

    /** The "Instant delivery stopped" notice comes at most this often. */
    const val NOTICE_EVERY_MS = 12 * 3_600_000L

    /** The card's warnings, in the order they are shown (one at a time). */
    enum class Warning { STOPPED, NOTIFICATIONS, POLL }

    /** Whether Instant delivery is on but its service is not running ([running]) and has not beaten since [beatAt]. */
    fun stopped(instantOn: Boolean, running: Boolean, beatAt: Long, now: Long): Boolean =
        instantOn && !running && now - beatAt > STALE_MS

    /** [stopped] for this app now: the switch, the service in this process, and its last heartbeat or start. */
    fun stopped(app: App, now: Long = System.currentTimeMillis()): Boolean =
        // Lab: K6 (LAB-PLAN 5.3.4): while the Lab Reader receives for this pairing, Instant delivery is off on purpose.
        app.handover.receivingElsewhere() == null &&
            stopped(app.prefs.instantDelivery, InstantDeliveryService.running, maxOf(app.prefs.labInstantBeat, InstantDeliveryService.startedAt), now)

    /** The card's warning: Instant delivery stopped, then notifications off, then the last poll's error. */
    fun warning(stopped: Boolean, notificationsOk: Boolean, pollError: String?): Warning? = when {
        stopped -> Warning.STOPPED
        !notificationsOk -> Warning.NOTIFICATIONS
        pollError != null -> Warning.POLL
        else -> null
    }

    /**
     * "Last checked {rel} · Instant delivery on" (or "off"): [lastCheck] is the last successful poll; while the live
     * connection is open the Inbox checks all the time ("just now"). -> null before the first check.
     */
    fun line(lastCheck: Long, live: Boolean, instantOn: Boolean, now: Long): String? {
        val at = if (live) now else lastCheck
        if (at <= 0L) return null
        return LabText.fill(LabText[if (instantOn) "arrivals.healthOn" else "arrivals.healthOff"], mapOf("rel" to LabText.relativeTime(at, now)))
    }

    /** Instant delivery's heartbeat (Lab on only). */
    fun beat(app: App, now: Long = System.currentTimeMillis()) {
        if (app.prefs.lab) app.prefs.labInstantBeat = now
    }

    /**
     * The 15-minute job's check (F15.2): with Lab on, on the Inbox, Instant delivery on and stopped, the notice
     * "Instant delivery stopped. …" with **Turn on**, at most once every 12 hours. -> whether it was posted.
     */
    fun checkInBackground(app: App, now: Long = System.currentTimeMillis()): Boolean {
        if (app.prefs.role != Role.INBOX || !app.prefs.lab || !stopped(app, now)) return false
        val last = app.prefs.labHealthNoticeAt
        if (last > 0 && now - last in 0 until NOTICE_EVERY_MS) return false
        logi("lab: instant delivery stopped (no heartbeat for ${STALE_MS / 60_000} minutes)")
        if (!Handoff.notificationsAllowed(app)) return false
        ArrivalNotices.ensureChannels(app)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(app, 5, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        val turnOn = PendingIntent.getBroadcast(app, 6, Intent(app, ArrivalActionReceiver::class.java).setAction(ArrivalActionReceiver.ACTION_TURN_ON), flags)
        val text = LabText["arrivals.stopped"]
        val n = NotificationCompat.Builder(app, ArrivalNotices.CH_HEALTH)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(LabText["arrivals.channelHealth"])
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, LabText["arrivals.turnOn"], turnOn)
            .build()
        val shown = runCatching { NotificationManagerCompat.from(app).notify(ArrivalNotices.HEALTH_NOTIFICATION, n) }
            .onFailure { logw("notification not shown", it) }.isSuccess
        if (shown) {
            app.prefs.labHealthNoticeAt = now
            ActivityLog.add(app, "health", "", "", "instant-stopped")
        }
        return shown
    }

    /** **Turn on** (the card, or the notice): Instant delivery's service starts again; the notice goes. */
    fun turnOn(context: Context) {
        val app = App.of(context)
        app.prefs.instantDelivery = true
        InstantDeliveryService.start(context)
        context.getSystemService(NotificationManager::class.java)?.cancel(ArrivalNotices.HEALTH_NOTIFICATION)
        logi("lab: instant delivery turned on again")
    }
}

/**
 * "Saved to the Reader" (F15): items handed over by themselves (links and pages, and documents with "Open as they
 * arrive" or "Add to the library as a batch") get one quiet notice each, "Saved to the Reader: {title}" / "From
 * {from}", with only **Dismiss**, grouped under "{n} saved from {from}" ("from your devices" when they come from
 * several). "Arrival notices" picks the channel: Quiet ("Arrivals", low importance, the default), Alert ("Arrivals
 * (alert)", high) or Off (none); during "Quiet hours" they go silently. An item that had a notice before (it waited
 * for a tap) never gets another. With Lab off none is posted.
 */
object ArrivalNotices {
    /** "Arrivals" (not "arrivals": that id was the old "New items" channel, deleted at every start). */
    const val CH_QUIET = "lab-arrivals"
    const val CH_ALERT = "lab-arrivals-alert"
    const val CH_HEALTH = "lab-inbox-health"
    const val GROUP = "com.daylight.share.ARRIVALS"

    /** Per-item notices are tagged with the item's id under this number; the group summary has its own. */
    const val ITEM_NOTIFICATION = 11
    const val SUMMARY_NOTIFICATION = 12
    const val HEALTH_NOTIFICATION = 13

    /** The item's sender, in the notice's extras (for the summary). */
    private const val EXTRA_FROM = "com.daylight.share.ARRIVAL_FROM"

    /** The states of a hand-off that get the notice (2.2.3): in the Reader, in its queue, or handed to it. */
    private val SAVED = setOf("reader", "queued", "handed")

    /** The Lab channels (F15): created when first needed, with Lab on. */
    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_QUIET, LabText["arrivals.channelQuiet"], NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_ALERT, LabText["arrivals.channelAlert"], NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_HEALTH, LabText["arrivals.channelHealth"], NotificationManager.IMPORTANCE_DEFAULT))
    }

    /** Items [ids] had a notice (a waiting item's announcement, or this one's): no "Saved to the Reader" follows. */
    fun noted(app: App, ids: Collection<String>) {
        if (ids.isEmpty()) return
        val cur = app.prefs.labNoticedIds()
        if (cur.containsAll(ids)) return
        // Kept for the items the Inbox still lists (at most 300).
        val listed = app.inbox.items.value.mapTo(HashSet()) { it.id }
        app.prefs.setLabNoticedIds(cur.filterTo(HashSet()) { it in listed } + ids)
    }

    fun savedTitle(item: InboxItem): String = LabText.fill(LabText["arrivals.saved"], mapOf("title" to item.displayTitle))

    fun savedText(item: InboxItem): String = LabText.fill(LabText["arrivals.savedText"], mapOf("from" to Notices.sender(item)))

    /** The group's summary: "{n} saved from {from}", or "… from your devices" when they come from several. */
    fun summaryTitle(n: Int, froms: List<String>): String {
        val distinct = froms.distinct()
        val from = distinct.singleOrNull()?.takeIf { it.isNotEmpty() } ?: LabText["arrivals.yourDevices"]
        return LabText.fill(LabText["arrivals.savedGroup"], mapOf("n" to n, "from" to from))
    }

    /**
     * After a hand-off that went without a tap ([HandoffActivity]: `by=auto` or `by=front`) ended with the Reader's
     * [status]: the "Saved to the Reader" notice, once. -> whether it was posted.
     */
    fun saved(app: App, item: InboxItem, status: String, now: Long = InboxLab.clock()): Boolean {
        if (!app.prefs.lab || item.lane == InboxItem.LANE_LOCAL) return false
        val mode = InboxLab.arrivals(app)
        if (mode == Arrivals.OFF || LabReporter.stateFor(status) !in SAVED) return false
        if (item.id in app.prefs.labNoticedIds()) return false
        noted(app, listOf(item.id))
        if (!Handoff.notificationsAllowed(app)) return false
        ensureChannels(app)
        val alert = mode == Arrivals.ALERT
        // Quiet hours: posted silently (it does not alert, in its group or alone).
        val silent = InboxLab.quietHoursNow(app, now)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(app, 4, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        val dismiss = PendingIntent.getBroadcast(
            app, item.id.hashCode(),
            Intent(app, ArrivalActionReceiver::class.java).setAction(ArrivalActionReceiver.ACTION_DISMISS).setData(Handoff.itemUri(item.id)), flags,
        )
        val b = NotificationCompat.Builder(app, if (alert) CH_ALERT else CH_QUIET)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(savedTitle(item))
            .setContentText(savedText(item))
            .setPriority(if (alert) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW)
            .setWhen(now)
            .setShowWhen(true)
            .setGroup(GROUP)
            .setGroupAlertBehavior(if (silent) NotificationCompat.GROUP_ALERT_SUMMARY else NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, LabText["arrivals.dismiss"], dismiss)
            .addExtras(Bundle().apply { putString(EXTRA_FROM, Notices.sender(item)) })
        if (silent) b.setSilent(true)
        val shown = runCatching { NotificationManagerCompat.from(app).notify(item.id, ITEM_NOTIFICATION, b.build()) }
            .onFailure { logw("notification not shown", it) }.isSuccess
        if (!shown) return false
        logi("received ${item.id} -> arrival notice: saved to the Reader (${mode.key})")
        ActivityLog.add(app, "notice", item.id, item.kind, "saved")
        updateSummary(app)
        return true
    }

    /** **Dismiss** on a "Saved to the Reader" notice: it goes, and nothing else changes (no state). */
    fun dismiss(context: Context, id: String) {
        context.getSystemService(NotificationManager::class.java)?.cancel(id, ITEM_NOTIFICATION)
        logi("received $id -> arrival notice dismissed")
        updateSummary(context)
    }

    /** Posts or takes down the group's summary for the "Saved to the Reader" notices that are up. */
    private fun updateSummary(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val up = runCatching { nm.activeNotifications }.getOrNull()
            ?.filter { it.id == ITEM_NOTIFICATION && it.tag != null } ?: return
        if (up.size < 2) {
            nm.cancel(SUMMARY_NOTIFICATION)
            return
        }
        val title = summaryTitle(up.size, up.map { it.notification.extras.getString(EXTRA_FROM) ?: "" })
        val open = PendingIntent.getActivity(
            context, 4, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val summary = NotificationCompat.Builder(context, CH_QUIET)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setNumber(up.size)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(SUMMARY_NOTIFICATION, summary) }.onFailure { logw("notification not shown", it) }
    }
}

/**
 * The Lab notices' actions (F15): **Keep for later** on a waiting item's notice ([ACTION_KEEP]), **Dismiss** on a
 * "Saved to the Reader" notice ([ACTION_DISMISS]) and **Turn on** on "Instant delivery stopped" ([ACTION_TURN_ON]).
 * The item's id is the intent's data (`daylightshare-item:<id>`).
 */
class ArrivalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.data?.schemeSpecificPart?.takeIf { ItemHeader.isId(it) }
        when (intent.action) {
            ACTION_KEEP -> id?.let { Handoff.keepForLater(context, it) }
            ACTION_DISMISS -> id?.let { ArrivalNotices.dismiss(context, it) }
            ACTION_TURN_ON -> InboxHealth.turnOn(context)
        }
    }

    companion object {
        const val ACTION_KEEP = "com.daylight.share.action.KEEP_FOR_LATER"
        const val ACTION_DISMISS = "com.daylight.share.action.ARRIVAL_DISMISS"
        const val ACTION_TURN_ON = "com.daylight.share.action.INSTANT_ON"
    }
}
