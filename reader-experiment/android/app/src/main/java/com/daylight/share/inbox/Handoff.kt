package com.daylight.share.inbox

import android.Manifest
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
import com.daylight.share.logw
import com.daylight.share.ui.MainActivity
import java.io.File
import java.net.URLEncoder

/**
 * The apps on this device that take our hand-offs. "Automatic" means the Daylight Reader builds
 * (com.daylightcomputer.reader, the main app first, and its suffixed copies); "Deliver to" can pick any other app that
 * answers SAVE_PAGE or the document SEND intents, such as the lab tablet's side-by-side copy [EXPERIMENT].
 */
object ReaderApps {
    const val MAIN = "com.daylightcomputer.reader"
    /** The lab tablet's side-by-side Reader copy (it answers SAVE_PAGE): offered in "Deliver to", never picked on its own. */
    const val EXPERIMENT = "com.daylightcomputer.readerexperiment"
    const val ACTION_SAVE_PAGE = "com.daylightcomputer.reader.action.SAVE_PAGE"
    const val EXTRA_TITLE = "com.daylightcomputer.reader.extra.TITLE"
    const val EXTRA_HTML_CHARSET = "com.daylightcomputer.reader.extra.HTML_CHARSET"
    const val EXTRA_STATUS = "status"

    /** The document types probed for "Deliver to" (what the Inbox hands over most). */
    private val DOCUMENT_TYPES = listOf("application/pdf", "application/epub+zip")

    fun isReader(pkg: String?): Boolean = pkg != null && (pkg == MAIN || pkg.startsWith("$MAIN."))

    /** An app that answers SAVE_PAGE ([savePage]) or the document SEND intents ([documents]): a "Deliver to" choice. */
    data class Candidate(val pkg: String, val label: String, val savePage: Boolean, val documents: Boolean)

    private fun packagesFor(context: Context, intent: Intent): Set<String> =
        runCatching { context.packageManager.queryIntentActivities(intent, 0) }.getOrNull()
            ?.mapNotNull { it.activityInfo?.packageName }?.toSet() ?: emptySet()

    private fun savePageProbe() = Intent(ACTION_SAVE_PAGE)

    private fun documentProbes(): List<Intent> = DOCUMENT_TYPES.flatMap { t ->
        listOf(Intent(Intent.ACTION_SEND).setType(t), Intent(Intent.ACTION_SEND_MULTIPLE).setType(t))
    }

    /** Every installed app (but this one) that answers SAVE_PAGE or the document SEND intents: the main Reader first, then Reader builds, then the rest by name. */
    fun candidates(context: Context): List<Candidate> {
        val save = packagesFor(context, savePageProbe())
        val docs = documentProbes().flatMapTo(LinkedHashSet()) { packagesFor(context, it) }
        return (save + docs).filter { it != context.packageName }.distinct()
            .map { Candidate(it, appLabel(context, it), it in save, it in docs) }
            .sortedWith(compareBy<Candidate>({ it.pkg != MAIN }, { !isReader(it.pkg) }, { it.label.lowercase() }, { it.pkg }))
    }

    /** Whether [pkg] answers SAVE_PAGE or a document SEND intent (it is installed and can be a "Deliver to" target). */
    fun answers(context: Context, pkg: String): Boolean =
        pkg != context.packageName && (listOf(savePageProbe()) + documentProbes()).any { packagesFor(context, Intent(it).setPackage(pkg)).isNotEmpty() }

    /** Reader packages that resolve at least one hand-off (the main app first): the "Automatic" targets. */
    fun installed(context: Context): List<String> {
        val probes = listOf(
            savePageProbe(),
            Intent(Intent.ACTION_SEND).setType("text/plain"),
            Intent(Intent.ACTION_SEND).setType("application/pdf"),
            Intent(Intent.ACTION_VIEW, Uri.parse("daylightreader://save?url=https%3A%2F%2Fexample.com%2F")),
        )
        val pkgs = LinkedHashSet<String>()
        for (p in probes) pkgs += packagesFor(context, p).filter(::isReader)
        return pkgs.sortedWith(compareBy<String>({ it != MAIN }, { it }))
    }

    /** The packages to try, in order: the "Deliver to" choice while it is installed, else every installed Reader. */
    fun targets(context: Context, chosen: String = App.of(context).prefs.deliverTo): List<String> =
        if (chosen.isNotEmpty() && answers(context, chosen)) listOf(chosen) else installed(context)

    private fun appLabel(context: Context, pkg: String): String = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString().ifBlank { pkg }
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }

    /** The app's name, with its package when it is not the main Reader ("Daylight Reader (com.daylightcomputer.readerexperiment)"). */
    fun label(context: Context, pkg: String?): String {
        if (pkg == null) return ""
        val l = appLabel(context, pkg)
        return if (pkg == MAIN || l == pkg) l else "$l ($pkg)"
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

/** One way to hand items over: [ids] are the Inbox items it carries (several for [Path.SEND_MULTIPLE]). */
class Route(val pkg: String, val path: Path, val intent: Intent, val ids: List<String> = emptyList())

/**
 * What happens to a document that arrives while the Inbox is in the background ("Documents" on the Inbox screen).
 *
 * The Daylight Reader's ImportActivity opens a document it imports alone, whatever the action (its ImportViewModel
 * follows the conversion to the reader when the batch has one source, `total == 1`); only two or more sources at once
 * go to the library ("N added"). So [QUIET] hands documents over as ACTION_SEND_MULTIPLE, which a Reader can treat as
 * "add to the library", but the Reader on the Daylight today still opens a document that arrives on its own.
 */
enum class DocumentMode(val key: String, val label: String) {
    /** A notification per document; its tap hands the document over (the Reader imports and opens it). */
    ASK("ask", "Ask with a notification"),
    /** Handed over without a tap as ACTION_SEND_MULTIPLE, even one document (path send_multiple). */
    QUIET("quiet", "Add quietly to the library"),
    /** Handed over without a tap as ACTION_SEND (path send_file): the Reader imports and opens it. */
    OPEN("open", "Open as they arrive");

    /** Whether documents go to the Reader without a tap while another app is in front. */
    val automatic: Boolean get() = this != ASK

    companion object {
        /**
         * Until the Reader keeps a lone ACTION_SEND_MULTIPLE document in the library, "quiet" would still open it over
         * what is being read, so a document waits for a tap on its notification unless the user picks otherwise.
         */
        val DEFAULT = ASK

        fun parse(key: String?): DocumentMode? = entries.firstOrNull { it.key == key?.trim()?.lowercase() }
    }
}

/** Builds the hand-off intents (PROTOCOL 3.4) and picks the ones that resolve. */
object Routes {
    private const val AUTHORITY_SUFFIX = ".files"

    fun uriFor(context: Context, file: File): Uri = FileProvider.getUriForFile(context, context.packageName + AUTHORITY_SUFFIX, file)

    /** [uriFor], or null (logged) when the file cannot be shared: the item then stays in the Inbox. */
    private fun uriOrNull(context: Context, file: File): Uri? = try {
        uriFor(context, file)
    } catch (e: IllegalArgumentException) {
        logw("cannot share ${file.name}: ${e.message}")
        null
    }

    private fun resolves(context: Context, intent: Intent): Boolean =
        runCatching { context.packageManager.queryIntentActivities(intent, 0).isNotEmpty() }.getOrDefault(false)

    private fun mimeOf(item: InboxItem): String = item.mime?.takeIf { it.contains('/') } ?: "application/octet-stream"

    /** Every route for [item] that resolves, in the order to try them. */
    fun forItem(context: Context, item: InboxItem, file: File?, pkgs: List<String> = ReaderApps.targets(context)): List<Route> {
        val out = ArrayList<Route>()
        val ids = listOf(item.id)
        if (item.kind == Kind.URL || item.kind == Kind.PAGE) {
            val url = item.url ?: return out
            for (pkg in pkgs) savePage(context, pkg, item, file)?.let { out += it }
            for (pkg in pkgs) sendLink(context, pkg, item.id, url, item.title)?.let { out += it }
            for (pkg in pkgs) viewLink(context, pkg, item.id, url)?.let { out += it }
        } else if (file != null) {
            val uri = uriOrNull(context, file) ?: return out
            val mime = mimeOf(item)
            for (pkg in pkgs) {
                sendFile(pkg, uri, mime, item).takeIf { resolves(context, it) }?.let { out += Route(pkg, Path.SEND_FILE, it, ids) }
            }
            if (mime != "application/octet-stream") for (pkg in pkgs) {
                sendFile(pkg, uri, "application/octet-stream", item).takeIf { resolves(context, it) }
                    ?.let { out += Route(pkg, Path.SEND_FILE_GENERIC, it, ids) }
            }
            for (pkg in pkgs) {
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).setPackage(pkg).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (resolves(context, view)) out += Route(pkg, Path.VIEW_FILE, view, ids)
            }
        }
        return out
    }

    /**
     * The routes for waiting documents, in the order to try them. Several documents, or any number with
     * [DocumentMode.QUIET], go together as ACTION_SEND_MULTIPLE first; then the first document alone (SEND, VIEW), the
     * rest waiting for the next hand-off.
     */
    fun forDocuments(context: Context, docs: List<Pair<InboxItem, File>>, pkgs: List<String>, mode: DocumentMode): List<Route> {
        if (docs.isEmpty()) return emptyList()
        val out = ArrayList<Route>()
        if (mode == DocumentMode.QUIET || docs.size >= 2) for (pkg in pkgs) sendMultiple(context, pkg, docs)?.let { out += it }
        val (first, file) = docs[0]
        out += forItem(context, first, file, pkgs)
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
        return if (resolves(context, i)) Route(pkg, Path.SAVE_PAGE, i, listOf(item.id)) else null
    }

    fun sendLink(context: Context, pkg: String, id: String, url: String, title: String?): Route? {
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(pkg).putExtra(Intent.EXTRA_TEXT, url)
        title?.let { i.putExtra(Intent.EXTRA_SUBJECT, it) }
        return if (resolves(context, i)) Route(pkg, Path.SEND_LINK, i, listOf(id)) else null
    }

    private fun viewLink(context: Context, pkg: String, id: String, url: String): Route? {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("daylightreader://save?url=" + URLEncoder.encode(url, "UTF-8"))).setPackage(pkg)
        return if (resolves(context, i)) Route(pkg, Path.VIEW_LINK, i, listOf(id)) else null
    }

    private fun sendFile(pkg: String, uri: Uri, mime: String, item: InboxItem): Intent {
        val i = Intent(Intent.ACTION_SEND).setType(mime).setPackage(pkg).putExtra(Intent.EXTRA_STREAM, uri)
        i.clipData = ClipData(ClipDescription(item.name ?: "document", arrayOf(mime)), ClipData.Item(uri))
        item.title?.let { i.putExtra(Intent.EXTRA_TITLE, it).putExtra(Intent.EXTRA_SUBJECT, it) }
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return i
    }

    /** Documents (one or more) to one Reader as ACTION_SEND_MULTIPLE (a Reader adds a batch to its library instead of opening each). */
    fun sendMultiple(context: Context, pkg: String, items: List<Pair<InboxItem, File>>): Route? {
        if (items.isEmpty()) return null
        val uris = ArrayList(items.map { uriOrNull(context, it.second) ?: return null })
        val mimes = items.map { mimeOf(it.first) }
        val type = when {
            mimes.distinct().size == 1 -> mimes[0]
            mimes.map { it.substringBefore('/') }.distinct().size == 1 -> mimes[0].substringBefore('/') + "/*"
            else -> "*/*"
        }
        val clip = ClipData(ClipDescription(if (items.size == 1) items[0].first.name ?: "document" else "documents", mimes.distinct().toTypedArray()), ClipData.Item(uris[0]))
        for (u in uris.drop(1)) clip.addItem(ClipData.Item(u))
        val i = Intent(Intent.ACTION_SEND_MULTIPLE).setType(type).setPackage(pkg)
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        i.clipData = clip
        return if (resolves(context, i)) Route(pkg, Path.SEND_MULTIPLE, i, items.map { it.first.id }) else null
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
 * - "Display over other apps" is granted: hand off now links and pages always, documents unless "Documents" is
 *   [DocumentMode.ASK];
 * - else, and for documents that wait: a notification per item, right away, whose tap does the hand-off.
 * Without a Reader, items stay in the Inbox ("Open with…").
 */
object Handoff {
    /** What to do with the waiting items now. */
    data class Plan(
        /** Start [HandoffActivity] in this mode ([HandoffActivity.MODE_ALL] or [HandoffActivity.MODE_AUTO]), or nothing. */
        val start: String?,
        /** Items that wait for a tap on their notification. */
        val notify: List<InboxItem>,
        /** Items no app takes: they stay in the Inbox. */
        val keep: List<InboxItem> = emptyList(),
    )

    /** Links and pages always go without a tap (with "Display over other apps"); documents unless the user wants to be asked. */
    fun takesWithoutTap(item: InboxItem, docs: DocumentMode): Boolean = item.kind != Kind.FILE || docs.automatic

    /** The decision, without side effects ([dispatch] carries it out). */
    fun plan(waiting: List<InboxItem>, hasTarget: Boolean, inFront: Boolean, background: Boolean, docs: DocumentMode): Plan = when {
        waiting.isEmpty() -> Plan(null, emptyList())
        !hasTarget -> Plan(null, emptyList(), keep = waiting)
        inFront -> Plan(HandoffActivity.MODE_ALL, emptyList())
        background -> {
            val auto = waiting.filter { takesWithoutTap(it, docs) }
            val autoIds = auto.map { it.id }.toSet()
            Plan(if (auto.isEmpty()) null else HandoffActivity.MODE_AUTO, waiting.filterNot { it.id in autoIds })
        }
        else -> Plan(null, waiting)
    }

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
        val front = app.front
        val docs = app.prefs.documentMode
        val plan = plan(waiting, ReaderApps.targets(context).isNotEmpty(), app.inForeground && front != null, canHandOffInBackground(context), docs)
        for (item in plan.keep) {
            app.inbox.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
            logi("received ${item.id} kind=${item.kind} -> kept in inbox (no reader installed) status=no_reader")
        }
        val start = plan.start
        if (start == null) {
            notifyWaiting(context, plan.notify, docs)
            return
        }
        // One hand-off at a time: it picks up whatever arrives while it runs. Documents that wait are announced now.
        if (HandoffActivity.running || System.currentTimeMillis() - HandoffActivity.requestedAt < 5_000) {
            if (start == HandoffActivity.MODE_AUTO) notifyWaiting(context, plan.notify, docs)
            return
        }
        HandoffActivity.requestedAt = System.currentTimeMillis()
        try {
            if (start == HandoffActivity.MODE_ALL && front != null) front.startActivity(HandoffActivity.intent(context, HandoffActivity.MODE_ALL))
            else context.startActivity(HandoffActivity.intent(context, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            HandoffActivity.requestedAt = 0L
            logi("background hand-off refused by the system: ${e.message}")
            notifyWaiting(context, waiting, docs)
            return
        }
        notifyWaiting(context, plan.notify, docs)
    }

    // ---------------------------------------------------------------------------------------------- notifications

    /** Per-item notifications are tagged with the item's id under this number; the group summary has its own. */
    const val ITEM_NOTIFICATION = 9
    const val SUMMARY_NOTIFICATION = 10
    /** The single notification of earlier builds ("2 new from iPhone"), removed when this build posts. */
    private const val LEGACY_NOTIFICATION = 7

    fun notificationsAllowed(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** The importance of the "New items" channel (the user can lower it), or null before it exists. */
    fun itemsChannelImportance(context: Context): Int? =
        runCatching { context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(App.CH_ITEMS)?.importance }.getOrNull()

    /** The item ids that have a notification up now. */
    private fun shownIds(nm: NotificationManager): Set<String> {
        val active = runCatching { nm.activeNotifications }.getOrNull() ?: return emptySet()
        val out = HashSet<String>()
        for (sbn in active) {
            val tag: String? = sbn.tag
            if (sbn.id == ITEM_NOTIFICATION && tag != null) out += tag
        }
        return out
    }

    /**
     * Shows one notification per item in [items] ("New PDF from iPhone: <title>", "Tap to add to the Reader"), grouped
     * under a summary when there are several, and removes those of items no longer waiting. Only the newest item that
     * was not shown before alerts (pops up over the Reader); its tap hands that item over, the summary's tap all of them.
     */
    fun notifyWaiting(context: Context, items: List<InboxItem>, docs: DocumentMode? = (context.applicationContext as? App)?.prefs?.documentMode) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val shown = shownIds(nm)
        val ids = items.mapTo(HashSet()) { it.id }
        for (id in shown - ids) nm.cancel(id, ITEM_NOTIFICATION)
        nm.cancel(LEGACY_NOTIFICATION)
        if (items.isEmpty()) {
            nm.cancel(SUMMARY_NOTIFICATION)
            return
        }
        val plan = Notices.plan(items, shown)
        for (n in plan.items) if (n.id !in shown) {
            val item = items.first { it.id == n.id }
            logi("received ${item.id} kind=${item.kind} -> waiting for a tap (notification)" + (if (item.kind == Kind.FILE && docs != null) " docs=${docs.key}" else ""))
        }
        if (!notificationsAllowed(context)) {
            logw("notifications are off: ${items.size} item(s) wait until the Inbox is opened")
            return
        }
        val compat = NotificationManagerCompat.from(context)
        val open = PendingIntent.getActivity(
            context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        for (n in plan.items) {
            val item = items.first { it.id == n.id }
            val tap = PendingIntent.getActivity(
                context, n.id.hashCode(), HandoffActivity.forItem(context, n.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val b = NotificationCompat.Builder(context, App.CH_ITEMS)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(n.title)
                .setContentText(n.text)
                .setStyle(NotificationCompat.BigTextStyle().setBigContentTitle(n.heading).bigText("${item.displayTitle}\n${n.text}"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setWhen(if (item.received > 0) item.received else System.currentTimeMillis())
                .setShowWhen(true)
                .setGroup(Notices.GROUP)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .addAction(0, "Open Inbox", open)
            if (!n.alert) b.setSilent(true)
            runCatching { compat.notify(n.id, ITEM_NOTIFICATION, b.build()) }.onFailure { logw("notification not shown", it) }
        }
        val s = plan.summary
        if (s == null) {
            nm.cancel(SUMMARY_NOTIFICATION)
            return
        }
        val all = PendingIntent.getActivity(
            context, 1, HandoffActivity.intent(context, HandoffActivity.MODE_ALL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val style = NotificationCompat.InboxStyle().setBigContentTitle(s.title)
        s.lines.take(6).forEach { style.addLine(it) }
        val summary = NotificationCompat.Builder(context, App.CH_ITEMS)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(s.title)
            .setContentText(s.text)
            .setStyle(style)
            .setNumber(items.size)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(Notices.GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(all)
            .addAction(0, "Open Inbox", open)
            .build()
        runCatching { compat.notify(SUMMARY_NOTIFICATION, summary) }.onFailure { logw("notification not shown", it) }
    }

    /** Removes every waiting-item notification. */
    fun cancelNotification(context: Context) = notifyWaiting(context, emptyList(), null)
}

/** The words of the waiting-item notifications (pure, so tests can read them). */
object Notices {
    const val GROUP = "com.daylight.share.WAITING"
    const val TAP = "Tap to add to the Reader"

    /** [title] is the collapsed line ("New PDF from iPhone: <title>"); [heading] the expanded one, above the full title. */
    data class Item(val id: String, val title: String, val heading: String, val text: String, val alert: Boolean)
    data class Summary(val title: String, val text: String, val lines: List<String>)
    data class Plan(val items: List<Item>, val summary: Summary?)

    /** "PDF", "EPUB", "Word document", …, "link", "web page". */
    fun kind(item: InboxItem): String {
        if (item.kind == Kind.URL) return "link"
        if (item.kind == Kind.PAGE) return "web page"
        val mime = item.mime?.lowercase()?.substringBefore(';')?.trim().orEmpty()
        val ext = item.name?.substringAfterLast('.', "")?.lowercase().orEmpty()
        return when {
            mime == "application/pdf" || ext == "pdf" -> "PDF"
            mime == "application/epub+zip" || ext == "epub" -> "EPUB"
            "wordprocessingml" in mime || mime == "application/msword" || ext == "docx" || ext == "doc" -> "Word document"
            "presentationml" in mime || ext == "pptx" -> "presentation"
            mime == "text/markdown" || mime == "text/x-markdown" || ext == "md" || ext == "markdown" -> "Markdown document"
            mime == "text/html" || ext == "html" || ext == "htm" -> "HTML document"
            mime == "text/plain" || ext == "txt" -> "text"
            else -> "document"
        }
    }

    fun sender(item: InboxItem): String = item.from?.trim()?.takeIf { it.isNotEmpty() } ?: "your phone"

    fun heading(item: InboxItem): String = "New ${kind(item)} from ${sender(item)}"

    fun title(item: InboxItem): String = "${heading(item)}: ${item.displayTitle}"

    /** One notice per item, oldest first; only the newest item not in [shown] alerts. A summary when there are several. */
    fun plan(items: List<InboxItem>, shown: Set<String>): Plan {
        val sorted = items.sortedBy { it.received }
        val newest = sorted.lastOrNull { it.id !in shown }?.id
        val notices = sorted.map { Item(it.id, title(it), heading(it), TAP, alert = it.id == newest) }
        if (sorted.size < 2) return Plan(notices, null)
        val senders = sorted.map(::sender).distinct()
        val title = if (senders.size == 1) "${sorted.size} new from ${senders[0]}" else "${sorted.size} new items"
        return Plan(notices, Summary(title, "Tap to add them to the Reader", sorted.map { "${kind(it)}: ${it.displayTitle}" }))
    }
}
