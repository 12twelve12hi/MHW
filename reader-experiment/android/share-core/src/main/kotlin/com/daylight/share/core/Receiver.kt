package com.daylight.share.core

import java.io.File

/**
 * What the receiver remembers between polls (PROTOCOL 3.2): the cursor, the item ids it has (14 days), the ntfy
 * message ids it has handled (2 days) and the earliest message time of each incomplete item (the cursor never passes
 * it).
 */
class ReceiverState(
    var since: String = "all",
    val seenItems: MutableMap<String, Long> = LinkedHashMap(),
    val seenMsgs: MutableMap<String, Long> = LinkedHashMap(),
    val incomplete: MutableMap<String, Long> = LinkedHashMap(),
) {
    fun toJson(): Map<String, Any?> = linkedMapOf(
        "since" to since,
        "seenItems" to LinkedHashMap(seenItems),
        "seenMsgs" to LinkedHashMap(seenMsgs),
        "incomplete" to LinkedHashMap(incomplete),
    )

    companion object {
        fun fromJson(m: Map<String, Any?>?): ReceiverState {
            if (m == null) return ReceiverState()
            fun longs(key: String): MutableMap<String, Long> {
                val out = LinkedHashMap<String, Long>()
                (m[key] as? Map<*, *>)?.forEach { (k, v) -> if (k is String && v is Double) out[k] = v.toLong() }
                return out
            }
            return ReceiverState((m["since"] as? String) ?: "all", longs("seenItems"), longs("seenMsgs"), longs("incomplete"))
        }
    }
}

/** Where [ReceiverState] lives. */
interface ReceiverStore {
    fun load(): ReceiverState
    fun save(state: ReceiverState)
}

/** [ReceiverStore] in a JSON file, written atomically. */
class FileReceiverStore(private val file: File) : ReceiverStore {
    @Synchronized
    override fun load(): ReceiverState = ReceiverState.fromJson(JsonFiles.readObject(file))

    @Synchronized
    override fun save(state: ReceiverState) = JsonFiles.write(file, state.toJson())
}

class MemoryReceiverStore(private var state: ReceiverState = ReceiverState()) : ReceiverStore {
    override fun load() = ReceiverState.fromJson(state.toJson())
    override fun save(state: ReceiverState) { this.state = ReceiverState.fromJson(state.toJson()) }
}

/**
 * The Daylight side (PROTOCOL 3.4, steps 1-3): reads the inbox topic, decodes and reassembles items, hands each new
 * complete item to [accept] (which must store it durably, or throw to have it tried again), and acknowledges
 * everything it has. Handing items to the Reader (step 4) is the app's job.
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

    class Result(val items: List<ItemHeader>, val ackIds: List<String>)

    /** Polls once, handles everything new and publishes the acks. Throws [RelayException] when the relay is unreachable. */
    @Synchronized
    fun pollOnce(): Result {
        val state = store.load()
        prune(state)
        val msgs = try {
            relay.poll(keys.inboxTopic, state.since) { it in state.seenMsgs }
        } catch (e: RelayException) {
            // A relay that rejects the cursor (400) is read from the start; dedupe makes that safe.
            if (e.status == 400 && state.since != "all") relay.poll(keys.inboxTopic, "all") { it in state.seenMsgs } else throw e
        }
        val result = handle(msgs, state)
        store.save(state)
        publishAcks(result.ackIds)
        return result
    }

    /** The cursor to resume a live stream from. */
    fun since(): String = store.load().since

    /** Whether [msgId] was handled already (the live stream skips downloading it). */
    fun handled(msgId: String): Boolean = store.load().seenMsgs.containsKey(msgId)

    /** Handles messages from the live stream; returns the ids to ack (publish them with [publishAcks], batched). */
    @Synchronized
    fun handleLive(msgs: List<RelayMessage>): Result {
        val state = store.load()
        val result = handle(msgs, state)
        store.save(state)
        return result
    }

    private fun handle(msgs: List<RelayMessage>, state: ReceiverState): Result {
        val now = clock()
        val items = ArrayList<ItemHeader>()
        val ack = LinkedHashSet<String>()
        var maxTime = 0L
        val incompleteHere = HashMap<String, Long>()
        for (m in msgs) {
            maxTime = maxOf(maxTime, m.time)
            if (m.skipped) continue
            val frame = m.frame ?: continue // expired attachment or not base64: not handled, the sender re-sends
            val opened = try {
                FrameCodec.open(keys, Purpose.INBOX, frame)
            } catch (e: ShareException) {
                state.seenMsgs[m.id] = now
                continue
            }
            val id = opened.header["id"] as? String
            if (id != null && state.seenItems.containsKey(id)) {
                state.seenMsgs[m.id] = now
                ack += id
                continue
            }
            val done = try {
                reassembler.add(opened.header, opened.body)
            } catch (e: ShareException) {
                state.seenMsgs[m.id] = now // invalid header or failed integrity: junk
                continue
            }
            if (done == null) {
                if (id != null) {
                    incompleteHere[id] = minOf(incompleteHere[id] ?: m.time, m.time)
                    state.incomplete[id] = minOf(state.incomplete[id] ?: m.time, m.time)
                }
                continue
            }
            try {
                accept(done)
            } catch (e: Exception) {
                // Could not store it (disk full?): not handled; the cursor stays here and it is tried again.
                incompleteHere[done.header.id] = minOf(incompleteHere[done.header.id] ?: m.time, m.time)
                (done.content as? FileBody)?.file?.delete()
                continue
            }
            state.seenMsgs[m.id] = now
            state.incomplete.remove(done.header.id)
            state.seenItems[done.header.id] = now
            ack += done.header.id
            items += done.header
        }
        // The cursor never passes the earliest part of an item that is still incomplete.
        var cursor = maxTime
        for (t in incompleteHere.values) cursor = minOf(cursor, t)
        for (t in state.incomplete.values) if (t > 0) cursor = minOf(cursor, t)
        if (cursor > 0) {
            val next = maxOf(0L, cursor - 5)
            val prev = state.since.toLongOrNull()
            // Never move a numeric cursor backwards past what a previous poll already handled, except for incompletes.
            state.since = if (prev != null && next < prev && incompleteHere.isEmpty() && state.incomplete.isEmpty()) prev.toString() else next.toString()
        }
        return Result(items, ack.toList())
    }

    /** Publishes acks for [ids], at most 200 per frame. Throws [RelayException]. */
    fun publishAcks(ids: Collection<String>) {
        val list = ids.distinct()
        var i = 0
        while (i < list.size) {
            val slice = list.subList(i, minOf(list.size, i + Limits.MAX_ACK_IDS))
            relay.publish(keys.ackTopic, AckHeader.frame(keys, slice, from, clock()))
            i += Limits.MAX_ACK_IDS
        }
    }

    private fun prune(state: ReceiverState) {
        val now = clock()
        state.seenItems.entries.removeAll { now - it.value > Limits.SEEN_TTL_MS }
        state.seenMsgs.entries.removeAll { now - it.value > Limits.SEEN_MSG_TTL_MS }
        // An item whose parts never all arrived is given up after a day (the relay keeps attachments 3 hours).
        state.incomplete.entries.removeAll { now / 1000 - it.value > 24 * 3600 }
        reassembler.prune()
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
