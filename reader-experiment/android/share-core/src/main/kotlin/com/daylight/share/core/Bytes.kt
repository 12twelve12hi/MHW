package com.daylight.share.core

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64

/** Byte helpers shared by the protocol classes. Everything here mirrors `js/daylight-share.js`. */
object Bytes {
    private val random = SecureRandom()
    private const val HEX = "0123456789abcdef"

    fun random(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

    fun sha256(vararg parts: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        for (p in parts) md.update(p)
        return md.digest()
    }

    fun toHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            sb.append(HEX[v ushr 4]).append(HEX[v and 15])
        }
        return sb.toString()
    }

    fun fromHex(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "odd hex length" }
        return ByteArray(hex.length / 2) { i ->
            val hi = Character.digit(hex[i * 2], 16)
            val lo = Character.digit(hex[i * 2 + 1], 16)
            require(hi >= 0 && lo >= 0) { "not hex" }
            ((hi shl 4) or lo).toByte()
        }
    }

    fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)

    /** Strict UTF-8 (like `new TextDecoder('utf-8', {fatal: true})`): null for malformed input. */
    fun fromUtf8Strict(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes, offset, length))
            .toString()
    } catch (e: CharacterCodingException) {
        null
    }

    /** Standard base64 with `=` padding and no line breaks. */
    fun toBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    /** Strict standard base64 (padding optional, surrounding whitespace trimmed); null for anything else. */
    fun fromBase64OrNull(s: String): ByteArray? {
        val t = s.trim()
        if (t.length % 4 == 1) return null
        val clean = t.trimEnd('=')
        if (t.length - clean.length > 2) return null
        for (c in clean) {
            val ok = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '/'
            if (!ok) return null
        }
        return try {
            Base64.getDecoder().decode(clean)
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    fun concat(vararg parts: ByteArray): ByteArray {
        val out = ByteArray(parts.sumOf { it.size })
        var o = 0
        for (p in parts) {
            System.arraycopy(p, 0, out, o, p.size)
            o += p.size
        }
        return out
    }

    fun u32be(n: Int): ByteArray =
        byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())

    fun readU32be(b: ByteArray, off: Int): Long =
        ((b[off].toLong() and 0xff) shl 24) or ((b[off + 1].toLong() and 0xff) shl 16) or
            ((b[off + 2].toLong() and 0xff) shl 8) or (b[off + 3].toLong() and 0xff)

    private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** ISO 8601 UTC with milliseconds, like `Date.prototype.toISOString()`. */
    fun isoTime(ms: Long): String = ISO.format(Instant.ofEpochMilli(ms))

    /** Parses [isoTime] output (and other ISO instants); null when it is not one. */
    fun parseIsoTime(s: String?): Long? = try {
        if (s.isNullOrBlank()) null else Instant.parse(s).toEpochMilli()
    } catch (e: Exception) {
        null
    }
}

/** RFC 4648 base32 (A-Z 2-7), no padding. */
object Base32 {
    const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun encode(bytes: ByteArray): String {
        val sb = StringBuilder((bytes.size * 8 + 4) / 5)
        var buf = 0
        var bits = 0
        for (b in bytes) {
            buf = (buf shl 8) or (b.toInt() and 0xff)
            bits += 8
            while (bits >= 5) {
                bits -= 5
                sb.append(ALPHABET[(buf ushr bits) and 31])
            }
            buf = buf and ((1 shl bits) - 1)
        }
        if (bits > 0) sb.append(ALPHABET[(buf shl (5 - bits)) and 31])
        return sb.toString()
    }

    /** Decodes; trailing bits that do not make a whole byte are ignored. Throws on characters outside the alphabet. */
    fun decode(s: String): ByteArray {
        val out = java.io.ByteArrayOutputStream(s.length * 5 / 8)
        var buf = 0
        var bits = 0
        for (ch in s) {
            val v = ALPHABET.indexOf(ch)
            require(v >= 0) { "bad base32 character" }
            buf = (buf shl 5) or v
            bits += 5
            if (bits >= 8) {
                bits -= 8
                out.write((buf ushr bits) and 0xff)
            }
            buf = buf and ((1 shl bits) - 1)
        }
        return out.toByteArray()
    }
}
