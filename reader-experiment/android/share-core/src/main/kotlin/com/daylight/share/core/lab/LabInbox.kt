package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.Keys
import com.daylight.share.core.RelayClient
import com.daylight.share.core.ShareException
import java.time.Instant
import java.time.ZoneOffset
import java.util.WeakHashMap

/**
 * The Inbox side of the Lab frames (LAB-PROTOCOL 2.2.4; the JS `LabInbox`, its reference): it records item states and
 * publishes hellos and state frames on the ack topic, last on the household's relay budget (2.1 rule 8, 2.2.7). Pure
 * JVM: Daylight Share's Inbox and the Lab Reader use the same class.
 *
 * - [store]: its state (`files/inbox/lab-<inboxTopic>.json` in the Inbox); [relay] and [keys]: the pairing's.
 * - [info]: the Inbox's current hello: its Lab level ([Lab.LAB_LEVEL] while the Inbox's Lab is on, 0 while it is
 *   off: a new or cleared store starts with Lab on exactly when it is 1 or more), `android/<versionName>`, its caps,
 *   and whether Instant delivery is live. `poll` defaults to the time [notePolled] last recorded.
 * - [schedule]: asks the app to call [flush] after a delay (2 s after [record], the spacing's wait, 30 s while more
 *   waits), replacing any earlier request; null means the app flushes at its own points only. With no network, the app
 *   schedules its `lab-flush` job (a CONNECTED constraint) when [flush] answers "error".
 * - [log]: one line per event (`lab: hello caps=…`, `lab: states n=… published`, `lab: state <id> <s>`, …).
 *
 * Rules: frames carry at most 24 states, oldest first, at most one every 30 s; nothing goes while the last poll's acks
 * failed or within an hour of a 429 or 413; at most 30 hellos and state frames a UTC day (digest frames and the lab: 0
 * frames are outside the cap); a batch that is not small is halved down to one entry, and an entry that still does not
 * fit is dropped; at most 500 pending entries (the oldest go first).
 *
 * Threads: every method is blocking. [record], [notePolled], [noteAcksFailed], [noteRelayLimit], [clear] and
 * [debugState] only read and write the store, under its lock, and never wait for the relay: [flush] holds that lock to
 * choose and build its frame and again to commit what went out, but not while it publishes. [flush], and [labTurnedOn],
 * [labTurnedOff] and [digest] (which flush), publish: with the pairing's [RelayClient] that can take about two minutes
 * (four attempts, 30 s reads, 1 + 2 + 4 s apart), so run them off the main thread. Flushes of one store run one at a
 * time (a second waits for the first); [clear] during a publish wins, and the publish's outcome is not written back.
 */
class LabInbox(
    private val store: LabStore,
    private val relay: RelayClient,
    private val keys: Keys,
    private val info: () -> LabInboxInfo,
    private val from: String = "",
    private val clock: () -> Long = System::currentTimeMillis,
    private val schedule: ((delayMs: Long) -> Unit)? = null,
    private val log: (String) -> Unit = {},
    private val buildFrame: (Keys, LabInboxInfo, List<LabState>, String, String) -> ByteArray = { k, inbox, states, f, sent ->
        LabFrame.build(k, inbox, states, f, sent)
    },
) {
    /** What one [flush] did: [published] 0 or 1 frame of [kind] ("off", "digest", "states", "hello") with [states] entries. */
    data class FlushResult(
        val published: Int,
        val kind: String?,
        val states: Int,
        /** "sent", "yield" (acks failed, or a 429/413 within the hour), "spacing" (30 s since the last Lab frame; see [waitMs]), "cap", "idle", "off" or "error" (the publish failed; entries are kept). */
        val reason: String,
        val waitMs: Long? = null,
        val error: Exception? = null,
    )

    /** The published entry of [LabState] with when it went out ([at], ms). */
    private data class Published(val i: String, val s: String, val t: Long, val at: Long) {
        val state: LabState get() = LabState(i, s, t)
    }

    private class LastInfo(val app: String, val caps: List<String>)

    private class State(
        var on: Boolean,
        var pending: MutableList<LabState>,
        var published: MutableList<Published>,
        var digest: MutableList<MutableList<LabState>>,
        var lastFrameAt: Long,
        var lastInfo: LastInfo?,
        var day: String,
        var dayCount: Int,
        var limitUntil: Long,
        var acksFailed: Boolean,
        var helloDue: Boolean,
        var offAt: Long,
        var offRepeats: Int,
        var offPending: Boolean,
        var lastPoll: Long?,
    )

    // --------------------------------------------------------------------------------------------------------- API

    /** The Inbox polled the inbox topic successfully at [ms]: the hello's `poll`. */
    fun notePolled(ms: Long = clock()) = update { it.lastPoll = ms }

    /**
     * Records that item [id] reached state [s] at [t] (Unix seconds). It replaces a pending entry for the same id, and
     * is kept at all, only when it beats both the pending and the last published entry (a higher rank, or the same rank
     * with a later t), so a re-announced item never goes back from held to waiting. Ignored while Lab is off and for a
     * bad entry. -> true when recorded; then a flush is scheduled in 2 s.
     */
    fun record(id: String, s: String, t: Long): Boolean {
        val e = try {
            LabState.checked(id, s, t)
        } catch (x: ShareException) {
            log("lab: bad state $id $s")
            return false
        }
        val recorded = synchronized(store.lock) {
            val st = load()
            if (!st.on) return@synchronized false
            val pending = st.pending.firstOrNull { it.i == e.i }
            val published = st.published.lastOrNull { it.i == e.i }?.state
            if (!Lab.beats(e, pending) || !Lab.beats(e, published)) return@synchronized false
            st.pending.removeAll { it.i == e.i }
            st.pending.add(e)
            if (st.pending.size > Lab.PENDING_MAX) st.pending.subList(0, st.pending.size - Lab.PENDING_MAX).clear()
            save(st)
            true
        }
        if (recorded) {
            log("lab: state ${e.i} ${e.s}")
            schedule?.invoke(Lab.LAB_FLUSH_DELAY_MS)
        }
        return recorded
    }

    /** The last poll's acks failed to publish (true) or went out (false). While true, Lab frames give way. */
    fun noteAcksFailed(failed: Boolean = true) = update { it.acksFailed = failed }

    /** A 429 or 413 from the relay (any publish or poll of this Inbox): Lab frames give way for an hour. */
    fun noteRelayLimit(status: Int) {
        if (status != 429 && status != 413) return
        update { it.limitUntil = maxOf(it.limitUntil, clock() + Lab.LAB_YIELD_MS) }
    }

    /** Lab was turned on: a hello goes at the next flush (this one). */
    fun labTurnedOn(): FlushResult {
        update {
            it.on = true
            it.helloDue = true
            it.offPending = false
            it.offAt = 0
            it.offRepeats = 0
        }
        return flush()
    }

    /** Lab was turned off: one frame with lab: 0 and caps: [], repeated after each ack digest for 48 h ([digest]). */
    fun labTurnedOff(): FlushResult {
        update {
            it.on = false
            it.pending = ArrayList()
            it.digest = ArrayList()
            it.helloDue = false
            it.offPending = true
            it.offAt = clock()
            it.offRepeats = 0
        }
        return flush()
    }

    /**
     * Call with the v1.1 ack digest (every 11 hours). Lab on: queues the latest state of every item whose state changed
     * in the last 48 hours (at most 48, newest first, 24 a frame), pending ones included. Lab off within 48 h of turning
     * it off: queues the lab: 0 frame again (at most 5 times). Then flushes.
     */
    fun digest(): FlushResult {
        update { st ->
            val now = clock()
            if (st.on) {
                val latest = LinkedHashMap<String, LabState>()
                for (e in st.published.map { it.state } + st.pending + st.digest.flatten()) { // a digest still queued is folded in
                    if (e.t * 1000 < now - Lab.STATE_DIGEST_WINDOW_MS) continue
                    if (Lab.beats(e, latest[e.i])) latest[e.i] = e
                }
                val all = latest.values.sortedWith(compareByDescending<LabState> { it.t }.thenBy { it.i }).take(Lab.STATE_DIGEST_MAX)
                val taken = all.mapTo(HashSet()) { it.i }
                st.pending.removeAll { it.i in taken }
                st.digest = all.chunked(Lab.MAX_ST_PER_FRAME).mapTo(ArrayList()) { it.toMutableList() }
            } else if (st.offAt != 0L && now - st.offAt <= Lab.LAB_OFF_REPEAT_MS && st.offRepeats < Lab.LAB_OFF_REPEATS) {
                st.offPending = true
                st.offRepeats += 1
            }
        }
        return flush()
    }

    /**
     * Publishes at most one Lab frame, in this order: the lab: 0 frame; a digest frame; pending states (a state frame);
     * a hello when one is due (Lab turned on, caps or app changed, or the last Lab frame is over 11 hours old). Never
     * throws for the relay: a failed publish answers "error" and keeps the entries. Schedules the next flush while more
     * waits.
     */
    fun flush(): FlushResult {
        val (r, next) = synchronized(flushLockOf(store.lock)) { flushOnce() }
        next?.let { schedule?.invoke(it) }
        return r
    }

    /** Forgets everything (Reset pairing clears the Inbox's Lab store). */
    fun clear() = store.clear()

    /** The stored state as JSON, for tests and diagnostics. */
    fun debugState(): Map<String, Any?> = synchronized(store.lock) { toJson(load()) }

    // ------------------------------------------------------------------------------------------------------- flush

    private fun currentInfo(st: State): LabInboxInfo {
        val i = info()
        return LabInboxInfo(i.lab, i.app, i.caps, i.poll ?: st.lastPoll, i.live)
    }

    /** A frame [plan] chose and built: [kind], the [batch] it carries, the [hello] it says, at [now]. */
    private class Plan(val kind: String, val batch: List<LabState>, val hello: LabInboxInfo, val frame: ByteArray, val now: Long)

    /**
     * One flush, under the store's flush lock: [plan] (the store's lock), the publish (no lock but the flush lock, so
     * [record] and the notes go on meanwhile), then [commit] (the store's lock) on the state as it is by then.
     */
    private fun flushOnce(): Pair<FlushResult, Long?> {
        val (none, p) = synchronized(store.lock) { plan() }
        if (p == null) return none!! to none.waitMs // the spacing's wait, else nothing to schedule
        try {
            relay.publish(keys.ackTopic, p.frame)
        } catch (e: Exception) {
            val status = (e as? ShareException)?.status ?: 0
            synchronized(store.lock) {
                val st = loadIfKept()
                if (st != null && (status == 429 || status == 413)) {
                    st.limitUntil = maxOf(st.limitUntil, p.now + Lab.LAB_YIELD_MS)
                    save(st)
                }
            }
            log("lab: publish failed ${e.message ?: e.javaClass.simpleName}")
            return FlushResult(0, null, 0, "error", error = e) to null
        }
        return synchronized(store.lock) { commit(p) }
    }

    /**
     * Chooses the frame that goes next and builds it (halving a batch that is not small, dropping an entry that alone
     * does not fit), or answers why nothing goes. Saves the state either way (the new UTC day, the pruned published list).
     */
    private fun plan(): Pair<FlushResult?, Plan?> {
        val st = load()
        val now = clock()
        val day = utcDay(now)
        if (st.day != day) {
            st.day = day
            st.dayCount = 0
        }
        st.published.removeAll { !(it.t * 1000 >= now - Lab.STATE_DIGEST_WINDOW_MS || it.at >= now - Lab.STATE_DIGEST_WINDOW_MS) }
        fun none(reason: String, waitMs: Long? = null): Pair<FlushResult?, Plan?> {
            save(st)
            return FlushResult(0, null, 0, reason, waitMs) to null
        }
        val info = currentInfo(st)
        while (true) {
            val kind: String
            var batch: List<LabState> = emptyList()
            when {
                !st.on -> {
                    if (!st.offPending) return none("off")
                    kind = "off"
                }
                st.digest.isNotEmpty() -> {
                    kind = "digest"
                    batch = st.digest[0].toList()
                }
                st.pending.isNotEmpty() -> {
                    kind = "states"
                    batch = st.pending.take(Lab.MAX_ST_PER_FRAME)
                }
                st.helloDue || st.lastInfo == null || st.lastInfo!!.app != Lab.readApp(info.app) ||
                    st.lastInfo!!.caps != Lab.readCaps(info.caps) || now - st.lastFrameAt > Lab.HELLO_EVERY_MS -> kind = "hello"
                else -> return none("idle")
            }
            if (st.acksFailed || now < st.limitUntil) return none("yield")
            if (st.lastFrameAt != 0L && now - st.lastFrameAt < Lab.LAB_FRAME_GAP_MS) {
                return none("spacing", st.lastFrameAt + Lab.LAB_FRAME_GAP_MS - now)
            }
            if ((kind == "states" || kind == "hello") && st.dayCount >= Lab.LAB_FRAMES_PER_DAY) return none("cap")

            val hello = if (kind == "off") info.copy(lab = 0, caps = emptyList()) else info
            var frame: ByteArray? = null
            while (frame == null) {
                try {
                    frame = buildFrame(keys, hello, batch, from, Bytes.isoTime(now))
                } catch (e: ShareException) {
                    if (e.reason != "not-small" || batch.isEmpty()) throw e
                    if (batch.size > 1) {
                        batch = batch.take((batch.size + 1) / 2)
                        continue
                    }
                    break
                }
            }
            if (frame == null) {
                val d = batch[0]
                log("lab: dropped state ${d.i} ${d.s}: the frame is not small")
                st.pending.removeAll { it.i == d.i }
                if (kind == "digest") {
                    st.digest[0].removeAll { it.i == d.i }
                    if (st.digest[0].isEmpty()) st.digest.removeAt(0)
                }
                continue // choose again, without the entry that does not fit
            }
            save(st)
            return null to Plan(kind, batch, hello, frame, now)
        }
    }

    /**
     * Records that [p] went out, on the state as it is now: [record] may have added entries meanwhile (kept when they
     * beat what went out), [digest] may have queued a new digest (the entries that went out leave it), and Lab may have
     * been turned on or off (its frame still goes next). Nothing is written when [clear] ran meanwhile.
     */
    private fun commit(p: Plan): Pair<FlushResult, Long?> {
        val kind = p.kind
        val batch = p.batch
        val st = loadIfKept()
        if (st == null) {
            log("lab: cleared during a publish")
            return FlushResult(1, kind, batch.size, "sent") to null
        }
        st.lastFrameAt = maxOf(st.lastFrameAt, p.now)
        st.lastInfo = LastInfo(Lab.readApp(p.hello.app), Lab.readCaps(p.hello.caps))
        if (kind == "off") {
            st.offPending = false
        } else {
            st.helloDue = false
            if (kind == "digest") {
                val sent = batch.toHashSet()
                for (d in st.digest) d.removeAll { it in sent }
                st.digest.removeAll { it.isEmpty() }
            } else {
                val day = utcDay(p.now)
                if (st.day != day) {
                    st.day = day
                    st.dayCount = 0
                }
                st.dayCount += 1
            }
            for (e in batch) st.published.add(Published(e.i, e.s, e.t, p.now))
            // The pending entries this frame made old: the ones it carried, and any recorded meanwhile that do not beat it.
            val sent = batch.associateBy { it.i }
            st.pending.removeAll { e -> sent[e.i]?.let { !Lab.beats(e, it) } == true }
        }
        save(st)
        when (kind) {
            "hello" -> log("lab: hello caps=${st.lastInfo!!.caps.joinToString(",")}${if (p.hello.lab == 0) " lab=0" else ""}")
            "off" -> log("lab: hello lab=0")
            else -> log("lab: states n=${batch.size} published")
        }
        val more = st.on && (st.digest.isNotEmpty() || (st.pending.isNotEmpty() && st.dayCount < Lab.LAB_FRAMES_PER_DAY))
        return FlushResult(1, kind, batch.size, "sent") to (if (more) Lab.LAB_FRAME_GAP_MS else null)
    }

    // ----------------------------------------------------------------------------------------------------- storage

    private fun update(fn: (State) -> Unit) {
        synchronized(store.lock) {
            val st = load()
            fn(st)
            save(st)
        }
    }

    /** The state, or null when the store is empty: [clear] ran since [plan] saved it. */
    private fun loadIfKept(): State? = if (runCatching { store.load() }.getOrNull() == null) null else load()

    private fun load(): State {
        val m = runCatching { store.load() }.getOrNull() ?: emptyMap()
        fun states(v: Any?): MutableList<LabState> = (v as? List<*>)?.mapNotNullTo(ArrayList()) { e ->
            val x = e as? Map<*, *> ?: return@mapNotNullTo null
            val i = x["i"] as? String ?: return@mapNotNullTo null
            val s = x["s"] as? String ?: return@mapNotNullTo null
            val t = x["t"].asLong() ?: return@mapNotNullTo null
            LabState(i, s, t)
        } ?: ArrayList()
        val published = (m["published"] as? List<*>)?.mapNotNullTo(ArrayList()) { e ->
            val x = e as? Map<*, *> ?: return@mapNotNullTo null
            val i = x["i"] as? String ?: return@mapNotNullTo null
            val s = x["s"] as? String ?: return@mapNotNullTo null
            val t = x["t"].asLong() ?: return@mapNotNullTo null
            Published(i, s, t, x["at"].asLong() ?: 0L)
        } ?: ArrayList()
        val digest = (m["digest"] as? List<*>)?.mapTo(ArrayList()) { states(it) }?.filterTo(ArrayList()) { it.isNotEmpty() } ?: ArrayList()
        val lastInfo = (m["lastInfo"] as? Map<*, *>)?.let { LastInfo(it["app"] as? String ?: "", (it["caps"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()) }
        val on = m["on"] as? Boolean ?: (info().lab >= 1)
        return State(
            on = on,
            pending = states(m["pending"]),
            published = published,
            digest = digest,
            lastFrameAt = m["lastFrameAt"].asLong() ?: 0L,
            lastInfo = lastInfo,
            day = m["day"] as? String ?: "",
            dayCount = m["dayCount"].asLong()?.toInt() ?: 0,
            limitUntil = m["limitUntil"].asLong() ?: 0L,
            acksFailed = m["acksFailed"] == true,
            helloDue = m["helloDue"] == true,
            offAt = m["offAt"].asLong() ?: 0L,
            offRepeats = m["offRepeats"].asLong()?.toInt() ?: 0,
            offPending = m["offPending"] == true,
            lastPoll = m["lastPoll"].asLong(),
        )
    }

    private fun toJson(st: State): Map<String, Any?> = linkedMapOf(
        "on" to st.on,
        "pending" to st.pending.map { it.toJson() },
        "published" to st.published.map { linkedMapOf("i" to it.i, "s" to it.s, "t" to it.t, "at" to it.at) },
        "digest" to st.digest.map { d -> d.map { it.toJson() } },
        "lastFrameAt" to st.lastFrameAt,
        "lastInfo" to st.lastInfo?.let { linkedMapOf("app" to it.app, "caps" to it.caps) },
        "day" to st.day,
        "dayCount" to st.dayCount,
        "limitUntil" to st.limitUntil,
        "acksFailed" to st.acksFailed,
        "helloDue" to st.helloDue,
        "offAt" to st.offAt,
        "offRepeats" to st.offRepeats,
        "offPending" to st.offPending,
        "lastPoll" to st.lastPoll,
    )

    private fun save(st: State) = store.save(toJson(st))

    private companion object {
        fun utcDay(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()

        /** One flush lock per store (keyed by its lock, which is per file for [FileLabStore]). */
        private val flushLocks = WeakHashMap<Any, Any>()

        fun flushLockOf(storeLock: Any): Any = synchronized(flushLocks) { flushLocks.getOrPut(storeLock) { Any() } }
    }
}
