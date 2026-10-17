package com.daylight.share.inbox

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipDescription
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.logi
import com.daylight.share.ui.MainActivity
import java.io.File
import java.net.URLEncoder

/** The Daylight Reader builds on this device that take our hand-offs. */
object ReaderApps {
    const val MAIN = "com.daylightcomputer.reader"
    const val ACTION_SAVE_PAGE = "com.daylightcomputer.reader.action.SAVE_PAGE"
    const val EXTRA_TITLE = "com.daylightcomputer.reader.extra.TITLE"
    const val EXTRA_HTML_CHARSET = "com.daylightcomputer.reader.extra.HTML_CHARSET"
    const val EXTRA_STATUS = "status"

    fun isReader(pkg: String?): Boolean = pkg != null && (pkg == MAIN || pkg.startsWith("$MAIN."))

    /** Reader packages that resolve at least one hand-off (the main app first), whatever "Deliver to" says. */
    fun installed(context: Context): List<String> {
        val pm = context.packageManager
        val probes = listOf(
            Intent(ACTION_SAVE_PAGE),
            Intent(Intent.ACTION_SEND).setType("text/plain"),
            Intent(Intent.ACTION_SEND).setType("application/pdf"),
            Intent(Intent.ACTION_VIEW, Uri.parse("daylightreader://save?url=https%3A%2F%2Fexample.com%2F")),
        )
        val pkgs = LinkedHashSet<String>()
        for (p in probes) {
            runCatching { pm.queryIntentActivities(p, 0) }.getOrNull()?.forEach { ri ->
                val pkg = ri.activityInfo?.packageName
                if (isReader(pkg)) pkgs += pkg!!
            }
        }
        return pkgs.sortedWith(compareBy<String>({ it != MAIN }, { it }))
    }

    /** The packages to try, in order: the "Deliver to" choice when it is installed, else every installed Reader. */
    fun targets(context: Context): List<String> {
        val all = installed(context)
        val chosen = App.of(context).prefs.deliverTo
        return if (chosen.isNotEmpty() && chosen in all) listOf(chosen) else all
    }

    fun label(context: Context, pkg: String?): String {
        if (pkg == null) return ""
        return try {
            val ai = context.packageManager.getApplicationInfo(pkg, 0)
            val l = context.packageManager.getApplicationLabel(ai).toString()
            if (pkg == MAIN) l else "$l ($pkg)"
        } catch (e: PackageManager.NameNotFoundException) {
            pkg
        }
    }
}

/** How an item reaches a Reader (logged and shown as "via ..."). */
enum class Path(val key: String, val expectsResult: Boolean) {
    SAVE_PAGE("save_page", true),
    SEND_LINK("send_link", false),
    VIEW_LINK("view_link", false),
    SEND_FILE("send_file", false),
    SEND_FILE_GENERIC("send_file_octet", false),
    VIEW_FILE("view_file", false),
    SEND_MULTIPLE("send_multiple", false),
}

class Route(val pkg: String, val path: Path, val intent: Intent)

/** Builds the hand-off intents (PROTOCOL 3.4) and picks the ones that resolve. */
object Routes {
    private const val AUTHORITY_SUFFIX = ".files"

    fun uriFor(context: Context, file: File): Uri = FileProvider.getUriForFile(context, context.packageName + AUTHORITY_SUFFIX, file)

    /** [uriFor], or null (logged) when the file cannot be shared: the item then stays in the Inbox. */
    private fun uriOrNull(context: Context, file: File): Uri? = try {
        uriFor(context, file)
    } catch (e: IllegalArgumentException) {
        com.daylight.share.logw("cannot share ${file.name}: ${e.message}")
        null
    }

    private fun resolves(context: Context, intent: Intent): Boolean =
        runCatching { context.packageManager.queryIntentActivities(intent, 0).isNotEmpty() }.getOrDefault(false)

    /** Every route for [item] that resolves, in the order to try them. */
    fun forItem(context: Context, item: InboxItem, file: File?, pkgs: List<String> = ReaderApps.targets(context)): List<Route> {
        val out = ArrayList<Route>()
        if (item.kind == Kind.URL || item.kind == Kind.PAGE) {
            val url = item.url ?: return out
            for (pkg in pkgs) savePage(context, pkg, item, file)?.let { out += it }
            for (pkg in pkgs) sendLink(context, pkg, url, item.title)?.let { out += it }
            for (pkg in pkgs) viewLink(context, pkg, url)?.let { out += it }
        } else if (file != null) {
            val uri = uriOrNull(context, file) ?: return out
            val mime = item.mime?.takeIf { it.contains('/') } ?: "application/octet-stream"
            for (pkg in pkgs) {
                sendFile(pkg, uri, mime, item, Path.SEND_FILE).takeIf { resolves(context, it) }?.let { out += Route(pkg, Path.SEND_FILE, it) }
            }
            if (mime != "application/octet-stream") for (pkg in pkgs) {
                sendFile(pkg, uri, "application/octet-stream", item, Path.SEND_FILE_GENERIC).takeIf { resolves(context, it) }
                    ?.let { out += Route(pkg, Path.SEND_FILE_GENERIC, it) }
            }
            for (pkg in pkgs) {
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).setPackage(pkg).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (resolves(context, view)) out += Route(pkg, Path.VIEW_FILE, view)
            }
        }
        return out
    }

    fun savePage(context: Context, pkg: String, item: InboxItem, file: File?): Route? {
        val url = item.url ?: return null
        val i = Intent(ReaderApps.ACTION_SAVE_PAGE).setPackage(pkg).putExtra(Intent.EXTRA_TEXT, url)
        item.title?.let { i.putExtra(ReaderApps.EXTRA_TITLE, it) }
        val uri = if (item.kind == Kind.PAGE && file != null && file.length() <= Limits.MAX_PAGE_HTML) uriOrNull(context, file) else null
        if (uri != null) {
            i.clipData = ClipData(ClipDescription(item.title ?: "page", arrayOf("text/html")), ClipData.Item(uri))
            i.putExtra(ReaderApps.EXTRA_HTML_CHARSET, "utf-8")
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return if (resolves(context, i)) Route(pkg, Path.SAVE_PAGE, i) else null
    }

    fun sendLink(context: Context, pkg: String, url: String, title: String?): Route? {
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(pkg).putExtra(Intent.EXTRA_TEXT, url)
        title?.let { i.putExtra(Intent.EXTRA_SUBJECT, it) }
        return if (resolves(context, i)) Route(pkg, Path.SEND_LINK, i) else null
    }

    private fun viewLink(context: Context, pkg: String, url: String): Route? {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("daylightreader://save?url=" + URLEncoder.encode(url, "UTF-8"))).setPackage(pkg)
        return if (resolves(context, i)) Route(pkg, Path.VIEW_LINK, i) else null
    }

    private fun sendFile(pkg: String, uri: Uri, mime: String, item: InboxItem, path: Path): Intent {
        val i = Intent(Intent.ACTION_SEND).setType(mime).setPackage(pkg).putExtra(Intent.EXTRA_STREAM, uri)
        i.clipData = ClipData(ClipDescription(item.name ?: "document", arrayOf(mime)), ClipData.Item(uri))
        item.title?.let { i.putExtra(Intent.EXTRA_TITLE, it).putExtra(Intent.EXTRA_SUBJECT, it) }
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return i
    }

    /** Several documents at once to one Reader (it adds them to the library instead of opening each). */
    fun sendMultiple(context: Context, pkg: String, items: List<Pair<InboxItem, File>>): Route? {
        if (items.size < 2) return null
        val uris = ArrayList(items.map { uriOrNull(context, it.second) ?: return null })
        val mimes = items.map { it.first.mime?.takeIf { m -> m.contains('/') } ?: "application/octet-stream" }
        val type = when {
            mimes.distinct().size == 1 -> mimes[0]
            mimes.map { it.substringBefore('/') }.distinct().size == 1 -> mimes[0].substringBefore('/') + "/*"
            else -> "*/*"
        }
        val clip = ClipData(ClipDescription("documents", mimes.distinct().toTypedArray()), ClipData.Item(uris[0]))
        for (u in uris.drop(1)) clip.addItem(ClipData.Item(u))
        val i = Intent(Intent.ACTION_SEND_MULTIPLE).setType(type).setPackage(pkg)
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        i.clipData = clip
        return if (resolves(context, i)) Route(pkg, Path.SEND_MULTIPLE, i) else null
    }

    /** "Open with…": any app, through the system chooser. */
    fun openWith(context: Context, item: InboxItem, file: File?): Intent? {
        val view = when {
            file != null -> Intent(Intent.ACTION_VIEW).setDataAndType(uriOrNull(context, file) ?: return null, item.mime ?: "application/octet-stream")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            item.url != null -> Intent(Intent.ACTION_VIEW, Uri.parse(item.url))
            else -> return null
        }
        return Intent.createChooser(view, "Open with")
    }
}

/**
 * When items arrive, decides how they reach the Reader (Android blocks background activity starts):
 * - our app is in front: hand off now;
 * - "Display over other apps" is granted: hand off now (links always; documents when "Open documents as they
 *   arrive" is on, because the Reader opens each document it imports);
 * - else: a notification whose tap does the hand-off.
 * Without a Reader, items stay in the Inbox ("Open with…").
 */
object Handoff {
    private const val NOTIFICATION_ID = 7

    fun canHandOffInBackground(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** Decides what happens to waiting items; runs on the main thread (workers and the live connection call it too). */
    fun dispatch(context: Context) {
        if (Looper.myLooper() == Looper.getMainLooper()) dispatchNow(context)
        else Handler(Looper.getMainLooper()).post { dispatchNow(context) }
    }

    private fun dispatchNow(context: Context) {
        val app = App.of(context)
        if (app.prefs.role != com.daylight.share.Role.INBOX) return
        val waiting = app.inbox.waiting()
        if (waiting.isEmpty()) {
            cancelNotification(context)
            return
        }
        if (ReaderApps.targets(context).isEmpty()) {
            for (item in waiting) {
                app.inbox.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
                logi("received ${item.id} kind=${item.kind} -> kept in inbox (no reader installed) status=no_reader")
            }
            cancelNotification(context)
            return
        }
        // One hand-off at a time: it picks up whatever arrives while it runs.
        if (HandoffActivity.running || System.currentTimeMillis() - HandoffActivity.requestedAt < 5_000) return
        val front: Activity? = app.front
        when {
            app.inForeground && front != null -> {
                HandoffActivity.requestedAt = System.currentTimeMillis()
                front.startActivity(HandoffActivity.intent(context, HandoffActivity.MODE_ALL))
            }
            canHandOffInBackground(context) -> {
                val auto = waiting.filter { it.kind != Kind.FILE || app.prefs.autoDocuments }
                if (auto.isNotEmpty()) {
                    HandoffActivity.requestedAt = System.currentTimeMillis()
                    try {
                        context.startActivity(HandoffActivity.intent(context, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: Exception) {
                        logi("background hand-off refused by the system: ${e.message}")
                        notifyWaiting(context, waiting)
                        return
                    }
                }
                val rest = waiting - auto.toSet()
                if (rest.isNotEmpty()) notifyWaiting(context, rest) else cancelNotification(context)
            }
            else -> notifyWaiting(context, waiting)
        }
    }

    /** "2 new from iPhone — tap to add to Reader". */
    fun notifyWaiting(context: Context, items: List<InboxItem>) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val senders = items.mapNotNull { it.from?.takeIf { f -> f.isNotBlank() } }.distinct()
        val title = when {
            items.size == 1 -> "New from ${senders.firstOrNull() ?: "your phone"}"
            senders.size == 1 -> "${items.size} new from ${senders[0]}"
            else -> "${items.size} new items"
        }
        val text = if (items.size == 1) items[0].displayTitle else items.take(3).joinToString(" · ") { it.displayTitle }
        val tap = PendingIntent.getActivity(
            context, 1, HandoffActivity.intent(context, HandoffActivity.MODE_ALL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, App.CH_ARRIVALS)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("$title — tap to add to Reader")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(items.take(6).joinToString("\n") { it.displayTitle }))
            .setNumber(items.size)
            .setContentIntent(tap)
            .addAction(0, "Open Inbox", open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, n) }
    }

    fun cancelNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }
}
