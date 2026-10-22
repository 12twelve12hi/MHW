package com.daylight.share.inbox

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.withResumed
import com.daylight.share.App
import com.daylight.share.core.Kind
import com.daylight.share.logi
import com.daylight.share.logw
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.StatusCard
import com.daylight.share.ui.DaylightTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Hands waiting Inbox items to the Daylight Reader, one at a time (PROTOCOL 3.4 step 4). It is an activity because
 * Android lets apps start activities only from the foreground (or with "Display over other apps"), and because
 * SAVE_PAGE answers with a `status` (saved | duplicate | queued | refused) only to startActivityForResult callers.
 *
 * Links and pages go first, each waiting for the Reader's answer; a refused SAVE_PAGE (read-later from the browser
 * switched off in the Reader) is retried as a shared link. Documents go last, together, because the Reader opens
 * what it imports; "Documents" ([DocumentMode]) decides whether they go as ACTION_SEND or ACTION_SEND_MULTIPLE.
 *
 * A hand-off the Reader does not answer (documents, shared links) goes to the Reader's import, which drops a share
 * that arrives while its previous import is pending (DEVICE-CHECKS.md, round 2): it starts in a fresh task
 * ([Routes.IMPORT_FLAGS]), never within [IMPORT_GAP_MS] of the previous one (this activity waits, with its card), and
 * the hand-off ends there (the Reader is in front); what it wanted and is still waiting is offered again when the gap
 * is over. If this activity is sent to the background (Home while the card waits, or the Reader in front), nothing
 * brings it back, so it ends and announces what still waits rather than block every later hand-off.
 */
class HandoffActivity : ComponentActivity() {
    /** What a running hand-off takes: [mode], the [picked] items, and "Documents" ([docs]) as it started. */
    data class Claim(val mode: String, val picked: Set<String>, val docs: DocumentMode)

    private var mode = MODE_ALL
    /** Items a notification's or the card's tap asked for ([MODE_ONE], or added to a hand-off already running). */
    private val picked = LinkedHashSet<String>()
    /** Those of [picked] that came from the card over the Reader (logged `by=card`). */
    private val fromCard = HashSet<String>()
    private var docs = DocumentMode.DEFAULT
    private var myClaim: Claim? = null
    private var pending: CompletableDeferred<ActivityResult>? = null
    private val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        pending?.complete(r)
    }
    private val message = mutableStateOf("Adding to Daylight Reader…")
    /** A hand-off went to the Reader's import: it is in front now, and the next import waits [IMPORT_GAP_MS]. */
    private var importStarted = false
    /** Ends this activity if the Reader's answer does not come while it is in the background ([onStop]). */
    private var answerTimeout: Job? = null
    /** This instance's hand-off, as [current] names it. */
    private val run = Any()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = run
        running = true
        requestedAt = 0L
        mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_ALL
        intent?.let { pick(it) }
        docs = App.of(this).prefs.documentMode
        claimNow()
        // Our card shows only until the Reader's own card is up (two stacked cards look messy on e-paper).
        setContent { DaylightTheme { if (message.value.isNotEmpty()) StatusCard(message.value) } }
        lifecycleScope.launch {
            try {
                val handed = runQueue()
                if (handed == 0 && mode != MODE_AUTO && savedInstanceState == null && openedFromNotification) {
                    // A tap with nothing to hand over (already in the Reader, or removed): show the Inbox instead of flashing.
                    startActivity(Intent(this@HandoffActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logw("hand-off stopped", e)
            } finally {
                ended()
                unclaim()
                // Whatever still waits (documents after the first, late arrivals) gets the notification.
                val app = App.of(this@HandoffActivity)
                // Lab (F17): the states this run recorded go out (on a worker; a failure never holds up a hand-off).
                app.labReporter.flushSoon()
                val left = app.inbox.waiting()
                if (left.isEmpty()) Handoff.cancelNotification(this@HandoffActivity) else Handoff.notifyWaiting(this@HandoffActivity, left)
                // The Reader is importing: what this hand-off wanted and could not take yet is offered again after the gap.
                if (importStarted && left.any { wanted(mode, picked, it, docs) }) {
                    logi("hand-off: ${left.size} still waiting; offered again in ${IMPORT_GAP_MS / 1000} s")
                    Handler(Looper.getMainLooper()).postDelayed({ Handoff.dispatch(app) }, IMPORT_GAP_MS + 1_000)
                }
                finish()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        answerTimeout?.cancel()
        answerTimeout = null
    }

    /**
     * In the background (Home while the card waits for the gap, the Reader in front after a shared link) nothing brings
     * this activity back: it ends, and the coroutine's `finally` announces what still waits. Waiting for SAVE_PAGE's
     * answer is normal (the Reader's activity covers this one), so that gets [ANSWER_GRACE_MS]. With the screen off
     * (the Daylight asleep) it stays: it is still on top when the screen comes back, and goes on from there.
     */
    override fun onStop() {
        super.onStop()
        if (isFinishing || isChangingConfigurations) return
        if (getSystemService(PowerManager::class.java)?.isInteractive == false) {
            logi("hand-off: screen off; going on when it is back")
            return
        }
        if (pending == null) {
            logi("hand-off: sent to the background before it was done; what still waits gets a notification")
            finish()
            return
        }
        answerTimeout?.cancel()
        answerTimeout = lifecycleScope.launch {
            delay(ANSWER_GRACE_MS)
            if (pending != null && !isFinishing) {
                logi("hand-off: no answer from the Reader within ${ANSWER_GRACE_MS / 1000} s while in the background; stopping")
                finish()
            }
        }
    }

    private val openedFromNotification: Boolean get() = intent?.flags?.and(Intent.FLAG_ACTIVITY_NEW_TASK) != 0

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_ALL -> mode = MODE_ALL
            MODE_ONE -> pick(intent)
        }
        if (myClaim != null) claimNow()
    }

    override fun onDestroy() {
        super.onDestroy()
        ended()
        unclaim()
        pending?.cancel()
    }

    /** No hand-off runs any more, unless a newer instance started meanwhile. */
    private fun ended() {
        if (current === run) {
            current = null
            running = false
        }
    }

    private fun pick(i: Intent) {
        val ids = itemsOf(i)
        picked += ids
        if (i.getStringExtra(EXTRA_BY) == BY_CARD) fromCard += ids
    }

    /** Tells [Handoff.notifyWaiting] which items this hand-off is taking, so they are not announced meanwhile. */
    private fun claimNow() {
        val c = Claim(mode, picked.toSet(), docs)
        myClaim = c
        claim = c
    }

    private fun unclaim() {
        if (claim === myClaim) claim = null
        myClaim = null
    }

    /** Returns how many items were handed on. */
    private suspend fun runQueue(): Int {
        val app = App.of(this)
        val repo = app.inbox
        val attempted = HashSet<String>()
        var handed = 0
        while (true) {
            val waiting = repo.waiting().filter { it.id !in attempted && wanted(mode, picked, it, docs) }
            if (waiting.isEmpty()) break
            val link = waiting.firstOrNull { it.kind != Kind.FILE }
            if (link != null) {
                attempted += link.id
                message.value = "Adding “${link.displayTitle.take(60)}” to Daylight Reader…"
                if (handLink(link)) handed++
                if (importStarted) break // shared as a link: the Reader is in front, importing it
                continue
            }
            attempted += waiting.map { it.id }
            var batch = waiting
            // The Reader drops a share that arrives while its previous import is still pending (DEVICE-CHECKS.md, round
            // 2): a document hand-off never starts within IMPORT_GAP_MS of the last import. It waits, and then hands
            // over together everything this hand-off takes by then (taps and arrivals meanwhile included).
            val wait = importWait()
            if (wait > 0) {
                logi("documents: ${waiting.size} waiting; next hand-off in ${(wait + 999) / 1000} s (the Reader drops a share that arrives while its previous import is pending)")
                message.value = if (waiting.size > 1) "Adding ${waiting.size} documents to Daylight Reader in a moment…"
                else "Adding “${waiting[0].displayTitle.take(60)}” to Daylight Reader in a moment…"
                delay(wait)
                batch = repo.waiting().filter { it.kind == Kind.FILE && wanted(mode, picked, it, docs) }
                attempted += batch.map { it.id }
                if (batch.isEmpty()) break
                if (batch.size != waiting.size) logi("documents: handing over ${batch.size} together")
            }
            message.value = when {
                batch.size > 1 -> "Adding ${batch.size} documents to Daylight Reader…"
                docs == DocumentMode.QUIET -> "Adding “${batch[0].displayTitle.take(60)}” to Daylight Reader…"
                else -> "Opening “${batch[0].displayTitle.take(60)}” in Daylight Reader…"
            }
            handed += handFiles(batch, docs)
            break // the Reader is in front now; what remains is offered again after the gap (see onCreate's finally)
        }
        return handed
    }

    private suspend fun handLink(item: InboxItem): Boolean {
        val repo = App.of(this).inbox
        val file = repo.fileOf(item)
        val routes = Routes.forItem(this, item, file)
        for (route in routes) {
            if (!route.path.expectsResult && !importGap(item)) return false
            withResumed { }
            val status = start(route, item) ?: continue
            if (status == "refused" && route.path == Path.SAVE_PAGE) {
                logi("received ${item.id} kind=${item.kind} -> handed to ${route.pkg} via ${route.path.key} status=refused")
                val retry = Routes.sendLink(this, route.pkg, item.id, item.url ?: continue, item.title) ?: continue
                if (!importGap(item)) return false
                withResumed { }
                val s2 = start(retry, item) ?: continue
                done(item, retry, s2)
                return true
            }
            done(item, route, status)
            return true
        }
        repo.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
        logi("received ${item.id} kind=${item.kind} -> kept in inbox (no route resolved) status=no_route")
        App.of(this).labReporter.kept(item)
        return false
    }

    private suspend fun handFiles(items: List<InboxItem>, docs: DocumentMode): Int {
        val repo = App.of(this).inbox
        val withFiles = items.mapNotNull { item ->
            val f = repo.fileOf(item)
            if (f == null) {
                repo.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
                logw("item ${item.id}: content missing")
                App.of(this).labReporter.kept(item)
            }
            f?.let { item to it }
        }
        if (withFiles.isEmpty()) return 0
        withResumed { }
        // Together as SEND_MULTIPLE (several, or "as a batch"); else, or for a Reader without it, the first document
        // alone (the rest at the next hand-off).
        for (route in Routes.forDocuments(this, withFiles, ReaderApps.targetsFor(this, Kind.FILE), docs)) {
            val status = start(route, null) ?: continue
            val carried = withFiles.filter { it.first.id in route.ids }
            logi("documents: ${carried.size} to ${route.pkg} via ${route.path.key} in a fresh task (NEW_TASK|CLEAR_TASK); the next import hand-off waits ${IMPORT_GAP_MS / 1000} s")
            for ((item, _) in carried) done(item, route, status, docs)
            return carried.size
        }
        val item = withFiles[0].first
        repo.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
        logi("received ${item.id} kind=${item.kind} -> kept in inbox (no route resolved) status=no_route")
        App.of(this).labReporter.kept(item)
        return 0
    }

    /**
     * Starts [route]. Returns the Reader's status ("saved", "duplicate", "queued", "refused" for SAVE_PAGE; "sent" for
     * routes without an answer), or null when the intent could not be started.
     */
    private suspend fun start(route: Route, item: InboxItem?): String? {
        message.value = ""
        if (route.path.expectsResult) {
            val d = CompletableDeferred<ActivityResult>()
            pending = d
            try {
                launcher.launch(route.intent)
            } catch (e: ActivityNotFoundException) {
                pending = null
                return null
            } catch (e: SecurityException) {
                pending = null
                logw("hand-off via ${route.path.key} to ${route.pkg} not allowed", e)
                return null
            }
            // Started: it is in the Reader's hands even if we never hear back.
            item?.let { mark(it, route, "started") }
            val r = d.await()
            pending = null
            return r.data?.getStringExtra(ReaderApps.EXTRA_STATUS)?.take(20)
                ?: if (r.resultCode == RESULT_OK) "ok" else "no_answer"
        }
        return try {
            startActivity(route.intent)
            // The Reader's import has it (and is in front): the next import hand-off waits.
            lastImportHandoff = SystemClock.elapsedRealtime()
            importStarted = true
            "sent"
        } catch (e: ActivityNotFoundException) {
            null
        } catch (e: SecurityException) {
            logw("hand-off via ${route.path.key} to ${route.pkg} not allowed", e)
            null
        }
    }

    private fun mark(item: InboxItem, route: Route, status: String) {
        App.of(this).inbox.setItem(item.id) {
            it.copy(state = InboxItem.IN_READER, deliveredTo = route.pkg, via = route.path.key, readerStatus = status, handedAt = System.currentTimeMillis())
        }
    }

    /** Logs `received <id> kind=<k> -> handed to <pkg> via <path> status=<s>`, plus ` docs=<ask|quiet|open>` for documents and how it started (` by=front|auto|tap|card`). */
    private fun done(item: InboxItem, route: Route, status: String, docs: DocumentMode? = null) {
        mark(item, route, status)
        // Lab (F17): the hand-off's final state for its senders (saved -> reader, sent -> handed, …).
        App.of(this).labReporter.handedOff(item, status)
        val by = when {
            item.id in fromCard -> BY_CARD
            mode == MODE_AUTO && item.id !in picked -> "auto"
            mode == MODE_ONE || item.id in picked || openedFromNotification -> "tap"
            else -> "front"
        }
        logi("received ${item.id} kind=${item.kind} -> handed to ${route.pkg} via ${route.path.key} status=$status" + (if (docs != null) " docs=${docs.key}" else "") + " by=$by")
    }

    /** How long to wait before the next import hand-off may start (0 = now). */
    private fun importWait(): Long {
        val last = lastImportHandoff
        if (last == 0L) return 0L
        val since = SystemClock.elapsedRealtime() - last
        return if (since in 0 until IMPORT_GAP_MS) IMPORT_GAP_MS - since else 0L
    }

    /**
     * Before a link goes to the Reader's import (shared as text, or daylightreader://save): waits out [IMPORT_GAP_MS]
     * with the card up. Returns false when [item] was removed from the Inbox meanwhile.
     */
    private suspend fun importGap(item: InboxItem): Boolean {
        val wait = importWait()
        if (wait <= 0) return true
        logi("links: next hand-off in ${(wait + 999) / 1000} s (the Reader drops a share that arrives while its previous import is pending)")
        message.value = "Adding “${item.displayTitle.take(60)}” to Daylight Reader in a moment…"
        delay(wait)
        return App.of(this).inbox.get(item.id) != null
    }

    companion object {
        /**
         * The least time between two hand-offs to the Reader's import (documents, shared links): its import of the
         * previous one must be done. Not measured on a device yet (DEVICE-CHECKS.md has no import times).
         */
        const val IMPORT_GAP_MS = 25_000L

        /** How long a hand-off in the background waits for SAVE_PAGE's answer before it gives up ([onStop]). */
        const val ANSWER_GRACE_MS = 120_000L

        /** When the last import hand-off started ([SystemClock.elapsedRealtime]; 0 = none in this process). */
        @Volatile
        var lastImportHandoff = 0L

        /** The hand-off that runs (an older instance ending late does not clear [running]). */
        @Volatile
        private var current: Any? = null

        const val EXTRA_MODE = "mode"
        /** Everything waiting (foreground, or the notification's tap). */
        const val MODE_ALL = "all"
        /** In the background with "Display over other apps": links always, documents unless "Documents" is "ask". */
        const val MODE_AUTO = "auto"
        /** The items tapped: one notification's ([EXTRA_ITEM]), the summary's or the card's ([EXTRA_ITEMS]). */
        const val MODE_ONE = "one"
        const val EXTRA_ITEM = "item"
        const val EXTRA_ITEMS = "items"
        /** Who asked: [BY_CARD] for the card over the Reader (else a notification). */
        const val EXTRA_BY = "by"
        const val BY_CARD = "card"

        @Volatile
        var running = false

        /** When a hand-off was last asked for (it takes a moment to start). */
        @Volatile
        var requestedAt = 0L

        /** The running hand-off's [Claim], or null. */
        @Volatile
        var claim: Claim? = null

        /** Whether a running hand-off is taking [item] (it is not announced meanwhile). */
        fun claims(item: InboxItem): Boolean {
            val c = claim ?: return false
            return running && wanted(c.mode, c.picked, item, c.docs)
        }

        fun intent(context: Context, mode: String): Intent =
            Intent(context, HandoffActivity::class.java).putExtra(EXTRA_MODE, mode)

        /** The tap on one item's notification. */
        fun forItem(context: Context, id: String): Intent = intent(context, MODE_ONE).putExtra(EXTRA_ITEM, id)

        /** The tap on the summary or the card ([by] = [BY_CARD]): exactly the items it shows. */
        fun forItems(context: Context, ids: List<String>, by: String? = null): Intent =
            intent(context, MODE_ONE).putExtra(EXTRA_ITEMS, ids.toTypedArray()).apply { by?.let { putExtra(EXTRA_BY, it) } }

        /** The item ids an intent asks for ([EXTRA_ITEM] and [EXTRA_ITEMS]). */
        fun itemsOf(intent: Intent): List<String> =
            (listOfNotNull(intent.getStringExtra(EXTRA_ITEM)) + intent.getStringArrayExtra(EXTRA_ITEMS).orEmpty()).distinct()

        /** Whether a hand-off in [mode] takes [item]: everything ([MODE_ALL]), the tapped items, and in [MODE_AUTO] what goes without a tap. */
        fun wanted(mode: String, picked: Set<String>, item: InboxItem, docs: DocumentMode): Boolean = when (mode) {
            MODE_ALL -> true
            MODE_ONE -> item.id in picked
            else -> item.id in picked || Handoff.takesWithoutTap(item, docs)
        }
    }
}
