package com.daylight.share.core.lab

import com.daylight.share.core.Json
import com.daylight.share.core.MockRelay
import com.daylight.share.core.lab.Vectors.norm
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.util.Random
import java.util.concurrent.TimeUnit
import kotlin.io.path.createTempDirectory

/**
 * The W1 port against the JS reference itself, beyond the vectors: thousands of random inputs built from the pieces
 * that make the rules differ between platforms (ECMAScript whitespace, `\b`, ASCII-only case folding, lone surrogates,
 * percent escapes, character references, unclosed tags and quotes, redirectors and tracking parameters) go through
 * both `share/js/daylight-lab.js` (under node, src/test/js/w1-reference.mjs) and [Normalise], [Excerpt], [SetupCheck]
 * and [LabText], which must answer exactly alike. The seed is fixed, so a failure reproduces.
 */
class W1DifferentialTest {
    private val rnd = Random(20261022)

    private val tokens = listOf(
        "a", "Z", "9", "_", "-", ".", ",", ";", ":", "!", "?", "'", "\"", "(", ")", "[", "]", "<", ">", "&", "#", "%", "/", "=", "+", "*",
        "~", "|", "·", "—", "–", "…", " ", "  ", "\t", "\n", "\r\n", "\r", " ", " ", "　", "﻿", "\u0085", "\u000B",
        "​", "“", "”", "‘", "’", "«", "»", "„", "é", "ſ", "K", "İ", "Σ", "😀", "\uD800", "\uDC00",
        "http://", "https://", "HTTPS://", "Http://", "www.", "WWW.", "example.com", "e.com/a", "?utm_source=x", "&fbclid=1", "#frag", "#:~:text=",
        "Knead%20the%20dough", "%E2%80%94", "%C3", "%zz", "-,", "text=a,b", "&amp;", "&#x41;", "&#39;", "&lt;", "&nosuch;", "&#xD800;",
        "<a href=\"https://e.com/x\">", "<a href='javascript:alert(1)'>", "<a href=https://e.com/y>", "<A HREF=\"http://e.com/&amp;z\">", "</a>", "<p>",
        "</p>", "<br/>", "</br>", "<div>", "</div>", "<script>", "</script>", "<script ", "<style>", "</style >", "<!--", "-->", "<!doctype>",
        "<?xml?>", "<b>", "<B>", "<em class=x>", "</em>", "<svg/onload=x>", "<scr", "ipt>", "<h1>", "<li>", "<SECTION>", "<a", " title=\"x>y\"",
        "SERVER-ABCD-EF", "daylightserver://x?y", "dls-0123456789abcdef0123456789abcdef", "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23",
        "abcdefghijklmnopqrstuvwxyz23", "chrome-extension://abc/p", "redirectToUrlAfterTimeout(", "\\u0026", "\\x41", "\\\"", "<body>", "<BODY ",
        "google.com/amp/s/", "www.google.co.uk/url?q=", "l.facebook.com/l.php?u=", "x.cdn.ampproject.org/c/s/", "open.substack.com/pub/Jane/p/hello",
        "www.linkedin.com/safety/go?url=", "https%3A%2F%2Fe.com%2Fz", "youtube.com/watch?v=1&si=2", "x.com/a?s=20&t=3", "jane.substack.com/p/x?r=1",
        "nytimes.com/a?smid=1&smtyp=2", "apple.news/Ab1", "Opinion | ", "Title", "word ", "Sentence. ", "()", "[]", "\"\"", "“”", "@", "user:pw@",
        ":8080", "[::1]",
    )

    private fun pick(list: List<String>) = list[rnd.nextInt(list.size)]
    private fun text(max: Int = 14) = buildString { repeat(rnd.nextInt(max + 1)) { append(pick(tokens)) } }

    private val hosts = listOf(
        "example.com", "www.example.com", "e.com", "www.google.com", "google.co.uk", "x.cdn.ampproject.org", "l.facebook.com", "lm.facebook.com",
        "l.instagram.com", "www.linkedin.com", "open.substack.com", "jane.substack.com", "www.youtube.com", "youtu.be", "x.com", "twitter.com",
        "www.nytimes.com", "apple.news", "EXAMPLE.org:8443", "user@host.example", "[::1]:8080",
    )
    private val paths = listOf("", "/", "/a", "/amp/s/e.com/story", "/url", "/l.php", "/safety/go", "/pub/Jane/p/hello/x", "/c/e.com/b", "/v/s/e.com/c", "/watch", "/Path(1)")
    private val queries = listOf(
        "", "?q=https%3A%2F%2Fe.com%2Fz", "?url=https://e.com/u", "?u=https%3A%2F%2Fe.com%2Fv%3Fa%3D1&h=x", "?utm_source=x&id=1", "?id=1&fbclid=2&",
        "?si=3&v=1", "?s=20&t=1&x=2", "?smid=a&smtyp=b&keep=1", "?r=1&triedRedirect=true", "?q=%zz", "?q=%E2%80", "?=&&", "?UTM_source=1",
    )
    private val frags = listOf("", "#x", "#:~:text=Knead%20the,-dough", "#top:~:text=a-,b,c,-d", "#:~:text=%zz", "#:~:text=", "#a#b")

    private fun url(): String = when (rnd.nextInt(6)) {
        0 -> text(4)
        1 -> pick(listOf("http://", "https://", "HTTPS://")) + text(5)
        else -> pick(listOf("https://", "http://", "HTTPS://")) + pick(hosts) + pick(paths) + pick(queries) + pick(frags)
    }

    private fun mixed(): String = buildString { repeat(rnd.nextInt(5)) { append(if (rnd.nextInt(3) == 0) url() else text(6)) } }

    private val dates = listOf("2026-10-22", "2024-02-29", "2025-02-29", "2026-13-01", "", "2026-1-01", "yesterday")

    private class Case(val fn: String, val args: List<Any?>, val kotlin: () -> Any?)

    private fun cases(): List<Case> {
        val out = ArrayList<Case>()
        fun add(n: Int, make: () -> Case) = repeat(n) { out += make() }
        add(600) {
            val t = mixed()
            val u = if (rnd.nextBoolean()) "" else url()
            val subj = if (rnd.nextInt(4) == 0) text(4) else ""
            val src = if (rnd.nextInt(3) == 0) "selection" else ""
            val clean = rnd.nextInt(5) != 0
            Case("normaliseShare", listOf(mapOf("text" to t, "url" to u, "subject" to subj, "source" to src, "clean" to clean))) {
                Normalise.normaliseShare(t, u, subj, src, clean).let { linkedMapOf("kind" to it.kind, "url" to it.url, "title" to it.title, "excerpt" to it.excerpt, "orig" to it.orig) }
            }
        }
        add(300) {
            val t = mixed()
            val u = if (rnd.nextBoolean()) "" else url()
            val src = if (rnd.nextBoolean()) "selection" else "share"
            Case("classifyShare", listOf(mapOf("text" to t, "url" to u, "title" to "", "source" to src))) {
                Normalise.classifyShare(t, u, "", src).let { linkedMapOf("kind" to it.kind, "url" to it.url, "text" to it.text) }
            }
        }
        add(500) { val u = url(); Case("cleanShareUrl", listOf(u)) { Normalise.cleanShareUrl(u) } }
        add(300) { val t = mixed(); Case("findShareUrl", listOf(t)) { Normalise.findShareUrl(t)?.let { linkedMapOf("url" to it.url, "start" to it.start, "end" to it.end) } } }
        add(300) { val t = text(10); Case("shareTitle", listOf(t)) { Normalise.shareTitle(t) } }
        add(200) { val u = url(); Case("textFragmentText", listOf(u)) { Normalise.textFragmentText(u) } }
        add(200) { val u = url(); Case("withoutTextFragment", listOf(u)) { Normalise.withoutTextFragment(u) } }
        add(400) {
            val h = buildString { repeat(rnd.nextInt(8)) { append(if (rnd.nextInt(4) == 0) "\"" + url() + "\"" else pick(tokens)) } }
            Case("extractAppleNewsTarget", listOf(h)) { Normalise.extractAppleNewsTarget(h) }
        }
        add(800) {
            val h = text(20)
            val max = if (rnd.nextInt(3) == 0) rnd.nextInt(12) else 50_000
            Case("sanitizeExcerptHtml", listOf(h, max)) { Excerpt.sanitize(h, max).let { linkedMapOf("html" to it.html, "trimmed" to it.trimmed) } }
        }
        add(200) {
            val t = text(12)
            val max = if (rnd.nextBoolean()) rnd.nextInt(10) else 50_000
            Case("excerptTextHtml", listOf(t, max)) { Excerpt.textHtml(t, max).let { linkedMapOf("html" to it.html, "trimmed" to it.trimmed) } }
        }
        add(400) {
            val t = mixed()
            val h = if (rnd.nextInt(3) == 0) text(10) else ""
            val u = if (rnd.nextInt(4) == 0) "" else url()
            val page = if (rnd.nextBoolean()) text(5) else ""
            val site = if (rnd.nextInt(3) == 0) text(3) else ""
            val app = if (rnd.nextBoolean()) text(3) else ""
            val d = pick(dates)
            Case("excerptItem", listOf(mapOf("text" to t, "html" to h, "url" to u, "pageTitle" to page, "site" to site, "app" to app, "date" to d))) {
                Excerpt.item(t, h, u, page, site, app, d)?.let {
                    linkedMapOf<String, Any?>("kind" to it.kind, "mime" to it.mime, "name" to it.name).apply {
                        if (it.url != null) put("url", it.url)
                        put("title", it.title)
                        put("content", it.content)
                        put("extras", it.extras)
                    }
                }
            }
        }
        add(150) {
            val t = text(10)
            val app = text(3)
            val d = pick(dates)
            Case("excerptMarkdown", listOf(mapOf("text" to t, "app" to app, "date" to d))) { Excerpt.markdown(t, app, d) }
        }
        add(200) { val t = text(10); val note = rnd.nextBoolean(); Case("excerptFileName", listOf(t, mapOf("note" to note))) { Excerpt.fileName(t, note) } }
        add(200) { val t = text(10); val p = text(4); Case("excerptTitle", listOf(mapOf("text" to t, "pageTitle" to p))) { Excerpt.title(t, p) } }
        add(300) { val u = url(); val t = text(10); Case("textFragment", listOf(u, t)) { Excerpt.textFragment(u, t) } }
        add(60) { val d = if (rnd.nextBoolean()) pick(dates) else "20${rnd.nextInt(100)}-${rnd.nextInt(14)}-${rnd.nextInt(33)}"; Case("excerptDate", listOf(d)) { Excerpt.date(d) } }
        add(800) { val t = mixed(); Case("redactDiagnostics", listOf(t)) { SetupCheck.redactDiagnostics(t) } }
        add(100) { val h = if (rnd.nextBoolean()) url() else text(3); val f = text(2); Case("hostLineText", listOf(h, f)) { LabText.hostLineText(h, f) } }
        add(150) {
            val kind = pick(listOf("url", "page", "file"))
            val cap = pick(listOf("seen", "clean", "excerpt", "test", "bogus", ""))
            val size = rnd.nextInt(20_000_000).toLong()
            val from = text(3)
            val extras: Map<String, String> = if (cap.isEmpty()) emptyMap() else mapOf("x-cap" to cap)
            Case("inboxKindLine", listOf(mapOf<String, Any?>("kind" to kind, "extras" to extras, "size" to size, "from" to from))) {
                LabText.inboxKindLine(kind, extras, size, from)
            }
        }
        add(150) { val u = url(); Case("cleanedFromText", listOf(u)) { LabText.cleanedFromText(u) } }
        return out
    }

    @Test
    fun theKotlinPortAnswersAsTheJsReferenceDoes() {
        Assume.assumeTrue("node is needed for the JS reference", MockRelay.nodeAvailable())
        val all = cases()
        val dir = createTempDirectory("dls-w1-diff").toFile()
        val input = File(dir, "cases.json")
        input.writeText(Json.write(all.map { linkedMapOf("fn" to it.fn, "args" to it.args) }))
        val lib = File(MockRelay.shareDir, "js/daylight-lab.js")
        val script = File("src/test/js/w1-reference.mjs").absolutePath
        val p = ProcessBuilder(MockRelay.node, script, lib.path, input.path).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val text = p.inputStream.bufferedReader(Charsets.UTF_8).readText()
        assertTrue("node finished", p.waitFor(300, TimeUnit.SECONDS) && p.exitValue() == 0)
        val js = (Json.parse(text.trim()) as List<*>).map { it.obj() }
        assertTrue(js.size == all.size)
        val misses = ArrayList<String>()
        val counts = LinkedHashMap<String, Int>()
        for ((i, c) in all.withIndex()) {
            counts[c.fn] = (counts[c.fn] ?: 0) + 1
            val ref = js[i]
            val got = try {
                norm(c.kotlin())
            } catch (e: Exception) {
                "threw $e"
            }
            val want = if (ref.containsKey("error")) "threw ${ref["error"]}" else ref["out"]
            if (got != want && misses.size < 25) misses += "${c.fn}(${Json.write(c.args)})\n    js:     ${Json.write(want)}\n    kotlin: ${Json.write(got)}"
        }
        println("W1 differential: ${all.size} cases, ${misses.size} differ; $counts")
        assertTrue("the Kotlin port differs from the JS reference:\n" + misses.joinToString("\n"), misses.isEmpty())
    }
}
