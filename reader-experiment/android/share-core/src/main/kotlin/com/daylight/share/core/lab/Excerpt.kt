package com.daylight.share.core.lab

import com.daylight.share.core.BytesBody
import com.daylight.share.core.Bytes
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Text
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * A selection sent as an excerpt (LAB-PLAN F11; LAB-PROTOCOL 2.9.3): the JS `excerptItem`, `excerptHtml`,
 * `excerptMarkdown`, `excerptFileName`, `excerptTitle`, `textFragment`, `excerptDate`, `sanitizeExcerptHtml` and
 * `excerptTextHtml`, pinned by lab-vectors.json › labExcerpt. Excerpts are documents (the Reader would dedupe a page
 * against its article): with a source URL an HTML file whose `url` carries a text fragment, without one a Markdown note.
 * Both carry `x-cap: "excerpt"`. Text becomes an excerpt only from an explicit selection (6.5 Q1 = b, [Normalise]).
 */
object Excerpt {
    const val MAX_CHARS = 50_000
    const val LINE_MAX = 100
    const val NAME_WORDS = 6
    const val TEXT_FRAGMENT_WORDS = 8

    /** The tags an excerpt keeps; `href` only on `a`, and only http(s). */
    val TAGS: List<String> = listOf("p", "br", "b", "strong", "i", "em", "u", "s", "sub", "sup", "a", "ul", "ol", "li", "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6")

    /** Block tags an excerpt keeps as paragraphs, so that their text does not run together. */
    val AS_P: List<String> = listOf("address", "article", "aside", "caption", "center", "dd", "details", "div", "dt", "figcaption", "figure", "footer", "header", "main", "section", "summary", "tr")

    /** Elements an excerpt drops with everything inside them. */
    val DROP: List<String> = listOf("script", "style", "template", "noscript", "iframe", "object", "textarea", "select", "title", "head", "svg", "math", "canvas", "video", "audio", "button")

    /**
     * An excerpt ready to send: `kind` file, [mime] text/html (with a source URL, [url] set) or text/markdown (a note,
     * [url] null), [name], [title], [content] and [extras] (`x-cap: "excerpt"`).
     */
    data class Item(val kind: String, val mime: String, val name: String, val url: String?, val title: String, val content: String, val extras: Map<String, String>) {
        /** The outgoing item and its bytes, for `Outbox.send(item, body)` (with Lab on: the extras are Lab fields). */
        fun toOutgoing(from: String? = null): Pair<OutgoingItem, BytesBody> =
            OutgoingItem(kind, url = url, title = title, name = name, mime = mime, from = from, extras = extras) to BytesBody(Bytes.utf8(content))
    }

    /** sanitizeExcerptHtml's answer: the HTML, and whether text was cut at the limit. */
    data class Html(val html: String, val trimmed: Boolean)

    private fun fill(id: String, vars: Map<String, Any?>) = LabText.fill(LabText[id], vars)

    /** "Excerpt - {first 6 words}.html", or with [note] "Note - {first 6 words}.md" (through `Text.safeFileName`). */
    fun fileName(text: String?, note: Boolean = false): String {
        val bare = LabText[if (note) "excerpt.noteNameBare" else "excerpt.fileNameBare"]
        val w = JsText.words(text).take(NAME_WORDS).joinToString(" ")
        return if (w.isNotEmpty()) Text.safeFileName(fill(if (note) "excerpt.noteName" else "excerpt.fileName", mapOf("words" to w)), bare) else bare
    }

    private val LINE_BREAK = Regex("\r\n|\r|\n")

    /** The excerpt's first line: the first line with text, whitespace collapsed, cut to 100 characters with "…". */
    fun firstLine(text: String?): String {
        val line = LINE_BREAK.split(text ?: "").map { JsText.trim(JsText.collapse(it)) }.firstOrNull { it.isNotEmpty() } ?: ""
        if (JsText.codePoints(line) <= LINE_MAX) return line
        return JsText.trimEnd(JsText.takeCodePoints(line, LINE_MAX)) + "…"
    }

    /** "“{first line}” · {page title}" ("“{first line}”" without one; the page title alone without a line), cleaned. */
    fun title(text: String?, pageTitle: String? = ""): String {
        val line = firstLine(text)
        val page = Text.cleanTitle(pageTitle)
        if (line.isEmpty()) return page
        return Text.cleanTitle(if (page.isNotEmpty()) fill("excerpt.title", mapOf("line" to line, "page" to page)) else fill("excerpt.titleBare", mapOf("line" to line)))
    }

    /**
     * The source URL plus a text fragment of the first 8 words: the URL without its fragment, then "#:~:text=" and the
     * words joined with one space, UTF-8 percent-encoded except A-Z a-z 0-9 _ . ! ~ * ' ( ). The URL unchanged when there
     * are no words, the text cannot be encoded, or the result is over 4,096 characters or fails the web URL rule. Null
     * when the URL fails the web URL rule.
     */
    fun textFragment(url: String?, text: String?): String? {
        val u = Text.webUrl(url) ?: return null
        val w = JsText.words(text).take(TEXT_FRAGMENT_WORDS)
        if (w.isEmpty()) return u
        val enc = JsText.encodeURIComponent(w.joinToString(" "))?.replace("-", "%2D") ?: return u
        val h = u.indexOf('#')
        val out = "${if (h >= 0) u.substring(0, h) else u}#:~:text=$enc"
        return if (out.length <= com.daylight.share.core.Limits.MAX_URL && Text.webUrl(out) == out) out else u
    }

    private val DAY = Regex("([0-9]{4})-([0-9]{2})-([0-9]{2})")

    private fun leap(y: Int) = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    private fun monthDays(y: Int, m: Int) = intArrayOf(31, if (leap(y)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[m - 1]

    /**
     * "22 October 2026" from "YYYY-MM-DD" (fields checked as rule D checks them), from ms since 1970 (a [Number]) or a
     * [java.util.Date] in the device's time zone ([zone]), or from a [LocalDate]. "" for anything else.
     */
    fun date(date: Any?, zone: ZoneId = ZoneId.systemDefault()): String {
        val y: Int
        val m: Int
        val d: Int
        when (date) {
            is String -> {
                val r = DAY.matchEntire(date) ?: return ""
                y = r.groupValues[1].toInt()
                m = r.groupValues[2].toInt()
                d = r.groupValues[3].toInt()
                if (m < 1 || m > 12 || d < 1 || d > monthDays(y, m)) return ""
            }
            is Number, is java.util.Date -> {
                val ms = if (date is java.util.Date) date.time.toDouble() else (date as Number).toDouble()
                if (ms.isNaN() || ms.isInfinite() || Math.abs(ms) > 8.64e15) return ""
                val local = Instant.ofEpochMilli(ms.toLong()).atZone(zone).toLocalDate()
                y = local.year
                m = local.monthValue
                d = local.dayOfMonth
            }
            is LocalDate -> {
                y = date.year
                m = date.monthValue
                d = date.dayOfMonth
            }
            else -> return ""
        }
        return fill("excerpt.date", mapOf("d" to d, "month" to LabText.list("excerpt.months")[m - 1], "y" to y))
    }

    private val ENTITY_AT = Regex("&(?:[A-Za-z][A-Za-z0-9]{0,31}|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});")
    private val OTHER_MARKUP = Regex("<[!?][^>]*>?")

    /** Removes comments: `<!--` to the first `-->` after it, or to the end. */
    private fun dropComments(s: String): String {
        if (!s.contains("<!--")) return s
        val out = StringBuilder(s.length)
        var from = 0
        while (true) {
            val open = s.indexOf("<!--", from)
            if (open < 0) break
            out.append(s, from, open)
            val close = s.indexOf("-->", open + 4)
            if (close < 0) return out.toString()
            from = close + 3
        }
        return out.append(s, from, s.length).toString()
    }

    /**
     * Step 2 of [sanitize] for one name, in one pass: each `<name` followed by whitespace, / or > (any case), up to the
     * next >, and everything after it to the first `</name` + optional whitespace + `>` (or to the end), is removed. An
     * opening tag with no > after it stays (and so does everything after it).
     */
    private val DROP_PATTERNS: Map<String, Pair<Regex, Regex>> by lazy {
        DROP.associateWith { name -> Regex("(?i)<$name(?=[${JsText.WS}/>])") to Regex("(?i)</$name[${JsText.WS}]*>") }
    }

    private fun dropElement(s: String, name: String): String {
        val (open, close) = DROP_PATTERNS.getValue(name)
        val out = StringBuilder()
        var from = 0
        while (true) {
            val m = open.find(s, from) ?: break
            val gt = s.indexOf('>', m.range.first + 1 + name.length)
            if (gt < 0) break // no > after this one, so none after any later one either
            out.append(s, from, m.range.first)
            val c = close.find(s, gt + 1) ?: return out.toString()
            from = c.range.last + 1
        }
        return out.append(s, from, s.length).toString()
    }

    /**
     * An excerpt's selection HTML, sanitised (LAB-PROTOCOL 2.9.3): comments and other markup removed, [DROP] elements
     * removed with their content, then text escaped and tags kept only from [TAGS] ([AS_P] as `p`), with no attributes
     * but an `a`'s http(s) `href`; closing tags close what they open, and everything open is closed at the end. Text past
     * [maxChars] characters (a character reference counts as one) is cut, and [Html.trimmed] says so.
     */
    fun sanitize(html: String?, maxChars: Int = MAX_CHARS): Html {
        var s = OTHER_MARKUP.replace(dropComments(html ?: ""), "")
        for (name in DROP) s = dropElement(s, name)
        val out = StringBuilder()
        var count = 0
        var trimmed = false
        val stack = ArrayList<String>()
        fun text(raw: String, from: Int, to: Int): Boolean {
            var i = from
            while (i < to) {
                if (count >= maxChars) {
                    trimmed = true
                    return false
                }
                when (val c = raw[i]) {
                    '&' -> {
                        val ref = ENTITY_AT.matchAt(raw.substring(i, minOf(to, i + 40)), 0)
                        if (ref != null) {
                            out.append(ref.value)
                            i += ref.value.length
                            count++
                            continue
                        }
                        out.append("&amp;")
                    }
                    '<' -> out.append("&lt;")
                    '>' -> out.append("&gt;")
                    else -> {
                        val n = if (Character.isHighSurrogate(c) && i + 1 < to && Character.isLowSurrogate(raw[i + 1])) 2 else 1
                        out.append(raw, i, i + n)
                        i += n
                        count++
                        continue
                    }
                }
                i++
                count++
            }
            return true
        }
        var last = 0
        for (tag in JsText.tags(s)) {
            if (!text(s, last, tag.start)) break
            last = tag.end
            var name = tag.name.lowercase(java.util.Locale.ROOT)
            if (name in AS_P) name = "p"
            if (name !in TAGS || (name == "br" && tag.closing)) continue
            if (tag.closing) {
                val k = stack.lastIndexOf(name)
                if (k >= 0) while (stack.size > k) out.append("</").append(stack.removeAt(stack.size - 1)).append('>')
            } else if (name == "br") {
                out.append("<br>")
            } else {
                val href = if (name == "a") JsText.attrValue(tag.attrs, "href") else null
                val u = href?.let { Text.webUrl(JsText.decodeEntities(it)) }
                out.append(if (u != null) "<a href=\"${JsText.escapeAttr(u)}\">" else "<$name>")
                stack += name
            }
        }
        if (!trimmed) text(s, last, s.length)
        while (stack.isNotEmpty()) out.append("</").append(stack.removeAt(stack.size - 1)).append('>')
        return Html(out.toString(), trimmed)
    }

    /**
     * Plain selection text as excerpt HTML: CRLF and CR as LF, cut to [maxChars] characters, then paragraphs (split at
     * lines that are only whitespace) of escaped lines joined with `<br>`.
     */
    fun textHtml(text: String?, maxChars: Int = MAX_CHARS): Html {
        var t = JsText.lf(text ?: "")
        val trimmed = JsText.codePoints(t) > maxChars
        if (trimmed) t = JsText.takeCodePoints(t, maxChars)
        val paras = ArrayList<List<String>>()
        var cur = ArrayList<String>()
        for (line in t.split('\n')) {
            if (line.all(JsText::isWs)) {
                if (cur.isNotEmpty()) {
                    paras += cur
                    cur = ArrayList()
                }
            } else {
                cur += line
            }
        }
        if (cur.isNotEmpty()) paras += cur
        return Html(paras.joinToString("") { p -> "<p>" + p.joinToString("<br>") { JsText.escapeText(it) } + "</p>" }, trimmed)
    }

    /**
     * The excerpt document, for a selection with a source URL (LAB-PROTOCOL 2.9.3): a title, then
     * `<p><a href="{source}">{page title}</a> · {site} · {date}</p><blockquote>{selection}</blockquote>`. The source is
     * [url] without its text fragment; the site is [site], else the URL's host without "www.", left out when it equals
     * the link's text; the date is [date] through [Excerpt.date]. The selection is [sanitize] of [html] when it has text,
     * else [textHtml] of [text].
     */
    fun html(text: String? = "", html: String? = "", url: String? = "", pageTitle: String? = "", site: String? = "", date: Any? = null, zone: ZoneId = ZoneId.systemDefault()): String {
        val src = if (!url.isNullOrEmpty()) Text.webUrl(url) else null
        val source = if (src != null) Normalise.withoutTextFragment(src) else ""
        val body = if (JsText.trim(html ?: "").isNotEmpty()) sanitize(html) else textHtml(JsText.trim(text ?: ""))
        val quote = body.html + if (body.trimmed) "<p>${JsText.escapeText(LabText["excerpt.trimmed"])}</p>" else ""
        val page = Text.cleanTitle(pageTitle)
        val host = if (source.isNotEmpty()) JsText.urlParts(source).host.removePrefix("www.") else ""
        val siteName = Text.cleanTitle(site).ifEmpty { host }
        val linkText = page.ifEmpty { siteName }
        val parts = ArrayList<String>()
        if (source.isNotEmpty()) parts += "<a href=\"${JsText.escapeAttr(source)}\">${JsText.escapeText(linkText.ifEmpty { source })}</a>"
        else if (linkText.isNotEmpty()) parts += JsText.escapeText(linkText)
        if (siteName.isNotEmpty() && siteName != linkText) parts += JsText.escapeText(siteName)
        val d = date(date, zone)
        if (d.isNotEmpty()) parts += JsText.escapeText(d)
        val head = if (parts.isNotEmpty()) "<p>${parts.joinToString(" · ")}</p>" else ""
        return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + JsText.escapeText(title(text, pageTitle)) +
            "</title></head><body><article>\n" + head + "<blockquote>" + quote + "</blockquote></article></body></html>"
    }

    /**
     * The note for text without a URL: the text (CRLF and CR as LF, trimmed; over 50,000 characters cut and followed by
     * a blank line and "(Excerpt trimmed to 50,000 characters.)"), a blank line, "— shared from {app} on {date}" ("—
     * shared on {date}" without an app, "— shared from {app}" without a date, nothing without either), and a final LF.
     */
    fun markdown(text: String? = "", app: String? = "", date: Any? = null, zone: ZoneId = ZoneId.systemDefault()): String {
        val t = JsText.trim(JsText.lf(text ?: ""))
        val body = if (JsText.codePoints(t) > MAX_CHARS) "${JsText.takeCodePoints(t, MAX_CHARS)}\n\n${LabText["excerpt.trimmed"]}" else t
        val a = Text.cleanName(app)
        val d = date(date, zone)
        val footer = when {
            a.isNotEmpty() && d.isNotEmpty() -> fill("excerpt.sharedFromOn", mapOf("app" to a, "date" to d))
            d.isNotEmpty() -> fill("excerpt.sharedOn", mapOf("date" to d))
            a.isNotEmpty() -> fill("excerpt.sharedFrom", mapOf("app" to a))
            else -> ""
        }
        return if (footer.isNotEmpty()) "$body\n\n$footer\n" else "$body\n"
    }

    /**
     * The item for a selection, ready to send: with a source [url] (passing the web URL rule) an HTML document whose
     * `url` is the source with a text fragment (kept as it is when it already has one); without one a Markdown note.
     * Null when the text is empty. [date]: "YYYY-MM-DD", or ms in local time; [app]: where a note came from ("Notes").
     */
    fun item(text: String? = "", html: String? = "", url: String? = "", pageTitle: String? = "", site: String? = "", app: String? = "", date: Any? = null, zone: ZoneId = ZoneId.systemDefault()): Item? {
        val t = JsText.trim(text ?: "")
        if (t.isEmpty()) return null
        val extras = mapOf(ItemHeader.X_CAP to "excerpt")
        val src = if (!url.isNullOrEmpty()) Text.webUrl(url) else null
        if (src != null) {
            return Item(
                Kind.FILE, "text/html", fileName(t), if (Normalise.hasTextFragment(src)) src else textFragment(src, t),
                title(t, pageTitle), html(t, html, src, pageTitle, site, date, zone), extras,
            )
        }
        return Item(Kind.FILE, "text/markdown", fileName(t, note = true), null, title(t), markdown(t, app, date, zone), extras)
    }
}
