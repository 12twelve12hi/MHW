package com.daylight.share.inbox

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.Role
import com.daylight.share.logi
import com.daylight.share.logw
import com.daylight.share.ui.MainActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Live delivery (PROTOCOL 3.2): one streaming connection to the inbox topic while anyone holds it (the Inbox screen
 * while visible, the Instant delivery service while on). Reconnects with backoff, 2 s doubling to 60 s.
 */
object Live {
    enum class State { OFF, CONNECTING, LIVE, WAITING_TO_RETRY }

    private val holders = MutableStateFlow<Set<String>>(emptySet())
    private val _state = MutableStateFlow(State.OFF)
    val state: StateFlow<State> get() = _state

    fun acquire(holder: String) {
        holders.value = holders.value + holder
    }

    fun release(holder: String) {
        holders.value = holders.value - holder
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun start(app: App) {
        app.scope.launch {
            combine(holders, app.role, app.inbox.pairingFlow) { h, role, pairing -> Triple(h.isNotEmpty(), role, pairing) }
                .collectLatest { (wanted, role, pairing) ->
                    if (wanted && role == Role.INBOX && pairing != null) { connect(app) } else { _state.value = State.OFF }
                }
        }
    }

    private suspend fun connect(app: App) {
        var backoff = 2_000L
        try {
            while (true) {
                val opened = System.currentTimeMillis()
                try {
                    _state.value = State.CONNECTING
                    // Catch up first (and ack), then follow the stream from the cursor.
                    if (app.inbox.pollOnce() > 0) withContext(Dispatchers.Main) { Handoff.dispatch(app) }
                    val receiver = app.inbox.receiver()
                    val stream = withContext(Dispatchers.IO) {
                        receiver.relay.openStream(receiver.pairing.keys.inboxTopic, receiver.since()) { receiver.handled(it) }
                    }
                    _state.value = State.LIVE
                    app.inbox.sync.value = app.inbox.sync.value.copy(live = true, error = null)
                    coroutineScope {
                        val closer = launch {
                            try {
                                awaitCancellation()
                            } finally {
                                stream.close()
                            }
                        }
                        withContext(Dispatchers.IO) {
                            while (true) {
                                val msg = stream.next() ?: break
                                if (app.inbox.handleLive(msg) > 0) withContext(Dispatchers.Main) { Handoff.dispatch(app) }
                            }
                        }
                        closer.cancel()
                    }
                    logi("live: stream ended, reconnecting")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    logw("live: ${e.message ?: e.javaClass.simpleName}")
                    app.inbox.sync.value = app.inbox.sync.value.copy(live = false, error = e.message)
                }
                app.inbox.sync.value = app.inbox.sync.value.copy(live = false)
                if (System.currentTimeMillis() - opened > 60_000) backoff = 2_000L
                _state.value = State.WAITING_TO_RETRY
                delay(backoff)
                backoff = minOf(backoff * 2, 60_000L)
            }
        } finally {
            app.inbox.sync.value = app.inbox.sync.value.copy(live = false)
            _state.value = State.OFF
        }
    }
}

/** "Instant delivery": a foreground service that holds the live connection while the Inbox is not on screen. */
class InstantDeliveryService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = App.of(this)
        // startForegroundService() requires startForeground() even when the service stops right away.
        try {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification(),
                if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
            )
        } catch (e: Exception) {
            logw("instant delivery could not start", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (app.prefs.role != Role.INBOX || !app.prefs.instantDelivery) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        Live.acquire(HOLDER)
        return START_STICKY
    }

    override fun onDestroy() {
        Live.release(HOLDER)
        super.onDestroy()
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 3, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, App.CH_INSTANT)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Instant delivery is on")
            .setContentText("Items from your phone arrive right away.")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 8
        private const val HOLDER = "instant"

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, InstantDeliveryService::class.java))
            } catch (e: Exception) {
                // Android 12+ refuses to start it from the background; the next app start or boot does it.
                logw("instant delivery not started: ${e.message}")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, InstantDeliveryService::class.java))
        }
    }
}

/** After a reboot or an update: Instant delivery back on, background work scheduled (App.onCreate does both). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        logi("boot/update: ${intent.action}")
        // App.onCreate has run already (it schedules the work); start Instant delivery here too, while Android allows it.
        val app = App.of(context)
        if (app.prefs.role == Role.INBOX && app.prefs.instantDelivery) InstantDeliveryService.start(context)
    }
}
