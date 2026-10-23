package com.daylight.share.sender

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.annotation.VisibleForTesting
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.Work
import com.daylight.share.core.Body
import com.daylight.share.core.BytesBody
import com.daylight.share.core.FileBody
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.Http
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Pairing
import com.daylight.share.core.Relay
import com.daylight.share.core.RelayClient
import com.daylight.share.core.ShareException
import com.daylight.share.core.Text
import com.daylight.share.core.UrlConnectionHttp
import com.daylight.share.core.lab.Excerpt
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabLedger
import com.daylight.share.core.lab.Normalise
import com.daylight.share.core.lab.SetupCheck
import com.daylight.share.Role
import com.daylight.share.logi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.Locale
import java.util.UUID

/** What the user shares from a phone, before it is in the outbox. */
sealed interface Shared {
    data class Link(val url: String, val title: String?) : Shared
    data class Text(val text: String, val subject: String?) : Shared
    data class Stream(val uri: Uri, val mime: String?) : Shared
}

/**
 * What the share card's Options chose, and what the card prepared (Lab, LAB-PLAN F04 and F11). The defaults are a
 * share as it came.
 */
data class ShareOptions(
    /** An edited title; null keeps the one the share brings. */
    val title: String? = null,
    /** "Send as excerpt" (F11; 6.5 Q1 = b: text becomes an excerpt only when the user chose it). */
    val asExcerpt: Boolean = false,
    /** A shared stream the card already copied into private storage while its countdown ran. */
    val copied: SenderRepo.Copy? = null,
    /** The app the text came from, for a note's "— shared from {app} on {date}". */
    val sourceApp: String? = null,
)

/** The sender's data: the pairing with a Daylight and the [Outbox] (PROTOCOL 3.3) with its history. */
class SenderRepo(private val app: App) {
    private val root = File(app.filesDir, "outbox")
    private val incoming = File(app.filesDir, "outbox-incoming")

    private val _pairing = MutableStateFlow(app.prefs.senderPairing())
    val pairingFlow: StateFlow<Pairing?> get() = _pairing

    private val _rows = MutableStateFlow<List<OutboxRow>>(emptyList())
    val rows: StateFlow<List<OutboxRow>> get() = _rows

    private var outbox: Outbox? = null
    private var outboxKey: String? = null
    private var ledger: LabLedger? = null

    private val _lab = MutableStateFlow<LabLedger.Snapshot?>(null)

    /**
     * What the Daylight said about Lab and this phone's items (the ledger's snapshot, LAB-PROTOCOL 2.2.6), for the
     * delivery timeline (F01); null while unpaired or not read yet.
     */
    val labSnapshot: StateFlow<LabLedger.Snapshot?> get() = _lab

    init {
        // F08: the Direct Share shortcut goes when Lab goes off, and in the Inbox role (it comes back with the next send).
        app.scope.launch { app.labOn.collect { on -> if (!on) Shortcuts.remove(app) } }
        app.scope.launch { app.role.collect { r -> if (r == Role.INBOX) Shortcuts.remove(app) } }
        // Copies a share left behind when the process died while it was being prepared.
        app.scope.launch(Dispatchers.IO) { sweepIncoming() }
    }

    /**
     * Deletes the copies in `outbox-incoming` that no share is still preparing: those older than [INCOMING_MAX_AGE_MS]
     * (a share stores or deletes its copy within seconds; one the process died with stays until this runs, at start).
     * -> how many went.
     */
    @VisibleForTesting
    internal fun sweepIncoming(now: Long = System.currentTimeMillis()): Int {
        val old = incoming.listFiles()?.filter { it.isFile && now - it.lastModified() > INCOMING_MAX_AGE_MS }.orEmpty()
        var n = 0
        for (f in old) if (f.delete()) n++
        if (n > 0) logi("sender: $n copies left from shares that never finished were deleted")
        return n
    }

    /** The HTTP of the outbox's relay client (tests plug in a fake relay); null: the app's own. */
    @VisibleForTesting
    internal var http: Http? = null
        set(v) {
            field = v
            synchronized(this) { outbox = null }
        }

    fun pairing(): Pairing? = _pairing.value

    /**
     * Uses [p] from now on (PROTOCOL 3.3 step 6; CHANGES-v1.1 2.4 "pairing change"): the same secret (a new relay or
     * name) keeps the outbox, so pending items go through the new relay; a different secret deletes the old outbox, its
     * rows, their content and the ack cursor. That includes an outbox kept by [unpair]: every outbox but [p]'s goes.
     * Callers ask first when [PairingConfirmation] says so.
     */
    fun pair(p: Pairing) {
        val old = pairing()
        // Lab (LAB-PLAN 2.6): a Daylight server that knows the old pairing is locked first, Lab on or off.
        app.lab.beforePairing(old, p)
        val keep = p.keys.inboxTopic
        synchronized(this) {
            // Under this lock, so a share being added ([addTo]) lands before the deletion or is refused after it.
            val others = root.listFiles()?.filter { it.isDirectory && it.name != keep }.orEmpty()
            for (dir in others) FileOutboxStore(dir).clear()
            if (others.isNotEmpty()) logi("sender: a different Daylight: the outbox for ${old?.name?.ifEmpty { null } ?: "the previous one"} was deleted")
            outbox = null
            app.prefs.senderLink = p.link()
            _pairing.value = p
        }
        if (old == null || !old.sameSecret(p)) {
            _rows.value = emptyList()
            _lab.value = null
        }
        // Lab (F08): the Direct Share shortcut carries the Daylight's name.
        Shortcuts.update(app)
        logi("sender: paired with ${p.name.ifEmpty { "a Daylight" }} via ${p.relay}")
    }

    /** Forgets the pairing. The outbox stays until the next [pair]: kept for the same code, deleted for another. */
    fun unpair() {
        // Lab (LAB-PLAN 2.6): a typed Server address and the cached server status were this pairing's server's.
        app.lab.beforeUnpair(pairing())
        synchronized(this) {
            app.prefs.senderLink = null
            _pairing.value = null
            outbox = null
        }
        _rows.value = emptyList()
        _lab.value = null
        // Lab (F08): no Daylight, no Direct Share target.
        Shortcuts.remove(app)
    }

    /**
     * Settings › Relay › Save on a sender: changes the relay of the current pairing (the outbox stays). Returns null when
     * saved, else the sentence to show: the relay comes with the pairing, so there is nothing to change while unpaired.
     */
    fun saveRelay(input: String): String? {
        val p = pairing() ?: return NOT_PAIRED_RELAY
        val r = try {
            Relay.normalize(input)
        } catch (e: ShareException) {
            return e.message ?: "That relay address isn’t valid."
        }
        if (r != p.relay) pair(Pairing(p.secret, r, p.name))
        return null
    }

    @Synchronized
    fun outbox(): Outbox? {
        val p = pairing() ?: return null
        val key = p.link() + "|" + app.prefs.deviceName
        outbox?.takeIf { outboxKey == key }?.let { return it }
        // One outbox per Daylight: pairing with another one starts a fresh history.
        val store = FileOutboxStore(File(root, p.keys.inboxTopic))
        // Lab (F17, LAB-PROTOCOL 2.2.6): the ledger hears every ack-topic frame, Lab on or off, so turning Lab on shows
        // the right states at once. It lives next to the outbox (lab.json) and goes with it.
        val l = LabLedger.of(store)
        val o = Outbox(
            pairing = p,
            store = store,
            relay = RelayClient(p.relay, http ?: UrlConnectionHttp("DaylightShare/${BuildConfig.VERSION_NAME} (sender)")),
            from = app.prefs.deviceName,
            app = "android/${BuildConfig.VERSION_NAME}",
            onAckHeader = l.hook(),
        )
        outbox = o
        outboxKey = key
        ledger = l
        return o
    }

    /** The Lab ledger of the current pairing (what the Daylight said about Lab and its items), or null when unpaired. */
    @Synchronized
    fun ledger(): LabLedger? {
        val o = outbox() ?: return null
        return ledger?.takeIf { o === outbox }
    }

    suspend fun refresh() = withContext(Dispatchers.IO) {
        _rows.value = outbox()?.rows() ?: emptyList()
        readLab()
    }

    /** Reads the ledger's snapshot again (F01). */
    private fun readLab() {
        _lab.value = runCatching { ledger()?.snapshot() }.getOrNull()
    }

    /**
     * Puts what was shared into the outbox: copies streams into private storage first (a shared URI's grant ends with
     * the activity that received it). Anything over 9 MB is refused before it is read or copied, with the shared
     * sentence ("Too big to send. Files can be up to 9 MB; this one is 14.2 MB."). Throws [ShareException] with a
     * message for the user.
     *
     * With Lab on (LAB-PLAN 3.3): links and text go through smart intake (F16: `Normalise.normaliseShare`, cleaning only
     * while F16's Use switch is on; the URL as shared goes as `x-orig`); text becomes an excerpt only when [options] say
     * "Send as excerpt" (F11, 6.5 Q1 = b), and text without a link becomes a note (`Excerpt.item`); a share while this
     * device is offline waits for a connection (F07: `defer`, then [FlushWorker]); and the Direct Share shortcut is
     * pushed (F08). With Lab off it is exactly v1.1.
     */
    suspend fun add(shared: Shared, options: ShareOptions = ShareOptions()): OutboxRow = withContext(Dispatchers.IO) {
        // The Daylight this share is for: if the user pairs with another one while a file is being copied, the share
        // is refused rather than written into the deleted outbox (or sent to a Daylight it was not shared to).
        val topic = outbox()?.pairing?.keys?.inboxTopic ?: throw ShareException("pairing", "Pair with your Daylight first.")
        if (app.prefs.lab) return@withContext addLab(topic, shared, options)
        when (shared) {
            is Shared.Link -> {
                val url = Text.webUrl(shared.url) ?: Text.findUrl(shared.url) ?: throw ShareException("url", "That isn’t a web address.")
                addTo(topic, OutgoingItem(Kind.URL, url = url, title = options.title ?: shared.title), null)
            }
            is Shared.Text -> {
                val name = Text.safeFileName((shared.subject?.take(60)?.ifBlank { null } ?: "Shared text") + ".txt")
                addTo(topic, OutgoingItem(Kind.FILE, name = name, mime = "text/plain", title = options.title ?: shared.subject), BytesBody(shared.text.toByteArray()))
            }
            is Shared.Stream -> {
                val copy = options.copied ?: copyIn(shared.uri, shared.mime)
                try {
                    addTo(topic, OutgoingItem(Kind.FILE, name = copy.name, mime = copy.mime, title = options.title ?: copy.title), FileBody(copy.file), moveContent = true)
                } finally {
                    copy.file.delete()
                }
            }
        }
    }

    /** What a share becomes with Lab on (F16, F11), before it is stored: the item, its bytes, and how it was read. */
    class Intake(val item: OutgoingItem, val body: Body?, val kind: String)

    /**
     * Smart intake (F16) and F11's rule for a link or text share, Lab on. [Intake.kind] is `Normalise.Kinds`' (link,
     * excerpt, note). Throws [ShareException] when nothing in it can be sent.
     */
    fun intake(shared: Shared, options: ShareOptions = ShareOptions()): Intake {
        val clean = PhoneLab.useOn(app, "F16")
        val r = when (shared) {
            is Shared.Link -> {
                val url = Text.webUrl(shared.url) ?: Text.findUrl(shared.url) ?: throw ShareException("url", "That isn’t a web address.")
                Normalise.normaliseShare(text = "", url = url, subject = shared.title ?: "", clean = clean)
            }
            is Shared.Text -> Normalise.normaliseShare(
                text = shared.text, subject = shared.subject ?: "",
                source = if (options.asExcerpt) Normalise.SOURCE_SELECTION else "", clean = clean,
            )
            is Shared.Stream -> throw IllegalArgumentException("a stream is not read by intake")
        }
        return when (r.kind) {
            Normalise.Kinds.LINK -> Intake(OutgoingItem(Kind.URL, url = r.url, title = options.title?.ifBlank { null } ?: r.title, extras = r.extras), null, r.kind)
            Normalise.Kinds.EXCERPT, Normalise.Kinds.NOTE -> {
                val subject = (shared as? Shared.Text)?.subject ?: ""
                val e = Excerpt.item(
                    text = r.excerpt, url = r.url ?: "", pageTitle = subject, site = PhoneLab.host(r.url),
                    app = options.sourceApp ?: "", date = System.currentTimeMillis(),
                ) ?: throw ShareException("content", NOTHING_TO_SEND)
                val (item, body) = e.toOutgoing()
                Intake(item.copy(title = options.title?.ifBlank { null } ?: item.title), body, r.kind)
            }
            else -> throw ShareException("content", NOTHING_TO_SEND)
        }
    }

    /** [add] with Lab on. */
    private fun addLab(topic: String, shared: Shared, options: ShareOptions): OutboxRow {
        val defer = !PhoneLab.online(app)
        val row = when (shared) {
            is Shared.Stream -> {
                val copy = options.copied ?: copyIn(shared.uri, shared.mime)
                try {
                    addTo(topic, OutgoingItem(Kind.FILE, name = copy.name, mime = copy.mime, title = options.title?.ifBlank { null } ?: copy.title), FileBody(copy.file), moveContent = true, defer = defer)
                } finally {
                    copy.file.delete()
                }
            }
            else -> {
                val i = intake(shared, options)
                addTo(topic, i.item, i.body, defer = defer)
            }
        }
        ActivityLog.addRow(app, "share", row)
        if (FlushWorker.waiting(row)) FlushWorker.schedule(app)
        Shortcuts.push(app)
        return row
    }

    /**
     * F26: sends Setup check's test article (`SetupCheck.testArticle`, a page with `x-cap: "test"`) now, or when the
     * network is back. Remembers its id, which Setup check follows. -> its row.
     */
    suspend fun sendTestArticle(): OutboxRow = withContext(Dispatchers.IO) {
        val topic = outbox()?.pairing?.keys?.inboxTopic ?: throw ShareException("pairing", "Pair with your Daylight first.")
        val (item, body) = SetupCheck.testArticle(device = app.prefs.deviceName).toOutgoing()
        val defer = !PhoneLab.online(app)
        val row = addTo(topic, item, body, defer = defer)
        app.prefs.labTestId = row.id
        ActivityLog.addRow(app, "test", row)
        if (defer) {
            FlushWorker.schedule(app)
            row
        } else {
            publish(row.id) ?: row
        }
    }

    /**
     * Adds to the outbox of the pairing with inbox topic [topic], under the same lock as [pair]'s deletion. Throws
     * [ShareException] "pairing" ([PAIRING_CHANGED]) when the user paired with another Daylight (or unpaired) meanwhile.
     */
    @VisibleForTesting
    internal fun addTo(topic: String, item: OutgoingItem, content: Body?, moveContent: Boolean = false, defer: Boolean = false): OutboxRow = synchronized(this) {
        val o = outbox()?.takeIf { it.pairing.keys.inboxTopic == topic } ?: throw ShareException("pairing", PAIRING_CHANGED)
        val row = o.add(item, content, moveContent, defer)
        _rows.value = o.rows()
        row
    }

    /**
     * Publishes item [id] now; then ack checks follow in the background. Lab (F07): a row that waits for a connection
     * while this device is offline is left to wait ([FlushWorker]), and a publish that fails for want of a network
     * waits for the connection too.
     */
    suspend fun publish(id: String): OutboxRow? = withContext(Dispatchers.IO) {
        val o = outbox() ?: return@withContext null
        if (app.prefs.lab) {
            val row = o.row(id)
            if (row != null && FlushWorker.waiting(row) && !PhoneLab.online(app)) {
                FlushWorker.schedule(app)
                return@withContext row
            }
        }
        val r = o.publish(id)
        _rows.value = o.rows()
        Work.syncLater(app, 30)
        Work.syncLater(app, 180)
        if (r != null && app.prefs.lab) {
            ActivityLog.addRow(app, "send", r)
            if (FlushWorker.waiting(r)) FlushWorker.schedule(app)
        }
        r
    }

    /**
     * F07: one offline flush pass (`Outbox.flushNetwork`, both caps and the pass rules). FlushWorker spaces the passes.
     * -> the rows it attempted.
     */
    suspend fun flush(): List<OutboxRow> = withContext(Dispatchers.IO) {
        val o = outbox() ?: return@withContext emptyList()
        val out = o.flushNetwork()
        _rows.value = o.rows()
        for (r in out) ActivityLog.addRow(app, "flush", r)
        if (out.isNotEmpty()) {
            logi("sender: ${out.size} sent after waiting for a connection")
            Work.syncLater(app, 30)
            Work.syncLater(app, 180)
        }
        out
    }

    /**
     * After attempts outside the app's screens (the share-in-place job, a flush pass): F04's notices for items shared
     * in place that ended badly, and, unless [scheduleFlush] is false, a flush pass for what waits for a connection.
     */
    suspend fun afterAttempts(rows: List<OutboxRow>, scheduleFlush: Boolean = true) = withContext(Dispatchers.IO) {
        if (!app.prefs.lab) return@withContext
        if (scheduleFlush && rows.any { FlushWorker.waiting(it) }) FlushWorker.schedule(app)
        Notices.review(app, outbox()?.rows() ?: rows, _lab.value)
    }

    /** F04: remembers items shared in place, whose failure (or arrival in the Reader) may be told by a notice. */
    fun noteInPlace(ids: Collection<String>) {
        if (ids.isEmpty()) return
        app.prefs.setLabInPlaceIds(app.prefs.labInPlaceIds() + ids)
        app.prefs.labAskNotices = true
    }

    /** One pass: acks, re-sends, expiry. */
    suspend fun tick() = withContext(Dispatchers.IO) {
        val o = outbox() ?: return@withContext
        val t = o.tick()
        if (dropIfReplaced(o)) return@withContext
        if (t.delivered > 0 || t.resent > 0) logi("sender: ${t.delivered} delivered, ${t.resent} sent again")
        val rows = o.rows()
        _rows.value = rows
        pruneLedger(rows)
        readLab()
        if (app.prefs.lab) {
            if (t.delivered > 0) ActivityLog.add(app, "acks", "", "", "delivered ${t.delivered}")
            for (r in t.resentRows) ActivityLog.addRow(app, "resend", r)
            // F04: an item shared in place that ended badly, or reached the Reader, is told about once.
            Notices.review(app, rows, _lab.value)
            // F07: rows that wait for a connection go as soon as it is back.
            if (rows.any { FlushWorker.waiting(it) }) FlushWorker.schedule(app)
        }
    }

    /** Keeps the ledger's states for the outbox's ids only, at most 200 (LAB-PROTOCOL 2.2.6); writes only when needed. */
    private fun pruneLedger(rows: List<OutboxRow>) {
        val l = ledger() ?: return
        runCatching {
            val ids = rows.mapTo(HashSet()) { it.id }
            val states = l.snapshot().states
            if (states.size > Lab.LEDGER_STATES_MAX || states.keys.any { it !in ids }) l.prune(ids)
        }
    }

    /**
     * A pass that was running on [o] while the user paired with another Daylight may have saved its ack cursor into
     * the outbox [pair] had just deleted: deleted again here. Returns whether [o] belongs to a replaced pairing.
     */
    private fun dropIfReplaced(o: Outbox): Boolean {
        synchronized(this) {
            val current = pairing() ?: return false
            if (current.sameSecret(o.pairing)) return false
            FileOutboxStore(File(root, o.pairing.keys.inboxTopic)).clear()
            return true
        }
    }

    suspend fun retry(id: String) = withContext(Dispatchers.IO) {
        outbox()?.let { o ->
            o.retry(id)?.let { ActivityLog.addRow(app, "retry", it) }
            _rows.value = o.rows()
        }
        Work.syncLater(app, 30)
    }

    suspend fun remove(id: String) = withContext(Dispatchers.IO) {
        outbox()?.let { o ->
            o.remove(id)
            _rows.value = o.rows()
        }
    }

    /** A shared stream copied into private storage: the file, its name, type and title. */
    class Copy(val file: File, val name: String, val mime: String, val title: String?)

    /**
     * Copies a shared stream now, off the main thread (the share card does it while its countdown runs). Cancelling the
     * caller stops the copy between chunks and deletes what it wrote, and a copy that finished as the caller was
     * cancelled is deleted too: nothing is left in `outbox-incoming` for a share that went.
     */
    suspend fun copy(uri: Uri, mimeHint: String?): Copy {
        val job = currentCoroutineContext()[Job]
        var made: Copy? = null
        try {
            return withContext(Dispatchers.IO) { copyIn(uri, mimeHint) { job?.isActive != false }.also { made = it } }
        } catch (e: CancellationException) {
            made?.file?.delete()
            throw e
        }
    }

    /** The size a content or file URI says it has (OpenableColumns.SIZE, or the file's length); null when unknown. */
    @VisibleForTesting
    internal fun sizeOf(uri: Uri): Long? {
        if (uri.scheme == ContentResolver.SCHEME_FILE) return uri.path?.let { File(it) }?.takeIf { it.isFile }?.length()
        return runCatching {
            app.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getLong(0).takeIf { it >= 0 } else null
            }
        }.getOrNull()
    }

    /**
     * Copies a shared stream into private storage. Over [Limits.MAX_ITEM] bytes it is refused before anything is read
     * when its size is known, and as soon as the copy passes the limit when it is not.
     */
    @VisibleForTesting
    internal fun copyIn(uri: Uri, mimeHint: String?, keepGoing: () -> Boolean = { true }): Copy {
        val cr = app.contentResolver
        if (uri.scheme == ContentResolver.SCHEME_FILE) {
            // Never send our own private files (an app could ask us to share our settings with the paired Daylight).
            val path = uri.path?.let { File(it).canonicalPath } ?: throw ShareException("content", "Couldn’t read that file.")
            if (path.startsWith(File(app.applicationInfo.dataDir).canonicalPath)) throw ShareException("content", "Couldn’t read that file.")
        } else if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
            throw ShareException("content", "Couldn’t read that file.")
        }
        sizeOf(uri)?.let { size -> if (size > Limits.MAX_ITEM) throw ShareException("too-large", Text.tooBigMessage(size)) }
        var name: String? = null
        runCatching {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
            }
        }
        if (name.isNullOrBlank()) name = uri.lastPathSegment?.substringAfterLast('/')
        val mime = pickMime(mimeHint, runCatching { cr.getType(uri) }.getOrNull(), name)
        var fileName = Text.safeFileName(name, "document")
        if (!fileName.contains('.')) {
            MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { fileName = Text.safeFileName("$fileName.$it") }
        }
        val tmp = File(incoming, UUID.randomUUID().toString())
        try {
            incoming.mkdirs()
            val input = cr.openInputStream(uri) ?: throw ShareException("content", "Couldn’t read that file.")
            input.use { copyCapped(it, tmp, keepGoing) }
        } catch (e: SecurityException) {
            tmp.delete()
            throw ShareException("content", "Daylight Share isn’t allowed to read that file.")
        } catch (e: ShareException) {
            tmp.delete()
            throw e
        } catch (e: IOException) {
            tmp.delete()
            throw ShareException("content", "Couldn’t read that file (${e.message}).", cause = e)
        }
        val title = fileName.substringBeforeLast('.').takeIf { it.isNotBlank() }
        return Copy(tmp, fileName, mime, title)
    }

    companion object {
        /** A stream of unknown size that passed 9 MB while it was copied and was longer than [MAX_MEASURED] (its size unknown). */
        const val TOO_BIG_UNKNOWN = "Too big to send. Files can be up to 9 MB."

        /** A stream of unknown size over 9 MB is read on (not stored) up to this many bytes to tell its size. */
        const val MAX_MEASURED = 100_000_000L

        /** A copy in `outbox-incoming` older than this belongs to no share still being prepared ([sweepIncoming]). */
        const val INCOMING_MAX_AGE_MS = 60L * 60_000

        /** "Save relay" on a sender that is not paired: the relay comes with the pairing. */
        const val NOT_PAIRED_RELAY = "Pair with your Daylight first. The relay comes with its code."

        /** Nothing in a share can be sent. */
        const val NOTHING_TO_SEND = "There’s nothing here Daylight Share can send."

        /** The share started for one Daylight, and the user paired with another (or unpaired) before it was stored. */
        const val PAIRING_CHANGED = "The pairing changed while this was being prepared, so it wasn’t sent. Share it again."

        /**
         * Copies [input] to [dest], stopping the copy as soon as it passes [Limits.MAX_ITEM] bytes ("too-large", with the
         * shared sentence and the size when the rest of the stream, read without storing it, ends by [MAX_MEASURED]). A
         * write that fails is "storage" ("This device is out of space…"), a read that fails is "content", and a copy
         * stopped because [keepGoing] said no (the share went) is "cancelled". On failure [dest] may be left for the
         * caller to delete.
         */
        fun copyCapped(input: java.io.InputStream, dest: File, keepGoing: () -> Boolean = { true }) {
            val out = try {
                dest.outputStream()
            } catch (e: IOException) {
                throw ShareException("storage", Outbox.OUT_OF_SPACE, cause = e)
            }
            out.use {
                val buf = ByteArray(256 * 1024)
                var total = 0L
                while (true) {
                    if (!keepGoing()) throw ShareException("cancelled", "The share was closed before it was sent.")
                    val n = try {
                        input.read(buf)
                    } catch (e: IOException) {
                        throw ShareException("content", "Couldn’t read that file (${e.message}).", cause = e)
                    }
                    if (n < 0) break
                    total += n
                    if (total > Limits.MAX_ITEM) throw ShareException("too-large", tooBig(input, buf, total))
                    try {
                        it.write(buf, 0, n)
                    } catch (e: IOException) {
                        throw ShareException("storage", Outbox.OUT_OF_SPACE, cause = e)
                    }
                }
            }
        }

        /** The sentence for a stream that passed 9 MB after [readSoFar] bytes: with its size when the rest is short enough to count. */
        private fun tooBig(input: java.io.InputStream, buf: ByteArray, readSoFar: Long): String {
            var total = readSoFar
            try {
                while (total <= MAX_MEASURED) {
                    val n = input.read(buf)
                    if (n < 0) return Text.tooBigMessage(total)
                    total += n
                }
            } catch (e: IOException) {
                // Cannot tell its size: the sentence without it.
            }
            return TOO_BIG_UNKNOWN
        }

        private val BY_EXTENSION = mapOf(
            "pdf" to "application/pdf", "epub" to "application/epub+zip", "md" to "text/markdown", "markdown" to "text/markdown",
            "html" to "text/html", "htm" to "text/html", "xhtml" to "application/xhtml+xml", "txt" to "text/plain",
            "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "mobi" to "application/x-mobipocket-ebook", "azw3" to "application/vnd.amazon.mobi8-ebook",
        )

        fun pickMime(hint: String?, resolver: String?, name: String?): String {
            fun specific(m: String?) = m?.lowercase(Locale.ROOT)?.takeIf { it.contains('/') && !it.contains('*') && it != "application/octet-stream" }
            val ext = name?.substringAfterLast('.', "")?.lowercase(Locale.ROOT).orEmpty()
            return specific(resolver) ?: specific(hint) ?: BY_EXTENSION[ext]
                ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }
}
