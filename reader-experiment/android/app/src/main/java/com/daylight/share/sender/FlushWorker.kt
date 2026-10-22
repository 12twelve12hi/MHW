package com.daylight.share.sender

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkerParameters
import com.daylight.share.App
import com.daylight.share.Role
import com.daylight.share.core.ErrorCode
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Status
import java.util.concurrent.TimeUnit

/**
 * F07 (offline-first outbox): while items wait for a connection, the unique one-time job [NAME] with a `CONNECTED`
 * constraint. When the network is back it runs `Outbox.flushNetwork()` (oldest first, at most 30 frames and 18 MB of
 * attachments a pass; nothing more after a 429, no attachment after a 413), passes at least 3 minutes apart
 * ([Outbox.FLUSH_SPACING_MS]), and schedules the next pass while items still wait. With Lab off it does nothing: the
 * v1.1 back-off sends them (LAB-PLAN 1.3).
 */
class FlushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = App.of(applicationContext)
        val next = run(app)
        if (next != null) schedule(applicationContext, next, fromWorker = true)
        return Result.success()
    }

    companion object {
        const val NAME = "flush"

        /**
         * Schedules a pass when the network is there (and [delayMs] has passed). From outside the job an already
         * scheduled pass is kept; the job itself appends its next pass after it ends.
         */
        fun schedule(context: Context, delayMs: Long = 0, fromWorker: Boolean = false) {
            PhoneLab.noteJob(NAME)
            val req = OneTimeWorkRequestBuilder<FlushWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(maxOf(0L, delayMs), TimeUnit.MILLISECONDS)
                .build()
            SendWorker.wm(context)?.enqueueUniqueWork(NAME, if (fromWorker) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP, req)
        }

        /** Whether [row] waits for a connection (F07): failed for want of a network, deferred while offline included. */
        fun waiting(row: OutboxRow): Boolean = row.status == Status.FAILED && row.errorCode == ErrorCode.NETWORK

        /**
         * One pass, callable without WorkManager. -> the delay until the next pass when items still wait for a
         * connection (null: none wait, or Lab is off). Passes come at least [Outbox.FLUSH_SPACING_MS] apart: a pass that
         * comes sooner only says when the next may run.
         */
        suspend fun run(app: App, now: Long = System.currentTimeMillis()): Long? {
            if (!app.prefs.lab || app.prefs.role != Role.SENDER) return null
            val o = app.sender.outbox() ?: return null
            if (o.rows().none { waiting(it) }) return null
            val since = now - app.prefs.labFlushAt
            if (since in 0 until Outbox.FLUSH_SPACING_MS) return Outbox.FLUSH_SPACING_MS - since
            app.prefs.labFlushAt = now
            val attempted = app.sender.flush()
            app.sender.afterAttempts(attempted, scheduleFlush = false)
            return if (o.rows().any { waiting(it) }) Outbox.FLUSH_SPACING_MS else null
        }
    }
}
