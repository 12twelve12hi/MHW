package com.daylight.share.core

import java.io.File

/**
 * What the receiver remembers between polls (PROTOCOL 3.2; CHANGES-v1.1 2.6): the cursor, the item ids it has (14 days
 * after the latest sighting), the ntfy message ids it has handled (2 days), the earliest message time (relay seconds)
 * of each incomplete item (the cursor never passes it; given up after 24 h), the messages that carried held parts
 * ([partMsgs]: message id -> item id and when it was seen, kept 2 days) and when the ack digest last went out.
 */
class ReceiverState(
    var since: String = "all",
    val seenItems: MutableMap<String, Long> = LinkedHashMap(),
    val seenMsgs: MutableMap<String, Long> = LinkedHashMap(),
    val incomplete: MutableMap<String, Long> = LinkedHashMap(),
    val partMsgs: MutableMap<String, PartMsg> = LinkedHashMap(),
    var lastDigest: Long = 0,
) {
    /** A message that carried a part of [item], first seen at [seen] (ms). */
    data class PartMsg(val item: String, val seen: Long)

    fun toJson(): Map<String, Any?> = linkedMapOf(
        "since" to since,
        "seenItems" to LinkedHashMap(seenItems),
        "seenMsgs" to LinkedHashMap(seenMsgs),
        "incomplete" to LinkedHashMap(incomplete),
        "partMsgs" to partMsgs.mapValuesTo(LinkedHashMap()) { (_, p) -> linkedMapOf("item" to p.item, "seen" to p.seen) },
        "lastDigest" to lastDigest,
    )

    companion object {
        fun fromJson(m: Map<String, Any?>?): ReceiverState {
            if (m == null) return ReceiverState()
            fun longs(key: String): MutableMap<String, Long> {
                val out = LinkedHashMap<String, Long>()
                (m[key] as? Map<*, *>)?.forEach { (k, v) -> if (k is String && v is Number) out[k] = v.toLong() }
                return out
            }
            val parts = LinkedHashMap<String, PartMsg>()
            (m["partMsgs"] as? Map<*, *>)?.forEach { (k, v) ->
                val e = v as? Map<*, *>
                val item = e?.get("item") as? String
                val seen = (e?.get("seen") as? Number)?.toLong()
                if (k is String && item != null && seen != null) parts[k] = PartMsg(item, seen)
            }
            return ReceiverState(
                (m["since"] as? String) ?: "all", longs("seenItems"), longs("seenMsgs"), longs("incomplete"), parts,
                (m["lastDigest"] as? Number)?.toLong() ?: 0L,
            )
        }
    }
}

/** Where [ReceiverState] lives. [lock] is shared by every [Receiver] on the same state. */
interface ReceiverStore {
    fun load(): ReceiverState
    fun save(state: ReceiverState)
    val lock: Any get() = this
}

/** [ReceiverStore] in a JSON file, written atomically; its lock is per file ([FileLocks]). */
class FileReceiverStore(private val file: File) : ReceiverStore {
    override val lock: Any = FileLocks.of(file)

    override fun load(): ReceiverState = synchronized(lock) { ReceiverState.fromJson(JsonFiles.readObject(file)) }

    override fun save(state: ReceiverState) = synchronized(lock) { JsonFiles.write(file, state.toJson()) }
}

class MemoryReceiverStore(private var state: ReceiverState = ReceiverState()) : ReceiverStore {
    override fun load() = synchronized(lock) { ReceiverState.fromJson(state.toJson()) }
    override fun save(state: ReceiverState) = synchronized(lock) { this.state = ReceiverState.fromJson(state.toJson()) }
}

/**
 * The Daylight side (PROTOCOL 3.4, steps 1-4; the rules of CHANGES-v1.1 2.6): reads the inbox topic, decodes and
 * reassembles items, hands each new complete item to [accept] (which must store it durably, or throw: then the item's
 * messages are handled, but its id is not remembered and it is not acked, so it comes back with the sender's next
 * re-send), acknowledges everything it has, and re-publishes a digest of recent ids every 11 hours and after any
 * failed ack. Handing items to the Reader (step 5) is the app's job. Every method runs under the state's lock.
 */
class Receiver(
    val pairing: Pairing,
    private val store: ReceiverStore,
    private val reassembler: Reassembler = Reassembler(),
    val relay: RelayClient = RelayClient(pairing.relay),
    private val from: String = "Daylight",
    private val clock: () -> Long = System::currentTimeMillis,
    private val accept: (Reassembler.Completed) -> Unit,
) {
    private val keys = pairing.keys
    private val lock: Any = store.lock

    /**
     * [items]: new items, stored. [ackIds]: this poll's ids whose ack was published. [digestIds]: older ids the digest
     * re-published. [ackError]: why an ack could not be published (null when all went out). [storeError]: why [accept]
     * failed for an item (null when every item was stored). [limited]: a download answered 429 or 413 (the relay is
     * limiting this network; what it held back arrives later).
     */
    class Result(
        val items: List<ItemHeader>,
        val ackIds: List<String>,
        val ackError: String? = null,
        val storeError: String? = null,
        val digestIds: List<String> = emptyList(),
        val limited: Boolean = false,
    )

    /**
     * Polls once, handles everything new, saves the state, then publishes the acks (and the digest when due). Throws
     * [RelayException] only when the poll itself fails; acks never throw.
     */
    fun pollOnce(): Result = synchronized(lock) {
        val state = store.load()
        val now = clock()
        prune(state, now)
        val msgs = relay.poll(keys.inboxTopic, state.since) { id -> handledOrHeld(state, id) }
        val handled = handle(msgs, state, now)
        store.save(state)

        val acks = handled.ackIds
        var digest = emptyList<String>()
        val digestDue = now - state.lastDigest >= Limits.DIGEST_INTERVAL_MS
        if (digestDue) {
            val own = acks.toHashSet()
            digest = state.seenItems.entries
                .filter { (id, t) -> now - t in 0..Limits.DIGEST_WINDOW_MS && id !in own }
                .sortedByDescending { it.value }
                .take(Limits.DIGEST_MAX_IDS)
                .map { it.key }
        }
        val (published, ackError) = publishAcksOrError(acks + digest)
        if (ackError != null) state.lastDigest = 0
        else if (digestDue) state.lastDigest = now
        if (ackError != null || digestDue) store.save(state)
        val sent = published.toHashSet()
        Result(handled.items, acks.filter { it in sent }, ackError, handled.storeError, digest.filter { it in sent }, handled.limited)
    }

    /** The cursor to resume a live stream from. */
    fun since(): String = store.load().since

    /** Whether [msgId] needs no download: handled already, or it carried a part that is still held. */
    fun handled(msgId: String): Boolean = handledOrHeld(store.load(), msgId)

    private fun handledOrHeld(state: ReceiverState, msgId: String): Boolean =
        msgId in state.seenMsgs || state.partMsgs[msgId]?.let { reassembler.isPending(it.item) } == true

    /**
     * Handles messages from the live stream with the same rules as a poll (download outcomes, holds, cursor). Returns
     * the ids to ack: publish them with [publishAcks] and call [ackFailed] when that fails.
     */
    fun handleLive(msgs: List<RelayMessage>): Result = synchronized(lock) {
        val state = store.load()
        val r = handle(msgs, state, clock())
        store.save(state)
        r
    }

    /** An ack could not be published (the live path): the next poll publishes the digest, which includes it. */
    fun ackFailed() = synchronized(lock) {
        val state = store.load()
        state.lastDigest = 0
        store.save(state)
    }

    private fun handle(msgs: List<RelayMessage>, state: ReceiverState, now: Long): Result {
        val items = ArrayList<ItemHeader>()
        val ack = LinkedHashSet<String>()
        var newest = 0L
        var held: Long? = null
        var storeError: String? = null
        fun handled(ids: Collection<String>) {
            for (id in ids) state.seenMsgs[id] = now
        }
        /** The messages that carried held parts of [item] (they become handled with it); forgets them as parts. */
        fun partsOf(item: String): List<String> {
            val ids = state.partMsgs.filterValues { it.item == item }.keys.toList()
            ids.forEach { state.partMsgs.remove(it) }
            return ids
        }
        var limited = false
        for (m in msgs) {
            newest = maxOf(newest, m.time)
            if (m.status == 429 || m.status == 413) limited = true
            when (m.outcome) {
                Outcome.SKIPPED -> continue
                Outcome.RETRY -> {
                    held = minOf(held ?: m.time, m.time)
                    continue
                }
                Outcome.EXPIRED, Outcome.JUNK -> {
                    handled(listOf(m.id))
                    continue
                }
                Outcome.FRAME -> Unit
            }
            val frame = m.frame ?: run { handled(listOf(m.id)); null } ?: continue
            val opened = try {
                FrameCodec.open(keys, Purpose.INBOX, frame)
            } catch (e: ShareException) {
                handled(listOf(m.id))
                continue
            }
            val rawId = opened.header["id"] as? String
            if (rawId != null && state.seenItems.containsKey(rawId)) {
                state.seenItems[rawId] = now
                handled(listOf(m.id))
                ack += rawId
                continue
            }
            val done = try {
                reassembler.add(opened.header, opened.body)
            } catch (e: ShareException) {
                // A bad header, or the item failed its check: its messages are handled and its held parts dropped.
                handled(listOf(m.id) + (rawId?.let(::partsOf) ?: emptyList()))
                if (rawId != null) {
                    reassembler.drop(rawId)
                    state.incomplete.remove(rawId)
                }
                continue
            }
            if (done == null) {
                if (rawId != null) {
                    state.incomplete[rawId] = minOf(state.incomplete[rawId] ?: m.time, m.time)
                    state.partMsgs[m.id] = ReceiverState.PartMsg(rawId, now)
                }
                continue
            }
            val id = done.header.id
            handled(listOf(m.id) + partsOf(id))
            state.incomplete.remove(id)
            try {
                accept(done)
            } catch (e: Exception) {
                // Could not store it (disk full?): not remembered, not acked; it comes back with the next re-send.
                storeError = e.message ?: e.javaClass.simpleName
                (done.content as? FileBody)?.file?.delete()
                continue
            }
            state.seenItems[id] = now
            ack += id
            items += done.header
        }
        for (t in state.incomplete.values) held = minOf(held ?: t, t)
        if (msgs.isNotEmpty()) state.since = RelayClient.nextCursor(state.since, newest, held)
        return Result(items, ack.toList(), null, storeError, limited = limited)
    }

    /**
     * Publishes acks for [ids] in frames of at most [Limits.MAX_ACK_IDS] (always small frames: messages), stopping at
     * the first failure. Never throws. Returns the error, or null when every frame went out.
     */
    fun publishAcks(ids: Collection<String>): String? = publishAcksOrError(ids).second

    private fun publishAcksOrError(ids: Collection<String>): Pair<List<String>, String?> {
        val list = ids.distinct()
        val published = ArrayList<String>()
        var i = 0
        while (i < list.size) {
            val slice = list.subList(i, minOf(list.size, i + Limits.MAX_ACK_IDS))
            try {
                relay.publish(keys.ackTopic, AckHeader.frame(keys, slice, from, clock()))
            } catch (e: ShareException) {
                return published to (e.message ?: e.code)
            } catch (e: RuntimeException) {
                return published to (e.message ?: e.javaClass.simpleName)
            }
            published += slice
            i += Limits.MAX_ACK_IDS
        }
        return published to null
    }

    private fun prune(state: ReceiverState, now: Long) {
        state.seenItems.entries.removeAll { now - it.value > Limits.SEEN_TTL_MS }
        state.seenMsgs.entries.removeAll { now - it.value > Limits.SEEN_MSG_TTL_MS }
        state.partMsgs.entries.removeAll { now - it.value.seen > Limits.SEEN_MSG_TTL_MS }
        // An item whose parts never all arrived is given up a day after its first part (attachments live 3 hours).
        val givenUp = state.incomplete.filter { (_, t) -> now - t * 1000 > Limits.INCOMPLETE_TTL_MS }.keys
        for (id in givenUp) {
            state.incomplete.remove(id)
            reassembler.drop(id)
        }
        for (id in reassembler.prune(Limits.INCOMPLETE_TTL_MS)) state.incomplete.remove(id)
    }
}

/** Small JSON-file helpers shared by the stores. */
object JsonFiles {
    fun readObject(file: File): Map<String, Any?>? {
        if (!file.isFile) {
            val bak = File(file.parentFile, file.name + ".bak")
            return if (bak.isFile) runCatching { Json.parseObjectOrNull(bak.readText()) }.getOrNull() else null
        }
        return runCatching { Json.parseObjectOrNull(file.readText()) }.getOrNull()
    }

    /** Writes via a temporary file and a rename, keeping the previous version as `.bak` until the rename succeeds. */
    fun write(file: File, value: Any?) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(Json.write(value))
        val bak = File(file.parentFile, file.name + ".bak")
        if (file.exists()) {
            bak.delete()
            file.renameTo(bak)
        }
        if (!tmp.renameTo(file)) {
            file.writeText(Json.write(value))
            tmp.delete()
        }
        bak.delete()
    }
}
