package com.daylight.share

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.os.Looper
import com.daylight.share.core.AckHeader
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Pairing
import com.daylight.share.core.Status
import com.daylight.share.core.lab.LabFrame
import com.daylight.share.core.lab.LabInboxInfo
import com.daylight.share.core.lab.LabState
import com.daylight.share.sender.PhoneLab
import org.junit.Assert.fail
import org.robolectric.Shadows.shadowOf
import java.io.File

/**
 * What the phone's Wave 1 tests share (K4): a paired phone on a relay in memory, outbox rows, the Daylight's Lab frames
 * and acks on the ack topic, the notifications posted, and the Lab jobs asked for.
 */
object PhoneKit {
    const val MIN = 60_000L

    /**
     * The phone, paired with the server vectors' pairing ("Kitchen Daylight") on [relay], in the sender role; Lab on, the
     * one-time note seen (unless [noteSeen] is false) and the link-only hint shown; [online] as Android would say.
     */
    fun phone(app: App, relay: FakeRelay, pairing: Pairing = LabKit.vectorPairing, online: Boolean = true, noteSeen: Boolean = true) {
        LabKit.useRelay(app, relay)
        app.prefs.askedNotifications = true
        app.prefs.deviceName = "Test phone"
        app.prefs.labNoteShown = noteSeen
        app.prefs.labLinkOnlyShown = true
        PhoneLab.onlineOverride = online
        PhoneLab.jobs = java.util.Collections.synchronizedList(ArrayList())
        app.sender.pair(pairing)
        app.setRole(Role.SENDER)
    }

    /** Clears what [phone] set in the process (the online override and the job list). */
    fun reset() {
        PhoneLab.onlineOverride = null
        PhoneLab.jobs = null
    }

    fun store(app: App, pairing: Pairing = LabKit.vectorPairing) = FileOutboxStore(File(app.filesDir, "outbox/${pairing.keys.inboxTopic}"))

    /** Writes [rows] as the outbox (newest first). */
    fun writeRows(app: App, rows: List<OutboxRow>, pairing: Pairing = LabKit.vectorPairing) =
        store(app, pairing).save(rows.sortedByDescending { it.created }, "all")

    fun id(n: Int): String = "%032x".format(0x4400 + n)

    /** A row of [kind] with [title], [status] and the times given. */
    fun row(n: Int, title: String, status: String, created: Long, kind: String = Kind.URL, delivered: Long = 0, errorCode: String = "", lastPublish: Long = created): OutboxRow {
        val h = ItemHeader(
            id = id(n), kind = kind, url = if (kind == Kind.FILE) null else "https://example.com/k4-$n", title = title,
            name = if (kind == Kind.FILE) "file-$n.pdf" else null, mime = if (kind == Kind.FILE) "application/pdf" else null,
            size = if (kind == Kind.URL) null else 120_000L, sha256 = if (kind == Kind.URL) null else "0".repeat(64),
            sent = "2026-10-22T10:00:00.000Z", from = "Test phone", app = "android/test",
        )
        return OutboxRow(
            h, created = created, status = status, errorCode = errorCode, lastPublish = lastPublish, attemptStarted = lastPublish,
            delivered = delivered, deliveredBy = if (status == Status.DELIVERED) "Kitchen Daylight" else "",
        )
    }

    /** The Daylight's Lab hello (caps st and tap) with [states] (id to state), as its Inbox publishes it. */
    fun hello(relay: FakeRelay, states: Map<String, String> = emptyMap(), pairing: Pairing = LabKit.vectorPairing, now: Long = System.currentTimeMillis()) {
        val st = states.map { (id, s) -> LabState(id, s, now / 1000) }
        relay.publish(pairing.keys.ackTopic, LabFrame.build(pairing.keys, LabInboxInfo(1, "android/1.0.99", listOf("st", "tap"), poll = now), st, from = "Kitchen Daylight"))
    }

    /** An ack from the Daylight listing [ids]. */
    fun ack(relay: FakeRelay, ids: List<String>, pairing: Pairing = LabKit.vectorPairing) {
        relay.publish(pairing.keys.ackTopic, AckHeader.frame(pairing.keys, ids, "Kitchen Daylight", System.currentTimeMillis()))
    }

    fun grantNotifications(app: App) = shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)

    fun denyNotifications(app: App) = shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)

    /** The notifications posted, newest last. */
    fun notifications(app: App): List<Notification> = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications

    fun titleOf(n: Notification): String = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()

    /** The jobs asked for so far. */
    fun jobs(): List<String> = PhoneLab.jobs?.let { synchronized(it) { it.toList() } } ?: emptyList()

    /** Runs the main looper (without moving the clock) until [cond] holds, for at most [ms] of real time. */
    fun until(ms: Long = 8_000, what: String = "the condition", cond: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (!cond()) {
            shadowOf(Looper.getMainLooper()).idle()
            if (System.currentTimeMillis() > end) fail("timed out waiting for $what")
            Thread.sleep(15)
        }
    }
}
