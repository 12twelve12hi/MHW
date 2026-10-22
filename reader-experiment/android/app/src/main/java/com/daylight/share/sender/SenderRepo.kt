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
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabLedger
import com.daylight.share.logi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
        if (old == null || !old.sameSecret(p)) _rows.value = emptyList()
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
    }

    /**
     * Puts what was shared into the outbox: copies streams into private storage first (a shared URI's grant ends with
     * the activity that received it). Anything over 9 MB is refused before it is read or copied, with the shared
     * sentence ("Too big to send. Files can be up to 9 MB; this one is 14.2 MB."). Throws [ShareException] with a
     * message for the user.
     */
    suspend fun add(shared: Shared): OutboxRow = withContext(Dispatchers.IO) {
        // The Daylight this share is for: if the user pairs with another one while a file is being copied, the share
        // is refused rather than written into the deleted outbox (or sent to a Daylight it was not shared to).
        val topic = outbox()?.pairing?.keys?.inboxTopic ?: throw ShareException("pairing", "Pair with your Daylight first.")
        when (shared) {
            is Shared.Link -> {
                val url = Text.webUrl(shared.url) ?: Text.findUrl(shared.url) ?: throw ShareException("url", "That isn’t a web address.")
                addTo(topic, OutgoingItem(Kind.URL, url = url, title = shared.title), null)
            }
            is Shared.Text -> {
                val name = Text.safeFileName((shared.subject?.take(60)?.ifBlank { null } ?: "Shared text") + ".txt")
                addTo(topic, OutgoingItem(Kind.FILE, name = name, mime = "text/plain", title = shared.subject), BytesBody(shared.text.toByteArray()))
            }
            is Shared.Stream -> {
                val copy = copyIn(shared.uri, shared.mime)
                try {
                    addTo(topic, OutgoingItem(Kind.FILE, name = copy.name, mime = copy.mime, title = copy.title), FileBody(copy.file), moveContent = true)
                } finally {
                    copy.file.delete()
                }
            }
        }
    }

    /**
     * Adds to the outbox of the pairing with inbox topic [topic], under the same lock as [pair]'s deletion. Throws
     * [ShareException] "pairing" ([PAIRING_CHANGED]) when the user paired with another Daylight (or unpaired) meanwhile.
     */
    @VisibleForTesting
    internal fun addTo(topic: String, item: OutgoingItem, content: Body?, moveContent: Boolean = false): OutboxRow = synchronized(this) {
        val o = outbox()?.takeIf { it.pairing.keys.inboxTopic == topic } ?: throw ShareException("pairing", PAIRING_CHANGED)
        val row = o.add(item, content, moveContent)
        _rows.value = o.rows()
        row
    }

    /** Publishes item [id] now; then ack checks follow in the background. */
    suspend fun publish(id: String): OutboxRow? = withContext(Dispatchers.IO) {
        val o = outbox() ?: return@withContext null
        val r = o.publish(id)
        _rows.value = o.rows()
        Work.syncLater(app, 30)
        Work.syncLater(app, 180)
        r
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
            o.retry(id)
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

    internal class Copy(val file: File, val name: String, val mime: String, val title: String?)

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
    internal fun copyIn(uri: Uri, mimeHint: String?): Copy {
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
            input.use { copyCapped(it, tmp) }
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

        /** "Save relay" on a sender that is not paired: the relay comes with the pairing. */
        const val NOT_PAIRED_RELAY = "Pair with your Daylight first. The relay comes with its code."

        /** The share started for one Daylight, and the user paired with another (or unpaired) before it was stored. */
        const val PAIRING_CHANGED = "The pairing changed while this was being prepared, so it wasn’t sent. Share it again."

        /**
         * Copies [input] to [dest], stopping the copy as soon as it passes [Limits.MAX_ITEM] bytes ("too-large", with the
         * shared sentence and the size when the rest of the stream, read without storing it, ends by [MAX_MEASURED]). A
         * write that fails is "storage" ("This device is out of space…"), a read that fails is "content". On failure
         * [dest] may be left for the caller to delete.
         */
        fun copyCapped(input: java.io.InputStream, dest: File) {
            val out = try {
                dest.outputStream()
            } catch (e: IOException) {
                throw ShareException("storage", Outbox.OUT_OF_SPACE, cause = e)
            }
            out.use {
                val buf = ByteArray(256 * 1024)
                var total = 0L
                while (true) {
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
