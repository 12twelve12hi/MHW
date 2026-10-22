package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.Keys
import com.daylight.share.core.RelayClient
import com.daylight.share.core.ShareException
import java.time.Instant
import java.time.ZoneOffset

/**
 * The Inbox side of the Lab frames (LAB-PROTOCOL 2.2.4; the JS `LabInbox`, its reference): it records item states and
 * publishes hellos and state frames on the ack topic, last on the household's relay budget (2.1 rule 8, 2.2.7). Pure
 * JVM: Daylight Share's Inbox and the Lab Reader use the same class.
 *
 * - [store]: its state (`files/inbox/lab-<inboxTopic>.json` in the Inbox); [relay] and [keys]: the pairing's.
 * - [info]: the Inbox's current hello: its Lab level, `android/<versionName>`, its caps, and whether Instant delivery
 *   is live. `poll` defaults to the time [notePolled] last recorded.
 * - [schedule]: asks the app to call [flush] after a delay (2 s after [record], the spacing's wait, 30 s while more
 *   waits), replacing any earlier request; null means the app flushes at its own points only. With no network, the app
 *   schedules its `lab-flush` job (a CONNECTED constraint) when [flush] answers "error".
 * - [log]: one line per event (`lab: hello caps=…`, `lab: states n=… published`, `lab: state <id> <s>`, …).
 *
 * Rules: frames carry at most 24 states, oldest first, at most one every 30 s; nothing goes while the last poll's acks
 * failed or within an hour of a 429 or 413; at most 30 hellos and state frames a UTC day (digest frames and the lab: 0
 * frames are outside the cap); a batch that is not small is halved down to one entry, and an entry that still does not
 * fit is dropped; at most 500 pending entries (the oldest go first). Every method is blocking and runs under the
 * store's lock; [flush] publishes, so run it off the main thread.
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
        var next: Long? = null
        val r = synchronized(store.lock) {
            val (res, wait) = flushLocked()
            next = wait
            res
        }
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

    private fun flushLocked(): Pair<FlushResult, Long?> {
        while (true) {
            val st = load()
            val now = clock()
            val day = utcDay(now)
            if (st.day != day) {
                st.day = day
                st.dayCount = 0
            }
            st.published.removeAll { !(it.t * 1000 >= now - Lab.STATE_DIGEST_WINDOW_MS || it.at >= now - Lab.STATE_DIGEST_WINDOW_MS) }
            fun none(reason: String, waitMs: Long? = null, error: Exception? = null) = FlushResult(0, null, 0, reason, waitMs, error)
            val info = currentInfo(st)
            val kind: String
            var batch: List<LabState> = emptyList()
            when {
                !st.on -> {
                    if (!st.offPending) {
                        save(st)
                        return none("off") to null
                    }
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
                else -> {
                    save(st)
                    return none("idle") to null
                }
            }
            if (st.acksFailed || now < st.limitUntil) {
                save(st)
                return none("yield") to null
            }
            if (st.lastFrameAt != 0L && now - st.lastFrameAt < Lab.LAB_FRAME_GAP_MS) {
                val waitMs = st.lastFrameAt + Lab.LAB_FRAME_GAP_MS - now
                save(st)
                return none("spacing", waitMs) to waitMs
            }
            if ((kind == "states" || kind == "hello") && st.dayCount >= Lab.LAB_FRAMES_PER_DAY) {
                save(st)
                return none("cap") to null
            }

            val hello = if (kind == "off") info.copy(lab = 0, caps = emptyList()) else info
            var frame: ByteArray? = null
            var dropped = false
            while (frame == null) {
                try {
                    frame = buildFrame(keys, hello, batch, from, Bytes.isoTime(now))
                } catch (e: ShareException) {
                    if (e.reason != "not-small" || batch.isEmpty()) throw e
                    if (batch.size > 1) {
                        batch = batch.take((batch.size + 1) / 2)
                        continue
                    }
                    val d = batch[0]
                    log("lab: dropped state ${d.i} ${d.s}: the frame is not small")
                    st.pending.removeAll { it.i == d.i }
                    if (kind == "digest") {
                        st.digest[0].removeAll { it.i == d.i }
                        if (st.digest[0].isEmpty()) st.digest.removeAt(0)
                    }
                    save(st)
                    dropped = true
                    break
                }
            }
            if (dropped) continue // flush again, without the entry that does not fit
            try {
                relay.publish(keys.ackTopic, frame!!)
            } catch (e: Exception) {
                val status = (e as? ShareException)?.status ?: 0
                if (status == 429 || status == 413) st.limitUntil = maxOf(st.limitUntil, now + Lab.LAB_YIELD_MS)
                save(st)
                log("lab: publish failed ${e.message ?: e.javaClass.simpleName}")
                return none("error", error = e) to null
            }
            st.lastFrameAt = now
            st.lastInfo = LastInfo(Lab.readApp(hello.app), Lab.readCaps(hello.caps))
            if (kind == "off") {
                st.offPending = false
            } else {
                st.helloDue = false
                if (kind == "digest") {
                    val ids = batch.mapTo(HashSet()) { it.i }
                    st.digest[0].removeAll { it.i in ids }
                    if (st.digest[0].isEmpty()) st.digest.removeAt(0)
                } else {
                    st.dayCount += 1
                }
                if (kind == "states") {
                    val ids = batch.mapTo(HashSet()) { it.i }
                    st.pending.removeAll { it.i in ids }
                }
                for (e in batch) st.published.add(Published(e.i, e.s, e.t, now))
            }
            save(st)
            when (kind) {
                "hello" -> log("lab: hello caps=${st.lastInfo!!.caps.joinToString(",")}${if (hello.lab == 0) " lab=0" else ""}")
                "off" -> log("lab: hello lab=0")
                else -> log("lab: states n=${batch.size} published")
            }
            val more = st.on && (st.digest.isNotEmpty() || (st.pending.isNotEmpty() && st.dayCount < Lab.LAB_FRAMES_PER_DAY))
            return FlushResult(1, kind, batch.size, "sent") to (if (more) Lab.LAB_FRAME_GAP_MS else null)
        }
    }

    // ----------------------------------------------------------------------------------------------------- storage

    private fun update(fn: (State) -> Unit) {
        synchronized(store.lock) {
            val st = load()
            fn(st)
            save(st)
        }
    }

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
    }
}
