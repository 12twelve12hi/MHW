package com.daylight.share.core

import java.io.File

/** Outbox row status values (the same strings as the JavaScript Sender). */
object Status {
    /** Waiting to be published (or being published). */
    const val SENDING = "sending"
    /** On the relay, not acknowledged yet. */
    const val SENT = "sent"
    /** The Daylight acknowledged it. */
    const val DELIVERED = "delivered"
    /** The last publish failed; it is tried again with backoff. */
    const val FAILED = "failed"
    /** Not delivered within 7 days; "Try again" publishes it once more. */
    const val EXPIRED = "expired"
}

/** One shared item in the sender's outbox and history. [header] is part 0's header, reused for every re-send. */
data class OutboxRow(
    val header: ItemHeader,
    val created: Long,
    val status: String = Status.SENDING,
    val lastPublish: Long = 0,
    val attachment: Boolean = false,
    val attempts: Int = 0,
    val error: String = "",
    val delivered: Long = 0,
    val deliveredBy: String = "",
) {
    val id: String get() = header.id
    val kind: String get() = header.kind
    val title: String get() = header.title ?: ""
    val url: String get() = header.url ?: ""
    val name: String get() = header.name ?: ""
    val size: Long get() = header.size ?: 0

    fun toJson(): Map<String, Any?> = linkedMapOf(
        "header" to header.toJson(false),
        "created" to created,
        "status" to status,
        "lastPublish" to lastPublish,
        "attachment" to attachment,
        "attempts" to attempts,
        "error" to error,
        "delivered" to delivered,
        "deliveredBy" to deliveredBy,
    )

    companion object {
        fun fromJson(m: Map<String, Any?>): OutboxRow? {
            @Suppress("UNCHECKED_CAST")
            val h = (m["header"] as? Map<String, Any?>)?.let { runCatching { ItemHeader.check(it) }.getOrNull() } ?: return null
            return OutboxRow(
                header = h.copy(part = 0, parts = 1),
                created = (m["created"] as? Double)?.toLong() ?: 0,
                status = m["status"] as? String ?: Status.SENDING,
                lastPublish = (m["lastPublish"] as? Double)?.toLong() ?: 0,
                attachment = m["attachment"] == true,
                attempts = (m["attempts"] as? Double)?.toInt() ?: 0,
                error = m["error"] as? String ?: "",
                delivered = (m["delivered"] as? Double)?.toLong() ?: 0,
                deliveredBy = m["deliveredBy"] as? String ?: "",
            )
        }
    }
}

/**
 * The outbox on disk: `outbox.json` (rows, newest first, and the ack cursor) and `content/<id>.enc` (the encoded body
 * of each item that may still need re-sending).
 */
class FileOutboxStore(val dir: File) {
    private val file = File(dir, "outbox.json")
    val contentDir = File(dir, "content")

    @Synchronized
    fun load(): Pair<List<OutboxRow>, String> {
        val m = JsonFiles.readObject(file) ?: return emptyList<OutboxRow>() to "all"
        val rows = (m["rows"] as? List<*>)?.mapNotNull { r ->
            @Suppress("UNCHECKED_CAST")
            (r as? Map<String, Any?>)?.let(OutboxRow::fromJson)
        } ?: emptyList()
        return rows to ((m["ackSince"] as? String) ?: "all")
    }

    @Synchronized
    fun save(rows: List<OutboxRow>, ackSince: String) {
        JsonFiles.write(file, linkedMapOf("rows" to rows.map { it.toJson() }, "ackSince" to ackSince))
    }

    fun contentFile(id: String) = File(contentDir, "$id.enc")
}

/**
 * The sender (PROTOCOL 3.3): publishes items, reads acks, re-sends what the relay is about to forget, expires week-old
 * items. Every method is blocking and synchronized; run them off the main thread.
 */
class Outbox(
    val pairing: Pairing,
    private val store: FileOutboxStore,
    val relay: RelayClient = RelayClient(pairing.relay),
    private val from: String = "",
    private val app: String = "",
    private val clock: () -> Long = System::currentTimeMillis,
    private val chunkSize: Int = Limits.CHUNK,
) {
    private val keys = pairing.keys

    @Synchronized
    fun rows(): List<OutboxRow> = store.load().first

    @Synchronized
    fun row(id: String): OutboxRow? = rows().firstOrNull { it.id == id }

    /**
     * Validates and stores a new item (status "sending"); [publish] or [tick] sends it. [content] is the item's bytes;
     * with [moveContent] a [FileBody] (a private copy of what was shared) is moved into the outbox instead of copied.
     * Throws [ShareException] for bad input.
     */
    @Synchronized
    fun add(item: OutgoingItem, content: Body?, moveContent: Boolean = false): OutboxRow {
        val workDir = File(store.dir, "work").also { it.mkdirs() }
        val prepared = ItemBuilder.prepare(
            item.copy(from = item.from ?: from, app = item.app ?: app), content, chunkSize = chunkSize, workDir = workDir, nowMs = clock(),
        )
        if (prepared.header.kind != Kind.URL) {
            store.contentDir.mkdirs()
            val dest = store.contentFile(prepared.header.id)
            val enc = prepared.encoded
            if (enc is FileBody && (enc.file.parentFile == workDir || (moveContent && enc === content))) {
                dest.delete()
                if (!enc.file.renameTo(dest)) {
                    enc.file.copyTo(dest, overwrite = true)
                    enc.file.delete()
                }
            } else {
                enc.open().use { input -> dest.outputStream().use { input.copyTo(it) } }
            }
        }
        val row = OutboxRow(prepared.header, created = clock(), attachment = prepared.attachment)
        saveRow(row)
        return row
    }

    /** Publishes every part of item [id] now (fresh nonces). Returns the updated row; relay failures mark it failed. */
    @Synchronized
    fun publish(id: String): OutboxRow? {
        val row = row(id) ?: return null
        val prepared = preparedOf(row) ?: return saveRow(row.copy(status = Status.EXPIRED, error = "The content is gone; share it again."))
        val updated = try {
            for (part in 0 until prepared.parts) relay.publish(keys.inboxTopic, prepared.frame(keys, part))
            row.copy(status = Status.SENT, error = "", attachment = prepared.attachment)
        } catch (e: ShareException) {
            row.copy(status = Status.FAILED, error = e.message ?: e.code)
        }
        return saveRow(updated.copy(lastPublish = clock(), attempts = row.attempts + 1))
    }

    private fun preparedOf(row: OutboxRow): PreparedItem? {
        if (row.kind == Kind.URL) return PreparedItem(row.header, BytesBody(ByteArray(0)), chunkSize)
        val f = store.contentFile(row.id)
        if (!f.isFile) return null
        return PreparedItem(row.header, FileBody(f), chunkSize)
    }

    /** Reads the ack topic and marks acknowledged rows delivered. Returns how many became delivered. */
    @Synchronized
    fun checkAcks(): Int {
        val (_, since) = store.load()
        val msgs = relay.poll(keys.ackTopic, since)
        val acked = HashMap<String, String>()
        var maxTime = 0L
        for (m in msgs) {
            maxTime = maxOf(maxTime, m.time)
            val frame = m.frame ?: continue
            val opened = try {
                FrameCodec.open(keys, Purpose.ACK, frame)
            } catch (e: ShareException) {
                continue
            }
            val by = Text.cleanName(opened.header["from"] as? String)
            AckHeader.idsOf(opened.header)?.forEach { acked[it] = by }
        }
        val (rows, _) = store.load()
        var n = 0
        val now = clock()
        val updated = rows.map { r ->
            if (r.status != Status.DELIVERED && acked.containsKey(r.id)) {
                n++
                store.contentFile(r.id).delete()
                r.copy(status = Status.DELIVERED, delivered = now, deliveredBy = acked[r.id] ?: "", error = "")
            } else r
        }
        store.save(updated, if (maxTime > 0) maxOf(0L, maxTime - 5).toString() else since)
        return n
    }

    /** Publishes what is due: new rows, failed rows after their backoff, and re-sends before the relay forgets. */
    @Synchronized
    fun resendDue(): List<OutboxRow> {
        val now = clock()
        val out = ArrayList<OutboxRow>()
        for (row in rows()) {
            if (row.status == Status.DELIVERED || row.status == Status.EXPIRED) continue
            if (now - row.created > Limits.OUTBOX_EXPIRY_MS) {
                saveRow(row.copy(status = Status.EXPIRED))
                continue
            }
            val wait = when {
                row.status == Status.FAILED -> 60_000L * minOf(60L, 1L shl minOf(row.attempts, 6))
                row.attachment -> Limits.RESEND_ATTACHMENT_MS
                else -> Limits.RESEND_MESSAGE_MS
            }
            if (row.lastPublish != 0L && now - row.lastPublish < wait) continue
            publish(row.id)?.let { out += it }
        }
        prune()
        return out
    }

    /** "Retry" / "Try again": publishes item [id] now; an expired item gets another 7 days. */
    @Synchronized
    fun retry(id: String): OutboxRow? {
        val row = row(id) ?: return null
        if (row.status == Status.DELIVERED) return row
        if (row.status == Status.EXPIRED) saveRow(row.copy(created = clock(), status = Status.SENDING))
        return publish(id)
    }

    /** Removes an item from the outbox and its history. */
    @Synchronized
    fun remove(id: String) {
        val (rows, since) = store.load()
        store.contentFile(id).delete()
        store.save(rows.filter { it.id != id }, since)
    }

    class Tick(val delivered: Int, val resent: Int, val error: String?)

    /** One maintenance pass: acks, then re-sends. Call on start, after a share, and from the periodic worker. */
    @Synchronized
    fun tick(): Tick {
        var error: String? = null
        val delivered = try {
            checkAcks()
        } catch (e: ShareException) {
            error = e.message
            0
        }
        val resent = resendDue()
        if (error == null) error = resent.firstOrNull { it.status == Status.FAILED }?.error
        return Tick(delivered, resent.size, error)
    }

    /** Whether anything still waits for an ack or a publish. */
    @Synchronized
    fun hasPending(): Boolean = rows().any { it.status == Status.SENDING || it.status == Status.SENT || it.status == Status.FAILED }

    private fun saveRow(row: OutboxRow): OutboxRow {
        val (rows, since) = store.load()
        val list = ArrayList<OutboxRow>(rows.size + 1)
        list += row
        rows.filterTo(list) { it.id != row.id }
        list.sortByDescending { it.created }
        store.save(list.take(MAX_ROWS), since)
        return row
    }

    /** Drops the content of rows that no longer need it (and of rows beyond the history limit). */
    private fun prune() {
        val now = clock()
        val (rows, _) = store.load()
        val keep = rows.filter { r ->
            r.status != Status.DELIVERED && !(r.status == Status.EXPIRED && now - r.created > 2 * Limits.OUTBOX_EXPIRY_MS)
        }.map { it.id }.toSet()
        store.contentDir.listFiles()?.forEach { f -> if (f.name.removeSuffix(".enc") !in keep) f.delete() }
        File(store.dir, "work").listFiles()?.forEach { f -> if (now - f.lastModified() > 3600_000) f.delete() }
    }

    companion object {
        const val MAX_ROWS = 200
    }
}
