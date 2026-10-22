package com.daylight.share.core.lab

import com.daylight.share.core.AckHeaderListener
import com.daylight.share.core.FileLocks
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.Json
import com.daylight.share.core.JsonFiles
import java.io.File

/**
 * Where a Lab structure keeps its state: one JSON object, in a file (next to the outbox for a sender's [LabLedger], in
 * the Inbox's files for a [LabInbox]) or in memory (tests). Every read and write of one store runs under its [lock].
 */
interface LabStore {
    val lock: Any
    fun load(): Map<String, Any?>?
    fun save(value: Map<String, Any?>)
    fun clear()
}

/** A [LabStore] in a JSON file, written atomically; its lock is per file, shared by every object on it. */
class FileLabStore(val file: File) : LabStore {
    override val lock: Any = FileLocks.of(file)
    override fun load(): Map<String, Any?>? = synchronized(lock) { JsonFiles.readObject(file) }
    override fun save(value: Map<String, Any?>) = synchronized(lock) { JsonFiles.write(file, value) }
    override fun clear() {
        synchronized(lock) {
            file.delete()
            File(file.parentFile, file.name + ".bak").delete()
        }
    }
}

/** A [LabStore] in memory (tests); it keeps a JSON copy, so callers never share mutable state with it. */
class MemoryLabStore : LabStore {
    override val lock: Any = Any()
    private var text: String? = null

    @Suppress("UNCHECKED_CAST")
    override fun load(): Map<String, Any?>? = synchronized(lock) { text?.let { Json.parse(it) as Map<String, Any?> } }
    override fun save(value: Map<String, Any?>) = synchronized(lock) { text = Json.write(value) }
    override fun clear() = synchronized(lock) { text = null }
}

internal fun Any?.asLong(): Long? = when (this) {
    is Double -> if (isNaN() || isInfinite()) null else toLong()
    is Number -> toLong()
    else -> null
}

/**
 * What a sender learns from the ack topic (LAB-PROTOCOL 2.2.6), per publisher. Wire it into the [com.daylight.share.core.Outbox]
 * with `onAckHeader = ledger.hook()`: it records every ack-topic message that decrypts, whether Lab is on or off, so
 * turning Lab on shows correct states at once. The store ([of]: `lab.json` next to the outbox) holds:
 *   inbox  {android?, reader-lab?, other?: {lab, app, caps, poll (ms, clamped to `at`) | null, live, at (ms)}}
 *   heard  the latest relay time (ms) of any ack-topic message that decrypted
 *   states {id: {s, t}}
 * A pairing with another secret removes it with the outbox ([FileOutboxStore.clear]). Methods are blocking.
 */
class LabLedger(private val store: LabStore, private val clock: () -> Long = System::currentTimeMillis) {
    /** One publisher's last hello (2.2.6): [poll] is clamped to [at], the relay time (ms) of its message. */
    data class Publisher(val publisher: String, val lab: Int, val app: String, val caps: List<String>, val poll: Long?, val live: Boolean, val at: Long) {
        fun toJson(): Map<String, Any?> = linkedMapOf("lab" to lab, "app" to app, "caps" to caps, "poll" to poll, "live" to live, "at" to at)
    }

    /** An item's state as the ledger keeps it: token [s] and [t] in Unix seconds. */
    data class Entry(val s: String, val t: Long)

    /**
     * Everything a screen needs in one read. [inboxLab]: some fresh publisher (heard within 36 h) has lab >= 1. [caps]:
     * the union of the caps of those publishers, sorted. [checkedIn]: the later of `heard` and the newest clamped
     * `poll` (ms), or null. [states]: every item's state; show one only on a row whose status is delivered.
     */
    data class Snapshot(val publishers: List<Publisher>, val inboxLab: Boolean, val caps: List<String>, val checkedIn: Long?, val states: Map<String, Entry>) {
        fun hasCap(token: String): Boolean = token in caps
        fun state(id: String): Entry? = states[id]
    }

    /**
     * Records one ack-topic header that decrypted. [time]: the message's relay time in Unix seconds (now when null). A
     * header whose kind is not "ack" is ignored. Never throws on the header's content.
     */
    fun record(header: Map<String, Any?>?, time: Long?) {
        if (header == null || header["kind"] != "ack") return
        synchronized(store.lock) {
            val st = load()
            val at = if (time != null) time * 1000 else clock()
            var changed = false
            if (at > st.heard) {
                st.heard = at
                changed = true
            }
            val parsed = LabFrame.parse(header)
            parsed.inbox?.let { inbox ->
                val pub = Lab.publisherOf(inbox.app)
                val cur = st.inbox[pub]
                if (cur == null || at >= cur.at) {
                    st.inbox[pub] = Publisher(pub, inbox.lab, inbox.app, inbox.caps, inbox.poll?.let { minOf(it, at) }, inbox.live, at)
                    changed = true
                }
            }
            for (e in parsed.states) {
                val cur = st.states[e.i]?.let { LabState(e.i, it.s, it.t) }
                if (Lab.beats(e, cur)) {
                    st.states[e.i] = Entry(e.s, e.t)
                    changed = true
                }
            }
            if (parsed.states.isNotEmpty()) bound(st.states, Lab.LEDGER_STATES_HARD_MAX)
            if (changed) save(st)
        }
    }

    /** The Outbox's `onAckHeader` for this ledger (the JS `labHook`). */
    fun hook(): AckHeaderListener = AckHeaderListener { header, time, _ -> record(header, time) }

    /** -> the publishers heard, in [Lab.PUBLISHERS] order. */
    fun publishers(): List<Publisher> = synchronized(store.lock) { load().inbox.let { m -> Lab.PUBLISHERS.mapNotNull { m[it] } } }

    fun snapshot(): Snapshot = synchronized(store.lock) {
        val st = load()
        val now = clock()
        val pubs = Lab.PUBLISHERS.mapNotNull { st.inbox[it] }
        val live = pubs.filter { now - it.at <= Lab.INBOX_STALE_MS && it.lab >= 1 }
        val caps = live.flatMap { it.caps }.toSortedSet().toList()
        var checked: Long? = if (st.heard > 0) st.heard else null
        for (p in pubs) if (p.poll != null && (checked == null || p.poll > checked)) checked = p.poll
        Snapshot(pubs, live.isNotEmpty(), caps, checked, LinkedHashMap(st.states))
    }

    fun inboxLab(): Boolean = snapshot().inboxLab
    fun caps(): List<String> = snapshot().caps
    fun hasCap(token: String): Boolean = token in caps()
    fun checkedIn(): Long? = snapshot().checkedIn

    /** -> the state of item [id], or null. Show it only on rows whose status is delivered ([LabRowText] does). */
    fun state(id: String): Entry? = synchronized(store.lock) { load().states[id] }

    /** Keeps the states of [ids] only (the outbox's ids and the hosted outbox's), at most 200, the latest first. */
    fun prune(ids: Collection<String>) {
        synchronized(store.lock) {
            val keep = ids.toHashSet()
            val st = load()
            st.states.keys.retainAll(keep)
            bound(st.states, Lab.LEDGER_STATES_MAX)
            save(st)
        }
    }

    /** Forgets everything (a pairing with another secret; [FileOutboxStore.clear] already deletes the file). */
    fun clear() = store.clear()

    // ------------------------------------------------------------------------------------------------------- storage

    private class State(var heard: Long, val inbox: LinkedHashMap<String, Publisher>, val states: LinkedHashMap<String, Entry>)

    private fun load(): State {
        val m = runCatching { store.load() }.getOrNull() ?: emptyMap()
        val inbox = LinkedHashMap<String, Publisher>()
        (m["inbox"] as? Map<*, *>)?.forEach { (k, v) ->
            val e = v as? Map<*, *> ?: return@forEach
            if (k !is String || k !in Lab.PUBLISHERS) return@forEach
            val at = e["at"].asLong() ?: return@forEach
            inbox[k] = Publisher(
                k, e["lab"].asLong()?.toInt() ?: 0, e["app"] as? String ?: "", (e["caps"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                e["poll"].asLong(), e["live"] == true, at,
            )
        }
        val states = LinkedHashMap<String, Entry>()
        (m["states"] as? Map<*, *>)?.forEach { (k, v) ->
            val e = v as? Map<*, *> ?: return@forEach
            val s = e["s"] as? String ?: return@forEach
            val t = e["t"].asLong() ?: return@forEach
            if (k is String) states[k] = Entry(s, t)
        }
        return State(m["heard"].asLong() ?: 0L, inbox, states)
    }

    private fun save(st: State) {
        store.save(
            linkedMapOf(
                "inbox" to st.inbox.mapValuesTo(LinkedHashMap()) { it.value.toJson() },
                "heard" to st.heard,
                "states" to st.states.mapValuesTo(LinkedHashMap()) { (_, e) -> linkedMapOf("s" to e.s, "t" to e.t) },
            ),
        )
    }

    companion object {
        /** The ledger of an outbox: `lab.json` in its directory (LAB-PROTOCOL 2.7.3), cleared with the outbox. */
        fun of(outbox: FileOutboxStore, clock: () -> Long = System::currentTimeMillis): LabLedger = LabLedger(FileLabStore(outbox.labFile), clock)

        /** Keeps at most [max] entries, the latest `t` first (ties: the smaller id first). */
        private fun bound(map: LinkedHashMap<String, Entry>, max: Int) {
            if (map.size <= max) return
            val keep = map.entries.sortedWith(compareByDescending<Map.Entry<String, Entry>> { it.value.t }.thenBy { it.key })
                .take(max).map { it.key }.toHashSet()
            map.keys.retainAll(keep)
        }
    }
}
