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
 * what it imports.
 */
class HandoffActivity : ComponentActivity() {
    private var mode = MODE_ALL
    private var pending: CompletableDeferred<ActivityResult>? = null
    private val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        pending?.complete(r)
    }
    private val message = mutableStateOf("Adding to Daylight Reader…")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        running = true
        mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_ALL
        setContent { DaylightTheme { StatusCard(message.value) } }
        lifecycleScope.launch {
            try {
                val handed = runQueue()
                if (handed == 0 && mode == MODE_ALL && savedInstanceState == null && App.of(this@HandoffActivity).inbox.waiting().isEmpty() && openedFromNotification) {
                    // Nothing left to do (already handed off): show the Inbox instead of flashing.
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
        if (intent.getStringExtra(EXTRA_MODE) == MODE_ALL) mode = MODE_ALL
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
        while (true) {
            val waiting = repo.waiting().filter { it.id !in attempted && (mode == MODE_ALL || it.kind != Kind.FILE || app.prefs.autoDocuments) }
            if (waiting.isEmpty()) break
            val link = waiting.firstOrNull { it.kind != Kind.FILE }
            if (link != null) {
                attempted += link.id
                message.value = "Adding “${link.displayTitle.take(60)}” to Daylight Reader…"
                if (handLink(link)) handed++
                continue
            }
            attempted += waiting.map { it.id }
            message.value = if (waiting.size == 1) "Opening “${waiting[0].displayTitle.take(60)}” in Daylight Reader…" else "Adding ${waiting.size} documents to Daylight Reader…"
            handed += handFiles(waiting)
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
                val retry = Routes.sendLink(this, route.pkg, item.url ?: continue, item.title) ?: continue
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

    private suspend fun handFiles(items: List<InboxItem>): Int {
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
        if (withFiles.size >= 2) {
            for (pkg in ReaderApps.targets(this)) {
                val route = Routes.sendMultiple(this, pkg, withFiles) ?: continue
                val status = start(route, null) ?: continue
                for ((item, _) in withFiles) done(item, route, status)
                return withFiles.size
            }
        }
        // One document (or a Reader without SEND_MULTIPLE): the first now, the rest at the next hand-off.
        val (item, file) = withFiles[0]
        for (route in Routes.forItem(this, item, file)) {
            val status = start(route, item) ?: continue
            done(item, route, status)
            return 1
        }
        repo.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
        logi("received ${item.id} kind=${item.kind} -> kept in inbox (no route resolved) status=no_route")
        return 0
    }

    /**
     * Starts [route]. Returns the Reader's status ("saved", "duplicate", "queued", "refused" for SAVE_PAGE; "sent" for
     * routes without an answer), or null when the intent could not be started.
     */
    private suspend fun start(route: Route, item: InboxItem?): String? {
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

    private fun done(item: InboxItem, route: Route, status: String) {
        mark(item, route, status)
        logi("received ${item.id} kind=${item.kind} -> handed to ${route.pkg} via ${route.path.key} status=$status")
    }

    companion object {
        const val EXTRA_MODE = "mode"
        /** Everything waiting (foreground, or the notification's tap). */
        const val MODE_ALL = "all"
        /** In the background with "Display over other apps": links always, documents only when the user said so. */
        const val MODE_AUTO = "auto"

        @Volatile
        var running = false

        fun intent(context: Context, mode: String): Intent =
            Intent(context, HandoffActivity::class.java).putExtra(EXTRA_MODE, mode)
    }
}
