package com.daylight.share.core

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

/**
 * Protocol constants (PROTOCOL.md 2.3, 3.2-3.5, 4; revision 1.1). All sizes in bytes, times in milliseconds unless the
 * name ends in `_S`. Why each value is what it is: ../../share/CHANGES-v1.1.md 2.1-2.3.
 */
object Limits {
    const val PROTOCOL_VERSION = 1
    const val DEFAULT_RELAY = "https://ntfy.sh"

    /** The chunk every sender uses (29 x 64 KiB): a frame is at most CHUNK + MAX_HEADER + 36 = 1,966,116 bytes. */
    const val CHUNK = 1_900_544
    /** Parts a receiver accepts; a sender needs at most 5. */
    const val MAX_PARTS = 16
    /** The largest content (`size`, before compression) a sender sends: "Files can be up to 9 MB". */
    const val MAX_ITEM = 9_000_000L
    /** The largest file `size` a receiver accepts (a page's must be at most [MAX_PAGE_HTML]). */
    const val MAX_DECODED = 268_435_456L
    /** Header JSON: receivers ignore a frame with a longer header, senders never seal one. */
    const val MAX_HEADER = 65_536
    /** Attachment downloads (inbox and acks): v1.0 senders' 12 MiB chunks + 128 KiB. A literal, not derived from CHUNK. */
    const val MAX_ATTACHMENT = 12_713_984L
    /** A poll answer. */
    const val MAX_POLL_RESPONSE = 64L shl 20
    const val MAX_PAGE_HTML = 8L * 1024 * 1024
    const val MAX_URL = 4096
    const val MAX_TITLE = 300
    const val MAX_NAME = 60
    /** Every ack frame stays a small frame (a message, kept 12 h), whatever `from`. */
    const val MAX_ACK_IDS = 70
    const val SMALL_FRAME_B64_MAX = 3800

    /** The cursor overlap (inbox and ack cursors), in seconds: a slow upload is listed after later messages. */
    const val CURSOR_OVERLAP_S = 1800L
    const val RESEND_MESSAGE_MS = 11L * 3_600_000
    /** The re-send wait of an attachment item in its fast phase, and the wait after `full` or `refused`. */
    const val ATTACHMENT_WAIT_MS = 185L * 60_000
    /** An attachment item re-sends after [ATTACHMENT_WAIT_MS] while `lastPublish - created` is under this, then after [RESEND_SLOW_MS]. */
    const val RESEND_FAST_WINDOW_MS = 6L * 3_600_000
    const val RESEND_SLOW_MS = 12L * 3_600_000
    /** The third `full`/`refused` attempt in a row makes the row `expired`. */
    const val SLOW_FAIL_LIMIT = 3
    /** A `sending` row is due again this long after its last progress (the process publishing it was stopped). */
    const val SENDING_STALE_MS = 15L * 60_000
    const val OUTBOX_EXPIRY_MS = 7L * 86_400_000
    /** Content of a row that is not delivered is kept this long after `created`. */
    const val CONTENT_KEEP_MS = 14L * 86_400_000
    /** Finished (delivered or expired) rows kept; pending rows are never dropped. */
    const val OUTBOX_MAX_ROWS = 200
    const val SEEN_TTL_MS = 14L * 86_400_000
    const val SEEN_MSG_TTL_MS = 2L * 86_400_000
    const val INCOMPLETE_TTL_MS = 86_400_000L
    /** The Inbox re-publishes a digest of recent ids this often (and after any failed ack). */
    const val DIGEST_INTERVAL_MS = 11L * 3_600_000
    const val DIGEST_WINDOW_MS = 8L * 86_400_000
    const val DIGEST_MAX_IDS = 280
}

/**
 * Everything that can go wrong, with a [code] matching the JavaScript `ShareError` codes. For relay publishes the code
 * is "network", "full" (413) or "refused" (another 4xx) and [status] the HTTP status (0 when there was no answer).
 * Messages of the codes "too-large", "code", "url", "relay" and "storage" are sentences for people; the others are
 * technical detail for logs (show [RowText] for an outbox row instead).
 */
open class ShareException(val code: String, message: String, val reason: String = "", cause: Throwable? = null, val status: Int = 0) :
    Exception(message, cause)

/**
 * A pairing: the 16-byte secret, the relay and the Daylight's display name (PROTOCOL 1).
 * The Daylight Inbox makes one with [generate]; senders get one from [parse] (a link, a typed code, a code with dashes).
 */
class Pairing(secret: ByteArray, relay: String = Limits.DEFAULT_RELAY, name: String = "") {
    val secret: ByteArray = secret.copyOf()
    val relay: String = Relay.normalize(relay)
    val name: String = Text.cleanName(name)

    init {
        require(secret.size == 16) { "secret must be 16 bytes" }
    }

    /** The typed form, in groups of four: "MZXW-6YTB-...". */
    val code: String get() = formatCode(secret, dashes = true)

    /** The 28 characters without dashes. */
    val compactCode: String get() = formatCode(secret, dashes = false)

    /** `daylightshare://pair?c=...[&r=...][&n=...]` (PROTOCOL 1.3), as shown in the QR code. */
    fun link(): String {
        val q = ArrayList<String>()
        q += "c=" + formEncode(compactCode)
        if (relay != Limits.DEFAULT_RELAY) q += "r=" + formEncode(relay)
        if (name.isNotEmpty()) q += "n=" + formEncode(name)
        return "daylightshare://pair?" + q.joinToString("&")
    }

    val keys: Keys by lazy { Keys.derive(this.secret) }

    /** True when [other] has the same secret: the outbox stays (PROTOCOL 3.3 step 6). All 16 bytes are compared. */
    fun sameSecret(other: Pairing?): Boolean = other != null && other.secret.contentEquals(secret)

    fun withName(newName: String) = Pairing(secret, relay, newName)
    fun withRelay(newRelay: String) = Pairing(secret, newRelay, name)

    override fun equals(other: Any?) =
        other is Pairing && other.secret.contentEquals(secret) && other.relay == relay && other.name == name

    override fun hashCode() = secret.contentHashCode() * 31 + relay.hashCode()

    override fun toString() = "Pairing(relay=$relay, name=$name)" // never the secret

    companion object {
        const val SCHEME = "daylightshare"

        fun generate(): Pairing = Pairing(Bytes.random(16))

        fun formatCode(secret: ByteArray, dashes: Boolean = true): String {
            require(secret.size == 16) { "secret must be 16 bytes" }
            val check = Bytes.sha256(secret)[0]
            val code = Base32.encode(secret + check)
            return if (dashes) code.chunked(4).joinToString("-") else code
        }

        /** A typed or pasted code -> the secret. Throws [ShareException] with code "code", reason "format" or "checksum". */
        fun parseCode(input: String?): ByteArray {
            var s = (input ?: "").uppercase(Locale.ROOT).filterNot { Text.isJsWhitespace(it) || it == '-' || it == '_' || it == '.' }
            s = s.replace('0', 'O').replace('1', 'I').replace('8', 'B')
            if (s.length != 28 || !s.all { it in 'A'..'Z' || it in '2'..'7' }) {
                throw ShareException("code", "A pairing code has 28 letters and digits (7 groups of 4).", "format")
            }
            val bytes = Base32.decode(s)
            val secret = bytes.copyOfRange(0, 16)
            if (Bytes.sha256(secret)[0] != bytes[16]) {
                throw ShareException("code", "That code doesn’t check out. Look for a typo.", "checksum")
            }
            return secret
        }

        /** A pairing link, a typed code, or a code with dashes. Throws [ShareException]. */
        fun parse(input: String?): Pairing {
            val s = Text.jsTrim(input ?: "")
            if (s.lowercase(Locale.ROOT).startsWith("$SCHEME:")) {
                val q = if ('?' in s) s.substring(s.indexOf('?') + 1).substringBefore('#') else ""
                val params = parseQuery(q)
                val secret = parseCode(params["c"] ?: "")
                return Pairing(secret, params["r"] ?: "", params["n"] ?: "")
            }
            return Pairing(parseCode(s))
        }

        /** Whether [input] looks like a pairing link (to route deep links and pasted text). */
        fun isLink(input: String?): Boolean = input?.let(Text::jsTrim)?.lowercase(Locale.ROOT)?.startsWith("$SCHEME:") == true

        /** `application/x-www-form-urlencoded`, with spaces as %20 (what URLSearchParams + the JS replace produce). */
        internal fun formEncode(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

        /** Like URLSearchParams: first value wins, '+' is a space, bad escapes are kept as they are. */
        fun parseQuery(q: String): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for (pair in q.split('&')) {
                if (pair.isEmpty()) continue
                val k = formDecode(pair.substringBefore('='))
                val v = if ('=' in pair) formDecode(pair.substringAfter('=')) else ""
                if (k !in out) out[k] = v
            }
            return out
        }

        private fun formDecode(s: String): String = try {
            URLDecoder.decode(s, "UTF-8")
        } catch (e: IllegalArgumentException) {
            s.replace('+', ' ')
        }
    }
}

/** Relay URLs (PROTOCOL 1.3; vectors > relays). */
object Relay {
    private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://")
    private val DIGITS = Regex("^[0-9]*$")
    private val PORT_AFTER_BRACKET = Regex("^:[0-9]*$")
    private val IPV6 = Regex("^\\[[0-9a-f:.]+]$")
    private val HOST = Regex("^[a-z0-9][a-z0-9.-]*$")

    /**
     * The relay URL rule, textual like the JS `normalizeRelay` (no URL parser): trim; empty -> https://ntfy.sh;
     * whitespace or a control character left inside is an error; a scheme other than http(s) is an error, no scheme ->
     * https://; drop the query, fragment and user info; the host is required and lowercased: ASCII letters, digits, '-'
     * and '.' starting with a letter or digit, or a bracketed IPv6 address of hex digits, ':' and '.'; a port is digits,
     * dropped when it is the text "443" (https) or "80" (http); no '.' or '..' path segments; trailing slashes removed.
     * Throws [ShareException] "relay" with a sentence.
     */
    fun normalize(relay: String?): String {
        fun bad(message: String = "That relay address isn’t valid."): Nothing = throw ShareException("relay", message)
        var s = Text.jsTrim(relay ?: "")
        if (s.isEmpty()) return Limits.DEFAULT_RELAY
        if (s.any { Text.isJsWhitespace(it) || Text.isControl(it) }) bad()
        var scheme = "https"
        SCHEME.find(s)?.let { m ->
            scheme = m.groupValues[1].lowercase(Locale.ROOT)
            if (scheme != "http" && scheme != "https") bad("The relay must be an http(s) address.")
            s = s.substring(m.value.length)
        }
        val end = s.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val authority = if (end < 0) s else s.substring(0, end)
        var path = if (end < 0) "" else s.substring(end).let { p -> p.substring(0, p.indexOfFirst { it == '?' || it == '#' }.let { if (it < 0) p.length else it }) }
        val hostport = authority.substring(authority.lastIndexOf('@') + 1)
        val host: String
        var port = ""
        if (hostport.startsWith("[")) {
            val close = hostport.indexOf(']')
            if (close < 0) bad()
            host = hostport.substring(0, close + 1).lowercase(Locale.ROOT)
            val after = hostport.substring(close + 1)
            if (after.isNotEmpty() && !PORT_AFTER_BRACKET.matches(after)) bad()
            port = if (after.isEmpty()) "" else after.substring(1)
            if (!IPV6.matches(host)) bad()
        } else {
            val colon = hostport.indexOf(':')
            host = (if (colon < 0) hostport else hostport.substring(0, colon)).lowercase(Locale.ROOT)
            if (colon >= 0) port = hostport.substring(colon + 1)
            if (!DIGITS.matches(port)) bad()
            if (!HOST.matches(host)) bad()
        }
        if ((scheme == "https" && port == "443") || (scheme == "http" && port == "80")) port = ""
        if (path.split('/').any { it == "." || it == ".." }) bad()
        path = path.trimEnd('/')
        return "$scheme://$host${if (port.isNotEmpty()) ":$port" else ""}$path"
    }

    /**
     * The relay as people see it: the normalised relay's host and port, as text ("relay.example.org",
     * "relay.example.org:8443", "[::1]:8080"). Throws [ShareException] "relay" like [normalize].
     */
    fun host(relay: String?): String {
        val r = normalize(relay)
        return r.substring(r.indexOf("://") + 3).substringBefore('/')
    }

    /** `scheme://host[:port]` of a normalised relay (no path): what the download rule compares attachment URLs with. */
    fun origin(relay: String?): String {
        val r = normalize(relay)
        val i = r.indexOf("://") + 3
        return r.substring(0, i) + r.substring(i).substringBefore('/')
    }
}

/** The values derived from the secret (PROTOCOL 1.4). */
class Keys(keyBytes: ByteArray, val inboxTopic: String, val ackTopic: String) {
    val keyBytes: ByteArray = keyBytes.copyOf()

    companion object {
        private val LABEL_KEY = Bytes.utf8("dlshare/v1/key")
        private val LABEL_INBOX = Bytes.utf8("dlshare/v1/inbox")
        private val LABEL_ACK = Bytes.utf8("dlshare/v1/ack")

        fun derive(secret: ByteArray): Keys = Keys(
            keyBytes = Bytes.sha256(LABEL_KEY, secret),
            inboxTopic = "dls-" + Bytes.toHex(Bytes.sha256(LABEL_INBOX, secret)).substring(0, 32),
            ackTopic = "dls-" + Bytes.toHex(Bytes.sha256(LABEL_ACK, secret)).substring(0, 32),
        )
    }
}

/** Cleaning untrusted or user-typed strings, exactly like the JS helpers of the same names (textual rules, no parsers). */
object Text {
    private val URL_IN_TEXT = Regex("https?://[^\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF<>\"']+", RegexOption.IGNORE_CASE)
    private val BAD_NAME_CHARS = Regex("[\\p{Cc}:*?\"<>|]+")
    private val DIGITS = Regex("^[0-9]*$")
    private val PORT_AFTER_BRACKET = Regex("^:[0-9]*$")

    /** JavaScript's `\s` (and what `String.prototype.trim` removes). */
    fun isJsWhitespace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', '\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF' -> true
        else -> c in '\u2000'..'\u200A'
    }

    /** `\p{Cc}`: U+0000-001F and U+007F-009F. */
    fun isControl(c: Char): Boolean = c <= '\u001F' || c in '\u007F'..'\u009F'

    /** `String.prototype.trim`. */
    fun jsTrim(s: String): String = s.trim(::isJsWhitespace)

    /** Each run of control characters and JS whitespace becomes one space; then trimmed. */
    private fun collapse(s: String): String {
        val sb = StringBuilder(s.length)
        var inRun = false
        for (c in s) {
            if (isControl(c) || isJsWhitespace(c)) {
                if (!inRun) sb.append(' ')
                inRun = true
            } else {
                sb.append(c)
                inRun = false
            }
        }
        return jsTrim(sb.toString())
    }

    /** First [max] code points of [s]. */
    private fun takeCodePoints(s: String, max: Int): String {
        if (s.codePointCount(0, s.length) <= max) return s
        return s.substring(0, s.offsetByCodePoints(0, max))
    }

    /** A device or Daylight name: control characters and whitespace runs become one space, at most 60 code points. */
    fun cleanName(name: String?): String {
        val s = collapse(name ?: "")
        return if (s.isEmpty()) "" else takeCodePoints(s, Limits.MAX_NAME)
    }

    /** A title: like [cleanName], at most 300 code points. */
    fun cleanTitle(title: String?): String {
        val s = collapse(title ?: "")
        return if (s.isEmpty()) "" else takeCodePoints(s, Limits.MAX_TITLE)
    }

    /**
     * The web URL rule (PROTOCOL 4 "Web URL"; vectors > urls): the trimmed input unchanged, or null. No whitespace or
     * control characters, at most 4096 UTF-16 units, http:// or https:// (any case), a non-empty host that does not
     * start with '.' and has none of < > ^ | \, and a port of digits only. The Reader's SAVE_PAGE rule is looser, so
     * whatever passes here, the Reader accepts.
     */
    fun webUrl(raw: String?): String? {
        val s = jsTrim(raw ?: "")
        if (s.isEmpty() || s.length > Limits.MAX_URL || s.any { isJsWhitespace(it) || isControl(it) }) return null
        val head = s.take(8).lowercase(Locale.ROOT)
        if (!head.startsWith("http://") && !head.startsWith("https://")) return null
        val rest = s.substring(s.indexOf("://") + 3)
        val authority = rest.substring(0, rest.indexOfFirst { it == '/' || it == '?' || it == '#' }.let { if (it < 0) rest.length else it })
        val hostport = authority.substring(authority.lastIndexOf('@') + 1)
        val host: String
        if (hostport.startsWith("[")) {
            val close = hostport.indexOf(']')
            if (close < 0) return null
            host = hostport.substring(0, close + 1)
            val after = hostport.substring(close + 1)
            if (after.isNotEmpty() && !PORT_AFTER_BRACKET.matches(after)) return null
        } else {
            val colon = hostport.indexOf(':')
            host = if (colon < 0) hostport else hostport.substring(0, colon)
            if (colon >= 0 && !DIGITS.matches(hostport.substring(colon + 1))) return null
        }
        if (host.isEmpty() || host.startsWith(".") || host.any { it in "<>^|\\" }) return null
        return s
    }

    /** The first http(s) URL in shared text ("Title https://..."), without trailing punctuation; else null. */
    fun findUrl(text: String?): String? {
        val m = URL_IN_TEXT.find(text ?: "") ?: return null
        return webUrl(m.value.replace(Regex("[),.;!?]+$"), ""))
    }

    /** Removes UTF-16 code units D800-DFFF that are not part of a surrogate pair. */
    private fun dropLoneSurrogates(s: String): String {
        val sb = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (Character.isHighSurrogate(c)) {
                if (i + 1 < s.length && Character.isLowSurrogate(s[i + 1])) {
                    sb.append(c).append(s[i + 1])
                    i++
                }
            } else if (!Character.isLowSurrogate(c)) {
                sb.append(c)
            }
            i++
        }
        return sb.toString()
    }

    private fun utf8Length(s: String): Int = s.toByteArray(Charsets.UTF_8).size

    /**
     * A safe file name for an untrusted one (PROTOCOL 5; vectors > fileNames, fileNamesUtf16): remove lone surrogates;
     * split on runs of / and \; in each segment turn each run of control characters and : * ? " < > | into one space,
     * each run of whitespace into one space, drop leading dots and whitespace, trim; drop empty segments; join with one
     * space; empty -> [fallback]. Over 120 UTF-16 units or 200 UTF-8 bytes: keep the extension (from the last '.', if
     * that is not the first character and 1-10 units follow it) and remove whole code points from the end of the rest
     * until both limits hold.
     */
    fun safeFileName(name: String?, fallback: String = "document"): String {
        val segs = dropLoneSurrogates(name ?: "").split(Regex("[\\\\/]+")).map { seg ->
            val spaced = collapseWith(BAD_NAME_CHARS.replace(seg, " "))
            jsTrim(spaced.trimStart { it == '.' || isJsWhitespace(it) })
        }.filter { it.isNotEmpty() }
        val s = segs.joinToString(" ").ifEmpty { fallback }
        if (s.length <= 120 && utf8Length(s) <= 200) return s
        val dot = s.lastIndexOf('.')
        val after = s.length - dot - 1
        val ext = if (dot > 0 && after in 1..10) s.substring(dot) else ""
        var base = s.substring(0, s.length - ext.length)
        val extBytes = utf8Length(ext)
        var units = base.length + ext.length
        var bytes = utf8Length(base) + extBytes
        while (base.isNotEmpty() && (units > 120 || bytes > 200)) {
            val start = base.offsetByCodePoints(base.length, -1)
            val cp = base.substring(start)
            units -= cp.length
            bytes -= utf8Length(cp)
            base = base.substring(0, start)
        }
        return base + ext
    }

    /** Each run of JS whitespace becomes one space (no trimming). */
    private fun collapseWith(s: String): String {
        val sb = StringBuilder(s.length)
        var inRun = false
        for (c in s) {
            if (isJsWhitespace(c)) {
                if (!inRun) sb.append(' ')
                inRun = true
            } else {
                sb.append(c)
                inRun = false
            }
        }
        return sb.toString()
    }

    /** Sizes for people: ceil(bytes / 100,000) / 10 without a trailing ".0" (9,000,001 -> "9.1", 12,000,000 -> "12"). */
    fun formatMB(bytes: Long): String {
        val tenths = Math.ceil(bytes / 100_000.0).toLong()
        return if (tenths % 10 != 0L) "${Math.floorDiv(tenths, 10L)}.${Math.floorMod(tenths, 10L)}" else (tenths / 10).toString()
    }

    /** The sentence for content over [Limits.MAX_ITEM], at share time and on an expired / too-large row. */
    fun tooBigMessage(size: Long): String = "Too big to send. Files can be up to 9 MB; this one is ${formatMB(size)} MB."
}
