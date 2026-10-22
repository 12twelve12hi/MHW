package com.daylight.share.sender

import android.app.Notification
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.core.OutboxRow
import com.daylight.share.logw

/**
 * F04 (share in place): the first publish of an item shared from the share sheet, after the card has closed. An
 * expedited one-time job `send-<id>` with a `CONNECTED` constraint (where the quota ends, it runs as ordinary work);
 * the outbox and the relay finish the upload with the app swiped away. When the item ends failed or expired (not for
 * want of a network), the worker posts the "Send results" notice ([Notices]); a network failure waits for a
 * connection instead ([FlushWorker], F07).
 */
class SendWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString(KEY_ID) ?: return Result.success()
        run(App.of(applicationContext), id)
        return Result.success()
    }

    /** Only used for expedited work on Android 11 and older, which runs it as a short foreground service. */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val n: Notification = NotificationCompat.Builder(applicationContext, App.CH_SYNC)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Daylight Share")
            .setContentText("Sending…")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
        return ForegroundInfo(4712, n)
    }

    companion object {
        const val KEY_ID = "id"

        /** The unique work name of item [id]'s first publish. */
        fun name(id: String) = "send-$id"

        /** Enqueues the first publish of [id] (once: a second call for the same id keeps the first). */
        fun enqueue(context: Context, id: String) {
            PhoneLab.noteJob(name(id))
            val req = OneTimeWorkRequestBuilder<SendWorker>()
                .setInputData(workDataOf(KEY_ID to id))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            wm(context)?.enqueueUniqueWork(name(id), ExistingWorkPolicy.KEEP, req)
        }

        /**
         * The job's work, callable without WorkManager: one attempt for [id] ([SenderRepo.publish]), then what follows
         * it ([SenderRepo.afterAttempts]: the notice, or waiting for a connection). -> the row, or null when it is gone.
         */
        suspend fun run(app: App, id: String): OutboxRow? {
            val row = app.sender.publish(id) ?: return null
            app.sender.afterAttempts(listOf(row))
            return row
        }

        internal fun wm(context: Context): WorkManager? =
            if (WorkManager.isInitialized()) WorkManager.getInstance(context) else null.also { logw("WorkManager not initialised") }
    }
}
