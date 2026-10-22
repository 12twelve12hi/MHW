package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.Keys
import com.daylight.share.core.Limits
import com.daylight.share.core.Purpose
import com.daylight.share.core.ShareException
import com.daylight.share.core.Text

/**
 * The Lab additions to Daylight Share (reader-experiment/share/LAB-PROTOCOL.md, normative), ported from the JavaScript
 * reference `share/js/daylight-lab.js` under the same names. Everything here passes `share/vectors/lab-vectors.json`.
 *
 * Nothing changes the wire of protocol v1 (revision 1.1): `v` stays 1, Lab frames are ack frames whose `ids` is [],
 * and every v1.0 and v1.1 peer ignores them (LAB-PROTOCOL 2.1).
 */
object Lab {
    const val LAB_LEVEL = 1

    /** Capability tokens (2.2.2). */
    object Caps {
        const val ST = "st"
        const val TAP = "tap"
        const val READER_LINK = "reader-link"
        const val CAP_KIND = "cap-kind"
        const val READER_DOC = "reader-doc"
        const val QUIET = "quiet"
    }

    /** Capability tokens kept for later waves (2.2.2): no W0 or W1 code sets or reads them. */
    val RESERVED_CAPS = listOf("note", "dest", "hold", "lan", "return", "stack", "manifest", "control", "marks", "queue", "reading", "server")

    /** The item states (2.2.3), in rank order. */
    val LAB_STATES = listOf("waiting", "held", "inbox", "handed", "failed", "queued", "reader")
    val STATE_RANK: Map<String, Int> = linkedMapOf("waiting" to 1, "held" to 2, "inbox" to 2, "handed" to 3, "failed" to 3, "queued" to 4, "reader" to 5)

    /** The states after which a row needs no faster checks (2.5). */
    val SETTLED_STATES = listOf("reader", "queued", "handed", "inbox", "failed", "held")

    const val MAX_ST_PER_FRAME = 24
    const val MAX_ST_READ = 64
    const val MAX_CAPS = 16
    const val APP_MAX = 60
    const val LAB_MAX_LEVEL_WRITTEN = 99
    const val T_MAX = 4102444800L
    const val HELLO_EVERY_MS = 11L * 3_600_000
    const val STATE_DIGEST_WINDOW_MS = 48L * 3_600_000
    const val STATE_DIGEST_MAX = 48
    const val INBOX_STALE_MS = 36L * 3_600_000
    const val PENDING_MAX = 500
    const val LEDGER_STATES_MAX = 200
    const val LEDGER_STATES_HARD_MAX = 1000
    const val LAB_FRAME_GAP_MS = 30_000L
    const val LAB_FRAMES_PER_DAY = 30
    const val LAB_YIELD_MS = 3_600_000L
    const val LAB_OFF_REPEAT_MS = 48L * 3_600_000
    const val LAB_OFF_REPEATS = 5
    const val LAB_FLUSH_DELAY_MS = 2_000L
    const val GATE_DEADLINE_MS = 5_000L
    const val FAST_CHECK_MS = 30_000L
    const val FAST_CHECK_WINDOW_MS = 10L * 60_000

    /** The publishers a sender keeps apart (2.2.6): the part of `app` before the first '/'; anything else is "other". */
    val PUBLISHERS = listOf("android", "reader-lab", "other")

    /** Lab features (1.4) whose gate needs a capability of the Inbox (F17: in W0 and W1 only the timeline, `st`). */
    val FEATURE_CAPS: Map<String, String> = mapOf("F01" to Caps.ST)

    /** Lab features that run on the Daylight server, by the server's feature key (2.6). */
    val SERVER_FEATURES: Map<String, String> = linkedMapOf("F02" to "files", "F37" to "ai", "F19" to "email", "F36" to "feeds")

    /** The server's feature keys (2.6), with the Lab feature each belongs to. */
    val SERVER_KEYS: Map<String, String> = linkedMapOf("files" to "F02", "ai" to "F37", "pdf" to "F37", "email" to "F19", "feeds" to "F36", "deliver" to "F37")

    /** The features whose What's in Lab row has a Use switch (6.5 Q5): they change how sharing behaves. */
    val USE_FEATURES = listOf("F03", "F04", "F08", "F10", "F16", "F33")

    fun rankOf(s: String?): Int = STATE_RANK[s] ?: 0

    /** The merge rule (2.2.6): [a] replaces [b] when there is no [b], its rank is higher, or the same rank with a later `t`. */
    fun beats(a: LabState, b: LabState?): Boolean =
        b == null || rankOf(a.s) > rankOf(b.s) || (rankOf(a.s) == rankOf(b.s) && a.t > b.t)

    /** The publisher of an `app` (2.2.6): "android", "reader-lab" or "other". */
    fun publisherOf(app: String?): String {
        val p = (app ?: "").substringBefore('/')
        return if (p == "android" || p == "reader-lab") p else "other"
    }

    private val ID_RE = Regex("^[0-9a-f]{32}$")
    private val CAP_RE = Regex("^[a-z0-9-]{1,16}$")

    fun isId(s: Any?): Boolean = s is String && ID_RE.matches(s)

    fun isCap(s: Any?): Boolean = s is String && CAP_RE.matches(s)

    /**
     * Rule I (2.2.5): a JSON number (as this module's parser reads it: a [Double]; not a string, not a boolean) whose
     * value is a whole number. -0 counts as 0; 1.5 and 1e400 (infinite) do not. -> the value, or null.
     */
    fun intOf(v: Any?): Long? {
        val d = when (v) {
            is Double -> v
            is Int -> return v.toLong()
            is Long -> return v
            else -> return null
        }
        if (d.isNaN() || d.isInfinite() || d != Math.floor(d) || Math.abs(d) >= 9.2e18) return null
        return d.toLong() // -0.0 -> 0
    }

    /** Whether [v] is a whole JSON number (rule I), whatever its size: 1e300 is an integer above any level. */
    internal fun isWhole(v: Any?): Boolean = when (v) {
        is Double -> !v.isNaN() && !v.isInfinite() && v == Math.floor(v)
        is Int, is Long -> true
        else -> false
    }

    /** `app` as readers read it (2.2.5): a string of printable ASCII (U+0020 to U+007E) cut to 60 characters, else "". */
    fun readApp(v: Any?): String {
        val s = v as? String ?: return ""
        if (s.any { it < ' ' || it > '~' }) return ""
        return s.take(APP_MAX)
    }

    /** `caps` as readers read them (2.2.5): of the first 16 elements, the tokens, without repeats. */
    fun readCaps(v: Any?): List<String> {
        val l = v as? List<*> ?: return emptyList()
        val out = ArrayList<String>()
        for (c in l.take(MAX_CAPS)) if (isCap(c) && c !in out) out += c as String
        return out
    }

    // ------------------------------------------------------------------------------------------------- dates (rule D)

    private val ISO_RE = Regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\\.[0-9]{1,3})?Z$")

    private fun daysFromCivil(year: Long, m: Int, d: Int): Long {
        val y = if (m <= 2) year - 1 else year
        val era = Math.floorDiv(y, 400L)
        val yoe = y - era * 400
        val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    private fun leap(y: Int) = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0

    private fun monthDays(y: Int, m: Int): Int = intArrayOf(31, if (leap(y)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[m - 1]

    /**
     * `YYYY-MM-DDTHH:MM:SS(.f{1,3})?Z` with ASCII digits and valid fields (rule D: checked field by field, never with a
     * platform date parser) -> ms since 1970 (UTC), else null. A fraction of 1 or 2 digits is right-padded (.5 = 500 ms).
     */
    fun parseTime(s: Any?): Long? {
        val m = ISO_RE.matchEntire(s as? String ?: return null) ?: return null
        val g = m.groupValues
        val y = g[1].toInt()
        val mo = g[2].toInt()
        val d = g[3].toInt()
        val h = g[4].toInt()
        val mi = g[5].toInt()
        val se = g[6].toInt()
        if (mo < 1 || mo > 12 || d < 1 || d > monthDays(y, mo) || h > 23 || mi > 59 || se > 59) return null
        val frac = if (g[7].isEmpty()) 0 else g[7].substring(1).padEnd(3, '0').toInt()
        return (daysFromCivil(y.toLong(), mo, d) * 86400 + h * 3600 + mi * 60 + se) * 1000 + frac
    }

    /** 9999-12-31T23:59:59.999Z: the latest time an ISO string with a 4-digit year can hold. */
    const val MAX_ISO_MS = 253402300799999L
}

/**
 * One item state (2.2.1, 2.2.3): item id [i] (32 lowercase hex), state token [s], and [t], when the Inbox reached it,
 * in Unix seconds.
 */
data class LabState(val i: String, val s: String, val t: Long) {
    fun toJson(): Map<String, Any?> = linkedMapOf("i" to i, "s" to s, "t" to t)

    companion object {
        /** A checked entry, or a [ShareException] "lab" with reason "entry". */
        fun checked(i: String?, s: String?, t: Long?): LabState {
            if (!Lab.isId(i) || s == null || s !in Lab.STATE_RANK || t == null || t < 0 || t > Lab.T_MAX) {
                throw ShareException("lab", "bad state entry", "entry")
            }
            return LabState(i!!, s, t)
        }
    }
}

/**
 * The `x-inbox` object of a Lab frame (2.2.1), as a reader reads it ([LabFrame.parse]: [poll] in ms or null) or as an
 * Inbox describes itself ([LabFrame.build] clamps it with [clamped]).
 */
data class LabInboxInfo(
    val lab: Int = Lab.LAB_LEVEL,
    val app: String = "",
    val caps: List<String> = emptyList(),
    /** When the Inbox last polled the inbox topic successfully, ms since 1970; null when unknown. */
    val poll: Long? = null,
    /** Instant delivery has a connection open now. */
    val live: Boolean = false,
) {
    /**
     * Clamped as readers read it (2.2.5; the JS `buildInboxInfo`): `lab` an integer 0-99 (else [ShareException] "lab"
     * with reason "lab"); `app` printable ASCII cut to 60 characters, anything else ""; `caps` the first 16 elements
     * that are tokens, without repeats; `poll` left out unless it fits an ISO 8601 time from 1970 on.
     */
    fun clamped(): LabInboxInfo {
        if (lab < 0 || lab > Lab.LAB_MAX_LEVEL_WRITTEN) throw ShareException("lab", "lab must be an integer from 0 to 99", "lab")
        val p = poll?.takeIf { it in 0..Lab.MAX_ISO_MS }
        return LabInboxInfo(lab, Lab.readApp(app), Lab.readCaps(caps), p, live)
    }

    /** The `x-inbox` JSON (fields in the reference's order: lab, app, caps, poll as ISO 8601 UTC with ms, live). */
    fun toJson(): Map<String, Any?> {
        val c = clamped()
        val m = LinkedHashMap<String, Any?>()
        m["lab"] = c.lab
        m["app"] = c.app
        m["caps"] = c.caps
        if (c.poll != null) m["poll"] = Bytes.isoTime(c.poll)
        m["live"] = c.live
        return m
    }

    /** The publisher this Inbox speaks as (2.2.6). */
    val publisher: String get() = Lab.publisherOf(app)
}

/** What [LabFrame.parse] reads from an ack-topic header: the Inbox's hello ([inbox], or null) and its item [states]. */
data class LabAck(val inbox: LabInboxInfo?, val states: List<LabState>) {
    companion object {
        val NONE = LabAck(null, emptyList())
    }
}

/** Lab frames on the ack topic (2.2.1): hellos and item states, sealed exactly like acks. */
object LabFrame {
    /**
     * Builds a Lab frame (the JS `buildLabFrame`): sealed like an ack (the pairing key, AAD dlshare/v1/ack), `ids` [],
     * `x-inbox` from [inbox] (clamped) and, when [states] is not empty, `x-st` (at most 24). A hello has no states.
     * Throws [ShareException] "lab" with reason "too-many" (over 24 states), "entry" (a bad entry), "lab" (a level
     * outside 0-99) or "not-small" (base64 over 3,800 characters; [LabInbox] halves the batch on this one).
     */
    fun build(
        keys: Keys,
        inbox: LabInboxInfo,
        states: List<LabState> = emptyList(),
        from: String = "",
        sent: String = Bytes.isoTime(System.currentTimeMillis()),
        nonce: ByteArray = Bytes.random(FrameCodec.NONCE_BYTES),
    ): ByteArray {
        if (states.size > Lab.MAX_ST_PER_FRAME) throw ShareException("lab", "more than ${Lab.MAX_ST_PER_FRAME} states", "too-many")
        val header = LinkedHashMap<String, Any?>()
        header["v"] = Limits.PROTOCOL_VERSION
        header["kind"] = "ack"
        header["ids"] = emptyList<String>()
        header["sent"] = sent
        val f = Text.cleanName(from)
        if (f.isNotEmpty()) header["from"] = f
        header["x-inbox"] = inbox.toJson()
        if (states.isNotEmpty()) header["x-st"] = states.map { LabState.checked(it.i, it.s, it.t).toJson() }
        val frame = FrameCodec.encrypt(keys, Purpose.ACK, header, ByteArray(0), nonce)
        if (!FrameCodec.isSmall(frame.size.toLong())) throw ShareException("lab", "a Lab frame must be a small frame", "not-small")
        return frame
    }

    /**
     * Reads the Lab fields of an ack-topic header (2.2.5, exactly; vectors > labParse). [header] is a parsed JSON value
     * (null for a header the parser rejected). Never throws.
     *  1. Not an object, `kind` not "ack", or `ids` not an empty array -> nothing.
     *  2. `x-inbox` an object whose `lab` is an integer (rule I): above [Lab.LAB_LEVEL] -> nothing at all (a later
     *     level is unknown); below 0 -> no inbox; else the inbox, its fields clamped.
     *  3. `x-st` an array: of its first 64 elements, the objects with a valid `i`, a known `s` and an integer `t` from
     *     0 to 4102444800, in order, repeats included.
     */
    fun parse(header: Any?): LabAck {
        val h = header as? Map<*, *> ?: return LabAck.NONE
        if (h["kind"] != "ack") return LabAck.NONE
        val ids = h["ids"] as? List<*> ?: return LabAck.NONE
        if (ids.isNotEmpty()) return LabAck.NONE
        var inbox: LabInboxInfo? = null
        val x = h["x-inbox"] as? Map<*, *>
        val lab = x?.get("lab")
        if (x != null && Lab.isWhole(lab)) {
            val level = (lab as Number).toDouble() // whole, maybe past Long (1e300)
            if (level > Lab.LAB_LEVEL) return LabAck.NONE
            if (level >= 0) {
                inbox = LabInboxInfo(level.toInt(), Lab.readApp(x["app"]), Lab.readCaps(x["caps"]), Lab.parseTime(x["poll"]), x["live"] == true)
            }
        }
        val states = ArrayList<LabState>()
        val st = h["x-st"] as? List<*>
        if (st != null) {
            for (e in st.take(Lab.MAX_ST_READ)) {
                val m = e as? Map<*, *> ?: continue
                val i = m["i"]
                if (!Lab.isId(i)) continue
                val s = m["s"] as? String
                if (s == null || s !in Lab.STATE_RANK) continue
                val t = Lab.intOf(m["t"]) ?: continue
                if (t < 0 || t > Lab.T_MAX) continue
                states += LabState(i as String, s, t)
            }
        }
        return LabAck(inbox, states)
    }
}

/** The Lab lanes' topics (2.4), derived now and used from W2 (return lane) and W3 (control lane). */
data class LabTopics(val returnTopic: String, val returnAckTopic: String, val controlTopic: String, val controlAckTopic: String) {
    companion object {
        /** -> the four topics: "dls-" + the first 32 hex digits of SHA-256(label + 0x00 + secret). */
        fun derive(secret: ByteArray): LabTopics {
            if (secret.size != 16) throw ShareException("secret", "secret must be 16 bytes")
            fun topic(name: String) = "dls-" + Bytes.toHex(Bytes.sha256(Bytes.utf8("dlshare/v1/$name\u0000"), secret)).substring(0, 32)
            return LabTopics(topic("lab-return"), topic("lab-return-ack"), topic("lab-control"), topic("lab-control-ack"))
        }
    }
}
