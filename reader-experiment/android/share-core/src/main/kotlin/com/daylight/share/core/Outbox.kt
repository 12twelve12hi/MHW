package com.daylight.share.core

import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

/** Outbox row status values (the same strings as the JavaScript Sender). */
object Status {
    /** Being published (or waiting for its first publish). */
    const val SENDING = "sending"
    /** On the relay, not acknowledged yet. */
    const val SENT = "sent"
    /** The Daylight acknowledged it. */
    const val DELIVERED = "delivered"
    /** The last attempt failed; it is tried again by itself ([OutboxRow.errorCode] says when). */
    const val FAILED = "failed"
    /** Not delivered within 7 days, or given up ([OutboxRow.errorCode] says why); "Try again" may start it over. */
    const val EXPIRED = "expired"

    /** Rows that still wait for a publish or an ack: never dropped from the outbox. */
    val PENDING = setOf(SENDING, SENT, FAILED)
}

/** One lock object per canonical file path, so every object working on the same files takes turns (CHANGES-v1.1 note a). */
object FileLocks {
    private val locks = ConcurrentHashMap<String, Any>()

    fun of(file: File): Any {
        val key = runCatching { file.canonicalPath }.getOrDefault(file.absolutePath)
        return locks.computeIfAbsent(key) { Any() }
    }
}

/**
 * One shared item in the sender's outbox and history. [header] is part 0's header, reused for every re-send (same id,
 * same `sent`). Fields of CHANGES-v1.1 2.4; a field missing from a row saved by v1.0 reads as "" or 0.
 */
data class OutboxRow(
    val header: ItemHeader,
    val created: Long,
    val status: String = Status.SENDING,
    /** For failed and expired rows: "", or an [ErrorCode]. */
    val errorCode: String = "",
    /** Failed attempts since the last success (the network backoff). */
    val attempts: Int = 0,
    /** `full`/`refused` attempts in a row; the third makes the row expired. */
    val slowFails: Int = 0,
    /** When the last attempt ended: every wait counts from here. */
    val lastPublish: Long = 0,
    /** When the current attempt started or last made progress (a `sending` row is stale 15 minutes after it). */
    val attemptStarted: Long = 0,
    val attachment: Boolean = false,
    /** Technical detail for logs ("HTTP 503"); never shown: use [RowText]. */
    val error: String = "",
    val delivered: Long = 0,
    val deliveredBy: String = "",
    /**
     * Lab, F26's activity log (LAB-PROTOCOL 2.7.1, added Oct 22): the HTTP status of the row's last failed publish,
     * 413, 429, another 4xx, or 408 and 5xx after the in-call retries; 0 when that failure had no HTTP answer, 0 again
     * once a publish of the row goes, and 0 on a delivered row. Kept as it is when the row expires. A row stored
     * without it (v1.0, v1.1) reads as 0.
     */
    val http: Int = 0,
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
        "errorCode" to errorCode,
        "attempts" to attempts,
        "slowFails" to slowFails,
        "lastPublish" to lastPublish,
        "attemptStarted" to attemptStarted,
        "attachment" to attachment,
        "error" to error,
        "delivered" to delivered,
        "deliveredBy" to deliveredBy,
        "http" to http,
    )

    companion object {
        /** An HTTP status for [http]: 100 to 599, else 0 (no HTTP answer). */
        internal fun httpOf(status: Long): Int = if (status in 100..599) status.toInt() else 0

        fun fromJson(m: Map<String, Any?>): OutboxRow? {
            @Suppress("UNCHECKED_CAST")
            val raw = m["header"] as? Map<String, Any?> ?: return null
            // A v1.0 row may carry a size a v1.1 receiver refuses (a page over 8 MiB is impossible; a file over 9 MB
            // becomes expired / too-large when due), so the size is checked here only against what a receiver takes.
            val h = runCatching { ItemHeader.check(raw) }.getOrNull() ?: return null
            fun l(k: String) = (m[k] as? Double)?.toLong() ?: 0L
            return OutboxRow(
                header = h.copy(part = 0, parts = 1),
                created = l("created"),
                status = m["status"] as? String ?: Status.SENDING,
                errorCode = m["errorCode"] as? String ?: "",
                attempts = l("attempts").toInt(),
                slowFails = l("slowFails").toInt(),
                lastPublish = l("lastPublish"),
                attemptStarted = l("attemptStarted"),
                attachment = m["attachment"] == true,
                error = m["error"] as? String ?: "",
                delivered = l("delivered"),
                deliveredBy = m["deliveredBy"] as? String ?: "",
                http = httpOf(l("http")),
            )
        }
    }
}

/**
 * The outbox on disk: `outbox.json` (rows, newest first, and the ack cursor) and `content/<id>.enc` (the encoded body
 * of each item that may still need re-sending). [lock] is shared by every object on the same directory. The sender's
 * Lab ledger lives next to them in [labFile] (LAB-PROTOCOL 2.2.6), so [clear] removes it with the outbox.
 */
class FileOutboxStore(val dir: File) {
    private val file = File(dir, "outbox.json")
    val contentDir = File(dir, "content")
    val lock: Any = FileLocks.of(file)

    /** `lab.json`: the sender's Lab ledger (`lab.LabLedger.of(store)`), kept with the outbox and cleared with it. */
    val labFile: File get() = File(dir, "lab.json")

    fun load(): Pair<List<OutboxRow>, String> {
        synchronized(lock) {
            val m = JsonFiles.readObject(file) ?: return emptyList<OutboxRow>() to "all"
            val rows = (m["rows"] as? List<*>)?.mapNotNull { r ->
                @Suppress("UNCHECKED_CAST")
                (r as? Map<String, Any?>)?.let(OutboxRow::fromJson)
            } ?: emptyList()
            return rows to ((m["ackSince"] as? String) ?: "all")
        }
    }

    fun save(rows: List<OutboxRow>, ackSince: String) = synchronized(lock) {
        JsonFiles.write(file, linkedMapOf("rows" to rows.map { it.toJson() }, "ackSince" to ackSince))
    }

    fun contentFile(id: String) = File(contentDir, "$id.enc")

    /**
     * Deletes every row, all stored content, the ack cursor and the Lab ledger ([labFile]): pairing with a different
     * secret (PROTOCOL 3.3 step 6; LAB-PROTOCOL 2.2.6). The same secret keeps them all.
     */
    fun clear() = synchronized(lock) { dir.deleteRecursively() }
}

/**
 * What [Outbox.checkAcks] hands on (LAB-PROTOCOL 2.7.1): every ack-topic frame that decrypts and whose `kind` is "ack",
 * before any row is updated, with the message's relay [time] (Unix seconds) and ntfy message id. Lab frames are such
 * frames, so a sender's Lab ledger (`lab.LabLedger.hook()`) learns from every ack check, whether Lab is on or off.
 * [header] is untrusted: read it with `lab.LabFrame.parse`.
 */
fun interface AckHeaderListener {
    fun onAckHeader(header: Map<String, Any?>, time: Long, msgId: String)
}

/**
 * The sender (PROTOCOL 3.3; the rules of CHANGES-v1.1 2.4): publishes items, reads acks, re-sends what is due,
 * expires week-old items. Every public method is blocking and runs under the lock of its store's directory, shared by
 * every [Outbox] on those files; run them off the main thread.
 *
 * [onAckHeader] (Lab, LAB-PROTOCOL 2.7.1) sees every decrypted ack-topic frame whose kind is "ack"; what it throws is
 * caught and logged, and never stops the ack check.
 */
class Outbox(
    val pairing: Pairing,
    private val store: FileOutboxStore,
    val relay: RelayClient = RelayClient(pairing.relay),
    private val from: String = "",
    private val app: String = "",
    private val clock: () -> Long = System::currentTimeMillis,
    private val chunkSize: Int = Limits.CHUNK,
    private val onAckHeader: AckHeaderListener? = null,
) {
    private val keys = pairing.keys
    private val lock: Any = store.lock

    fun rows(): List<OutboxRow> = synchronized(lock) { store.load().first }

    fun row(id: String): OutboxRow? = rows().firstOrNull { it.id == id }

    /**
     * Validates and stores a new item (status "sending", not due for 15 minutes): [publish] sends it now. Content over
     * 9 MB is refused before anything is read or stored ([Text.tooBigMessage]). [content] is the item's bytes; with
     * [moveContent] a [FileBody] (a private copy of what was shared) is moved into the outbox instead of copied.
     * With [defer] (shared while offline, LAB-PLAN F07; the JS `send(item, {defer: true})`) the row is stored as
     * waiting for a connection instead: failed with [ErrorCode.NETWORK], 0 attempts and `lastPublish` now, its content
     * kept, for [flushNetwork] when the connection is back (or [resendDue]'s back-off after a minute).
     * Throws [ShareException] for bad input (nothing is stored, deferred or not), and "storage" when the content cannot
     * be stored.
     */
    fun add(item: OutgoingItem, content: Body?, moveContent: Boolean = false, defer: Boolean = false): OutboxRow = synchronized(lock) {
        if (content != null && item.kind != Kind.URL && content.length > Limits.MAX_ITEM) {
            throw ShareException("too-large", Text.tooBigMessage(content.length))
        }
        val workDir = File(store.dir, "work").also { it.mkdirs() }
        val prepared = try {
            ItemBuilder.prepare(item.copy(from = item.from ?: from, app = item.app ?: app), content, chunkSize = chunkSize, workDir = workDir, nowMs = clock())
        } catch (e: IOException) {
            throw ShareException("storage", OUT_OF_SPACE, cause = e)
        }
        if (prepared.header.kind != Kind.URL) {
            try {
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
            } catch (e: IOException) {
                store.contentFile(prepared.header.id).delete()
                throw ShareException("storage", OUT_OF_SPACE, cause = e)
            }
        }
        val now = clock()
        var row = OutboxRow(prepared.header, created = now, attemptStarted = now, attachment = prepared.attachment)
        if (defer) row = row.copy(status = Status.FAILED, errorCode = ErrorCode.NETWORK, lastPublish = now, error = DEFERRED)
        saveRow(row)
        row
    }

    /**
     * Shares one item now: [add], then one attempt. Returns the row. With [defer] (offline, F07) nothing is published:
     * the row waits for a connection ([add]).
     */
    fun send(item: OutgoingItem, content: Body?, moveContent: Boolean = false, defer: Boolean = false): OutboxRow = synchronized(lock) {
        val row = add(item, content, moveContent, defer)
        if (defer) row else attemptStored(row).row
    }

    /**
     * One attempt for item [id] now (the share's first publish, after [add]). A delivered row is left as it is. Returns
     * the updated row, or null when there is no such row.
     */
    fun publish(id: String): OutboxRow? {
        synchronized(lock) {
            val row = row(id) ?: return null
            if (row.status == Status.DELIVERED) return row
            return attemptStored(row).row
        }
    }

    private class Attempt(val row: OutboxRow, val error: ShareException?, val attempted: Boolean)

    /** Publishes the frames in part order and records the outcome (CHANGES-v1.1 2.4 `attempt`). */
    private fun attempt(start: OutboxRow, prepared: PreparedItem): Attempt {
        var row = start.copy(status = Status.SENDING, attemptStarted = clock(), attachment = prepared.attachment)
        saveRow(row)
        var error: ShareException? = null
        try {
            for (part in 0 until prepared.parts) {
                relay.publish(keys.inboxTopic, prepared.frame(keys, part))
                row = row.copy(attemptStarted = clock()) // progress: `sending` is stale 15 minutes after this
                saveRow(row)
            }
        } catch (e: ShareException) {
            error = e
        } catch (e: IOException) {
            // The stored content could not be read: tried again later; when it is gone, the row ends as gone.
            error = ShareException(ErrorCode.NETWORK, "could not read the content: ${e.message}", cause = e)
        }
        row = if (error == null) {
            row.copy(status = Status.SENT, errorCode = "", attempts = 0, slowFails = 0, error = "", http = 0)
        } else {
            val code = if (error.code in SENDER_CODES) error.code else ErrorCode.NETWORK
            val slow = if (code in SLOW_CODES) row.slowFails + 1 else 0
            row.copy(
                status = if (slow >= Limits.SLOW_FAIL_LIMIT) Status.EXPIRED else Status.FAILED,
                errorCode = code, attempts = row.attempts + 1, slowFails = slow, error = error.message ?: code,
                http = OutboxRow.httpOf(error.status.toLong()),
            )
        }
        row = row.copy(lastPublish = clock())
        saveRow(row)
        return Attempt(row, error, true)
    }

    /** A row's frames ([prepared]), or null with the row as it was ended ([row]). */
    private class Stored(val prepared: PreparedItem?, val row: OutboxRow)

    /**
     * A row's frames from its stored content (the JS `_buildStored`), or none after ending the row (no content: expired
     * / gone; over 9 MB: expired / too-large). The stored header carries the row's Lab fields, so every attempt writes
     * the same ones.
     */
    private fun prepareStored(row: OutboxRow): Stored {
        fun end(code: String, dropContent: Boolean): Stored {
            val r = row.copy(status = Status.EXPIRED, errorCode = code)
            saveRow(r)
            if (dropContent) store.contentFile(row.id).delete()
            return Stored(null, r)
        }
        val body: Body = if (row.kind == Kind.URL) BytesBody(ByteArray(0)) else {
            val f = store.contentFile(row.id)
            if (!f.isFile) return end(ErrorCode.GONE, false)
            FileBody(f)
        }
        if (row.size > Limits.MAX_ITEM) return end(ErrorCode.TOO_LARGE, true)
        val prepared = PreparedItem(row.header, body, chunkSize)
        if (prepared.parts > Limits.MAX_PARTS) return end(ErrorCode.TOO_LARGE, true)
        return Stored(prepared, row)
    }

    /** Re-sends a row from its stored content, or ends it (no content: gone; over 9 MB: too-large). */
    private fun attemptStored(row: OutboxRow): Attempt {
        val stored = prepareStored(row)
        val prepared = stored.prepared ?: return Attempt(stored.row, null, false)
        return attempt(row, prepared)
    }

    private fun due(row: OutboxRow, now: Long): Boolean = when (row.status) {
        Status.SENDING -> now - (row.attemptStarted.takeIf { it != 0L } ?: row.lastPublish.takeIf { it != 0L } ?: row.created) >= Limits.SENDING_STALE_MS
        Status.SENT -> if (!row.attachment) now - row.lastPublish >= Limits.RESEND_MESSAGE_MS
        else now - row.lastPublish >= (if (row.lastPublish - row.created < Limits.RESEND_FAST_WINDOW_MS) Limits.ATTACHMENT_WAIT_MS else Limits.RESEND_SLOW_MS)
        Status.FAILED -> if (row.errorCode in SLOW_CODES) now - row.lastPublish >= Limits.ATTACHMENT_WAIT_MS
        else now - row.lastPublish >= 60_000L * minOf(60L, 1L shl minOf(maxOf(row.attempts, 0), 6))
        else -> false
    }

    /**
     * Reads the ack topic (the download outcomes and cursor rule of PROTOCOL 3.2) and marks acknowledged rows
     * delivered, dropping their content. Returns how many became delivered. Throws [RelayException] when the poll fails.
     */
    fun checkAcks(): Int = synchronized(lock) {
        val since = store.load().second
        val msgs = relay.poll(keys.ackTopic, since)
        val acked = LinkedHashMap<String, String>()
        var newest = 0L
        var held: Long? = null
        for (m in msgs) {
            newest = maxOf(newest, m.time)
            if (m.retry) held = minOf(held ?: m.time, m.time)
            val frame = m.frame ?: continue
            if (m.outcome != Outcome.FRAME) continue
            val opened = try {
                FrameCodec.open(keys, Purpose.ACK, frame)
            } catch (e: ShareException) {
                continue
            }
            if (opened.header["kind"] != "ack") continue
            if (onAckHeader != null) {
                try {
                    onAckHeader.onAckHeader(opened.header, m.time, m.id)
                } catch (e: Exception) {
                    LOG.warning("onAckHeader failed: $e")
                }
            }
            val by = Text.cleanName(opened.header["from"] as? String)
            AckHeader.idsOf(opened.header)?.forEach { acked[it] = by }
        }
        val (rows, _) = store.load()
        val nextSince = if (msgs.isNotEmpty()) RelayClient.nextCursor(since, newest, held) else since
        val now = clock()
        val delivered = ArrayList<String>()
        val updated = rows.map { r ->
            if (r.status != Status.DELIVERED && acked.containsKey(r.id)) {
                delivered += r.id
                r.copy(status = Status.DELIVERED, delivered = now, deliveredBy = acked[r.id] ?: "", errorCode = "", http = 0)
            } else r
        }
        writeRows(updated, nextSince)
        for (id in delivered) store.contentFile(id).delete()
        delivered.size
    }

    /**
     * One re-send pass, oldest row first (PROTOCOL 3.3 steps 3-4): expires week-old rows, drops expired rows' content
     * 14 days after the share, re-sends rows that are due; after a 429 it publishes nothing more, and after a 413 no
     * attachment. Returns the rows it attempted.
     */
    fun resendDue(): List<OutboxRow> = synchronized(lock) {
        var stopAll = false
        var stopAttachments = false
        val out = ArrayList<OutboxRow>()
        for (row in store.load().first.asReversed().sortedBy { it.created }) {
            val now = clock()
            if (row.status == Status.DELIVERED) continue
            if (row.status == Status.EXPIRED) {
                if (now - row.created > Limits.CONTENT_KEEP_MS) store.contentFile(row.id).delete()
                continue
            }
            if (now - row.created > Limits.OUTBOX_EXPIRY_MS) {
                saveRow(row.copy(status = Status.EXPIRED, errorCode = ""))
                continue
            }
            if (!due(row, now)) continue
            if (stopAll || (stopAttachments && row.attachment)) continue
            val r = attemptStored(row)
            if (r.attempted) out += r.row
            if (r.error?.status == 429) stopAll = true
            else if (r.error?.code == ErrorCode.FULL) stopAttachments = true
        }
        cleanUp()
        out
    }

    /**
     * Coming back online (LAB-PLAN F07; the JS `flushNetwork`): attempts the rows waiting with [ErrorCode.NETWORK]
     * (status failed) now, oldest first, whatever their back-off. A pass stops before a row that would take it over
     * [maxFrames] frames or [maxAttachmentBytes] bytes of attachment frames (a pass always takes its first row, so a row
     * larger than the caps cannot block the queue). It follows [resendDue]'s pass rules: after a 429 it publishes
     * nothing more, and after a 413 no more attachments. Rows past the week are left to [resendDue], which expires them.
     * Space passes at least [FLUSH_SPACING_MS] apart: in that time ntfy.sh's request bucket refills by 36, so a pass of
     * 30 never meets an empty bucket. Returns the rows it attempted.
     */
    fun flushNetwork(maxFrames: Int = FLUSH_MAX_FRAMES, maxAttachmentBytes: Long = FLUSH_MAX_ATTACHMENT_BYTES): List<OutboxRow> = synchronized(lock) {
        var stopAll = false
        var stopAttachments = false
        var frames = 0
        var bytes = 0L
        val out = ArrayList<OutboxRow>()
        for (row in store.load().first.asReversed().sortedBy { it.created }) {
            if (stopAll) break
            if (row.status != Status.FAILED || row.errorCode != ErrorCode.NETWORK) continue
            if (clock() - row.created > Limits.OUTBOX_EXPIRY_MS) continue
            if (stopAttachments && row.attachment) continue
            val prepared = prepareStored(row).prepared ?: continue
            val attachmentBytes = (0 until prepared.parts).sumOf { p -> prepared.frameLength(p).let { if (FrameCodec.isSmall(it)) 0L else it } }
            if (stopAttachments && attachmentBytes > 0) continue
            val first = out.isEmpty()
            if (!first && (frames + prepared.parts > maxFrames || bytes + attachmentBytes > maxAttachmentBytes)) break
            frames += prepared.parts
            bytes += attachmentBytes
            val r = attempt(row, prepared)
            out += r.row
            if (r.error?.status == 429) stopAll = true
            else if (r.error?.code == ErrorCode.FULL) stopAttachments = true
        }
        out
    }

    /**
     * "Retry now" (a failed row) and "Try again" (an expired row with error code "", full or refused): publishes it
     * again with the same id and header. Any other row is left as it is (a sending, sent or delivered row is never
     * uploaded again by a tap). Returns the row, or null when there is none.
     */
    fun retry(id: String): OutboxRow? {
        synchronized(lock) {
            val row = row(id) ?: return null
            return when {
                row.status == Status.FAILED -> attemptStored(row).row
                row.status == Status.EXPIRED && row.errorCode in RESTARTABLE ->
                    attemptStored(row.copy(created = clock(), attempts = 0, slowFails = 0, errorCode = "")).row
                else -> row
            }
        }
    }

    /** Removes an item from the outbox and its history, with its content. Returns whether there was such a row. */
    fun remove(id: String): Boolean = synchronized(lock) {
        val (rows, since) = store.load()
        val left = rows.filter { it.id != id }
        if (left.size != rows.size) store.save(left, since)
        store.contentFile(id).delete()
        left.size != rows.size
    }

    /** One [tick]: how many rows became delivered, how many were sent again ([resentRows], each with its `http`), the first error. */
    class Tick(val delivered: Int, val resent: Int, val error: String?, val resentRows: List<OutboxRow> = emptyList())

    /** One maintenance pass: acks (errors ignored), then re-sends. Call on start, after a share, and from the worker. */
    fun tick(): Tick = synchronized(lock) {
        var error: String? = null
        val delivered = try {
            checkAcks()
        } catch (e: ShareException) {
            error = e.message
            0
        }
        val resent = resendDue()
        if (error == null) error = resent.firstOrNull { it.status == Status.FAILED }?.error
        Tick(delivered, resent.size, error, resent)
    }

    /** Whether anything still waits for a publish or an ack. */
    fun hasPending(): Boolean = rows().any { it.status in Status.PENDING }

    /** Writes [row] in place (a new row goes first) and applies the cap. */
    private fun saveRow(row: OutboxRow): OutboxRow {
        val (rows, since) = store.load()
        val list = ArrayList<OutboxRow>(rows.size + 1)
        val i = rows.indexOfFirst { it.id == row.id }
        if (i < 0) list += row
        rows.mapTo(list) { if (it.id == row.id) row else it }
        writeRows(list, since)
        return row
    }

    /** Every pending row, then the newest finished rows up to [Limits.OUTBOX_MAX_ROWS]; drops the rest with their content. */
    private fun writeRows(rows: List<OutboxRow>, since: String) {
        val sorted = rows.sortedByDescending { it.created }
        val pending = sorted.count { it.status in Status.PENDING }
        val room = maxOf(0, Limits.OUTBOX_MAX_ROWS - pending)
        val dropped = sorted.filter { it.status !in Status.PENDING }.drop(room).mapTo(HashSet()) { it.id }
        store.save(sorted.filter { it.id !in dropped }, since)
        for (id in dropped) store.contentFile(id).delete()
    }

    /** Deletes content files no row needs (no row, delivered) and stale temporary files. */
    private fun cleanUp() {
        val now = clock()
        val keep = store.load().first.filter { it.status != Status.DELIVERED }.mapTo(HashSet()) { it.id }
        store.contentDir.listFiles()?.forEach { f -> if (f.name.removeSuffix(".enc") !in keep) f.delete() }
        File(store.dir, "work").listFiles()?.forEach { f -> if (now - f.lastModified() > 3_600_000) f.delete() }
    }

    companion object {
        private val LOG: Logger = Logger.getLogger("DaylightShare")

        @Deprecated("Use Limits.OUTBOX_MAX_ROWS", ReplaceWith("Limits.OUTBOX_MAX_ROWS"))
        const val MAX_ROWS = Limits.OUTBOX_MAX_ROWS

        /** The sentence when the content cannot be copied into the outbox. */
        const val OUT_OF_SPACE = "This device is out of space, so it can’t send this."

        /** [OutboxRow.error] of a row shared while offline ([add] with defer), as the JS writes it. */
        const val DEFERRED = "deferred while offline"

        /** [flushNetwork]'s caps per pass (F07): 30 frames, 18 MB of attachment frames. */
        const val FLUSH_MAX_FRAMES = 30
        const val FLUSH_MAX_ATTACHMENT_BYTES = 18_000_000L

        /** The least time between two [flushNetwork] passes (F07). */
        const val FLUSH_SPACING_MS = 3 * 60_000L

        private val SENDER_CODES = setOf(ErrorCode.NETWORK, ErrorCode.FULL, ErrorCode.REFUSED)
        private val SLOW_CODES = setOf(ErrorCode.FULL, ErrorCode.REFUSED)
        private val RESTARTABLE = setOf("", ErrorCode.FULL, ErrorCode.REFUSED)
    }
}
