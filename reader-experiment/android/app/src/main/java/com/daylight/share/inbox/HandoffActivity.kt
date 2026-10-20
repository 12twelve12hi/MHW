package com.daylight.share.inbox

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
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
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

/**
 * Hands waiting Inbox items to the Daylight Reader, one at a time (PROTOCOL 3.4 step 4). It is an activity because
 * Android lets apps start activities only from the foreground (or with "Display over other apps"), and because
 * SAVE_PAGE answers with a `status` (saved | duplicate | queued | refused) only to startActivityForResult callers.
 *
 * Links and pages go first, each waiting for the Reader's answer; a refused SAVE_PAGE (read-later from the browser
 * switched off in the Reader) is retried as a shared link. Documents go last, together, because the Reader opens
 * what it imports; "Documents" ([DocumentMode]) decides whether they go as ACTION_SEND or ACTION_SEND_MULTIPLE.
 */
class HandoffActivity : ComponentActivity() {
    private var mode = MODE_ALL
    /** Items a notification's tap asked for ([MODE_ONE], or added to a hand-off already running). */
    private val picked = LinkedHashSet<String>()
    private var pending: CompletableDeferred<ActivityResult>? = null
    private val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        pending?.complete(r)
    }
    private val message = mutableStateOf("Adding to Daylight Reader…")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        running = true
        requestedAt = 0L
        mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_ALL
        intent?.getStringExtra(EXTRA_ITEM)?.let { picked += it }
        // Our card shows only until the Reader's own card is up (two stacked cards look messy on e-paper).
        setContent { DaylightTheme { if (message.value.isNotEmpty()) StatusCard(message.value) } }
        lifecycleScope.launch {
            try {
                val handed = runQueue()
                if (handed == 0 && mode != MODE_AUTO && savedInstanceState == null && openedFromNotification) {
                    // A tap with nothing to hand over (already in the Reader, or removed): show the Inbox instead of flashing.
                    startActivity(Intent(this@HandoffActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            } catch (e: Exception) {
                logw("hand-off stopped", e)
            } finally {
                running = false
                // Whatever still waits (documents after the first, late arrivals) gets the notification.
                val left = App.of(this@HandoffActivity).inbox.waiting()
                if (left.isEmpty()) Handoff.cancelNotification(this@HandoffActivity) else Handoff.notifyWaiting(this@HandoffActivity, left)
                finish()
            }
        }
    }

    private val openedFromNotification: Boolean get() = intent?.flags?.and(Intent.FLAG_ACTIVITY_NEW_TASK) != 0

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_ALL -> mode = MODE_ALL
            MODE_ONE -> intent.getStringExtra(EXTRA_ITEM)?.let { picked += it }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        running = false
        pending?.cancel()
    }

    /** Returns how many items were handed on. */
    private suspend fun runQueue(): Int {
        val app = App.of(this)
        val repo = app.inbox
        val attempted = HashSet<String>()
        var handed = 0
        val docs = app.prefs.documentMode
        while (true) {
            val waiting = repo.waiting().filter { it.id !in attempted && wanted(mode, picked, it, docs) }
            if (waiting.isEmpty()) break
            val link = waiting.firstOrNull { it.kind != Kind.FILE }
            if (link != null) {
                attempted += link.id
                message.value = "Adding “${link.displayTitle.take(60)}” to Daylight Reader…"
                if (handLink(link)) handed++
                continue
            }
            attempted += waiting.map { it.id }
            message.value = when {
                waiting.size > 1 -> "Adding ${waiting.size} documents to Daylight Reader…"
                docs == DocumentMode.QUIET -> "Adding “${waiting[0].displayTitle.take(60)}” to Daylight Reader…"
                else -> "Opening “${waiting[0].displayTitle.take(60)}” in Daylight Reader…"
            }
            handed += handFiles(waiting, docs)
            break // the Reader is in front now; documents that remain wait for the next hand-off
        }
        return handed
    }

    private suspend fun handLink(item: InboxItem): Boolean {
        val repo = App.of(this).inbox
        val file = repo.fileOf(item)
        val routes = Routes.forItem(this, item, file)
        for (route in routes) {
            withResumed { }
            val status = start(route, item) ?: continue
            if (status == "refused" && route.path == Path.SAVE_PAGE) {
                logi("received ${item.id} kind=${item.kind} -> handed to ${route.pkg} via ${route.path.key} status=refused")
                val retry = Routes.sendLink(this, route.pkg, item.id, item.url ?: continue, item.title) ?: continue
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
        return false
    }

    private suspend fun handFiles(items: List<InboxItem>, docs: DocumentMode): Int {
        val repo = App.of(this).inbox
        val withFiles = items.mapNotNull { item ->
            val f = repo.fileOf(item)
            if (f == null) {
                repo.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
                logw("item ${item.id}: content missing")
            }
            f?.let { item to it }
        }
        if (withFiles.isEmpty()) return 0
        withResumed { }
        // Together as SEND_MULTIPLE (several, or "Add quietly"); else, or for a Reader without it, the first document
        // alone (the rest at the next hand-off).
        for (route in Routes.forDocuments(this, withFiles, ReaderApps.targets(this), docs)) {
            val status = start(route, null) ?: continue
            val carried = withFiles.filter { it.first.id in route.ids }
            for ((item, _) in carried) done(item, route, status, docs)
            return carried.size
        }
        val item = withFiles[0].first
        repo.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
        logi("received ${item.id} kind=${item.kind} -> kept in inbox (no route resolved) status=no_route")
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

    /** Logs `received <id> kind=<k> -> handed to <pkg> via <path> status=<s>`, plus ` docs=<ask|quiet|open>` for documents and how it started (` by=front|auto|tap`). */
    private fun done(item: InboxItem, route: Route, status: String, docs: DocumentMode? = null) {
        mark(item, route, status)
        val by = when {
            mode == MODE_AUTO && item.id !in picked -> "auto"
            mode == MODE_ONE || item.id in picked || openedFromNotification -> "tap"
            else -> "front"
        }
        logi("received ${item.id} kind=${item.kind} -> handed to ${route.pkg} via ${route.path.key} status=$status" + (if (docs != null) " docs=${docs.key}" else "") + " by=$by")
    }

    companion object {
        const val EXTRA_MODE = "mode"
        /** Everything waiting (foreground, or the notification's tap). */
        const val MODE_ALL = "all"
        /** In the background with "Display over other apps": links always, documents unless "Documents" is "ask". */
        const val MODE_AUTO = "auto"
        /** One item, from the tap on its notification ([EXTRA_ITEM]). */
        const val MODE_ONE = "one"
        const val EXTRA_ITEM = "item"

        @Volatile
        var running = false

        /** When a hand-off was last asked for (it takes a moment to start). */
        @Volatile
        var requestedAt = 0L

        fun intent(context: Context, mode: String): Intent =
            Intent(context, HandoffActivity::class.java).putExtra(EXTRA_MODE, mode)

        /** The tap on one item's notification. */
        fun forItem(context: Context, id: String): Intent = intent(context, MODE_ONE).putExtra(EXTRA_ITEM, id)

        /** Whether a hand-off in [mode] takes [item]: everything ([MODE_ALL]), the tapped items, and in [MODE_AUTO] what goes without a tap. */
        fun wanted(mode: String, picked: Set<String>, item: InboxItem, docs: DocumentMode): Boolean = when (mode) {
            MODE_ALL -> true
            MODE_ONE -> item.id in picked
            else -> item.id in picked || Handoff.takesWithoutTap(item, docs)
        }
    }
}
