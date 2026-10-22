package com.daylight.share.sender

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.core.ErrorCode
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabLedger
import com.daylight.share.core.lab.LabText
import com.daylight.share.logi
import com.daylight.share.ui.MainActivity

/**
 * F04's notifications on the phone (LAB-PLAN 3.3 F04), in the channel "Send results" (`IMPORTANCE_DEFAULT`):
 *
 * - "Couldn’t send ‘{title}’ to {name}" / "Open to try again." when an item shared in place ends failed or expired
 *   after the card closed (a `network` failure is the exception: it waits for a connection, F07), unless "Tell me when a
 *   send fails" is off;
 * - "In your Reader ✓: {title}", quietly, when the ledger confirms `reader`, only with "Tell me when it’s in my Reader".
 *
 * Each is posted once per item, only with Lab on, and never without notification permission (F04's row in What's in
 * Lab then says "Needs notifications"). Tapping one opens the app, whose list starts with the row.
 */
object Notices {
    /** The channel id; its name is LAB_TEXT's `shareInPlace.channel` ("Send results"). */
    const val CHANNEL = "send-results"

    private const val ID_BASE = 0x4400

    /** How long a delivered item shared in place may still get its "In your Reader ✓" notice. */
    private const val KEEP_DELIVERED_MS = 48L * 3_600_000

    /** Creates the channel (once; Android keeps it). */
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, LabText["shareInPlace.channel"], NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = LabText["features.F04.sentence"]
            setShowBadge(true)
        })
    }

    /** What a row is called in a notice: its title, else its file name, else its URL. */
    fun titleOf(row: OutboxRow): String = row.title.ifEmpty { if (row.kind == Kind.FILE) row.name else row.url }

    /** Whether [row] ended in a way F04 tells about: failed (not for want of a network) or expired. */
    fun endedBadly(row: OutboxRow): Boolean =
        (row.status == Status.FAILED && row.errorCode != ErrorCode.NETWORK) || row.status == Status.EXPIRED

    /**
     * Looks at the items shared in place that may still be told about ([com.daylight.share.Prefs.labInPlaceIds]): one
     * that ended badly gets the failure notice, one the ledger says is in the Reader gets the quiet notice, and either
     * leaves the list; so does one that is no longer in the outbox, or was delivered over two days ago. Lab off: nothing is posted
     * and the list stays (Lab's notifications come back with it, 1.3).
     */
    fun review(app: App, rows: List<OutboxRow>, snapshot: LabLedger.Snapshot?) {
        if (!app.prefs.lab) return
        val ids = app.prefs.labInPlaceIds()
        if (ids.isEmpty()) return
        val byId = rows.associateBy { it.id }
        val now = System.currentTimeMillis()
        val keep = HashSet<String>()
        for (id in ids) {
            val row = byId[id] ?: continue
            when {
                endedBadly(row) -> failed(app, row)
                snapshot?.state(id)?.s == "reader" -> inReader(app, row)
                // Delivered two days ago and still not in the Reader: nothing more will be told.
                row.status == Status.DELIVERED && now - row.delivered > KEEP_DELIVERED_MS -> Unit
                else -> keep += id
            }
        }
        if (keep.size != ids.size) app.prefs.setLabInPlaceIds(keep)
    }

    /** The failure notice for [row] (when "Tell me when a send fails" is on and notifications are allowed). */
    fun failed(app: App, row: OutboxRow) {
        if (!app.prefs.labTellFails) return
        val title = LabText.fill(LabText["shareInPlace.failedTitle"], mapOf("title" to titleOf(row), "name" to PhoneLab.daylightName(app)))
        if (post(app, row.id, title, LabText["shareInPlace.failedText"], quiet = false)) {
            logi("lab: send result notice for ${row.id.take(8)} (${row.status}${row.errorCode.ifEmpty { null }?.let { " $it" } ?: ""})")
            ActivityLog.add(app, "notice", row.id, row.kind, row.status)
        }
    }

    /** The quiet "In your Reader ✓: {title}" for [row] (only with "Tell me when it’s in my Reader"). */
    fun inReader(app: App, row: OutboxRow) {
        if (!app.prefs.labTellReader) return
        val title = LabText.fill(LabText["shareInPlace.inReader"], mapOf("title" to titleOf(row)))
        if (post(app, row.id, title, null, quiet = true)) ActivityLog.add(app, "notice", row.id, row.kind, "reader")
    }

    @SuppressLint("MissingPermission") // checked: PhoneLab.notificationsOn
    private fun post(app: App, id: String, title: String, text: String?, quiet: Boolean): Boolean {
        if (!PhoneLab.notificationsOn(app)) return false
        ensureChannel(app)
        val open = PendingIntent.getActivity(
            app, id.hashCode(),
            Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .apply { if (text != null) setContentText(text) }
            .setStyle(NotificationCompat.BigTextStyle().bigText(listOfNotNull(title, text).joinToString("\n")))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setSilent(quiet)
            .setPriority(if (quiet) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        return runCatching { NotificationManagerCompat.from(app).notify(ID_BASE + (id.hashCode() and 0xFFFF), n) }.isSuccess
    }
}
