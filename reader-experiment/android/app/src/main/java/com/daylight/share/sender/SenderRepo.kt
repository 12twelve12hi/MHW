package com.daylight.share.sender

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.Work
import com.daylight.share.core.BytesBody
import com.daylight.share.core.FileBody
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.Kind
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Outbox
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Pairing
import com.daylight.share.core.RelayClient
import com.daylight.share.core.ShareException
import com.daylight.share.core.Text
import com.daylight.share.core.UrlConnectionHttp
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

    fun pairing(): Pairing? = _pairing.value

    fun pair(p: Pairing) {
        app.prefs.senderLink = p.link()
        _pairing.value = p
        synchronized(this) { outbox = null }
        logi("sender: paired with ${p.name.ifEmpty { "a Daylight" }} via ${p.relay}")
    }

    fun unpair() {
        app.prefs.senderLink = null
        _pairing.value = null
        synchronized(this) { outbox = null }
        _rows.value = emptyList()
    }

    /** Changes the relay of the current pairing (Settings). */
    fun setRelay(relay: String) {
        val p = pairing() ?: return
        pair(Pairing(p.secret, relay, p.name))
    }

    @Synchronized
    fun outbox(): Outbox? {
        val p = pairing() ?: return null
        val key = p.link() + "|" + app.prefs.deviceName
        outbox?.takeIf { outboxKey == key }?.let { return it }
        // One outbox per Daylight: pairing with another one starts a fresh history.
        val o = Outbox(
            pairing = p,
            store = FileOutboxStore(File(root, p.keys.inboxTopic)),
            relay = RelayClient(p.relay, UrlConnectionHttp("DaylightShare/${BuildConfig.VERSION_NAME} (sender)")),
            from = app.prefs.deviceName,
            app = "android/${BuildConfig.VERSION_NAME}",
        )
        outbox = o
        outboxKey = key
        return o
    }

    suspend fun refresh() = withContext(Dispatchers.IO) {
        _rows.value = outbox()?.rows() ?: emptyList()
    }

    /**
     * Puts what was shared into the outbox: copies streams into private storage first (a shared URI's grant ends with
     * the activity that received it). Throws [ShareException] with a message for the user.
     */
    suspend fun add(shared: Shared): OutboxRow = withContext(Dispatchers.IO) {
        val o = outbox() ?: throw ShareException("pairing", "Pair with your Daylight first.")
        val row = when (shared) {
            is Shared.Link -> {
                val url = Text.webUrl(shared.url) ?: Text.findUrl(shared.url) ?: throw ShareException("url", "That isn’t a web address.")
                o.add(OutgoingItem(Kind.URL, url = url, title = shared.title), null)
            }
            is Shared.Text -> {
                val name = Text.safeFileName((shared.subject?.take(60)?.ifBlank { null } ?: "Shared text") + ".txt")
                o.add(OutgoingItem(Kind.FILE, name = name, mime = "text/plain", title = shared.subject), BytesBody(shared.text.toByteArray()))
            }
            is Shared.Stream -> {
                val copy = copyIn(shared.uri, shared.mime)
                try {
                    o.add(OutgoingItem(Kind.FILE, name = copy.name, mime = copy.mime, title = copy.title), FileBody(copy.file), moveContent = true)
                } finally {
                    copy.file.delete()
                }
            }
        }
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
        if (t.delivered > 0 || t.resent > 0) logi("sender: ${t.delivered} delivered, ${t.resent} sent again")
        _rows.value = o.rows()
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

    private class Copy(val file: File, val name: String, val mime: String, val title: String?)

    private fun copyIn(uri: Uri, mimeHint: String?): Copy {
        val cr = app.contentResolver
        if (uri.scheme == ContentResolver.SCHEME_FILE) {
            // Never send our own private files (an app could ask us to share our settings with the paired Daylight).
            val path = uri.path?.let { File(it).canonicalPath } ?: throw ShareException("content", "Couldn’t read that file.")
            if (path.startsWith(File(app.applicationInfo.dataDir).canonicalPath)) throw ShareException("content", "Couldn’t read that file.")
        } else if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
            throw ShareException("content", "Couldn’t read that file.")
        }
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
            MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { fileName += ".$it" }
        }
        incoming.mkdirs()
        val tmp = File(incoming, UUID.randomUUID().toString())
        try {
            val input = cr.openInputStream(uri) ?: throw ShareException("content", "Couldn’t read that file.")
            input.use { inp ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(256 * 1024)
                    var total = 0L
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_RAW) throw ShareException("too-large", "That file is larger than 64 MB.")
                        out.write(buf, 0, n)
                    }
                }
            }
        } catch (e: IOException) {
            tmp.delete()
            throw ShareException("content", "Couldn’t read that file (${e.message}).")
        } catch (e: SecurityException) {
            tmp.delete()
            throw ShareException("content", "Daylight Share isn’t allowed to read that file.")
        } catch (e: ShareException) {
            tmp.delete()
            throw e
        }
        val title = fileName.substringBeforeLast('.').takeIf { it.isNotBlank() }
        return Copy(tmp, fileName, mime, title)
    }

    companion object {
        /** Raw size cap before encoding (text compresses; the protocol caps the encoded size at 64 MiB). */
        const val MAX_RAW = 256L * 1024 * 1024

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
