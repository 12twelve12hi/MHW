package com.daylight.share.inbox

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.daylight.share.App
import com.daylight.share.Prefs
import com.daylight.share.R
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.lab.LabText
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

    /**
     * An app that answers SAVE_PAGE ([savePage]) or the document SEND intents ([documents]): a "Deliver to" choice.
     * [links]: it takes links and pages ([takesLinks]); what it does not take goes to Automatic.
     */
    data class Candidate(val pkg: String, val label: String, val savePage: Boolean, val documents: Boolean, val links: Boolean = savePage)

    private fun packagesFor(context: Context, intent: Intent): Set<String> =
        runCatching { context.packageManager.queryIntentActivities(intent, 0) }.getOrNull()
            ?.mapNotNull { it.activityInfo?.packageName }?.toSet() ?: emptySet()

    private fun takes(context: Context, pkg: String, probes: List<Intent>): Boolean =
        pkg != context.packageName && probes.any { packagesFor(context, Intent(it).setPackage(pkg)).isNotEmpty() }

    private fun savePageProbe() = Intent(ACTION_SAVE_PAGE)

    private fun saveLinkProbe() = Intent(Intent.ACTION_VIEW, Uri.parse("daylightreader://save?url=https%3A%2F%2Fexample.com%2F"))

    private fun documentProbes(): List<Intent> = DOCUMENT_TYPES.flatMap { t ->
        listOf(Intent(Intent.ACTION_SEND).setType(t), Intent(Intent.ACTION_SEND_MULTIPLE).setType(t))
    }

    /** Every installed app (but this one) that answers SAVE_PAGE or the document SEND intents: the main Reader first, then Reader builds, then the rest by name. */
    fun candidates(context: Context): List<Candidate> {
        val save = packagesFor(context, savePageProbe())
        val docs = documentProbes().flatMapTo(LinkedHashSet()) { packagesFor(context, it) }
        return (save + docs).filter { it != context.packageName }.distinct()
            .map { Candidate(it, appLabel(context, it), it in save, it in docs, links = it in save || takesLinks(context, it)) }
            .sortedWith(compareBy<Candidate>({ it.pkg != MAIN }, { !isReader(it.pkg) }, { it.label.lowercase() }, { it.pkg }))
    }

    /** Whether [pkg] answers SAVE_PAGE or a document SEND intent (it is installed and can be a "Deliver to" target). */
    fun answers(context: Context, pkg: String): Boolean = takes(context, pkg, listOf(savePageProbe()) + documentProbes())

    /** Whether [pkg] takes links and pages: SAVE_PAGE or daylightreader://save, or, for a Reader build, a shared link. */
    fun takesLinks(context: Context, pkg: String): Boolean =
        takes(context, pkg, listOf(savePageProbe(), saveLinkProbe()) + if (isReader(pkg)) listOf(Intent(Intent.ACTION_SEND).setType("text/plain")) else emptyList())

    /** Whether [pkg] answers SAVE_PAGE (its Reader then confirms links and pages: the Inbox's `reader-link` cap, F17). */
    fun takesSavePage(context: Context, pkg: String): Boolean = takes(context, pkg, listOf(savePageProbe()))

    /** Whether [pkg] takes shared documents (a PDF or an EPUB, as ACTION_SEND or ACTION_SEND_MULTIPLE). */
    fun takesDocuments(context: Context, pkg: String): Boolean = takes(context, pkg, documentProbes())

    /** Reader packages that resolve at least one hand-off (the main app first): the "Automatic" targets. */
    fun installed(context: Context): List<String> {
        val probes = listOf(
            savePageProbe(),
            Intent(Intent.ACTION_SEND).setType("text/plain"),
            Intent(Intent.ACTION_SEND).setType("application/pdf"),
            saveLinkProbe(),
        )
        val pkgs = LinkedHashSet<String>()
        for (p in probes) pkgs += packagesFor(context, p).filter(::isReader)
        return pkgs.sortedWith(compareBy<String>({ it != MAIN }, { it }))
    }

    /** The packages to try, in order: the "Deliver to" choice while it is installed, else every installed Reader. */
    fun targets(context: Context, chosen: String = App.of(context).prefs.deliverTo): List<String> =
        if (chosen.isNotEmpty() && answers(context, chosen)) listOf(chosen) else installed(context)

    /**
     * The packages to try for an item of [kind] ([Kind.FILE] for documents, else links and pages): the "Deliver to"
     * choice when it takes that kind, else Automatic. So a side-by-side copy chosen for its SAVE_PAGE does not strand
     * documents it cannot take: they still go to the Daylight Reader.
     */
    fun targetsFor(context: Context, kind: String, chosen: String = App.of(context).prefs.deliverTo): List<String> {
        val ok = chosen.isNotEmpty() && if (kind == Kind.FILE) takesDocuments(context, chosen) else takesLinks(context, chosen)
        return if (ok) listOf(chosen) else installed(context)
    }

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
 * The Daylight Reader's ImportActivity treats ACTION_SEND and ACTION_SEND_MULTIPLE alike and decides by how many
 * documents arrive together (ImportViewModel): one is followed into the reader and opened (`total == 1`); two or more go
 * to the library ("N added") through ReaderLauncher.libraryIntent, whose CLEAR_TOP brings the Library forward in the
 * Reader's main task and so closes the document being read. So [QUIET] (ACTION_SEND_MULTIPLE even for one document) is
 * for a Reader that adds a batch without opening anything; with today's Reader it is not quiet, and its label says
 * "as a batch", not "quietly".
 */
enum class DocumentMode(val key: String, val label: String) {
    /** A card over the Reader (with "Display over other apps") and a notification per document; a tap hands it over (the Reader imports and opens it). */
    ASK("ask", "Ask with a notification"),
    /** Handed over without a tap as ACTION_SEND_MULTIPLE, even one document (path send_multiple). */
    QUIET("quiet", "Add to the library as a batch"),
    /** Handed over without a tap as ACTION_SEND (path send_file): the Reader imports and opens it. */
    OPEN("open", "Open as they arrive");

    /** Whether documents go to the Reader without a tap while another app is in front. */
    val automatic: Boolean get() = this != ASK

    companion object {
        /**
         * Until the Reader keeps a lone ACTION_SEND_MULTIPLE document in the library (and stops closing the open document
         * for a batch), [QUIET] would still pull the reader out of what they are reading, so a document waits for a tap
         * unless the user picks otherwise.
         */
        val DEFAULT = ASK

        fun parse(key: String?): DocumentMode? = entries.firstOrNull { it.key == key?.trim()?.lowercase() }
    }
}

/** Builds the hand-off intents (PROTOCOL 3.4) and picks the ones that resolve. */
object Routes {
    private const val AUTHORITY_SUFFIX = ".files"

    /**
     * Every hand-off the Reader does not answer (documents, and links shared as text or as daylightreader://save)
     * starts the Reader's import in a fresh task. The Reader's ImportActivity (singleTask, which also takes a shared
     * text/plain link) collects navigation only while resumed: a share that arrives while an earlier import's "open the
     * document" event is still pending comes through onNewIntent, the stale event reopens the earlier document and
     * finishes the activity, and the new share is dropped (DEVICE-CHECKS.md, round 2). CLEAR_TASK gives every import a
     * new ImportActivity, so nothing stale is left; [HandoffActivity] also spaces these hand-offs out
     * ([HandoffActivity.IMPORT_GAP_MS]). SAVE_PAGE (answered, another activity) needs neither.
     */
    const val IMPORT_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK

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
    fun forItem(context: Context, item: InboxItem, file: File?, pkgs: List<String> = ReaderApps.targetsFor(context, item.kind)): List<Route> {
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
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).setPackage(pkg).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or IMPORT_FLAGS)
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
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(pkg).putExtra(Intent.EXTRA_TEXT, url).addFlags(IMPORT_FLAGS)
        title?.let { i.putExtra(Intent.EXTRA_SUBJECT, it) }
        return if (resolves(context, i)) Route(pkg, Path.SEND_LINK, i, listOf(id)) else null
    }

    private fun viewLink(context: Context, pkg: String, id: String, url: String): Route? {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("daylightreader://save?url=" + URLEncoder.encode(url, "UTF-8"))).setPackage(pkg).addFlags(IMPORT_FLAGS)
        return if (resolves(context, i)) Route(pkg, Path.VIEW_LINK, i, listOf(id)) else null
    }

    private fun sendFile(pkg: String, uri: Uri, mime: String, item: InboxItem): Intent {
        val i = Intent(Intent.ACTION_SEND).setType(mime).setPackage(pkg).putExtra(Intent.EXTRA_STREAM, uri)
        i.clipData = ClipData(ClipDescription(item.name ?: "document", arrayOf(mime)), ClipData.Item(uri))
        item.title?.let { i.putExtra(Intent.EXTRA_TITLE, it).putExtra(Intent.EXTRA_SUBJECT, it) }
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or IMPORT_FLAGS)
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
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or IMPORT_FLAGS)
        i.clipData = clip
        return if (resolves(context, i)) Route(pkg, Path.SEND_MULTIPLE, i, items.map { it.first.id }) else null
    }

    /** "Open with…": any app, through the system chooser (a document in a fresh task, in case the Reader is picked). */
    fun openWith(context: Context, item: InboxItem, file: File?): Intent? {
        val view = when {
            file != null -> Intent(Intent.ACTION_VIEW).setDataAndType(uriOrNull(context, file) ?: return null, item.mime ?: "application/octet-stream")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or IMPORT_FLAGS)
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
 * - else, and for documents that wait: announced right away, by a notification per item whose tap does the hand-off and,
 *   with "Display over other apps", a card over the Reader ([WaitingCard]) that stays until answered.
 * Without an app that takes them, items stay in the Inbox ("Open with…").
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

    /** The decision, without side effects ([dispatch] carries it out). [hasTarget]: some app takes that item. */
    fun plan(waiting: List<InboxItem>, hasTarget: (InboxItem) -> Boolean, inFront: Boolean, background: Boolean, docs: DocumentMode): Plan {
        val go = waiting.filter(hasTarget)
        val keep = waiting.filterNot(hasTarget)
        return when {
            go.isEmpty() -> Plan(null, emptyList(), keep)
            inFront -> Plan(HandoffActivity.MODE_ALL, emptyList(), keep)
            background -> {
                val auto = go.filter { takesWithoutTap(it, docs) }.mapTo(HashSet()) { it.id }
                Plan(if (auto.isEmpty()) null else HandoffActivity.MODE_AUTO, go.filterNot { it.id in auto }, keep)
            }
            else -> Plan(null, go, keep)
        }
    }

    fun plan(waiting: List<InboxItem>, hasTarget: Boolean, inFront: Boolean, background: Boolean, docs: DocumentMode): Plan =
        plan(waiting, { hasTarget }, inFront, background, docs)

    fun canHandOffInBackground(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** Decides what happens to waiting items; runs on the main thread (workers and the live connection call it too). */
    fun dispatch(context: Context) {
        if (Looper.myLooper() == Looper.getMainLooper()) dispatchNow(context)
        else Handler(Looper.getMainLooper()).post { dispatchNow(context) }
    }

    private fun dispatchNow(context: Context) {
        val app = App.of(context)
        if (app.prefs.role != com.daylight.share.Role.INBOX) return
        val all = app.inbox.waiting()
        // Lab (F15): an item kept for later waits for Add to Reader: nothing hands it over by itself, and its notice
        // (if it still has one) stays as it is.
        val lab = app.prefs.lab
        val kept = all.filter { InboxLab.keptForLater(it, lab) }
        val waiting = if (kept.isEmpty()) all else all.filterNot { InboxLab.keptForLater(it, lab) }
        val front = app.front
        val docs = app.prefs.documentMode
        // "Deliver to" may take only links or only documents; the rest goes to Automatic (ReaderApps.targetsFor).
        val forLinks by lazy { ReaderApps.targetsFor(context, Kind.URL).isNotEmpty() }
        val forDocs by lazy { ReaderApps.targetsFor(context, Kind.FILE).isNotEmpty() }
        val plan = plan(waiting, { if (it.kind == Kind.FILE) forDocs else forLinks }, app.inForeground && front != null, canHandOffInBackground(context), docs)
        for (item in plan.keep) {
            app.inbox.setItem(item.id) { it.copy(state = InboxItem.OPEN) }
            logi("received ${item.id} kind=${item.kind} -> kept in inbox (no reader installed) status=no_reader")
            app.labReporter.kept(item)
        }
        val start = plan.start
        if (start == null) {
            notifyWaiting(context, plan.notify + kept, docs)
            return
        }
        // One hand-off at a time: it picks up whatever arrives while it runs. Documents that wait are announced now.
        if (HandoffActivity.running || System.currentTimeMillis() - HandoffActivity.requestedAt < 5_000) {
            if (start == HandoffActivity.MODE_AUTO) notifyWaiting(context, plan.notify + kept, docs)
            return
        }
        HandoffActivity.requestedAt = System.currentTimeMillis()
        try {
            if (start == HandoffActivity.MODE_ALL && front != null) front.startActivity(HandoffActivity.intent(context, HandoffActivity.MODE_ALL))
            else context.startActivity(HandoffActivity.intent(context, HandoffActivity.MODE_AUTO).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            HandoffActivity.requestedAt = 0L
            logi("background hand-off refused by the system: ${e.message}")
            notifyWaiting(context, app.inbox.waiting(), docs)
            return
        }
        notifyWaiting(context, plan.notify + kept, docs)
    }

    // ---------------------------------------------------------------------------------------------- notifications

    /** Per-item notifications are tagged with the item's id under this number; the group summary has its own. */
    const val ITEM_NOTIFICATION = 9
    const val SUMMARY_NOTIFICATION = 10
    /** The single notification of earlier builds ("2 new from iPhone"), removed when this build posts. */
    private const val LEGACY_NOTIFICATION = 7
    /** The summary's extra listing the items it covers, so it is posted again only when they change. */
    private const val EXTRA_SUMMARY_IDS = "com.daylight.share.SUMMARY_IDS"
    /** Sent to [NoticeDismissedReceiver] when the user swipes an item's notification away. */
    const val ACTION_DISMISSED = "com.daylight.share.action.NOTICE_DISMISSED"

    /** Makes each item's PendingIntents distinct whatever their request codes (two ids with the same hash stay apart). */
    fun itemUri(id: String): Uri = Uri.parse("daylightshare-item:$id")

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

    /** The items the summary that is up now lists, or null. */
    private fun summaryIds(nm: NotificationManager): String? =
        runCatching { nm.activeNotifications }.getOrNull()
            ?.firstOrNull { it.id == SUMMARY_NOTIFICATION && it.tag == null }?.notification?.extras?.getString(EXTRA_SUMMARY_IDS)

    /**
     * Announces the items in [items] that wait for a tap, and takes down the announcements of items no longer waiting.
     *
     * Each item is announced once: a notification ("New PDF from iPhone: <title>", "Tap to add to the Reader"), grouped
     * under a summary when there are several, and, with "Display over other apps", the card over the Reader. Only an
     * item never announced before alerts (the newest of them, and only when the card is not up to show it instead). A
     * notification the user swiped away does not come back ([Prefs.NOTICE_DISMISSED]); one that is up is not posted
     * again; items a running hand-off is taking ([HandoffActivity.claims]) are left alone.
     */
    fun notifyWaiting(context: Context, items: List<InboxItem>, docs: DocumentMode? = (context.applicationContext as? App)?.prefs?.documentMode) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val app = context.applicationContext as? App
        val prefs = app?.prefs
        if (app != null) app.prefs.keepNoticeIds(items.mapTo(HashSet()) { it.id } + app.inbox.waiting().map { it.id })
        val dismissed = prefs?.noticeIds(Prefs.NOTICE_DISMISSED).orEmpty()
        val announced = prefs?.noticeIds(Prefs.NOTICE_ANNOUNCED).orEmpty()
        val later = prefs?.noticeIds(Prefs.NOTICE_LATER).orEmpty()
        val due = items.filter { it.id !in dismissed && !HandoffActivity.claims(it) }.sortedBy { it.received }
        val dueIds = due.mapTo(HashSet()) { it.id }
        val shown = shownIds(nm)
        for (id in shown - dueIds) nm.cancel(id, ITEM_NOTIFICATION)
        nm.cancel(LEGACY_NOTIFICATION)
        val fresh = due.filter { it.id !in announced }
        prefs?.addNoticeIds(Prefs.NOTICE_ANNOUNCED, fresh.map { it.id })
        // Lab (F17): an item announced for the first time waits for a tap; its senders see "Waiting for a tap".
        app?.labReporter?.announced(fresh)
        // Lab (F15): these had a notice, so no "Saved to the Reader" follows when they are handed over.
        if (app != null) ArrivalNotices.noted(app, fresh.map { it.id })
        val lab = prefs?.lab == true

        // The card stays over the Reader until answered: an e-paper reader can miss a pop-up that shows for a few seconds.
        val card = WaitingCard.update(context, due.filter { it.id !in later }, pop = fresh.isNotEmpty())
        val allowed = notificationsAllowed(context)
        val on = listOfNotNull(if (card) "card" else null, if (allowed) "notification" else null).joinToString(" + ").ifEmpty { "notifications off" }
        for (item in fresh) {
            logi("received ${item.id} kind=${item.kind} -> waiting for a tap ($on)" + (if (item.kind == Kind.FILE && docs != null) " docs=${docs.key}" else ""))
        }
        if (due.isEmpty() || !allowed) {
            nm.cancel(SUMMARY_NOTIFICATION)
            if (due.isNotEmpty() && !card) logw("notifications are off: ${due.size} item(s) wait until the Inbox is opened")
            return
        }

        // Lab (F15): during "Quiet hours" nothing alerts.
        val hush = lab && app != null && InboxLab.quietHoursNow(app)
        val plan = Notices.plan(due, seen = announced, quiet = card || hush, lab = lab)
        val compat = NotificationManagerCompat.from(context)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        for (n in plan.items) {
            if (n.id in shown) continue // up already, and its words do not change
            val item = due.first { it.id == n.id }
            val tap = PendingIntent.getActivity(
                context, n.id.hashCode(), HandoffActivity.forItem(context, n.id).setData(itemUri(n.id)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags,
            )
            val swiped = PendingIntent.getBroadcast(
                context, n.id.hashCode(), Intent(context, NoticeDismissedReceiver::class.java).setAction(ACTION_DISMISSED).setData(itemUri(n.id)), flags,
            )
            // Lab (F15): Keep for later, next to Add to Reader (the tap), on the notice itself.
            val keep = if (!lab) null else PendingIntent.getBroadcast(
                context, n.id.hashCode(), Intent(context, ArrivalActionReceiver::class.java).setAction(ArrivalActionReceiver.ACTION_KEEP).setData(itemUri(n.id)), flags,
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
                // The alerting item pops up on its own; the others (and the summary) stay quiet.
                .setGroupAlertBehavior(if (n.alert) NotificationCompat.GROUP_ALERT_CHILDREN else NotificationCompat.GROUP_ALERT_SUMMARY)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .setDeleteIntent(swiped)
            // Lab (F15): the notice's two actions, Add to Reader and Keep for later; v1.1: Open Inbox.
            if (keep != null) {
                b.addAction(0, LabText["arrivals.addToReader"], tap)
                b.addAction(0, LabText["arrivals.keepForLater"], keep)
            } else {
                b.addAction(0, "Open Inbox", open)
            }
            if (!n.alert) b.setSilent(true)
            runCatching { compat.notify(n.id, ITEM_NOTIFICATION, b.build()) }.onFailure { logw("notification not shown", it) }
        }
        val s = plan.summary
        if (s == null) {
            nm.cancel(SUMMARY_NOTIFICATION)
            return
        }
        val ids = due.joinToString(",") { it.id }
        if (summaryIds(nm) == ids) return
        val all = PendingIntent.getActivity(context, 1, HandoffActivity.forItems(context, due.map { it.id }).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        val style = NotificationCompat.InboxStyle().setBigContentTitle(s.title)
        s.lines.take(6).forEach { style.addLine(it) }
        val summary = NotificationCompat.Builder(context, App.CH_ITEMS)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(s.title)
            .setContentText(s.text)
            .setStyle(style)
            .setNumber(due.size)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(Notices.GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(all)
            .addAction(0, "Open Inbox", open)
            .addExtras(Bundle().apply { putString(EXTRA_SUMMARY_IDS, ids) })
            .build()
        runCatching { compat.notify(SUMMARY_NOTIFICATION, summary) }.onFailure { logw("notification not shown", it) }
    }

    /** Removes every waiting-item notification and the card. */
    fun cancelNotification(context: Context) = notifyWaiting(context, emptyList(), null)

    /** The user swiped [id]'s notification away: it is not announced again (it waits in the Inbox); the summary and the card follow. */
    fun onDismissed(context: Context, id: String) {
        val app = context.applicationContext as? App ?: return
        app.prefs.addNoticeIds(Prefs.NOTICE_DISMISSED, listOf(id))
        logi("received $id -> notification dismissed: waits in the Inbox")
        // Lab (F15): kept for later on purpose, marked so (it waits for Add to Reader), and its senders see "Kept for
        // later on your Daylight" (F17).
        if (app.prefs.lab) app.inbox.markHeld(listOf(id))
        app.labReporter.held(listOf(id))
        app.inbox.get(id)?.let { com.daylight.share.sender.ActivityLog.add(app, "held", id, it.kind, "swiped") }
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val up = shownIds(nm) + WaitingCard.ids
        notifyWaiting(context, app.inbox.waiting().filter { it.id in up })
    }

    /**
     * Lab (F15): **Keep for later** on [id]'s notice: the notice goes and is not posted again, the card does not show it
     * again, and the item waits in the Inbox, marked "Kept for later", until Add to Reader (nothing hands it over by
     * itself); its senders see "Kept for later on your Daylight" (`held`).
     */
    fun keepForLater(context: Context, id: String) {
        val app = context.applicationContext as? App ?: return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm?.cancel(id, ITEM_NOTIFICATION)
        app.prefs.addNoticeIds(Prefs.NOTICE_DISMISSED, listOf(id))
        app.prefs.addNoticeIds(Prefs.NOTICE_LATER, listOf(id))
        if (app.prefs.lab) app.inbox.markHeld(listOf(id))
        app.labReporter.held(listOf(id))
        logi("received $id -> kept for later: waits in the Inbox")
        app.inbox.get(id)?.let { com.daylight.share.sender.ActivityLog.add(app, "held", id, it.kind, "notice") }
        if (nm == null) return
        val up = shownIds(nm) + WaitingCard.ids
        notifyWaiting(context, app.inbox.waiting().filter { it.id in up })
    }
}

/** Swiping an item's notification away ([Handoff.ACTION_DISMISSED]): see [Handoff.onDismissed]. */
class NoticeDismissedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Handoff.ACTION_DISMISSED) return
        val id = intent.data?.schemeSpecificPart?.takeIf { it.isNotEmpty() } ?: return
        Handoff.onDismissed(context, id)
    }
}

/** The words of the waiting-item notifications and of the card (pure, so tests can read them). */
object Notices {
    const val GROUP = "com.daylight.share.WAITING"
    const val TAP = "Tap to add to the Reader"

    /** [title] is the collapsed line ("New PDF from iPhone: <title>"); [heading] the expanded one, above the full title. */
    data class Item(val id: String, val title: String, val heading: String, val text: String, val alert: Boolean)
    data class Summary(val title: String, val text: String, val lines: List<String>)
    data class Plan(val items: List<Item>, val summary: Summary?)
    /**
     * The card over the Reader: [heading] ("New PDF from iPhone"), [body] (the title, or a line per item), [add] (its
     * button) and [later] (the other one: "Later", or with Lab on "Keep for later", F15).
     */
    data class Card(val heading: String, val body: String, val add: String, val later: String = LATER)

    /** The card's v1.1 "Later". */
    const val LATER = "Later"

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

    /**
     * "New PDF from iPhone". With [lab] (F15; LAB_TEXT's `arrivals.excerptOne`, Oct 22), one waiting excerpt reads
     * "New excerpt from iPhone", not "New HTML document from iPhone".
     */
    fun heading(item: InboxItem, lab: Boolean = false): String =
        if (lab && InboxLab.isExcerpt(item)) LabText.fill(LabText["arrivals.excerptOne"], mapOf("from" to sender(item)))
        else "New ${kind(item)} from ${sender(item)}"

    fun title(item: InboxItem, lab: Boolean = false): String = "${heading(item, lab)}: ${item.displayTitle}"

    private fun several(sorted: List<InboxItem>, lab: Boolean = false): String {
        val senders = sorted.map(::sender).distinct()
        // Lab (F15): waiting excerpts from one sender share one notice, "3 excerpts from iPhone".
        if (lab && senders.size == 1 && sorted.all(InboxLab::isExcerpt)) {
            return LabText.fill(LabText["arrivals.excerptsGroup"], mapOf("n" to sorted.size, "from" to senders[0]))
        }
        return if (senders.size == 1) "${sorted.size} new from ${senders[0]}" else "${sorted.size} new items"
    }

    /**
     * One notice per item, oldest first, and a summary when there are several. Only the newest item not in [seen] (never
     * announced before) alerts, and none when [quiet] (the card shows them instead, or Quiet hours). With [lab], the
     * summary of excerpts from one sender reads "3 excerpts from iPhone", and one excerpt "New excerpt from iPhone" (F15).
     */
    fun plan(items: List<InboxItem>, seen: Set<String>, quiet: Boolean = false, lab: Boolean = false): Plan {
        val sorted = items.sortedBy { it.received }
        val newest = if (quiet) null else sorted.lastOrNull { it.id !in seen }?.id
        val notices = sorted.map { Item(it.id, title(it, lab), heading(it, lab), TAP, alert = it.id == newest) }
        if (sorted.size < 2) return Plan(notices, null)
        return Plan(notices, Summary(several(sorted, lab), "Tap to add them to the Reader", sorted.map { "${kind(it)}: ${it.displayTitle}" }))
    }

    /**
     * The card for [items]: one item by its kind, sender and title; several as "3 new from iPhone" and a line each (up
     * to three). With [lab] (F15): its other button is "Keep for later", and excerpts from one sender are "3 excerpts
     * from iPhone".
     */
    fun card(items: List<InboxItem>, lab: Boolean = false): Card {
        val sorted = items.sortedBy { it.received }
        val later = if (lab) LabText["arrivals.keepForLater"] else LATER
        if (sorted.size == 1) return Card(heading(sorted[0], lab), sorted[0].displayTitle, "Add to Reader", later)
        val lines = sorted.take(3).map { "${kind(it)}: ${it.displayTitle}" } + if (sorted.size > 3) listOf("and ${sorted.size - 3} more") else emptyList()
        return Card(several(sorted, lab), lines.joinToString("\n"), "Add all to Reader", later)
    }
}
