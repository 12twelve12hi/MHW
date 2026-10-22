package com.daylight.share.core.lab

import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Text

/**
 * Smart intake (LAB-PLAN F16, F11's link-or-excerpt rule; LAB-PROTOCOL 2.9.1): the JS `normaliseShare`,
 * `classifyShare`, `cleanShareUrl`, `findShareUrl`, `shareTitle` and `extractAppleNewsTarget`, rule for rule, pinned by
 * `share/vectors/normalise.json` and lab-vectors.json › labExcerpt › classify. Pure: no network, no URL parser.
 *
 * Every share entry point runs [normaliseShare] while Lab is on: `normaliseShare(text, url, subject, source, clean =
 * labUseOn(…, "F16"))`. Text becomes an excerpt only from an explicit selection (6.5 Q1 = b: [SOURCE_SELECTION]);
 * every "headline + link" share stays a link with the headline as its title.
 */
object Normalise {
    /** `source` for an explicit selection: a selection the user sent as such, or the Options choice "Send as excerpt". */
    const val SOURCE_SELECTION = "selection"

    /** What [classifyShare] and [normaliseShare] decide. */
    object Kinds {
        const val LINK = "link"
        const val EXCERPT = "excerpt"
        const val NOTE = "note"
        const val NONE = "none"
    }

    /** Tracking parameters removed from every URL (F16 step 4); every `utm_*` goes too. */
    val TRACKING_PARAMS: List<String> = listOf(
        "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "igsh", "yclid", "twclid",
        "ttclid", "_hsenc", "_hsmi", "mkt_tok", "ref_src", "ref_url", "__s", "sr_share",
    )

    /**
     * Tracking parameters removed on some sites only. A rule with [domains] matches a host that is one of them or ends
     * in "." + one; a rule with [subdomainsOf] matches a host that ends in "." + it.
     */
    class SiteRule(val domains: List<String>, val subdomainsOf: String?, val params: List<String>)

    val TRACKING_BY_SITE: List<SiteRule> = listOf(
        SiteRule(listOf("youtube.com", "youtu.be", "open.spotify.com"), null, listOf("si")),
        SiteRule(listOf("twitter.com", "x.com"), null, listOf("s", "t")),
        SiteRule(listOf("nytimes.com"), null, listOf("smid", "smtyp")),
        SiteRule(emptyList(), "substack.com", listOf("r", "triedRedirect", "showWelcome")),
    )

    /** A URL found in shared text: the URL and its UTF-16 offsets [start] (inclusive) and [end] (exclusive). */
    data class Found(val url: String, val start: Int, val end: Int)

    /** [classifyShare]'s answer: [kind] (see [Kinds]), the URL (or null) and the text without its URL, trimmed. */
    data class Classified(val kind: String, val url: String?, val text: String)

    /**
     * [normaliseShare]'s answer. [url]: cleaned (null for a note or none); [title]: links only, else null; [excerpt]:
     * the text of an excerpt or note, else null; [orig]: the URL as shared when the cleaned one differs and it is at most
     * [ItemHeader.X_ORIG_MAX] characters: send it as `x-orig` (`OutgoingItem.extras`), which the item builder also leaves
     * out when it would make a small frame large.
     */
    data class Result(val kind: String, val url: String?, val title: String?, val excerpt: String?, val orig: String?) {
        /** The Lab item fields this share asks for (`x-orig` when [orig] is set): `OutgoingItem(…, extras = …)`. */
        val extras: Map<String, String> get() = if (orig != null) mapOf(ItemHeader.X_ORIG to orig) else emptyMap()
    }

    // ---- Finding the URL (step 1)

    private val URL_RUN = Regex("(?i)https?://[^${JsText.WS}<>\"]+")
    private const val URL_TRAIL = ".,;:!?'\"»”’"

    /**
     * F16 step 1: the first http(s) URL in shared text: a run of characters other than whitespace, < > and " that
     * starts with http:// or https:// (any case), without trailing . , ; : ! ? ' " » ” ’ and without a trailing ) or ]
     * while it is unbalanced (repeated until none applies), that passes the web URL rule. Null when there is none.
     */
    fun findShareUrl(text: String?): Found? {
        val t = text ?: ""
        for (m in URL_RUN.findAll(t)) {
            val s = m.value
            var open = s.count { it == '(' }
            var close = s.count { it == ')' }
            var openB = s.count { it == '[' }
            var closeB = s.count { it == ']' }
            var end = s.length
            while (end > 0) {
                val c = s[end - 1]
                if (c in URL_TRAIL) {
                    end--
                } else if (c == ')' && open < close) {
                    close--
                    end--
                } else if (c == ']' && openB < closeB) {
                    closeB--
                    end--
                } else {
                    break
                }
            }
            val u = s.substring(0, end)
            if (Text.webUrl(u) == u) return Found(u, m.range.first, m.range.first + u.length)
        }
        return null
    }

    // ---- Text fragments

    /** True when the URL's fragment holds a text directive (`:~:text=`), as Chrome on Android shares a selection. */
    fun hasTextFragment(url: String?): Boolean {
        val u = url ?: ""
        val h = u.indexOf('#')
        return h >= 0 && u.indexOf(":~:text=", h) >= 0
    }

    /** The URL without its fragment directive (from `:~:` on), and without the '#' when nothing is left before it. */
    fun withoutTextFragment(url: String?): String {
        val u = url ?: ""
        val h = u.indexOf('#')
        if (h < 0) return u
        val k = u.indexOf(":~:", h)
        if (k < 0) return u
        return if (k == h + 1) u.substring(0, h) else u.substring(0, k)
    }

    /**
     * The quoted text of a URL's first text directive: its start and end (prefix- and -suffix left out), each
     * percent-decoded (left as it is when that fails) and trimmed, empty parts dropped, joined with " … ". "" when there
     * is none.
     */
    fun textFragmentText(url: String?): String {
        val u = url ?: ""
        val h = u.indexOf('#')
        if (h < 0) return ""
        val k = u.indexOf(":~:", h)
        if (k < 0) return ""
        val directive = u.substring(k + 3).split('&').firstOrNull { it.startsWith("text=") } ?: return ""
        var parts = directive.substring(5).split(',')
        if (parts.size > 1 && parts[0].endsWith("-")) parts = parts.drop(1)
        if (parts.size > 1 && parts.last().startsWith("-")) parts = parts.dropLast(1)
        return parts.map { JsText.trim(JsText.decodeURIComponent(it) ?: it) }.filter { it.isNotEmpty() }.joinToString(" … ")
    }

    private val QUOTE_PAIRS = listOf("\"" to "\"", "“" to "”", "'" to "'", "‘" to "’", "«" to "»", "„" to "“")

    /** Removes one pair of quotes around the whole text ("…", “…”, '…', ‘…’, «…», „…“), then trims. */
    private fun unquote(s: String): String {
        for ((a, b) in QUOTE_PAIRS) {
            if (s.length >= 2 && s.startsWith(a) && s.endsWith(b)) return JsText.trim(s.substring(a.length, s.length - b.length))
        }
        return s
    }

    // ---- Link or excerpt (step 2)

    /**
     * Link or excerpt (F11 with 6.5 Q1 = b; LAB-PROTOCOL 2.9.1 step 2). The URL is [url] when it passes the web URL rule,
     * else the first one in [text]; the rest is the text without the found URL, trimmed (a selection given with its
     * page's [url] loses the URL found in it only when that is the page URL). Then: [source] is "selection" -> an
     * excerpt of the rest (a note without a URL, a link when nothing is left, none without either), where with a
     * text-fragment URL one pair of quotes is removed and an empty rest is the fragment's own text; no URL -> a note
     * (none when empty); everything else -> a link with the rest as its title. [title] is unused under 6.5 Q1 = b.
     */
    @Suppress("UNUSED_PARAMETER")
    fun classifyShare(text: String? = "", url: String? = "", title: String? = "", source: String? = ""): Classified {
        val t = text ?: ""
        val found = findShareUrl(t)
        val given = if (!url.isNullOrEmpty()) Text.webUrl(url) else null
        val u = given ?: found?.url
        val selection = source == SOURCE_SELECTION
        val take = found != null && !(selection && given != null && found.url != given)
        val rest = JsText.trim(if (take) t.substring(0, found!!.start) + t.substring(found.end) else t)
        if (selection) {
            val quote = if (u != null && hasTextFragment(u)) unquote(rest).ifEmpty { textFragmentText(u) } else rest
            if (quote.isNotEmpty()) return Classified(if (u != null) Kinds.EXCERPT else Kinds.NOTE, u, quote)
            return if (u != null) Classified(Kinds.LINK, u, "") else Classified(Kinds.NONE, null, "")
        }
        if (u == null) return if (rest.isNotEmpty()) Classified(Kinds.NOTE, null, rest) else Classified(Kinds.NONE, null, "")
        return Classified(Kinds.LINK, u, rest)
    }

    // ---- Cleaning (step 3)

    private val GOOGLE_HOST = Regex("^(?:www\\.)?google(?:\\.[a-z]{2,3}){1,2}")
    private val SUBSTACK_PATH = Regex("^/pub/([A-Za-z0-9-]+)/p/([^/]+)(/.*)?", RegexOption.DOT_MATCHES_ALL)

    private fun hostIs(host: String, domain: String) = host == domain || host.endsWith(".$domain")

    private fun paramName(piece: String): String = piece.indexOf('=').let { if (it < 0) piece else piece.substring(0, it) }

    /** The first parameter named exactly [name], percent-decoded as UTF-8 ('+' stays '+'), or null (also when invalid). */
    private fun queryParam(query: String?, name: String): String? {
        if (query == null) return null
        for (piece in query.split('&')) {
            if (paramName(piece) != name) continue
            val eq = piece.indexOf('=')
            return JsText.decodeURIComponent(if (eq < 0) "" else piece.substring(eq + 1))
        }
        return null
    }

    /** One unwrap step of F16 step 3, or null. The caller checks the result with the web URL rule. */
    private fun unwrapOnce(u: String): String? {
        val p = JsText.urlParts(u)
        fun tail(from: Int) = p.path.substring(from) + (if (p.query == null) "" else "?" + p.query) + (if (p.fragment == null) "" else "#" + p.fragment)
        fun firstValid(vararg vs: String?) = vs.firstOrNull { it != null && Text.webUrl(it) != null }
        if (GOOGLE_HOST.matches(p.host)) {
            if (p.path.startsWith("/amp/s/")) return "https://" + tail(7)
            if (p.path == "/url") return firstValid(queryParam(p.query, "q"), queryParam(p.query, "url"))
        }
        if (p.host.endsWith(".cdn.ampproject.org")) {
            if (p.path.startsWith("/c/s/") || p.path.startsWith("/v/s/")) return "https://" + tail(5)
            if (p.path.startsWith("/c/")) return "http://" + tail(3)
        }
        if ((p.host == "l.facebook.com" || p.host == "lm.facebook.com") && p.path == "/l.php") return queryParam(p.query, "u")
        if (p.host == "l.instagram.com" && (p.path == "" || p.path == "/")) return queryParam(p.query, "u")
        if ((p.host == "www.linkedin.com" || p.host == "linkedin.com") && (p.path == "/safety/go" || p.path == "/safety/go/")) {
            return queryParam(p.query, "url")
        }
        if (p.host == "open.substack.com") {
            val m = SUBSTACK_PATH.matchEntire(p.path)
            if (m != null) {
                return "https://${m.groupValues[1].lowercase(java.util.Locale.ROOT)}.substack.com/p/${m.groupValues[2]}${m.groupValues[3]}" + tail(p.path.length)
            }
        }
        return null
    }

    private fun isTracking(name: String, host: String): Boolean {
        if (name.startsWith("utm_") || name in TRACKING_PARAMS) return true
        for (r in TRACKING_BY_SITE) {
            val site = if (r.subdomainsOf != null) host.endsWith("." + r.subdomainsOf) else r.domains.any { hostIs(host, it) }
            if (site && name in r.params) return true
        }
        return false
    }

    /** F16 step 4: removes tracking parameters. Nothing else changes; a URL with none to remove comes back unchanged. */
    private fun stripTracking(u: String): String {
        val p = JsText.urlParts(u)
        val query = p.query ?: return u
        val pieces = query.split('&')
        val keep = pieces.filter { !isTracking(paramName(it), p.host) }
        if (keep.size == pieces.size) return u
        val q = keep.filter { it.isNotEmpty() }.joinToString("&")
        return p.join(q.ifEmpty { null })
    }

    /**
     * F16 steps 3 and 4 on a URL that passes the web URL rule: unwrap redirectors without the network (Google AMP and
     * /url, the AMP cache, Facebook, Instagram, LinkedIn, open.substack.com; at most 5 steps, each result checked with
     * the web URL rule), then remove tracking parameters. The cleaned URL (the input itself when nothing applies), or
     * null for an input that is not a web URL.
     */
    fun cleanShareUrl(url: String?): String? {
        var cur = Text.webUrl(url) ?: return null
        for (i in 0 until 5) {
            val next = unwrapOnce(cur)
            val ok = next?.let(Text::webUrl)
            if (ok == null || ok == cur) break
            cur = ok
        }
        return stripTracking(cur)
    }

    // ---- Titles (step 4)

    private val EMPTY_PAIRS = Regex("\\([${JsText.WS}]*\\)|\\[[${JsText.WS}]*]|<[${JsText.WS}]*>|\"[${JsText.WS}]*\"|“[${JsText.WS}]*”|‘[${JsText.WS}]*’|«[${JsText.WS}]*»")
    private const val TITLE_EDGE = " -–—:|·\"'“”‘’«»„"
    private const val TITLE_PUNCT = ".,;!?"

    /**
     * A title from shared text whose URL was taken out: the empty pairs a URL leaves behind, () [] <> "" “” ‘’ «»
     * (with only whitespace inside), become a space; whitespace is collapsed; then, until none applies, whitespace,
     * - – — : | · and quotes are trimmed from both ends, . , ; ! ? from the start, and . , ; ! ? from the end when a
     * space comes before them; then `Text.cleanTitle`.
     */
    fun shareTitle(text: String?): String {
        val s = JsText.collapse(EMPTY_PAIRS.replace(text ?: "", " "))
        var a = 0
        var b = s.length
        var moved = true
        while (moved) {
            moved = false
            while (a < b && (s[a] in TITLE_EDGE || s[a] in TITLE_PUNCT)) {
                a++
                moved = true
            }
            while (b > a && s[b - 1] in TITLE_EDGE) {
                b--
                moved = true
            }
            var k = b
            while (k > a && s[k - 1] in TITLE_PUNCT) k--
            if (k < b && k > a && s[k - 1] == ' ') {
                b = k
                moved = true
            }
        }
        return Text.cleanTitle(s.substring(a, b))
    }

    // ---- normaliseShare

    /**
     * Smart intake (F16), for every entry point while Lab is on. The kind and the URL come from [classifyShare]; the URL
     * is [cleanShareUrl]'s result, or exactly as found or given when [clean] is false (F16's Use switch off, 2.9.6:
     * then [Result.orig] is null too). A link's title is [subject] when it is not empty, else the text without its URL
     * ([shareTitle]); a headline is always a title, however long. Apple News links stay as they are here (only iPhone
     * and Mac resolve them).
     */
    fun normaliseShare(text: String? = "", url: String? = "", subject: String? = "", source: String? = "", clean: Boolean = true): Result {
        val c = classifyShare(text, url, subject, source)
        var outUrl: String? = null
        var orig: String? = null
        if (c.url != null) {
            outUrl = if (!clean) c.url else cleanShareUrl(c.url)
            if (outUrl != c.url && c.url.length <= ItemHeader.X_ORIG_MAX) orig = c.url
        }
        var title: String? = null
        var excerpt: String? = null
        if (c.kind == Kinds.EXCERPT || c.kind == Kinds.NOTE) {
            excerpt = c.text
        } else if (c.kind == Kinds.LINK) {
            title = Text.cleanTitle(subject).ifEmpty { shareTitle(c.text) }.ifEmpty { null }
        }
        return Result(c.kind, outUrl, title, excerpt, orig)
    }

    // ---- Apple News (step 5)

    /** True for an Apple News link (apple.news or a subdomain): iPhone and Mac resolve these (F16 step 5). */
    fun isAppleNewsUrl(url: String?): Boolean {
        val u = Text.webUrl(url) ?: return false
        return hostIs(JsText.urlParts(u).host, "apple.news")
    }

    private const val REDIRECT = "redirectToUrlAfterTimeout("
    private val JS_ESCAPE = Regex("\\\\(u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[\\s\\S])")
    private val BODY = Regex("(?i)<body[${JsText.WS}>]")

    /**
     * The string argument of the first `redirectToUrlAfterTimeout(` + optional whitespace + a quoted string (`\\` escapes
     * any character inside it), or null when no such call is complete: the JS regex
     * `/redirectToUrlAfterTimeout\(\s*(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1/`, scanned linearly.
     */
    private fun redirectArgument(s: String): String? {
        var from = 0
        while (true) {
            val at = s.indexOf(REDIRECT, from)
            if (at < 0) return null
            from = at + 1
            var i = at + REDIRECT.length
            while (i < s.length && JsText.isWs(s[i])) i++
            if (i >= s.length || (s[i] != '"' && s[i] != '\'')) continue
            val q = s[i]
            var j = i + 1
            while (j < s.length) {
                val c = s[j]
                if (c == '\\') {
                    if (j + 1 >= s.length) break
                    j += 2
                } else if (c == q) {
                    return s.substring(i + 1, j)
                } else {
                    j++
                }
            }
        }
    }

    /**
     * F16 step 5, the pure part: the article an Apple News page points to. The string argument of
     * redirectToUrlAfterTimeout("…") (JavaScript escapes undone), else the first `<a href>` after `<body` whose value
     * (character references undone) passes the web URL rule; else null.
     */
    fun extractAppleNewsTarget(html: String?): String? {
        val s = html ?: ""
        redirectArgument(s)?.let { arg ->
            val target = JS_ESCAPE.replace(arg) { m ->
                val e = m.groupValues[1]
                if (e.length > 1 && (e[0] == 'u' || e[0] == 'x')) e.substring(1).toInt(16).toChar().toString() else e
            }
            Text.webUrl(target)?.let { return it }
        }
        val body = BODY.find(s)?.range?.first ?: return null
        var p = s.indexOf('<', body)
        while (p >= 0) {
            val isA = p + 2 <= s.length - 1 && (s[p + 1] == 'a' || s[p + 1] == 'A') && (JsText.isWs(s[p + 2]) || s[p + 2] == '>')
            if (isA) {
                val gt = JsText.tagEnd(s, p + 2)
                if (gt >= 0) {
                    val href = JsText.attrValue(s.substring(p + 2, gt), "href")
                    val u = href?.let { Text.webUrl(JsText.decodeEntities(it)) }
                    if (u != null) return u
                    p = s.indexOf('<', gt + 1)
                    continue
                }
            }
            p = s.indexOf('<', p + 1)
        }
        return null
    }
}
