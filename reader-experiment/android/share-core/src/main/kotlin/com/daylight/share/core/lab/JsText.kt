package com.daylight.share.core.lab

import com.daylight.share.core.Text
import java.util.Locale

/**
 * The textual building blocks of the W1 reference functions (LAB-PROTOCOL 2.9), as `share/js/daylight-lab.js` defines
 * them, so [Normalise], [Excerpt] and [SetupCheck] give the JS results character for character:
 *
 * - **Whitespace** is ECMAScript's `\s` ([WS]), never Java's `\s`; `\b` is spelled out with ASCII word characters.
 * - **Case-insensitive** patterns use the inline `(?i)` flag, which is ASCII-only in Java as `i` is in JS without `u`
 *   (Kotlin's `RegexOption.IGNORE_CASE` also adds Unicode case, so "ſ" would match "s").
 * - `$` is never used for "end of input": Java's `$` also matches before a final line break.
 * - Every pattern that the reference runs with a repeated group over a long run (tags, the Apple News redirect) is a
 *   hand-written linear scanner here: Java's regex engine recurses once per iteration of such a group, so a long
 *   hostile run would overflow the stack, where the reference only spends time.
 */
internal object JsText {
    /** The body of a regex character class for ECMAScript's `\s`. */
    const val WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

    /** JS `\b` before a word character, and after one. */
    const val WORD_START = "(?<![A-Za-z0-9_])"
    const val WORD_END = "(?![A-Za-z0-9_])"

    private val WS_RUN = Regex("[$WS]+")

    fun isWs(c: Char): Boolean = Text.isJsWhitespace(c)

    /** `String.prototype.trim`. */
    fun trim(s: String): String = Text.jsTrim(s)

    /** `String.prototype.trimEnd`. */
    fun trimEnd(s: String): String = s.trimEnd(::isWs)

    /** `s.replace(/\s+/g, ' ')`: each whitespace run becomes one space (not trimmed). */
    fun collapse(s: String): String = WS_RUN.replace(s, " ")

    /** `s.trim().split(/\s+/).filter(Boolean)`: the whitespace-separated words. */
    fun words(s: String?): List<String> = WS_RUN.split(trim(s ?: "")).filter { it.isNotEmpty() }

    /** Code points (`Array.from(s).length`; a lone surrogate counts as one). */
    fun codePoints(s: String): Int = s.codePointCount(0, s.length)

    /** The first [n] code points (`Array.from(s).slice(0, n).join('')`). */
    fun takeCodePoints(s: String, n: Int): String = if (codePoints(s) <= n) s else s.substring(0, s.offsetByCodePoints(0, n))

    /** CRLF and CR become LF (`s.replace(/\r\n?/g, '\n')`). */
    fun lf(s: String): String = s.replace("\r\n", "\n").replace('\r', '\n')

    /** Text escaped for HTML text: `&`, `<`, `>`. */
    fun escapeText(s: String): String = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    /** Text escaped for a quoted attribute: [escapeText] and `"`. */
    fun escapeAttr(s: String): String = escapeText(s).replace("\"", "&quot;")

    private val HEX = "0123456789ABCDEF"

    /**
     * `decodeURIComponent`: every `%XX` decoded as UTF-8 (`+` stays `+`). null where the JS throws: a `%` without two
     * hex digits, or bytes that are not one valid UTF-8 code point (overlong, a surrogate, over U+10FFFF, a bad
     * continuation).
     */
    fun decodeURIComponent(s: String): String? {
        if (s.indexOf('%') < 0) return s
        val out = StringBuilder(s.length)
        var i = 0
        fun hex(c: Char): Int = when (c) {
            in '0'..'9' -> c - '0'
            in 'a'..'f' -> c - 'a' + 10
            in 'A'..'F' -> c - 'A' + 10
            else -> -1
        }
        // The byte of the escape "%XX" at k, or -1 (no '%' there, or not two hex digits before the end).
        fun byteAt(k: Int): Int {
            if (k + 2 >= s.length || s[k] != '%') return -1
            val h = hex(s[k + 1])
            val l = hex(s[k + 2])
            return if (h < 0 || l < 0) -1 else h * 16 + l
        }
        while (i < s.length) {
            val c = s[i]
            if (c != '%') {
                out.append(c)
                i++
                continue
            }
            val b = byteAt(i)
            if (b < 0) return null
            i += 3
            if (b < 0x80) {
                out.append(b.toChar())
                continue
            }
            val n = when {
                b and 0xE0 == 0xC0 -> 2
                b and 0xF0 == 0xE0 -> 3
                b and 0xF8 == 0xF0 -> 4
                else -> return null
            }
            var cp = b and (0xFF shr (n + 1))
            for (k in 1 until n) {
                val cb = byteAt(i)
                if (cb < 0 || cb and 0xC0 != 0x80) return null
                cp = (cp shl 6) or (cb and 0x3F)
                i += 3
            }
            val min = when (n) {
                2 -> 0x80
                3 -> 0x800
                else -> 0x10000
            }
            if (cp < min || cp > 0x10FFFF || cp in 0xD800..0xDFFF) return null
            out.appendCodePoint(cp)
        }
        return out.toString()
    }

    /**
     * `encodeURIComponent`: UTF-8, percent-encoded with uppercase hex, except `A-Z a-z 0-9 - _ . ! ~ * ' ( )`. null
     * where the JS throws (a lone surrogate).
     */
    fun encodeURIComponent(s: String): String? {
        val out = StringBuilder(s.length * 3)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c in "-_.!~*'()") {
                out.append(c)
                i++
                continue
            }
            val cp: Int
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= s.length || !Character.isLowSurrogate(s[i + 1])) return null
                cp = Character.toCodePoint(c, s[i + 1])
                i += 2
            } else if (Character.isLowSurrogate(c)) {
                return null
            } else {
                cp = c.code
                i++
            }
            for (b in String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)) {
                val v = b.toInt() and 0xFF
                out.append('%').append(HEX[v shr 4]).append(HEX[v and 15])
            }
        }
        return out.toString()
    }

    /** A URL as text (the input has passed the web URL rule): the JS `urlParts`. */
    class UrlParts(
        val scheme: String,
        val authority: String,
        val hostport: String,
        /** Lowercased, without the port; a bracketed IPv6 address keeps its brackets. */
        val host: String,
        val path: String,
        val query: String?,
        val fragment: String?,
    ) {
        fun join(query: String? = this.query): String =
            "$scheme://$authority$path${if (query == null) "" else "?$query"}${if (fragment == null) "" else "#$fragment"}"
    }

    fun urlParts(u: String): UrlParts {
        val i = u.indexOf("://")
        var rest = u.substring(i + 3)
        var fragment: String? = null
        var query: String? = null
        val h = rest.indexOf('#')
        if (h >= 0) {
            fragment = rest.substring(h + 1)
            rest = rest.substring(0, h)
        }
        val q = rest.indexOf('?')
        if (q >= 0) {
            query = rest.substring(q + 1)
            rest = rest.substring(0, q)
        }
        val slash = rest.indexOf('/')
        val authority = if (slash >= 0) rest.substring(0, slash) else rest
        val hostport = authority.substring(authority.lastIndexOf('@') + 1)
        val host = if (hostport.startsWith("[")) {
            hostport.substring(0, hostport.indexOf(']') + 1)
        } else {
            val c = hostport.indexOf(':')
            if (c < 0) hostport else hostport.substring(0, c)
        }
        return UrlParts(u.substring(0, i), authority, hostport, host.lowercase(Locale.ROOT), if (slash >= 0) rest.substring(slash) else "", query, fragment)
    }

    private val ENTITY = Regex("&(amp|lt|gt|quot|apos|#39|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});")

    /** Undoes the character references a serialiser writes: &amp; &lt; &gt; &quot; &#39; &apos; and numeric ones. */
    fun decodeEntities(s: String): String = ENTITY.replace(s) { m ->
        when (val e = m.groupValues[1]) {
            "amp" -> "&"
            "lt" -> "<"
            "gt" -> ">"
            "quot" -> "\""
            "apos", "#39" -> "'"
            else -> {
                val n = if (e[1] == 'x' || e[1] == 'X') e.substring(2).toLong(16) else e.substring(1).toLong()
                if (n > 0 && n <= 0x10FFFF && (n < 0xD800 || n > 0xDFFF)) String(Character.toChars(n.toInt())) else m.value
            }
        }
    }

    private val ATTR = Regex("(?:^|[$WS\"'/])([^$WS\"'>/=]+)(?:[$WS]*=[$WS]*(?:\"([^\"]*)\"|'([^']*)'|([^$WS\"'=<>`]+)))?")

    /** An attribute's raw value (quoted with " or ', or unquoted) in a tag's attribute text, or null. */
    fun attrValue(attrs: String, name: String): String? {
        for (m in ATTR.findAll(attrs)) {
            if (m.groupValues[1].lowercase(Locale.ROOT) == name) {
                return m.groups[2]?.value ?: m.groups[3]?.value ?: m.groups[4]?.value ?: ""
            }
        }
        return null
    }

    /**
     * The attribute part of a tag, `((?:[^<>"']|"[^<"]*"|'[^<']*')*)>`, from [from]: the index of its closing `>`, or -1
     * when no tag ends there. Linear: the scan never passes a `<`.
     */
    fun tagEnd(s: String, from: Int): Int {
        var j = from
        while (j < s.length) {
            when (val c = s[j]) {
                '>' -> return j
                '<' -> return -1
                '"', '\'' -> {
                    var k = j + 1
                    while (k < s.length && s[k] != c && s[k] != '<') k++
                    if (k >= s.length || s[k] == '<') return -1
                    j = k + 1
                }
                else -> j++
            }
        }
        return -1
    }

    /** One tag found by [tags]: `<` [closing] [name] [attrs] `>`, from [start] to [end] (exclusive). */
    class Tag(val start: Int, val end: Int, val closing: Boolean, val name: String, val attrs: String)

    private fun isNameChar(c: Char) = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '-'

    /**
     * The JS `TAG_RE` (`<(\/?)([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9-])((?:[^<>"']|"[^<"]*"|'[^<']*')*)>`, global), as a
     * sequence of matches from left to right.
     */
    fun tags(s: String): Sequence<Tag> = sequence {
        var p = s.indexOf('<')
        while (p >= 0) {
            var j = p + 1
            val closing = j < s.length && s[j] == '/'
            if (closing) j++
            var tag: Tag? = null
            if (j < s.length && (s[j] in 'A'..'Z' || s[j] in 'a'..'z')) {
                val nameStart = j
                while (j < s.length && isNameChar(s[j])) j++
                val gt = tagEnd(s, j)
                if (gt >= 0) tag = Tag(p, gt + 1, closing, s.substring(nameStart, j), s.substring(j, gt))
            }
            if (tag != null) {
                yield(tag)
                p = s.indexOf('<', tag.end)
            } else {
                p = s.indexOf('<', p + 1)
            }
        }
    }
}
