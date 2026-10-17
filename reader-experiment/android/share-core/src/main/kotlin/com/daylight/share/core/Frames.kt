package com.daylight.share.core

import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Which topic a frame belongs to; the AAD of its encryption (PROTOCOL 2). */
enum class Purpose(val aad: String) {
    INBOX("dlshare/v1/inbox"),
    ACK("dlshare/v1/ack"),
}

/** A decrypted frame: the header object and the body bytes. */
class OpenedFrame(val header: Map<String, Any?>, val body: ByteArray)

/** Sealing and opening frames: `"DLS1" || nonce || AES-256-GCM(key, nonce, u32be(len) || header || body, aad)`. */
object FrameCodec {
    val MAGIC = Bytes.utf8("DLS1")
    const val NONCE_BYTES = 12
    const val TAG_BYTES = 16
    const val MAX_HEADER_BYTES = 64 * 1024

    /** Low level: seals already-serialised header bytes and a body (the vectors use this). */
    fun seal(keys: Keys, purpose: Purpose, headerBytes: ByteArray, body: ByteArray = ByteArray(0), nonce: ByteArray = Bytes.random(NONCE_BYTES)): ByteArray {
        require(nonce.size == NONCE_BYTES) { "nonce must be 12 bytes" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keys.keyBytes, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
        cipher.updateAAD(Bytes.utf8(purpose.aad))
        val out = ByteArray(MAGIC.size + NONCE_BYTES + cipher.getOutputSize(4 + headerBytes.size + body.size))
        System.arraycopy(MAGIC, 0, out, 0, MAGIC.size)
        System.arraycopy(nonce, 0, out, MAGIC.size, NONCE_BYTES)
        var o = MAGIC.size + NONCE_BYTES
        o += cipher.update(Bytes.u32be(headerBytes.size), 0, 4, out, o)
        o += cipher.update(headerBytes, 0, headerBytes.size, out, o)
        o += cipher.doFinal(body, 0, body.size, out, o)
        return if (o == out.size) out else out.copyOf(o)
    }

    /** Serialises [header] like `JSON.stringify` and seals it. */
    fun encrypt(keys: Keys, purpose: Purpose, header: Map<String, Any?>, body: ByteArray = ByteArray(0), nonce: ByteArray = Bytes.random(NONCE_BYTES)): ByteArray =
        seal(keys, purpose, Bytes.utf8(Json.write(header)), body, nonce)

    /** Opens a frame. Throws [ShareException] with code "frame" for anything that is not a valid frame of [purpose]. */
    fun open(keys: Keys, purpose: Purpose, frame: ByteArray): OpenedFrame {
        if (frame.size < MAGIC.size + NONCE_BYTES + TAG_BYTES + 4) throw ShareException("frame", "too short")
        for (i in MAGIC.indices) if (frame[i] != MAGIC[i]) throw ShareException("frame", "bad magic")
        val plain = try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keys.keyBytes, "AES"),
                GCMParameterSpec(TAG_BYTES * 8, frame, MAGIC.size, NONCE_BYTES))
            cipher.updateAAD(Bytes.utf8(purpose.aad))
            val start = MAGIC.size + NONCE_BYTES
            cipher.doFinal(frame, start, frame.size - start)
        } catch (e: AEADBadTagException) {
            throw ShareException("frame", "does not decrypt")
        } catch (e: java.security.GeneralSecurityException) {
            throw ShareException("frame", "does not decrypt")
        }
        if (plain.size < 4) throw ShareException("frame", "short plaintext")
        val hlen = Bytes.readU32be(plain, 0)
        if (hlen > plain.size - 4 || hlen > MAX_HEADER_BYTES) throw ShareException("frame", "bad header length")
        val text = Bytes.fromUtf8Strict(plain, 4, hlen.toInt()) ?: throw ShareException("frame", "bad header")
        val header = Json.parseObjectOrNull(text) ?: throw ShareException("frame", "bad header")
        if (header["v"] != Limits.PROTOCOL_VERSION.toDouble()) throw ShareException("frame", "unsupported header")
        return OpenedFrame(header, plain.copyOfRange(4 + hlen.toInt(), plain.size))
    }

    /** Whether the frame goes as a message (base64 text of at most 3800 characters) rather than an attachment. */
    fun isSmall(frameLength: Long): Boolean = (frameLength + 2) / 3 * 4 <= Limits.SMALL_FRAME_B64_MAX
}

/** The kinds of item (PROTOCOL 2.2). */
object Kind {
    const val URL = "url"
    const val PAGE = "page"
    const val FILE = "file"
    val ALL = setOf(URL, PAGE, FILE)
}

/**
 * An item header (PROTOCOL 2.1). [toJson] writes the fields in the JavaScript reference's order, so frames built here
 * and there carry identical header bytes.
 */
data class ItemHeader(
    val id: String,
    val kind: String,
    val url: String? = null,
    val title: String? = null,
    val name: String? = null,
    val mime: String? = null,
    val size: Long? = null,
    val sha256: String? = null,
    val enc: String = ENC_IDENTITY,
    val part: Int = 0,
    val parts: Int = 1,
    val sent: String = "",
    val from: String? = null,
    val app: String? = null,
) {
    fun toJson(withParts: Boolean = parts > 1): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        m["v"] = Limits.PROTOCOL_VERSION
        m["id"] = id
        m["kind"] = kind
        if (url != null) m["url"] = url
        if (!title.isNullOrEmpty()) m["title"] = title
        if (kind == Kind.PAGE) {
            m["mime"] = mime ?: "text/html"
        } else if (kind == Kind.FILE) {
            if (name != null) m["name"] = name
            if (mime != null) m["mime"] = mime
        }
        if (kind != Kind.URL) {
            if (size != null) m["size"] = size
            if (sha256 != null) m["sha256"] = sha256
        }
        if (enc != ENC_IDENTITY) m["enc"] = enc
        m["sent"] = sent
        if (!from.isNullOrEmpty()) m["from"] = from
        if (!app.isNullOrEmpty()) m["app"] = app
        if (withParts) {
            m["part"] = part
            m["parts"] = parts
        }
        return m
    }

    companion object {
        const val ENC_IDENTITY = "identity"
        const val ENC_DEFLATE_RAW = "deflate-raw"
        private val ID_RE = Regex("^[0-9a-f]{32}$")
        private val SHA_RE = Regex("^[0-9a-f]{64}$")

        fun newId(): String = Bytes.toHex(Bytes.random(16))

        fun isId(s: String?): Boolean = s != null && ID_RE.matches(s)

        /**
         * Validates an untrusted header (the JS `checkItemHeader`) and returns a cleaned copy. Throws [ShareException]
         * with code "header".
         */
        fun check(h: Map<String, Any?>): ItemHeader {
            fun bad(why: String): Nothing = throw ShareException("header", why)
            val id = h["id"] as? String
            if (id == null || !ID_RE.matches(id)) bad("id")
            val kind = h["kind"] as? String
            if (kind == null || kind !in Kind.ALL) bad("kind")
            var url: String? = null
            if (h["url"] != null) {
                url = Text.webUrl(h["url"] as? String) ?: bad("url")
            }
            if ((kind == Kind.URL || kind == Kind.PAGE) && url == null) bad("url required")
            val title = Text.cleanTitle(h["title"]?.let { it as? String ?: jsString(it) }).ifEmpty { null }
            var size: Long? = null
            var sha: String? = null
            var mime: String? = null
            var name: String? = null
            if (kind != Kind.URL) {
                size = h["size"].asSafeLong()
                if (size == null || size < 0 || size > Limits.MAX_ENCODED * 4) bad("size")
                sha = h["sha256"] as? String
                if (sha == null || !SHA_RE.matches(sha)) bad("sha256")
                mime = if (kind == Kind.PAGE) "text/html" else cleanMime(h["mime"])
                if (kind == Kind.FILE) name = Text.safeFileName(h["name"]?.let { it as? String ?: jsString(it) }, "document")
            }
            val enc = h["enc"]?.let { it as? String ?: bad("enc") } ?: ENC_IDENTITY
            if (enc != ENC_IDENTITY && enc != ENC_DEFLATE_RAW) bad("enc")
            val parts = if (h["parts"] == null) 1L else h["parts"].asSafeLong() ?: bad("parts")
            val part = if (h["part"] == null) 0L else h["part"].asSafeLong() ?: bad("parts")
            if (parts < 1 || parts > Limits.MAX_PARTS || part < 0 || part >= parts) bad("parts")
            val sent = (h["sent"] as? String)?.take(40) ?: ""
            val from = Text.cleanName(h["from"]?.let { it as? String ?: jsString(it) }).ifEmpty { null }
            val app = (h["app"] as? String)?.take(60)
            return ItemHeader(id, kind, url, title, name, mime, size, sha, enc, part.toInt(), parts.toInt(), sent, from, app)
        }

        private fun cleanMime(v: Any?): String {
            val s = (v as? String)?.takeIf { it.isNotEmpty() } ?: v?.let(::jsString)?.takeIf { it.isNotEmpty() }
            return (s ?: "application/octet-stream").lowercase(java.util.Locale.ROOT).take(100)
        }

        /** `String(x)` for the non-string JSON values a hostile header might carry. */
        private fun jsString(v: Any?): String = when (v) {
            null -> ""
            is Double -> if (v == Math.floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()
            is Boolean -> v.toString()
            is List<*> -> v.joinToString(",") { jsString(it) }
            is Map<*, *> -> "[object Object]"
            else -> v.toString()
        }
    }
}

/** An ack header (PROTOCOL 2.4). */
data class AckHeader(val ids: List<String>, val sent: String, val from: String? = null) {
    fun toJson(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        m["v"] = Limits.PROTOCOL_VERSION
        m["kind"] = "ack"
        m["ids"] = ids.take(Limits.MAX_ACK_IDS)
        m["sent"] = sent
        if (!from.isNullOrEmpty()) m["from"] = from
        return m
    }

    companion object {
        /** The item ids an ack frame's header lists (strings only), or null when it is not an ack. */
        fun idsOf(h: Map<String, Any?>): List<String>? {
            if (h["kind"] != "ack") return null
            val ids = h["ids"] as? List<*> ?: return null
            return ids.filterIsInstance<String>()
        }

        fun frame(keys: Keys, ids: List<String>, from: String = "Daylight", sentMs: Long = System.currentTimeMillis(), nonce: ByteArray = Bytes.random(FrameCodec.NONCE_BYTES)): ByteArray =
            FrameCodec.encrypt(keys, Purpose.ACK, AckHeader(ids, Bytes.isoTime(sentMs), Text.cleanName(from)).toJson(), ByteArray(0), nonce)
    }
}
