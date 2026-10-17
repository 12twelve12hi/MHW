package com.daylight.share

import android.app.Notification
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
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
import java.util.concurrent.TimeUnit

/**
 * Background work for both roles: the Inbox polls its topic and hands new items on; a sender publishes what is due,
 * reads acks and re-sends (PROTOCOL 3.3 and 3.4). Every 15 minutes, plus on demand.
 */
object Work {
    private const val PERIODIC = "dls-periodic"
    private const val NOW = "dls-now"
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedulePeriodic(context: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun cancelPeriodic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }

    /** Runs a sync as soon as possible (expedited where the quota allows), after any sync already running. */
    fun syncNow(context: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }

    /** A later check (a sender reads acks again ~30 s and a few minutes after sending). */
    fun syncLater(context: Context, delaySeconds: Long) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("dls-later-$delaySeconds", ExistingWorkPolicy.REPLACE, req)
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = App.of(applicationContext)
        when (app.prefs.role) {
            Role.INBOX -> {
                app.inbox.pollOnce()
                Handoff.dispatch(app)
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
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(4711, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE)
        else ForegroundInfo(4711, n)
    }
}
