package com.daylight.share.core

/**
 * A small JSON reader and writer, so the protocol module has no dependencies.
 *
 * Values: `null`, [Boolean], [Double] (every number, as in JavaScript), [String], [List] and [Map] (insertion-ordered).
 * [write] produces the same text as `JSON.stringify` for these values (no spaces, keys in insertion order, the same
 * string escaping), so a header serialised here is byte-identical to one serialised by the JavaScript reference.
 */
object Json {
    class ParseException(message: String) : Exception(message)

    fun parse(text: String): Any? {
        val p = Parser(text)
        p.ws()
        val v = p.value(0)
        p.ws()
        if (!p.atEnd()) throw ParseException("trailing characters")
        return v
    }

    fun parseObjectOrNull(text: String): Map<String, Any?>? = try {
        @Suppress("UNCHECKED_CAST")
        parse(text) as? Map<String, Any?>
    } catch (e: ParseException) {
        null
    }

    fun write(value: Any?): String = StringBuilder().also { writeTo(it, value) }.toString()

    private fun writeTo(sb: StringBuilder, v: Any?) {
        when (v) {
            null -> sb.append("null")
            is Boolean -> sb.append(if (v) "true" else "false")
            is String -> quote(sb, v)
            is Int, is Long, is Short, is Byte -> sb.append(v.toString())
            is Double -> sb.append(number(v))
            is Float -> sb.append(number(v.toDouble()))
            is Number -> sb.append(number(v.toDouble()))
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, value) in v) {
                    if (!first) sb.append(',')
                    first = false
                    quote(sb, k.toString())
                    sb.append(':')
                    writeTo(sb, value)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (e in v) {
                    if (!first) sb.append(',')
                    first = false
                    writeTo(sb, e)
                }
                sb.append(']')
            }
            is Array<*> -> writeTo(sb, v.asList())
            else -> quote(sb, v.toString())
        }
    }

    /** JavaScript's number-to-string for the values the protocol uses (integers print without ".0"). */
    private fun number(d: Double): String {
        if (d.isNaN() || d.isInfinite()) return "null"
        if (d == Math.floor(d) && Math.abs(d) < 1e21) return d.toLong().toString()
        return d.toString()
    }

    private fun quote(sb: StringBuilder, s: String) {
        sb.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\b' -> sb.append("\\b")
                c == '\u000C' -> sb.append("\\f")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> sb.append("\\u").append(String.format("%04x", c.code))
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> {
                    sb.append(c).append(s[i + 1])
                    i++
                }
                Character.isSurrogate(c) -> sb.append("\\u").append(String.format("%04x", c.code))
                else -> sb.append(c)
            }
            i++
        }
        sb.append('"')
    }

    private class Parser(val s: String) {
        var i = 0

        fun atEnd() = i >= s.length

        fun ws() {
            while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
        }

        fun fail(why: String): Nothing = throw ParseException("$why at $i")

        fun value(depth: Int): Any? {
            if (depth > 64) fail("too deep")
            if (atEnd()) fail("unexpected end")
            return when (val c = s[i]) {
                '{' -> obj(depth)
                '[' -> arr(depth)
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else fail("unexpected character")
            }
        }

        fun lit(word: String, v: Any?): Any? {
            if (!s.startsWith(word, i)) fail("bad literal")
            i += word.length
            return v
        }

        fun obj(depth: Int): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            i++
            ws()
            if (i < s.length && s[i] == '}') { i++; return m }
            while (true) {
                ws()
                if (atEnd() || s[i] != '"') fail("expected key")
                val k = str()
                ws()
                if (atEnd() || s[i] != ':') fail("expected colon")
                i++
                ws()
                m[k] = value(depth + 1)
                ws()
                if (atEnd()) fail("unexpected end")
                when (s[i]) {
                    ',' -> i++
                    '}' -> { i++; return m }
                    else -> fail("expected , or }")
                }
            }
        }

        fun arr(depth: Int): List<Any?> {
            val l = ArrayList<Any?>()
            i++
            ws()
            if (i < s.length && s[i] == ']') { i++; return l }
            while (true) {
                ws()
                l.add(value(depth + 1))
                ws()
                if (atEnd()) fail("unexpected end")
                when (s[i]) {
                    ',' -> i++
                    ']' -> { i++; return l }
                    else -> fail("expected , or ]")
                }
            }
        }

        fun str(): String {
            i++ // opening quote
            val sb = StringBuilder()
            while (true) {
                if (atEnd()) fail("unterminated string")
                val c = s[i++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (atEnd()) fail("bad escape")
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) fail("bad unicode escape")
                                val code = s.substring(i, i + 4).toIntOrNull(16) ?: fail("bad unicode escape")
                                sb.append(code.toChar())
                                i += 4
                            }
                            else -> fail("bad escape \\$e")
                        }
                    }
                    c < ' ' -> fail("control character in string")
                    else -> sb.append(c)
                }
            }
        }

        fun num(): Double {
            val start = i
            if (s[i] == '-') i++
            if (atEnd()) fail("bad number")
            if (s[i] == '0') {
                i++
            } else if (s[i] in '1'..'9') {
                while (i < s.length && s[i] in '0'..'9') i++
            } else fail("bad number")
            if (i < s.length && s[i] == '.') {
                i++
                val d = i
                while (i < s.length && s[i] in '0'..'9') i++
                if (i == d) fail("bad number")
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                val d = i
                while (i < s.length && s[i] in '0'..'9') i++
                if (i == d) fail("bad number")
            }
            return s.substring(start, i).toDouble()
        }
    }
}

/** Typed reads from a parsed JSON object. */
internal fun Map<String, Any?>.str(key: String): String? = this[key] as? String

internal fun Map<String, Any?>.num(key: String): Double? = this[key] as? Double

/** A JavaScript "safe integer" (what `Number.isSafeInteger` accepts), else null. */
internal fun Any?.asSafeLong(): Long? {
    val d = this as? Double ?: return null
    if (d.isNaN() || d.isInfinite() || d != Math.floor(d) || Math.abs(d) > 9007199254740991.0) return null
    return d.toLong()
}
