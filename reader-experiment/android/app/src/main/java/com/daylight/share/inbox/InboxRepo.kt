package com.daylight.share.inbox

import com.daylight.share.App
import com.daylight.share.BuildConfig
import androidx.annotation.VisibleForTesting
import com.daylight.share.core.ErrorCode
import com.daylight.share.core.FileBody
import com.daylight.share.core.FileReceiverStore
import com.daylight.share.core.Http
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.JsonFiles
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.Pairing
import com.daylight.share.core.Reassembler
import com.daylight.share.core.Receiver
import com.daylight.share.core.Relay
import com.daylight.share.core.RelayClient
import com.daylight.share.core.RelayMessage
import com.daylight.share.core.RelayProbe
import com.daylight.share.core.ShareException
import com.daylight.share.core.UrlConnectionHttp
import com.daylight.share.logi
import com.daylight.share.logw
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/** One received item, as the Inbox lists it. */
data class InboxItem(
    val id: String,
    val kind: String,
    val url: String? = null,
    val title: String? = null,
    val name: String? = null,
    val mime: String? = null,
    val size: Long = 0,
    val from: String? = null,
    val app: String? = null,
    val sent: String = "",
    val received: Long = 0,
    /** The stored content, relative to the Inbox's files folder (pages and files). */
    val file: String? = null,
    val state: String = WAITING,
    /** Which Reader package got it, along which path (save_page, send_link, ...), and what it answered. */
    val deliveredTo: String? = null,
    val via: String? = null,
    val readerStatus: String? = null,
    val handedAt: Long = 0,
    /**
     * Where it came from: [LANE_PAIRING], the pairing's inbox topic (every item today), or [LANE_SERVER], the Daylight
     * server's lane (Wave S, S0). Server-lane items get no Lab states (LAB-PROTOCOL 2.2.4): no sender holds their ids.
     */
    val lane: String = LANE_PAIRING,
) {
    val displayTitle: String
        get() = title?.takeIf { it.isNotBlank() } ?: name?.takeIf { it.isNotBlank() } ?: url ?: "Untitled"

    /** The Reader said it has the item: SAVE_PAGE answered `saved` or `duplicate`. Documents get no such answer. */
    val confirmedInReader: Boolean get() = state == IN_READER && readerStatus in CONFIRMED

    /**
     * Where the item is, in the Inbox's words: "In your Reader ✓" only when the Reader confirmed it; "Handed to the
     * Reader" when it was handed over without an answer (documents, shared links) or the answer is still to come.
     */
    val readerLabel: String
        get() = when (state) {
            IN_READER -> if (confirmedInReader) IN_YOUR_READER else HANDED_TO_READER
            OPEN -> "Open — not in the Reader"
            else -> "Waiting"
        }

    fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "kind" to kind, "url" to url, "title" to title, "name" to name, "mime" to mime, "size" to size,
        "from" to from, "app" to app, "sent" to sent, "received" to received, "file" to file, "state" to state,
        "deliveredTo" to deliveredTo, "via" to via, "readerStatus" to readerStatus, "handedAt" to handedAt,
    ).also { if (lane != LANE_PAIRING) it["lane"] = lane }

    companion object {
        /** Waiting for the hand-off to the Reader. */
        const val WAITING = "waiting"
        /** Handed to the Reader. */
        const val IN_READER = "in_reader"
        /** No Reader takes it: it stays here, to open with another app. */
        const val OPEN = "open"

        /** The Reader's SAVE_PAGE answers that mean it has the item. */
        val CONFIRMED = setOf("saved", "duplicate")
        const val IN_YOUR_READER = "In your Reader ✓"
        const val HANDED_TO_READER = "Handed to the Reader"

        /** [lane]: the pairing's inbox topic. */
        const val LANE_PAIRING = "pairing"
        /** [lane]: the Daylight server's lane (Wave S). */
        const val LANE_SERVER = "server"

        fun fromJson(m: Map<String, Any?>): InboxItem? {
            val id = m["id"] as? String ?: return null
            if (!ItemHeader.isId(id)) return null
            fun s(k: String) = m[k] as? String
            fun l(k: String) = (m[k] as? Double)?.toLong() ?: 0L
            return InboxItem(
                id = id, kind = s("kind") ?: Kind.URL, url = s("url"), title = s("title"), name = s("name"), mime = s("mime"),
                size = l("size"), from = s("from"), app = s("app"), sent = s("sent") ?: "", received = l("received"),
                file = s("file"), state = s("state") ?: WAITING, deliveredTo = s("deliveredTo"), via = s("via"),
                readerStatus = s("readerStatus"), handedAt = l("handedAt"), lane = s("lane") ?: LANE_PAIRING,
            )
        }
    }
}

/**
 * Connection state for the UI. [error] is one of the Inbox sentences ([InboxText]) or null; [storeFull] stays on from
 * a failed store until an item is stored.
 */
data class SyncState(
    val live: Boolean = false,
    val lastCheck: Long = 0,
    val error: String? = null,
    val checking: Boolean = false,
    val storeFull: Boolean = false,
) {
    /**
     * After a poll or the live connection failed with [e]. The relay's failures are [ShareException]s; an IOException
     * is this device failing to write (the receiver's state on a full disk), so it is the out-of-space sentence.
     */
    fun failed(e: Throwable): SyncState =
        if (e is IOException) copy(storeFull = true, checking = false) else copy(error = InboxText.forFailure(e), checking = false)

    /** The live connection is open: its failure sentence goes, a limit reported by the catch-up poll stays. */
    fun connected(): SyncState = copy(live = true, error = error.takeIf { it == InboxText.LIMITED })
}

/** What the Daylight Inbox says about receiving (CHANGES-v1.1 2.5, "The Daylight Inbox"). */
object InboxText {
    const val OUT_OF_SPACE = "Your Daylight is out of space, so new items can’t be saved. Free some space."
    const val LIMITED = "Too much has gone through this network for now. New items will arrive later."
    const val OFFLINE = "Offline. New items will arrive when this Daylight is back online."
    fun relayError(status: Int) = "The relay isn’t working right now (error $status). It will keep trying."
    const val RELAY_ERROR = "The relay isn’t working right now. It will keep trying."

    /** Under an item handed to the Reader without its confirmation ("Handed to the Reader"), next to "Add to Reader again". */
    fun unconfirmedHint(kind: String): String =
        if (kind == Kind.FILE) "The Reader doesn’t confirm documents. If it isn’t in its library, add it again."
        else "The Reader hasn’t confirmed this one. If it isn’t in its library, add it again."

    /** The sentence for a poll (or the live connection) that failed with [e]. */
    fun forFailure(e: Throwable): String {
        val status = (e as? ShareException)?.status ?: 0
        return when {
            status == 429 || status == 413 -> LIMITED
            e is ShareException && e.code == ErrorCode.NETWORK -> OFFLINE
            status >= 300 -> relayError(status)
            e is ShareException -> RELAY_ERROR
            // Not the relay's (those are ShareExceptions): a write on this device failed.
            e is IOException -> OUT_OF_SPACE
            else -> OFFLINE
        }
    }
}

/**
 * The Daylight Inbox's data: its pairing, the received items (`files/inbox/items.json` and `files/inbox/files/<id>/`),
 * and the protocol [Receiver] that fills them.
 */
class InboxRepo(private val app: App) {
    private val dir = File(app.filesDir, "inbox")
    private val itemsFile = File(dir, "items.json")
    val filesRoot = File(dir, "files")

    private val _items = MutableStateFlow(load())
    val items: StateFlow<List<InboxItem>> get() = _items

    private val _pairing = MutableStateFlow<Pairing?>(null)
    val pairingFlow: StateFlow<Pairing?> get() = _pairing

    val sync = MutableStateFlow(SyncState())

    @Volatile private var receiver: Receiver? = null

    /** The Inbox's pairing, made on first use. */
    @Synchronized
    fun ensurePairing(): Pairing {
        _pairing.value?.let { return it }
        val p = app.prefs.inboxCode?.let { code ->
            runCatching { Pairing(Pairing.parseCode(code), app.prefs.inboxRelay, app.prefs.deviceName) }.getOrNull()
        } ?: Pairing(Pairing.generate().secret, app.prefs.inboxRelay, app.prefs.deviceName).also {
            app.prefs.inboxCode = it.compactCode
            logi("inbox: new pairing ${it.keys.inboxTopic}")
        }
        _pairing.value = p
        return p
    }

    /** A new secret: every sender has to pair again. */
    @Synchronized
    fun resetPairing() {
        val old = _pairing.value ?: app.prefs.inboxCode?.let { runCatching { Pairing(Pairing.parseCode(it)) }.getOrNull() }
        val p = Pairing(Pairing.generate().secret, app.prefs.inboxRelay, app.prefs.deviceName)
        app.prefs.inboxCode = p.compactCode
        receiver = null
        _pairing.value = p
        // Reset pairing clears the Inbox's Lab store (F17): its states and hellos were the old pairing's.
        old?.let { app.labReporter.forget(it.keys.inboxTopic) }
        logi("inbox: pairing reset")
    }

    /** Uses a given pairing (debug setup link, or a relay or name change). */
    @Synchronized
    fun usePairing(p: Pairing) {
        val old = _pairing.value
        app.prefs.inboxCode = p.compactCode
        app.prefs.inboxRelay = p.relay
        receiver = null
        _pairing.value = Pairing(p.secret, p.relay, app.prefs.deviceName)
        // Another secret (the debug setup link): the old pairing's Lab store goes, as with Reset pairing.
        if (old != null && !old.sameSecret(p)) app.labReporter.forget(old.keys.inboxTopic)
    }

    /** The HTTP of the Inbox's relay clients (tests plug in a fake relay); null: the app's own. */
    @VisibleForTesting
    internal var http: Http? = null
        set(v) {
            field = v
            synchronized(this) { receiver = null }
        }

    /** The HTTP the Inbox's relay clients use (the Receiver's, and the Lab frames'). */
    fun relayHttp(): Http = http ?: UrlConnectionHttp("DaylightShare/${BuildConfig.VERSION_NAME} (inbox)")

    /** The relay check (PROTOCOL 3.4) of [relay]: null when it passes, else the failure with its sentence. */
    fun checkRelay(relay: String): ShareException? =
        runCatching { RelayProbe.check(relay, UrlConnectionHttp("DaylightShare/${BuildConfig.VERSION_NAME} (inbox)")) }
            .getOrElse { e -> e as? ShareException ?: ShareException("relay", RelayProbe.UNREACHABLE, RelayProbe.REASON_NETWORK) }

    /**
     * Settings › Relay › Save on the Inbox: a relay other than ntfy.sh is saved only when it passes the relay check
     * (it takes the largest frame a sender makes and gives it back). Returns null when saved, else the sentence to show;
     * the relay in use then stays.
     */
    suspend fun saveRelay(input: String, probe: (String) -> ShareException? = ::checkRelay): String? = withContext(Dispatchers.IO) {
        val r = try {
            Relay.normalize(input)
        } catch (e: ShareException) {
            return@withContext e.message ?: "That relay address isn’t valid."
        }
        if (r == app.prefs.inboxRelay) return@withContext null
        if (r != Limits.DEFAULT_RELAY) {
            val failure = runCatching { probe(r) }.getOrElse { e -> e as? ShareException ?: ShareException("relay", RelayProbe.UNREACHABLE, RelayProbe.REASON_NETWORK) }
            if (failure != null) {
                logi("inbox: relay $r not saved: ${failure.message}")
                return@withContext failure.message ?: RelayProbe.UNREACHABLE
            }
        }
        app.prefs.inboxRelay = r
        app.prefs.inboxRelayChecked = r
        app.prefs.inboxRelayWarning = null
        refreshPairing()
        logi("inbox: relay saved: $r")
        null
    }

    /** Re-reads the relay and the name from the settings. */
    fun refreshPairing() {
        val cur = ensurePairing()
        usePairing(Pairing(cur.secret, app.prefs.inboxRelay, app.prefs.deviceName))
    }

    @Synchronized
    fun receiver(): Receiver {
        val p = ensurePairing()
        receiver?.takeIf { it.pairing == p }?.let { return it }
        val r = Receiver(
            pairing = p,
            store = FileReceiverStore(File(dir, "receiver-${p.keys.inboxTopic}.json")),
            reassembler = Reassembler(File(dir, "spool")),
            relay = RelayClient(p.relay, relayHttp()),
            from = app.prefs.deviceName,
            accept = ::accept,
        )
        receiver = r
        return r
    }

    /** Polls once (catch-up). Returns the number of new items; errors land in [sync]. */
    suspend fun pollOnce(): Int = withContext(Dispatchers.IO) {
        sync.value = sync.value.copy(checking = true)
        try {
            val r = receiver().pollOnce()
            val stored = r.items.isNotEmpty()
            sync.value = sync.value.copy(
                lastCheck = System.currentTimeMillis(), checking = false,
                error = if (r.limited) InboxText.LIMITED else null,
                storeFull = if (r.storeError != null) true else if (stored) false else sync.value.storeFull,
            )
            if (stored || r.digestIds.isNotEmpty()) logi("inbox: poll found ${r.items.size} new, acked ${r.ackIds.size}, digest ${r.digestIds.size}")
            r.ackError?.let { logw("inbox: ack failed: $it (the next poll publishes the digest)") }
            r.storeError?.let { logw("inbox: could not store an item: $it (it comes back with the sender's next re-send)") }
            if (r.limited) logw("inbox: the relay is limiting this network (429/413 on a download)")
            // Lab (F17): once the poll's acks are out, the Lab frames follow, last on the relay budget.
            app.labReporter.afterPoll(ackFailed = r.ackError != null, limitStatus = r.limitStatus)
            r.items.size
        } catch (e: Exception) {
            logw("inbox: poll failed: ${e.message ?: e.javaClass.simpleName}" + ((e as? ShareException)?.status?.let { " (status $it)" } ?: ""))
            sync.value = sync.value.failed(e)
            app.labReporter.pollFailed((e as? ShareException)?.status ?: 0)
            0
        }
    }

    /** Handles messages from the live stream (blocking). Returns new item count; acks are published right away. */
    fun handleLive(msg: RelayMessage): Int {
        val r = receiver()
        val res = r.handleLive(listOf(msg))
        if (res.ackIds.isNotEmpty()) {
            // sendAcks, not publishAcks: Lab needs the ack publish's 429 or 413 too (LAB-PROTOCOL 2.2.4).
            val out = r.sendAcks(res.ackIds)
            val error = out.error
            if (error != null) {
                // The next poll publishes the digest, which carries these ids (PROTOCOL 3.4 step 4).
                logw("inbox: ack failed: $error")
                r.ackFailed()
            }
            app.labReporter.afterLiveAcks(ackFailed = error != null, limitStatus = out.limitStatus)
        }
        app.labReporter.afterLive(limitStatus = res.limitStatus, flush = res.items.isNotEmpty() || res.ackIds.isNotEmpty())
        if (res.items.isNotEmpty()) sync.value = sync.value.copy(lastCheck = System.currentTimeMillis(), error = null, storeFull = false)
        if (res.storeError != null) {
            logw("inbox: could not store an item: ${res.storeError} (it comes back with the sender's next re-send)")
            sync.value = sync.value.copy(storeFull = true)
        }
        if (res.limited) sync.value = sync.value.copy(error = InboxText.LIMITED)
        return res.items.size
    }

    /**
     * Stores a complete item (called by the Receiver before it remembers or acks it). Throws to have it come back with
     * the sender's next re-send (a full disk). An id already in the list is not stored or queued for the Reader again
     * (the app stopped between storing an item and saving the receiver's state).
     */
    @VisibleForTesting
    internal fun accept(done: Reassembler.Completed) {
        val h = done.header
        val content = (done.content as? FileBody)?.file
        if (get(h.id) != null) {
            content?.delete()
            logi("received ${h.id} kind=${h.kind} again: already in the Inbox, not queued again")
            return
        }
        var rel: String? = null
        if (h.kind != Kind.URL) {
            val src = content ?: error("content not on disk")
            val folder = File(filesRoot, h.id)
            if (!folder.isDirectory && !folder.mkdirs()) throw IOException("could not create the item's folder")
            rel = if (h.kind == Kind.PAGE) {
                try {
                    File(folder, "page.html").writeBytes(withUtf8Meta(src.readBytes()))
                } finally {
                    src.delete()
                }
                "${h.id}/page.html"
            } else {
                "${h.id}/" + storeFile(src, folder, h.name ?: "document")
            }
        }
        val item = InboxItem(
            id = h.id, kind = h.kind, url = h.url, title = h.title, name = h.name, mime = h.mime, size = h.size ?: 0,
            from = h.from, app = h.app, sent = h.sent, received = System.currentTimeMillis(), file = rel,
        )
        update { list -> listOf(item) + list.filter { it.id != item.id } }
        if (sync.value.storeFull) sync.value = sync.value.copy(storeFull = false)
        logi("received ${h.id} kind=${h.kind} from=${h.from ?: "?"} size=${h.size ?: 0} stored")
    }

    /** Moves [src] to [dest] (tests replace it to make the file system refuse a name). */
    @VisibleForTesting
    internal var move: (src: File, dest: File) -> Unit = { src, dest ->
        if (dest.exists()) dest.delete()
        if (!src.renameTo(dest)) {
            src.copyTo(dest, overwrite = true)
            src.delete()
        }
    }

    /**
     * Stores [src] in [folder] under the safe [name] (the Reader sees it through FileProvider's DISPLAY_NAME). When the
     * file system refuses that name, it is stored as `document` plus the extension; the item keeps its name. Returns the
     * file's name.
     */
    private fun storeFile(src: File, folder: File, name: String): String {
        try {
            move(src, File(folder, name))
            return name
        } catch (e: IOException) {
            val dot = name.lastIndexOf('.')
            val fallback = "document" + if (dot > 0 && name.length - dot - 1 in 1..10) name.substring(dot) else ""
            if (fallback == name) throw e
            logw("could not store \"$name\" (${e.message}); stored as $fallback")
            File(folder, name).delete()
            move(src, File(folder, fallback))
            return fallback
        }
    }

    fun get(id: String): InboxItem? = _items.value.firstOrNull { it.id == id }

    /** Adds or replaces a row (tests; received items come through the Receiver). */
    @VisibleForTesting
    internal fun put(item: InboxItem) = update { list -> listOf(item) + list.filter { it.id != item.id } }

    fun waiting(): List<InboxItem> = _items.value.filter { it.state == InboxItem.WAITING }.sortedBy { it.received }

    fun fileOf(item: InboxItem): File? = item.file?.let { File(filesRoot, it) }?.takeIf { it.isFile }

    fun setItem(id: String, transform: (InboxItem) -> InboxItem) =
        update { list -> list.map { if (it.id == id) transform(it) else it } }

    fun remove(id: String) {
        update { list -> list.filter { it.id != id } }
        File(filesRoot, id).deleteRecursively()
    }

    /** Puts items back in the queue for the Reader ("Add to Reader" again). */
    fun requeue(id: String) = setItem(id) { it.copy(state = InboxItem.WAITING) }

    @Synchronized
    private fun update(transform: (List<InboxItem>) -> List<InboxItem>) {
        val now = System.currentTimeMillis()
        var list = transform(_items.value)
        // Keep 300 rows; content of items the Reader has had for a week is no longer needed.
        if (list.size > MAX_ITEMS) {
            list.drop(MAX_ITEMS).forEach { File(filesRoot, it.id).deleteRecursively() }
            list = list.take(MAX_ITEMS)
        }
        list = list.map {
            if (it.state == InboxItem.IN_READER && it.file != null && now - it.handedAt > WEEK) {
                File(filesRoot, it.id).deleteRecursively()
                it.copy(file = null)
            } else it
        }
        _items.value = list
        JsonFiles.write(itemsFile, mapOf("items" to list.map { it.toJson() }))
    }

    private fun load(): List<InboxItem> {
        val m = JsonFiles.readObject(itemsFile) ?: return emptyList()
        return (m["items"] as? List<*>)?.mapNotNull { e ->
            @Suppress("UNCHECKED_CAST")
            (e as? Map<String, Any?>)?.let(InboxItem::fromJson)
        } ?: emptyList()
    }

    companion object {
        const val MAX_ITEMS = 300
        private const val WEEK = 7L * 24 * 3600 * 1000
        private val META = "<meta charset=\"utf-8\">".toByteArray(Charsets.US_ASCII)
        private val DOCTYPE = "<!doctype".toByteArray(Charsets.US_ASCII)

        /**
         * The page as the Inbox stores it (PROTOCOL 3.4 step 5): `<meta charset="utf-8">` right after a leading
         * `<!doctype …>` (after an optional byte-order mark and whitespace; any case), else at the very start, so a
         * Reader that sniffs the encoding reads UTF-8 (the body is UTF-8 whatever its own meta says).
         */
        fun withUtf8Meta(html: ByteArray): ByteArray {
            var i = 0
            if (html.size >= 3 && html[0] == 0xEF.toByte() && html[1] == 0xBB.toByte() && html[2] == 0xBF.toByte()) i = 3
            while (i < html.size && html[i].toInt().toChar() in " \t\n\r\u000C") i++
            var at = 0
            if (i + DOCTYPE.size <= html.size && DOCTYPE.indices.all { k -> (html[i + k].toInt() or 0x20).toByte() == DOCTYPE[k] || html[i + k] == DOCTYPE[k] }) {
                val close = (i + DOCTYPE.size until html.size).firstOrNull { html[it] == '>'.code.toByte() }
                if (close != null) at = close + 1
            }
            return html.copyOfRange(0, at) + META + html.copyOfRange(at, html.size)
        }
    }
}
