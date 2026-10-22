package com.daylight.share

import android.app.Notification
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.daylight.share.inbox.Handoff
import com.daylight.share.inbox.InboxHealth
import java.util.concurrent.TimeUnit

/**
 * Background work for both roles: the Inbox polls its topic and hands new items on; a sender publishes what is due,
 * reads acks and re-sends (PROTOCOL 3.3 and 3.4). Every 15 minutes, plus on demand. Lab (F15, K5): on the Inbox the
 * job also checks that Instant delivery, when on, is still running, and says so in "Inbox health" when it stopped.
 */
object Work {
    private const val PERIODIC = "dls-periodic"
    private const val NOW = "dls-now"
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** WorkManager, or null where it is not set up (never in the app, whose startup provider initialises it; JVM tests). */
    private fun wm(context: Context): WorkManager? =
        if (WorkManager.isInitialized()) WorkManager.getInstance(context) else null.also { logw("WorkManager not initialised") }

    fun schedulePeriodic(context: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
        wm(context)?.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun cancelPeriodic(context: Context) {
        wm(context)?.cancelUniqueWork(PERIODIC)
    }

    /** Runs a sync as soon as possible (expedited where the quota allows), after any sync already running. */
    fun syncNow(context: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        wm(context)?.enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }

    /** A later check (a sender reads acks again ~30 s and a few minutes after sending). */
    fun syncLater(context: Context, delaySeconds: Long) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
            .build()
        wm(context)?.enqueueUniqueWork("dls-later-$delaySeconds", ExistingWorkPolicy.REPLACE, req)
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = App.of(applicationContext)
        when (app.prefs.role) {
            Role.INBOX -> {
                app.inbox.pollOnce()
                Handoff.dispatch(app)
                // Lab (F15): "Instant delivery stopped", at most once every 12 hours (Lab on only).
                runCatching { InboxHealth.checkInBackground(app) }.onFailure { logw("lab: health check failed: ${it.message}") }
            }
            Role.SENDER -> app.sender.tick()
            null -> Unit
        }
        return Result.success()
    }

    /** Only used for expedited work on Android 11 and older, which runs it as a short foreground service. */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val n: Notification = NotificationCompat.Builder(applicationContext, App.CH_SYNC)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Daylight Share")
            .setContentText("Checking for items…")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
        // No service type: this only runs on Android 11 and older, where types are not enforced.
        return ForegroundInfo(4711, n)
    }
}
