package com.daylight.share.core

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

/** Protocol constants (PROTOCOL.md, section 4). */
object Limits {
    const val PROTOCOL_VERSION = 1
    const val DEFAULT_RELAY = "https://ntfy.sh"
    const val CHUNK = 12 * 1024 * 1024
    const val MAX_PARTS = 16
    const val MAX_ENCODED = 64L * 1024 * 1024
    const val MAX_PAGE_HTML = 8L * 1024 * 1024
    const val MAX_URL = 4096
    const val MAX_TITLE = 300
    const val MAX_NAME = 60
    const val MAX_ACK_IDS = 200
    const val SMALL_FRAME_B64_MAX = 3800
    const val RESEND_ATTACHMENT_MS = 150L * 60 * 1000
    const val RESEND_MESSAGE_MS = 11L * 60 * 60 * 1000
    const val OUTBOX_EXPIRY_MS = 7L * 24 * 60 * 60 * 1000
    const val SEEN_TTL_MS = 14L * 24 * 60 * 60 * 1000
    const val SEEN_MSG_TTL_MS = 2L * 24 * 60 * 60 * 1000
}

/** Everything that can go wrong, with a [code] matching the JavaScript `ShareError` codes and a user-facing message. */
open class ShareException(val code: String, message: String, val reason: String = "", cause: Throwable? = null) :
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
            var s = (input ?: "").uppercase(Locale.ROOT).replace(Regex("[\\s\\-_.]"), "")
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
            val s = (input ?: "").trim()
            if (s.lowercase(Locale.ROOT).startsWith("$SCHEME:")) {
                val q = if ('?' in s) s.substring(s.indexOf('?') + 1).substringBefore('#') else ""
                val params = parseQuery(q)
                val secret = parseCode(params["c"] ?: "")
                return Pairing(secret, params["r"] ?: "", params["n"] ?: "")
            }
            return Pairing(parseCode(s))
        }

        /** Whether [input] looks like a pairing link (to route deep links and pasted text). */
        fun isLink(input: String?): Boolean = input?.trim()?.lowercase(Locale.ROOT)?.startsWith("$SCHEME:") == true

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

/** Relay URLs (PROTOCOL 1.3): http(s), no trailing slash, no query or fragment. */
object Relay {
    /** Normalises a relay URL like the JS `normalizeRelay`; empty means the default. Throws [ShareException] "relay". */
    fun normalize(relay: String?): String {
        var r = (relay ?: "").trim()
        if (r.isEmpty()) return Limits.DEFAULT_RELAY
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(r)) r = "https://$r"
        val u = try {
            URI(r).normalize()
        } catch (e: Exception) {
            throw ShareException("relay", "That relay address isn’t a valid URL.")
        }
        val scheme = u.scheme?.lowercase(Locale.ROOT)
        if (scheme != "https" && scheme != "http") throw ShareException("relay", "The relay must be http(s).")
        val host = u.host?.lowercase(Locale.ROOT)
            ?: throw ShareException("relay", "That relay address isn’t a valid URL.")
        val defaultPort = if (scheme == "https") 443 else 80
        val port = if (u.port == -1 || u.port == defaultPort) "" else ":${u.port}"
        val hostPart = if (':' in host && !host.startsWith("[")) "[$host]" else host
        val path = (u.rawPath ?: "").ifEmpty { "/" }
        return "$scheme://$hostPart$port$path".trimEnd('/')
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

/** Cleaning untrusted or user-typed strings, exactly like the JS helpers of the same names. */
object Text {
    private val CONTROL_OR_SPACE = Regex("[\\p{Cc}\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
    private val SPACES = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
    private val BAD_NAME_CHARS = Regex("[\\p{Cc}:*?\"<>|]+")
    private val URL_IN_TEXT = Regex("https?://[^\\s<>\"']+", RegexOption.IGNORE_CASE)

    /** First [max] code points of [s]. */
    private fun takeCodePoints(s: String, max: Int): String {
        if (s.codePointCount(0, s.length) <= max) return s
        return s.substring(0, s.offsetByCodePoints(0, max))
    }

    private fun jsTrim(s: String): String = s.trim { it.isWhitespace() || it == '﻿' || it == ' ' }

    /** A device or Daylight name: control characters and whitespace runs become one space, at most 60 code points. */
    fun cleanName(name: String?): String {
        val s = jsTrim(CONTROL_OR_SPACE.replace(name ?: "", " "))
        return if (s.isEmpty()) "" else takeCodePoints(s, Limits.MAX_NAME)
    }

    /** A title: like [cleanName], at most 300 code points. */
    fun cleanTitle(title: String?): String {
        val s = jsTrim(CONTROL_OR_SPACE.replace(title ?: "", " "))
        return if (s.isEmpty()) "" else takeCodePoints(s, Limits.MAX_TITLE)
    }

    /**
     * An absolute http(s) URL with a host, at most 4096 characters, with no whitespace or control characters; else
     * null. The same rule the Daylight Reader applies to SAVE_PAGE (so whatever passes here, the Reader accepts).
     */
    fun webUrl(raw: String?): String? {
        val s = raw?.trim() ?: return null
        if (s.isEmpty() || s.length > Limits.MAX_URL) return null
        if (s.any { it.isWhitespace() || it.isISOControl() || it == '﻿' }) return null
        val lower = s.lowercase(Locale.ROOT)
        val rest = when {
            lower.startsWith("https://") -> s.substring(8)
            lower.startsWith("http://") -> s.substring(7)
            else -> return null
        }
        val authority = rest.substringBefore('/').substringBefore('?').substringBefore('#')
        val host = authority.substringAfterLast('@').let {
            if (it.startsWith("[")) it.substringBefore(']') + "]" else it.substringBefore(':')
        }
        if (host.isEmpty() || host.startsWith(".")) return null
        return s
    }

    /** The first http(s) URL in shared text ("Title https://..."), without trailing punctuation; else null. */
    fun findUrl(text: String?): String? {
        val m = URL_IN_TEXT.find(text ?: "") ?: return null
        return webUrl(m.value.replace(Regex("[),.;!?]+$"), ""))
    }

    /**
     * A safe file name (PROTOCOL 5): split on / and \; in each segment turn control characters and : * ? " < > | into
     * spaces, collapse whitespace, trim, drop leading dots; drop empty segments; join with one space; empty -> the
     * fallback; over 120 characters -> cut, keeping an extension of up to 10 characters.
     */
    fun safeFileName(name: String?, fallback: String = "document"): String {
        val segs = (name ?: "").split(Regex("[\\\\/]+"))
            .map { seg -> jsTrim(SPACES.replace(BAD_NAME_CHARS.replace(seg, " "), " ")).trimStart('.').let(::jsTrim) }
            .filter { it.isNotEmpty() }
        var s = segs.joinToString(" ")
        if (s.isEmpty()) s = fallback
        if (s.length > 120) {
            val dot = s.lastIndexOf('.')
            val ext = if (dot > 0 && s.length - dot <= 10) s.substring(dot) else ""
            s = s.substring(0, 120 - ext.length) + ext
        }
        return s
    }
}
