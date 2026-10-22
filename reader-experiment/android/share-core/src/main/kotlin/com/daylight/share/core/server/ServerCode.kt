package com.daylight.share.core.server

import com.daylight.share.core.Base32
import com.daylight.share.core.Bytes
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.Json
import com.daylight.share.core.Limits
import com.daylight.share.core.Pairing
import com.daylight.share.core.Relay
import com.daylight.share.core.ShareException
import com.daylight.share.core.Text
import java.net.URLEncoder
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The Server code and the values derived from it (server DESIGN 3.1, 3.2), ported from `server/client/daylight-server.js`
 * (the W0 subset of LAB-PLAN 2.6) and pinned by `server/vectors/server-vectors.json` › derived and serverCodeParsing.
 * Labels end in a 0x00 byte; AADs do not.
 */
object ServerCode {
    const val SERVER_API = 1
    const val SERVER_API_MIN = 1
    const val CONFIG_REFRESH_MS = 6L * 3_600_000
    const val STATUS_REFRESH_MS = 10L * 60_000
    const val CONFIG_MAX_AHEAD_MS = 5L * 60_000

    /** The server's feature keys (DESIGN 10.5). */
    val FEATURES = listOf("ai", "pdf", "email", "feeds", "files", "deliver")

    private const val SERVER_SCHEME = "daylightserver:"
    private const val PAIR_SCHEME = "daylightshare:"

    internal fun label(name: String): ByteArray = Bytes.utf8("dlshare/v1/$name\u0000")

    private fun hexOf(name: String, vararg parts: ByteArray): String = Bytes.toHex(Bytes.sha256(label(name), *parts))

    /** secret (16 bytes) -> seed (16 bytes). Apps only: the server never sees the secret under Lab delivery. */
    fun deriveSeed(secret: ByteArray): ByteArray {
        if (secret.size != 16) throw ShareException("secret", "secret must be 16 bytes")
        return Bytes.sha256(label("server-seed"), secret).copyOf(16)
    }

    private fun codeCheck(seed: ByteArray): Byte = Bytes.sha256(label("server-code-check"), seed)[0]

    /**
     * -> "SERVER-XXXX-…-XXXX", or "daylightserver://setup?c=…&r=…&k=…" when the pairing uses another relay than ntfy.sh
     * or an access [token].
     */
    fun format(seed: ByteArray, relay: String? = null, token: String? = null): String {
        if (seed.size != 16) throw ShareException("seed", "seed must be 16 bytes")
        val c = Base32.encode(seed + codeCheck(seed))
        val r = if (relay.isNullOrEmpty()) Limits.DEFAULT_RELAY else Relay.normalize(relay)
        if (r == Limits.DEFAULT_RELAY && token.isNullOrEmpty()) return "SERVER-" + c.chunked(4).joinToString("-")
        val q = ArrayList<String>()
        q += "c=" + form(c)
        if (r != Limits.DEFAULT_RELAY) q += "r=" + form(r)
        if (!token.isNullOrEmpty()) q += "k=" + form(token)
        return "daylightserver://setup?" + q.joinToString("&")
    }

    /** URLSearchParams' serializer: application/x-www-form-urlencoded, spaces as '+'. */
    private fun form(s: String): String = URLEncoder.encode(s, "UTF-8")

    private const val PAIRING_CODE_MESSAGE = "That is your pairing code. The server needs the Server code instead (Lab settings › Daylight server › Copy). Replace the secret’s value."

    private fun compact(s: String): String = s.uppercase(Locale.ROOT).filterNot { Text.isJsWhitespace(it) || it == '-' || it == '_' || it == '.' }

    private fun decodeChars(chars: String): ByteArray {
        val s = compact(chars).replace('0', 'O').replace('1', 'I').replace('8', 'B')
        if (s.length != 28 || !s.all { it in 'A'..'Z' || it in '2'..'7' }) {
            throw ShareException("server-code", "A Server code is SERVER- followed by 28 letters and digits. Copy it again from Lab settings › Daylight server.", "format")
        }
        val bytes = Base32.decode(s)
        val seed = bytes.copyOf(16)
        if (codeCheck(seed) != bytes[16]) {
            throw ShareException("server-code", "That Server code doesn’t check out. Copy it again from Lab settings › Daylight server.", "checksum")
        }
        return seed
    }

    /** A parsed Server code: the [seed], the relay it names (ntfy.sh by default) and an access [token] (or ""). */
    class Parsed(val seed: ByteArray, val relay: String, val token: String)

    /**
     * A Server code (either form) -> [Parsed]. Throws [ShareException] "server-code" with a sentence and a reason
     * ("format", "checksum" or "pairing-code": a pairing code or link, so the master secret is never uploaded by mistake).
     */
    fun parse(input: String?): Parsed {
        val s = Text.jsTrim(input ?: "")
        val lower = s.lowercase(Locale.ROOT)
        if (lower.startsWith(PAIR_SCHEME)) throw ShareException("server-code", PAIRING_CODE_MESSAGE, "pairing-code")
        if (lower.startsWith(SERVER_SCHEME)) {
            val q = if ('?' in s) s.substring(s.indexOf('?') + 1).substringBefore('#') else ""
            val p = Pairing.parseQuery(q)
            val seed = decodeChars(p["c"] ?: "")
            return Parsed(seed, Relay.normalize(p["r"] ?: ""), Text.jsTrim(p["k"] ?: ""))
        }
        val c = compact(s)
        if (!c.startsWith("SERVER")) {
            val isPairing = runCatching { Pairing.parseCode(s) }.isSuccess
            if (isPairing) throw ShareException("server-code", PAIRING_CODE_MESSAGE, "pairing-code")
            throw ShareException("server-code", "A Server code starts with SERVER-. Copy it from Lab settings › Daylight server › Server code.", "format")
        }
        return Parsed(decodeChars(c.substring(6)), Limits.DEFAULT_RELAY, "")
    }

    /** "3f9a1c2e" -> "3f9a-1c2e", as Lab settings and the deploy summary show it. */
    fun showFingerprint(fp: String): String = fp.take(4) + "-" + fp.drop(4).take(4)

    /** Deterministic item ids for server-made items (feed:<feedId>:<entryKey>, digest:<date>, …). */
    fun serverItemId(seed: ByteArray, origin: String): String = hexOf("server-item-id", seed, byteArrayOf(0), Bytes.utf8(origin)).substring(0, 32)

    /** -> the values derived from the seed (DESIGN 3.2). */
    fun derive(seed: ByteArray, emailSalt: String = ""): ServerValues {
        if (seed.size != 16) throw ShareException("seed", "seed must be 16 bytes")
        val emailHash = Bytes.sha256(label("server-email"), seed, Bytes.utf8(emailSalt))
        return ServerValues(
            authToken = hexOf("server-auth", seed),
            boxKey = Bytes.sha256(label("server-box"), seed),
            configTopic = "dls-" + hexOf("server-config-topic", seed).substring(0, 32),
            itemTopic = "dls-" + hexOf("server-item-topic", seed).substring(0, 32),
            ackTopic = "dls-" + hexOf("server-ack-topic", seed).substring(0, 32),
            emailToken = Base32.encode(emailHash).lowercase(Locale.ROOT).substring(0, 10),
            fingerprint = hexOf("server-fingerprint", seed).substring(0, 8),
            workerName = "daylight-" + hexOf("server-worker", seed).substring(0, 12),
        )
    }
}

/** The values a Server code gives (DESIGN 3.2). [boxKey] seals config, server items and server acks. */
class ServerValues(
    val authToken: String,
    boxKey: ByteArray,
    val configTopic: String,
    val itemTopic: String,
    val ackTopic: String,
    val emailToken: String,
    val fingerprint: String,
    val workerName: String,
) {
    val boxKey: ByteArray = boxKey.copyOf()
}

/**
 * Frames under the server's box key (DESIGN 3.2): the protocol's frame format with the box key and the AADs below.
 * W0 apps open config frames only ([open] with [CONFIG]); item and ack are here for tests and Wave S.
 */
object ServerBox {
    const val CONFIG = "config"
    const val ITEM = "item"
    const val ACK = "ack"
    private val AADS = mapOf(CONFIG to "dlshare/v1/server-config", ITEM to "dlshare/v1/server-item", ACK to "dlshare/v1/server-ack")

    private fun aad(name: String): ByteArray = Bytes.utf8(AADS[name] ?: throw ShareException("aad", "unknown box AAD $name"))

    /** Seals [header] (serialised like JSON.stringify) and [body] with the box key and AAD [aad]. */
    fun seal(values: ServerValues, aad: String, header: Map<String, Any?>, body: ByteArray = ByteArray(0), nonce: ByteArray = Bytes.random(FrameCodec.NONCE_BYTES)): ByteArray {
        require(nonce.size == FrameCodec.NONCE_BYTES) { "nonce must be 12 bytes" }
        val a = aad(aad)
        val headerBytes = Bytes.utf8(Json.write(header))
        if (headerBytes.size > Limits.MAX_HEADER) throw ShareException("header", "header of ${headerBytes.size} bytes")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(values.boxKey, "AES"), GCMParameterSpec(FrameCodec.TAG_BYTES * 8, nonce))
        cipher.updateAAD(a)
        val ct = cipher.doFinal(Bytes.concat(Bytes.u32be(headerBytes.size), headerBytes, body))
        return Bytes.concat(FrameCodec.MAGIC, nonce, ct)
    }

    /** -> the header and body. Throws [ShareException] "frame" for anything that is not a valid frame under this key and AAD. */
    fun open(values: ServerValues, aad: String, frame: ByteArray): Pair<Map<String, Any?>, ByteArray> {
        val a = aad(aad)
        if (frame.size < 4 + 12 + 16 + 4) throw ShareException("frame", "too short")
        for (i in 0 until 4) if (frame[i] != FrameCodec.MAGIC[i]) throw ShareException("frame", "bad magic")
        val plain = try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(values.boxKey, "AES"), GCMParameterSpec(FrameCodec.TAG_BYTES * 8, frame, 4, 12))
            cipher.updateAAD(a)
            cipher.doFinal(frame, 16, frame.size - 16)
        } catch (e: java.security.GeneralSecurityException) {
            throw ShareException("frame", "does not decrypt")
        }
        if (plain.size < 4) throw ShareException("frame", "short plaintext")
        val hlen = Bytes.readU32be(plain, 0)
        if (hlen > plain.size - 4 || hlen > Limits.MAX_HEADER) throw ShareException("frame", "bad header length")
        val text = Bytes.fromUtf8Strict(plain, 4, hlen.toInt()) ?: throw ShareException("frame", "bad header")
        val header = try {
            Json.parse(text)
        } catch (e: Json.ParseException) {
            throw ShareException("frame", "bad header")
        }
        @Suppress("UNCHECKED_CAST")
        val h = header as? Map<String, Any?> ?: throw ShareException("frame", "unsupported header")
        if (h["v"] != Limits.PROTOCOL_VERSION.toDouble()) throw ShareException("frame", "unsupported header")
        return h to plain.copyOfRange(4 + hlen.toInt(), plain.size)
    }
}

/** A checked config (DESIGN 4.1, 4.3): the server's https origin, its API version, fingerprint and delivery mode. */
data class ServerConfig(val server: String, val api: Int, val fingerprint: String, val delivery: String, val sent: String, val id: String) {
    fun toJson(): Map<String, Any?> = linkedMapOf("server" to server, "api" to api, "fingerprint" to fingerprint, "delivery" to delivery, "sent" to sent, "id" to id)

    companion object {
        private val FP = Regex("^[0-9a-f]{8}$")

        fun fromJson(m: Any?): ServerConfig? {
            val c = m as? Map<*, *> ?: return null
            val server = c["server"] as? String ?: return null
            val api = (c["api"] as? Number)?.toInt() ?: return null
            val fp = c["fingerprint"] as? String ?: return null
            return ServerConfig(server, api, fp, if (c["delivery"] == "v1") "v1" else "lab", c["sent"] as? String ?: "", c["id"] as? String ?: "")
        }

        /**
         * The 4.3 rules for an opened config header (the JS `checkConfig`). -> a clean config or null. `server` must be
         * an https origin as it serialises (lowercase host, no default port, no user info, path, query or fragment; one
         * trailing '/' allowed), `sent` an ISO time no more than 5 minutes ahead of [now], `api` an integer >= 1 and
         * `fingerprint` 8 hex digits. Hosts are read more strictly than a WHATWG parser would: letters, digits, '-',
         * '_' and '.' only, or a bracketed IPv6 address.
         */
        fun check(header: Map<String, Any?>?, now: Long): ServerConfig? {
            val h = header ?: return null
            if ((h["v"] as? Number)?.toDouble() != 1.0 || h["kind"] != "config") return null
            val origin = httpsOrigin(h["server"] as? String ?: return null) ?: return null
            val sent = Bytes.parseIsoTime(h["sent"] as? String) ?: return null
            if (sent > now + ServerCode.CONFIG_MAX_AHEAD_MS) return null
            val api = (h["api"] as? Number)?.toDouble() ?: return null
            if (api != Math.floor(api) || api < 1 || api.isInfinite() || api > Int.MAX_VALUE) return null
            val fp = h["fingerprint"] as? String ?: return null
            if (!FP.matches(fp)) return null
            val idText = when (val id = h["id"]) {
                null -> ""
                is String -> id
                is Double -> if (id == Math.floor(id) && !id.isInfinite()) id.toLong().toString() else id.toString()
                else -> id.toString()
            }
            return ServerConfig(origin, api.toInt(), fp, if (h["delivery"] == "v1") "v1" else "lab", Bytes.isoTime(sent), idText)
        }

        private val HTTPS_ORIGIN = Regex("^https://([a-z0-9_.-]+|\\[[0-9a-f:.]+])(?::([1-9][0-9]{0,4}))?$")

        /** `https://host[:port]` exactly as a URL parser serialises its origin (one trailing '/' allowed), else null. */
        internal fun httpsOrigin(server: String): String? {
            val s = server.removeSuffix("/")
            val m = HTTPS_ORIGIN.matchEntire(s) ?: return null
            val host = m.groupValues[1]
            if (host.isEmpty() || host.startsWith(".")) return null
            val port = m.groupValues[2]
            if (port.isNotEmpty() && (port.toInt() > 65535 || port == "443")) return null
            return s
        }
    }
}
