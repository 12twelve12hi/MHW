package com.daylight.share.inbox

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.annotation.VisibleForTesting
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.Role
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.RelayClient
import com.daylight.share.core.lab.FileLabStore
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabInbox
import com.daylight.share.core.lab.LabInboxInfo
import com.daylight.share.logi
import com.daylight.share.logw
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The DC-1 Inbox's Lab frames (LAB-PLAN F17; LAB-PROTOCOL 2.2.4): share-core's [LabInbox] wired into the Inbox. It
 * tells the paired phones and computers that this Daylight speaks Lab (its hello: `lab`, `android/<versionName>`, its
 * caps, its last poll and whether Instant delivery is live) and where each item got to (`x-st`), on the ack topic, last
 * on the household's relay budget.
 *
 * - **Store:** `files/inbox/lab-<inboxTopic>.json`, one per pairing; Reset pairing clears it ([forget]).
 * - **What it records**, for items of the pairing's inbox topic only ([InboxItem.LANE_PAIRING]; server-lane items get
 *   nothing): `waiting` when an item is first announced ([announced]; never again for that id), `held` when its card
 *   was answered Later or its notification swiped away ([held]), the final state of every hand-off ([handedOff],
 *   mapped by [stateFor]; nothing for "started") and `inbox` for every item kept in the Inbox ([kept]).
 * - **When it publishes:** after every poll and live batch, once their acks are out ([afterPoll], [afterLive]); at the
 *   end of every hand-off run ([flushSoon] from [HandoffActivity]'s `finally`); 2 s after a state is recorded, and when
 *   the 30 s spacing is over ([LabInbox]'s schedule). It gives way while the last acks failed and for an hour after a
 *   429 or 413 ([afterPoll], [pollFailed], [afterLiveAcks]), and with no network it leaves it to the `lab-flush` job
 *   ([LabFlushWorker], a CONNECTED constraint). With the v1.1 ack digest's 11 hours it runs the Lab state digest.
 * - **The switch:** [App.setLab] sets `Prefs.lab`, then [labSwitched] sends the hello (on) or the one `lab: 0` frame
 *   (off) on a worker; the `lab: 0` frame is repeated after each digest for 48 hours. With Lab off nothing else goes.
 * - **Threads:** recording only reads and writes the store (the hand-off calls it on the main thread); everything that
 *   publishes runs on one worker. A flush failure never blocks a hand-off.
 * - **Log** (tag `DaylightShare`): `lab: hello caps=<…>`, `lab: states n=<k> published`, `lab: state <id> <s>`.
 */
class LabReporter(private val app: App) {
    private class Bound(val topic: String, val relay: String, val from: String, val inbox: LabInbox)

    private val lock = Any()
    @Volatile private var bound: Bound? = null
    private var scheduled: Job? = null
    private val flushQueued = AtomicBoolean(false)

    @OptIn(ExperimentalCoroutinesApi::class)
    private val worker = Dispatchers.IO.limitedParallelism(1)

    /** The clock of the Lab frames and the states' times (tests use a fake one). */
    @VisibleForTesting
    internal var clock: () -> Long = System::currentTimeMillis

    /** Whether flushes run by themselves (on the worker, after polls, records and hand-offs); tests call [flushNow]. */
    @VisibleForTesting
    @Volatile
    internal var autoFlush: Boolean = true

    private val dir: File get() = File(app.filesDir, "inbox")

    /** The Lab store of the pairing whose inbox topic is [topic]. */
    fun storeFile(topic: String): File = File(dir, "lab-$topic.json")

    /** The Inbox's [LabInbox] for its current pairing; null outside the Inbox role. */
    fun inbox(): LabInbox? {
        if (app.prefs.role != Role.INBOX) return null
        // The pairing first, outside this class's lock: InboxRepo calls [forget] under its own.
        val p = app.inbox.ensurePairing()
        val topic = p.keys.inboxTopic
        val from = app.prefs.deviceName
        synchronized(lock) {
            bound?.takeIf { it.topic == topic && it.relay == p.relay && it.from == from }?.let { return it.inbox }
            val li = LabInbox(
                store = FileLabStore(storeFile(topic)),
                relay = RelayClient(p.relay, app.inbox.relayHttp()),
                keys = p.keys,
                info = ::info,
                from = from,
                clock = { this@LabReporter.clock() },
                schedule = ::schedule,
                log = { logi(it) },
            )
            bound = Bound(topic, p.relay, from, li)
            return li
        }
    }

    /**
     * The Inbox's hello (2.2.1): its Lab level from the switch, read on every call (a new or cleared store starts with
     * Lab on exactly when it is 1), `android/<versionName>`, its [caps], and whether Instant delivery is connected now.
     */
    fun info(): LabInboxInfo = LabInboxInfo(
        lab = if (app.prefs.lab) Lab.LAB_LEVEL else 0,
        app = "android/${BuildConfig.VERSION_NAME}",
        caps = caps(),
        live = app.prefs.instantDelivery && Live.state.value == Live.State.LIVE,
    )

    /**
     * The hello's caps (2.2.2): `st` and `tap`, `reader-link` when the app links go to first takes SAVE_PAGE (the
     * Reader then confirms links and pages), and `cap-kind` (W1, K5: its rows show each item's `x-cap` kind, F03).
     * Choosing another "Deliver to" app or installing a Reader changes them, and the next flush sends a hello.
     */
    fun caps(): List<String> {
        val out = arrayListOf(Lab.Caps.ST, Lab.Caps.TAP)
        val linkTarget = runCatching { ReaderApps.targetsFor(app, Kind.URL).firstOrNull() }.getOrNull()
        if (linkTarget != null && runCatching { ReaderApps.takesSavePage(app, linkTarget) }.getOrDefault(false)) out += Lab.Caps.READER_LINK
        out += Lab.Caps.CAP_KIND
        return out
    }

    // ----------------------------------------------------------------------------------------------- what it records

    /** Items announced for the first time (a notification, the card): `waiting`, once per id. */
    fun announced(items: List<InboxItem>) {
        val fresh = items.filter { it.lane == InboxItem.LANE_PAIRING }
        if (fresh.isEmpty() || !app.prefs.lab) return
        val li = inbox() ?: return
        val done = app.prefs.labWaitingIds()
        val added = ArrayList<String>()
        for (item in fresh) {
            if (item.id in done) continue
            added += item.id
            if (li.record(item.id, STATE_WAITING, seconds())) remember(item.id, STATE_WAITING)
        }
        if (added.isEmpty()) return
        // Kept for the items the Inbox still lists (at most 300).
        val listed = app.inbox.items.value.mapTo(HashSet()) { it.id }
        app.prefs.setLabWaitingIds(done.filterTo(HashSet()) { it in listed } + added)
    }

    /** Items kept for later on purpose: the card's Later, or a notification swiped away. */
    fun held(ids: Collection<String>) {
        for (id in ids) app.inbox.get(id)?.let { record(it, STATE_HELD) }
    }

    /** A hand-off's final state: the Reader's [status] mapped by [stateFor] (never "started"). */
    fun handedOff(item: InboxItem, status: String) = record(item, stateFor(status))

    /** An item that stays in the Inbox: no Reader takes it, or its content is gone. */
    fun kept(item: InboxItem) = record(item, STATE_INBOX)

    private fun record(item: InboxItem, s: String) {
        if (item.lane != InboxItem.LANE_PAIRING) return
        val li = inbox() ?: return
        if (li.record(item.id, s, seconds())) remember(item.id, s)
    }

    /** The item's last recorded state, for its details' "Sender sees: {label}" (F01, K5). */
    private fun remember(id: String, s: String) {
        app.inbox.setItem(id) { if (it.labState == s) it else it.copy(labState = s) }
    }

    private fun seconds(): Long = clock() / 1000

    // ------------------------------------------------------------------------------------------- when it publishes

    /** A poll went through: its acks are out (or failed, [ackFailed]); [limitStatus] the relay's 429 or 413, or 0. */
    fun afterPoll(ackFailed: Boolean, limitStatus: Int) {
        val li = inbox() ?: return
        li.notePolled(clock())
        li.noteAcksFailed(ackFailed)
        li.noteRelayLimit(limitStatus)
        val now = clock()
        if (now - app.prefs.labDigestAt >= Limits.DIGEST_INTERVAL_MS || app.prefs.labDigestAt > now) {
            app.prefs.labDigestAt = now
            inWorker("digest") { li.digest().also(::afterFlush) }
        } else {
            flushSoon()
        }
    }

    /** A poll failed with the relay's [status] (a 429 makes the Lab frames give way for an hour). */
    fun pollFailed(status: Int) {
        if (status == 429 || status == 413) inbox()?.noteRelayLimit(status)
    }

    /** A live batch's acks went out ([ackFailed] when not), with the publish's 429 or 413 in [limitStatus]. */
    fun afterLiveAcks(ackFailed: Boolean, limitStatus: Int) {
        val li = inbox() ?: return
        li.noteAcksFailed(ackFailed)
        li.noteRelayLimit(limitStatus)
    }

    /** After a live batch (a download's 429 in [limitStatus]); [flush] when it brought items or acks. */
    fun afterLive(limitStatus: Int, flush: Boolean) {
        val li = inbox() ?: return
        li.noteRelayLimit(limitStatus)
        if (flush) flushSoon()
    }

    /** The Lab switch changed ([App.setLab] set `Prefs.lab` first): the hello, or the one `lab: 0` frame. */
    fun labSwitched() {
        if (app.prefs.role != Role.INBOX || !autoFlush) return
        inWorker("the Lab switch") { flushNow() }
    }

    /** Flushes on the worker, soon (several asks while one waits make one flush). */
    fun flushSoon() {
        if (!autoFlush || app.prefs.role != Role.INBOX) return
        if (!flushQueued.compareAndSet(false, true)) return
        app.scope.launch(worker) {
            flushQueued.set(false)
            guarded("flush") { flushNow() }
        }
    }

    /**
     * Publishes at most one Lab frame now (blocking: off the main thread), after bringing the store in line with the
     * switch (a hello when Lab went on, the `lab: 0` frame when it went off, also after the app stopped between the
     * two). -> what it did, or null outside the Inbox role.
     */
    fun flushNow(): LabInbox.FlushResult? {
        val li = inbox() ?: return null
        val on = li.debugState()["on"] == true
        val r = when {
            on == app.prefs.lab -> li.flush()
            app.prefs.lab -> li.labTurnedOn()
            else -> li.labTurnedOff()
        }
        afterFlush(r)
        return r
    }

    /** Forgets the Lab store of the pairing with inbox topic [topic] (Reset pairing, another secret). */
    fun forget(topic: String) {
        synchronized(lock) {
            if (bound?.topic == topic) bound = null
        }
        FileLabStore(storeFile(topic)).clear()
        logi("lab: the Inbox's Lab store for the old pairing was cleared")
    }

    private fun afterFlush(r: LabInbox.FlushResult) {
        if (r.reason == "error" && !online()) whenOnline()
    }

    /** [LabInbox]'s schedule: a flush in [delayMs], replacing any earlier one. */
    private fun schedule(delayMs: Long) {
        if (!autoFlush) return
        synchronized(lock) {
            scheduled?.cancel()
            scheduled = app.scope.launch(worker) {
                delay(delayMs)
                guarded("flush") { flushNow() }
            }
        }
    }

    private fun inWorker(what: String, block: () -> Unit) {
        if (!autoFlush) {
            guarded(what, block)
            return
        }
        app.scope.launch(worker) { guarded(what, block) }
    }

    private fun guarded(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            logw("lab: $what failed: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun online(): Boolean = runCatching {
        val cm = app.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }.getOrDefault(true)

    /** No network: the `lab-flush` job flushes once a connection is back. */
    private fun whenOnline() {
        if (!WorkManager.isInitialized()) return
        val req = OneTimeWorkRequestBuilder<LabFlushWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(app).enqueueUniqueWork(FLUSH_WORK, ExistingWorkPolicy.KEEP, req)
        logi("lab: no network; the Lab frames go when it is back ($FLUSH_WORK)")
    }

    companion object {
        /** The WorkManager job that flushes once the network is back. */
        const val FLUSH_WORK = "lab-flush"

        const val STATE_WAITING = "waiting"
        const val STATE_HELD = "held"
        const val STATE_INBOX = "inbox"

        /**
         * The Reader's status after a hand-off -> the state the senders see (LAB-PROTOCOL 2.2.3): saved and duplicate are
         * `reader`, queued is `queued`, no_reader and no_route are `inbox`; sent, ok, no_answer and any other status
         * (the Reader's status is a free string) are `handed`.
         */
        fun stateFor(status: String?): String = when (status) {
            "saved", "duplicate" -> "reader"
            "queued" -> "queued"
            "no_reader", "no_route" -> STATE_INBOX
            else -> "handed"
        }
    }
}

/** `lab-flush`: the Lab frames that waited for a network (LAB-PROTOCOL 2.2.4). */
class LabFlushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        withContext(Dispatchers.IO) { App.of(applicationContext).labReporter.flushNow() }
        return Result.success()
    }
}
