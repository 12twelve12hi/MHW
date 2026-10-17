package com.daylight.share.inbox

import com.daylight.share.App
import com.daylight.share.BuildConfig
import com.daylight.share.core.FileBody
import com.daylight.share.core.FileReceiverStore
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.JsonFiles
import com.daylight.share.core.Kind
import com.daylight.share.core.Pairing
import com.daylight.share.core.Reassembler
import com.daylight.share.core.Receiver
import com.daylight.share.core.RelayClient
import com.daylight.share.core.RelayMessage
import com.daylight.share.core.ShareException
import com.daylight.share.core.UrlConnectionHttp
import com.daylight.share.logi
import com.daylight.share.logw
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import java.io.File

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
) {
    val displayTitle: String
        get() = title?.takeIf { it.isNotBlank() } ?: name?.takeIf { it.isNotBlank() } ?: url ?: "Untitled"

    fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "kind" to kind, "url" to url, "title" to title, "name" to name, "mime" to mime, "size" to size,
        "from" to from, "app" to app, "sent" to sent, "received" to received, "file" to file, "state" to state,
        "deliveredTo" to deliveredTo, "via" to via, "readerStatus" to readerStatus, "handedAt" to handedAt,
    )

    companion object {
        /** Waiting for the hand-off to the Reader. */
        const val WAITING = "waiting"
        /** Handed to the Reader. */
        const val IN_READER = "in_reader"
        /** No Reader takes it: it stays here, to open with another app. */
        const val OPEN = "open"

        fun fromJson(m: Map<String, Any?>): InboxItem? {
            val id = m["id"] as? String ?: return null
            if (!ItemHeader.isId(id)) return null
            fun s(k: String) = m[k] as? String
            fun l(k: String) = (m[k] as? Double)?.toLong() ?: 0L
            return InboxItem(
                id = id, kind = s("kind") ?: Kind.URL, url = s("url"), title = s("title"), name = s("name"), mime = s("mime"),
                size = l("size"), from = s("from"), app = s("app"), sent = s("sent") ?: "", received = l("received"),
                file = s("file"), state = s("state") ?: WAITING, deliveredTo = s("deliveredTo"), via = s("via"),
                readerStatus = s("readerStatus"), handedAt = l("handedAt"),
            )
        }
    }
}

/** Connection state for the UI. */
data class SyncState(val live: Boolean = false, val lastCheck: Long = 0, val error: String? = null, val checking: Boolean = false)

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
        val p = Pairing(Pairing.generate().secret, app.prefs.inboxRelay, app.prefs.deviceName)
        app.prefs.inboxCode = p.compactCode
        receiver = null
        _pairing.value = p
        logi("inbox: pairing reset")
    }

    /** Uses a given pairing (debug setup link, or a relay or name change). */
    @Synchronized
    fun usePairing(p: Pairing) {
        app.prefs.inboxCode = p.compactCode
        app.prefs.inboxRelay = p.relay
        receiver = null
        _pairing.value = Pairing(p.secret, p.relay, app.prefs.deviceName)
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
            relay = RelayClient(p.relay, UrlConnectionHttp("DaylightShare/${BuildConfig.VERSION_NAME} (inbox)")),
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
            sync.value = sync.value.copy(lastCheck = System.currentTimeMillis(), error = null, checking = false)
            if (r.items.isNotEmpty()) logi("inbox: poll found ${r.items.size} new, acked ${r.ackIds.size}")
            r.items.size
        } catch (e: ShareException) {
            logw("inbox: poll failed: ${e.message}")
            sync.value = sync.value.copy(error = e.message, checking = false)
            0
        } catch (e: Exception) {
            logw("inbox: poll failed", e)
            sync.value = sync.value.copy(error = e.message ?: e.javaClass.simpleName, checking = false)
            0
        }
    }

    /** Handles messages from the live stream (blocking). Returns new item count; acks are published right away. */
    fun handleLive(msg: RelayMessage): Int {
        val r = receiver()
        val res = r.handleLive(listOf(msg))
        if (res.ackIds.isNotEmpty()) {
            try {
                r.publishAcks(res.ackIds)
            } catch (e: ShareException) {
                logw("inbox: ack failed: ${e.message}") // the next poll acks again
            }
        }
        if (res.items.isNotEmpty()) sync.value = sync.value.copy(lastCheck = System.currentTimeMillis(), error = null)
        return res.items.size
    }

    /** Stores a complete item (called by the Receiver before it acks). Throws to have it tried again. */
    private fun accept(done: Reassembler.Completed) {
        val h = done.header
        var rel: String? = null
        if (h.kind != Kind.URL) {
            val src = (done.content as? FileBody)?.file ?: error("content not on disk")
            val folder = File(filesRoot, h.id).apply { mkdirs() }
            val fileName = if (h.kind == Kind.PAGE) "page.html" else (h.name ?: "document")
            val dest = File(folder, fileName)
            if (dest.exists()) dest.delete()
            if (!src.renameTo(dest)) {
                src.copyTo(dest, overwrite = true)
                src.delete()
            }
            rel = "${h.id}/$fileName"
        }
        val item = InboxItem(
            id = h.id, kind = h.kind, url = h.url, title = h.title, name = h.name, mime = h.mime, size = h.size ?: 0,
            from = h.from, app = h.app, sent = h.sent, received = System.currentTimeMillis(), file = rel,
        )
        update { list -> listOf(item) + list.filter { it.id != item.id } }
        logi("received ${h.id} kind=${h.kind} from=${h.from ?: "?"} size=${h.size ?: 0} stored")
    }

    fun get(id: String): InboxItem? = _items.value.firstOrNull { it.id == id }

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
    }
}
