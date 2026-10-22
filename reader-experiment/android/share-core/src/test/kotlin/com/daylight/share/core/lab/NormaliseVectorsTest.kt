package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.BytesBody
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.ItemBuilder
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Keys
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Purpose
import com.daylight.share.core.Text
import com.daylight.share.core.lab.Vectors.norm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

/**
 * Smart intake (F16) and the W1 rules no vector can pin, against ../../share/vectors/normalise.json (made by the JS
 * reference, LAB-PROTOCOL 2.9): every case exactly, x-orig on part 0 (left out over 1,024 characters or when it would
 * make a small frame large), the Apple News pages; then the headline + link shares, hostile input that must stay
 * linear (and must not overflow the JVM's stack), the sanitiser against hostile HTML, and tracking removal that leaves
 * everything else byte for byte.
 */
class NormaliseVectorsTest {
    private val n get() = Vectors.normalise

    private fun resultJson(r: Normalise.Result) = norm(linkedMapOf("kind" to r.kind, "url" to r.url, "title" to r.title, "excerpt" to r.excerpt, "orig" to r.orig))

    @Test
    fun cases() {
        val cases = n["cases"].objs()
        assertTrue("F16.1: at least 50 cases", cases.size >= 50)
        for (c in cases) {
            val i = c["input"].obj()
            val r = Normalise.normaliseShare(i["text"] as String?, i["url"] as String?, i["subject"] as String?, i["source"] as String?, i["clean"] != false)
            assertEquals(c["name"] as String, c["expect"], resultJson(r))
            assertEquals(c["name"] as String, r.orig?.let { mapOf(ItemHeader.X_ORIG to it) } ?: emptyMap<String, String>(), r.extras)
        }
    }

    /** F11.5, F16.1: the real headline + link shares stay links with the headline as the title. */
    @Test
    fun headlineAndLinkSharesStayLinks() {
        val shares = n["cases"].objs().filter { Regex("^(NYT|Guardian|Apple News|Substack|X:|Chrome on Android)").containsMatchIn(it["name"] as String) }
        assertTrue(shares.size >= 10)
        for (c in shares) {
            assertEquals(c["name"] as String, "link", c["expect"].obj()["kind"])
            val text = c["input"].obj()["text"] as String?
            if (text != null && !text.startsWith("http")) assertTrue(c["name"] as String, c["expect"].obj()["title"] != null)
        }
    }

    @Test
    fun xOrigFrames() {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        val keys = Keys.derive(md.digest(Bytes.utf8("vector-secret-1")).copyOf(16))
        val id = Bytes.toHex(java.security.MessageDigest.getInstance("SHA-256").digest(Bytes.utf8("x-orig-id"))).substring(0, 32)
        for (c in n["xOrigFrames"].objs()) {
            val name = c["name"] as String
            val item = c["item"].obj()
            val content = (item["contentHex"] as String?)?.let(Bytes::fromHex) ?: (item["contentText"] as String?)?.let(Bytes::utf8)
            val extras = c["extras"].obj().mapValues { it.value as String }
            val out = OutgoingItem(
                item["kind"] as String, id = id, url = item["url"] as String?, title = item["title"] as String?, name = item["name"] as String?,
                mime = item["mime"] as String?, sent = "2026-10-20T08:00:00.000Z", extras = extras,
            )
            val p = ItemBuilder.prepare(out, content?.let(::BytesBody), compress = false)
            val want = c["expect"].obj()
            assertEquals(name, want["fields"], norm(p.header.extras))
            val frame = p.frame(keys, 0)
            val header = FrameCodec.open(keys, Purpose.INBOX, frame).header
            assertEquals(name, want["fields"], norm(header.filterKeys { it.startsWith("x-") }))
            assertEquals(name, want["small"], FrameCodec.isSmall(frame.size.toLong()))
            assertEquals(name, frame.size.toLong(), p.frameLength(0))
            // and a receiver reads them back as extras (2.3)
            assertEquals(name, want["fields"], norm(ItemHeader.check(header).extras))
        }
        // Without extras the frames are exactly v1.1's: no x- field at all.
        val plain = ItemBuilder.prepare(OutgoingItem("url", id = id, url = "https://example.com/", sent = "2026-10-20T08:00:00.000Z"), null)
        assertTrue(FrameCodec.open(keys, Purpose.INBOX, plain.frame(keys, 0)).header.keys.none { it.startsWith("x-") })
    }

    @Test
    fun appleNews() {
        for (c in n["appleNews"].objs()) assertEquals(c["name"] as String, c["expect"], Normalise.extractAppleNewsTarget(c["html"] as String))
        assertTrue(Normalise.isAppleNewsUrl("https://apple.news/AbC123"))
        assertTrue(Normalise.isAppleNewsUrl("https://www.apple.news/AbC123"))
        assertFalse(Normalise.isAppleNewsUrl("https://notapple.news/AbC123"))
        assertFalse(Normalise.isAppleNewsUrl("apple.news/AbC123"))
        // An apple.news link stays as it is: only iPhone and Mac resolve it.
        assertEquals("https://apple.news/AbC123", Normalise.normaliseShare(url = "https://apple.news/AbC123").url)
    }

    @Test
    fun aHeadlineIsAlwaysATitleAndExcerptsNeedAnExplicitSelection() {
        val long = (0 until 120).joinToString(" ") { "word$it" } + ". Another sentence. And a third!"
        val r = Normalise.normaliseShare("$long https://example.com/x")
        assertEquals("link", r.kind)
        assertNull(r.excerpt)
        assertTrue(r.title!!.startsWith("word0 word1"))
        assertEquals(300, r.title!!.codePointCount(0, r.title!!.length))
        val s = Normalise.normaliseShare(long, "https://example.com/x", source = Normalise.SOURCE_SELECTION)
        assertEquals("excerpt", s.kind)
        assertNull(s.title)
        assertEquals(long, s.excerpt)
    }

    @Test
    fun aTextFragmentAloneNeverMakesAnExcerpt() {
        // Chrome on Android sharing a page opened from a Google result (Google adds the fragment)
        val g = Normalise.normaliseShare("How to bake bread - BBC Food\nhttps://www.bbc.co.uk/food/bread#:~:text=Knead%20the%20dough")
        assertEquals(Normalise.Result("link", "https://www.bbc.co.uk/food/bread#:~:text=Knead%20the%20dough", "How to bake bread - BBC Food", null, null), g)
        for ((text, url) in listOf("" to "https://example.com/a#:~:text=hello", "https://example.com/a#:~:text=hello" to "")) {
            val r = Normalise.normaliseShare(text, url)
            assertEquals("link", r.kind)
            assertNull(r.excerpt)
            assertEquals("My title", Normalise.normaliseShare(text, url, subject = "My title").title)
        }
        val quoted = "“Knead the dough.”\nhttps://example.com/bread#:~:text=Knead%20the%20dough"
        assertEquals("link", Normalise.normaliseShare(quoted).kind)
        assertEquals(
            Normalise.Result("excerpt", "https://example.com/bread#:~:text=Knead%20the%20dough", null, "Knead the dough.", null),
            Normalise.normaliseShare(quoted, source = Normalise.SOURCE_SELECTION),
        )
        assertEquals("hello", Normalise.normaliseShare(url = "https://example.com/a#:~:text=hello", source = Normalise.SOURCE_SELECTION).excerpt)
        // F16's Use switch off: the URL as found, no orig
        val off = Normalise.normaliseShare("Story https://example.com/s?utm_source=x", clean = false)
        assertEquals("https://example.com/s?utm_source=x", off.url)
        assertNull(off.orig)
        assertEquals("Story", off.title)
    }

    /** F16.3: a URL whose only change is removed tracking parameters is otherwise byte-identical. */
    @Test
    fun trackingRemovalChangesNothingElse() {
        val rnd = Random(7)
        val names = listOf("a", "id", "Q", "page", "utm_source", "utm_x", "fbclid", "gclid", "si", "s", "t", "smid", "r", "keep_me", "UTM_source", "")
        val hosts = listOf("example.com", "www.youtube.com", "x.com", "www.nytimes.com", "jane.substack.com", "Example.ORG:8443")
        for (i in 0 until 400) {
            val host = hosts[rnd.nextInt(hosts.size)]
            val pieces = List(rnd.nextInt(6)) {
                val nm = names[rnd.nextInt(names.size)]
                if (rnd.nextInt(4) == 0) nm else "$nm=${listOf("1", "A%20b", "", "x=y")[rnd.nextInt(4)]}"
            }
            val frag = if (rnd.nextInt(3) == 0) "#Frag-$i" else ""
            val url = "https://$host/Path/$i${if (pieces.isNotEmpty() || rnd.nextInt(2) == 1) "?" + pieces.joinToString("&") else ""}$frag"
            val out = Normalise.cleanShareUrl(url)
            fun tracked(p: String): Boolean {
                val nm = p.split('=')[0]
                val h = host.lowercase().split(':')[0]
                return nm.startsWith("utm_") || nm in Normalise.TRACKING_PARAMS || (nm == "si" && h.endsWith("youtube.com")) ||
                    (nm in listOf("s", "t") && h == "x.com") || (nm == "smid" && h.endsWith("nytimes.com")) || (nm == "r" && h.endsWith(".substack.com"))
            }
            if (pieces.none(::tracked)) {
                assertEquals(url, url, out)
                continue
            }
            val kept = pieces.filter { !tracked(it) && it.isNotEmpty() }.joinToString("&")
            assertEquals(url, "https://$host/Path/$i${if (kept.isNotEmpty()) "?$kept" else ""}$frag", out)
        }
    }

    @Test
    fun hostileSelectionHtmlKeepsOnlyAllowedTags() {
        val hostile = listOf(
            "<img src=x onerror=alert(1)>", "<svg/onload=alert(1)>", "<a href=\"java&#115;cript:alert(1)\">x</a>",
            "<a href=\" javascript:alert(1)\">x</a>", "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>",
            "</blockquote></article><script>alert(1)</script>", "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
            "<p style=\"background:url(javascript:alert(1))\">x</p>", "<a href=\"https://ok.example/\" onclick=\"alert(1)\">ok</a>",
            "<<script>script>alert(1)<</script>/script>", "<scr<script>ipt>alert(1)</scr</script>ipt>", "<p\nonmouseover=alert(1)>x</p>",
        )
        for (h in hostile) {
            val html = Excerpt.sanitize(h).html
            for (m in Regex("</?([a-zA-Z0-9]+)([^>]*)>").findAll(html)) {
                assertTrue("$h -> $html", m.groupValues[1] in Excerpt.TAGS)
                assertTrue("$h -> $html", m.groupValues[2] == "" || Regex("^ href=\"https?://[^\"]*\"$").matches(m.groupValues[2]))
            }
            assertFalse("$h -> $html", Regex("(?i)<script|javascript:|onerror|onload|onclick|onmouseover=").containsMatchIn(html.replace(Regex("&lt;[^&]*&gt;|&lt;"), "")))
            val doc = Excerpt.html("x", h, "https://example.com/")
            assertEquals("$h: one blockquote", 2, doc.split("</blockquote>").size)
            assertTrue(doc.endsWith("</blockquote></article></body></html>"))
        }
    }

    /**
     * The reference's linear-time inputs, plus what would overflow the JVM's stack if a rule were a regex with a
     * repeated group: each must finish in a few seconds (a quadratic rule takes minutes on these).
     */
    @Test
    fun hostileInputStaysLinear() {
        val inputs: List<Pair<String, () -> Any?>> = listOf(
            "a \" x60000" to { Excerpt.sanitize("<a \"".repeat(60000)) },
            "p title=\" x30000" to { Excerpt.sanitize("<p title=\"".repeat(30000) + ">") },
            "<!-- x50000" to { Excerpt.sanitize("<!--".repeat(50000)) },
            "<script> x30000" to { Excerpt.sanitize("<script>".repeat(30000)) },
            "unbalanced )" to { Normalise.normaliseShare("see http://e.com/" + ")".repeat(200000)) },
            "dashes" to { Normalise.normaliseShare("-".repeat(200000) + "x https://e.com/a") },
            "dots" to { Normalise.normaliseShare(". ".repeat(100000) + "https://e.com/a") },
            "apple <a \"" to { Normalise.extractAppleNewsTarget("<body>" + "<a \"".repeat(60000)) },
            "apple redirect" to { Normalise.extractAppleNewsTarget("redirectToUrlAfterTimeout(\"" + "x".repeat(200000)) },
            "<script x20000" to { Excerpt.sanitize("<script ".repeat(20000)) },
            "<style/ x20000" to { Excerpt.sanitize("<style/".repeat(20000) + "</style") },
            "< + a x100000" to { Excerpt.sanitize("<" + "a".repeat(100000)) },
            "< + a- x50000" to { Excerpt.sanitize("<" + "a-".repeat(50000) + " x") },
            "AAAA- x80000" to { SetupCheck.redactDiagnostics("AAAA-".repeat(80000)) },
            "a. x100000" to { SetupCheck.redactDiagnostics("a.".repeat(100000)) },
            "www. x50000" to { SetupCheck.redactDiagnostics("www.".repeat(50000)) },
            "a1+ x100000" to { SetupCheck.redactDiagnostics("a1+".repeat(100000) + ":/") },
            // long runs inside one tag, one quoted value and one redirect string: no regex group repeats over them
            "one long tag" to { Excerpt.sanitize("<p title=\"" + "x".repeat(300000) + "\">t</p>") },
            "one long href" to { Normalise.extractAppleNewsTarget("<body><a href=\"https://e.com/" + "x".repeat(300000) + "\">") },
            "one long redirect" to { Normalise.extractAppleNewsTarget("redirectToUrlAfterTimeout('" + "\\x41".repeat(100000) + "')") },
            "one long attribute run" to { Excerpt.sanitize("<a " + "b=c ".repeat(100000) + "href=\"https://e.com/\">x</a>") },
        )
        for ((name, run) in inputs) {
            val t = System.nanoTime()
            run()
            val ms = (System.nanoTime() - t) / 1_000_000
            assertTrue("$name took $ms ms", ms < 5000)
        }
    }

    @Test
    fun excerptLimitsAndDocuments() {
        val text = "ab ".repeat(20000)
        val item = Excerpt.item(text, url = "https://example.com/a", pageTitle = "A", date = "2026-10-22")!!
        val quote = item.content.split("<blockquote>")[1].split("</blockquote>")[0]
        assertTrue(quote.endsWith("<p>(Excerpt trimmed to 50,000 characters.)</p>"))
        assertEquals(50000 + "(Excerpt trimmed to 50,000 characters.)".length, quote.replace(Regex("<[^>]+>"), "").length)
        assertFalse(Excerpt.item("ab ".repeat(100), url = "https://example.com/a")!!.content.contains("trimmed"))
        val md = Excerpt.markdown(text, "Notes", "2026-10-22")
        assertTrue(md.startsWith("ab ab"))
        assertTrue(md.endsWith("\n\n(Excerpt trimmed to 50,000 characters.)\n\n— shared from Notes on 22 October 2026\n"))
        // F11.4: a page already in the Reader becomes a new document with its own name and text fragment.
        val a = Excerpt.item("One passage from the page.", url = "https://example.com/story", pageTitle = "Story")!!
        val b = Excerpt.item("Another passage from it.", url = "https://example.com/story", pageTitle = "Story")!!
        assertEquals("file", a.kind)
        assertEquals("text/html", a.mime)
        assertNotEquals(a.url, b.url)
        assertTrue(a.url!!.startsWith("https://example.com/story#:~:text="))
        assertTrue(a.content.contains("<a href=\"https://example.com/story\">Story</a>"))
        assertEquals(mapOf("x-cap" to "excerpt"), a.extras)
        assertNull(Excerpt.item("   ", url = "https://example.com/a"))
        // toOutgoing: a file item the builder accepts, with x-cap on part 0
        val (out, body) = a.toOutgoing("Pixel")
        val p = ItemBuilder.prepare(out, body)
        assertEquals("excerpt", p.header.xCap)
        assertEquals(a.name, p.header.name)
        assertEquals(a.url, p.header.url)
    }

    @Test
    fun excerptDateReadsANumberInTheGivenZone() {
        val zone = java.time.ZoneId.of("Pacific/Kiritimati") // UTC+14: the local date differs from the UTC one
        val ms = java.time.ZonedDateTime.of(2026, 10, 22, 1, 0, 0, 0, zone).toInstant().toEpochMilli()
        assertEquals("22 October 2026", Excerpt.date(ms, zone))
        assertEquals("21 October 2026", Excerpt.date(ms, java.time.ZoneOffset.UTC))
        assertEquals("1 January 2026", Excerpt.date(java.time.LocalDate.of(2026, 1, 1)))
        assertEquals("", Excerpt.date(Double.NaN))
        assertEquals("", Excerpt.date(9e15))
        assertEquals("", Excerpt.date("2026-10-22\n"))
    }

    @Test
    fun uriCodingIsTheJsOne() {
        assertEquals("a+b c/é😀", JsText.decodeURIComponent("a+b%20c%2F%C3%A9%F0%9F%98%80"))
        for (bad in listOf("%", "%2", "%zz", "%C3", "%C3%28", "%C0%80", "%ED%A0%80", "%F4%90%80%80", "%80", "%C3%A9%")) assertNull(bad, JsText.decodeURIComponent(bad))
        assertEquals("self%2Dmade%2C%20rock%20%26%20roll%20%E2%80%94%20Caf%C3%A9", JsText.encodeURIComponent("self-made, rock & roll — Café")?.replace("-", "%2D"))
        assertEquals("A-Z_a.z!~*'()", JsText.encodeURIComponent("A-Z_a.z!~*'()"))
        assertNull(JsText.encodeURIComponent("x\uD800y"))
        assertEquals("%F0%9F%98%80", JsText.encodeURIComponent("😀"))
        // a lone surrogate in the words leaves the URL as it is
        assertEquals("https://example.com/a", Excerpt.textFragment("https://example.com/a", "x\uD800"))
    }

    @Test
    fun findShareUrlTrimsWhatTheReferenceTrims() {
        assertEquals("https://en.wikipedia.org/wiki/Foo_(bar)", Normalise.findShareUrl("See https://en.wikipedia.org/wiki/Foo_(bar).")?.url)
        assertEquals("https://example.com/a", Normalise.findShareUrl("(https://example.com/a)")?.url)
        assertEquals("https://example.com/a", Normalise.findShareUrl("“https://example.com/a”")?.url)
        assertEquals(Normalise.Found("HTTPS://example.com/a", 4, 25), Normalise.findShareUrl("Go: HTTPS://example.com/a!"))
        assertNull(Normalise.findShareUrl("no link here"))
        // JS whitespace, not Java's: a no-break space ends the URL
        assertEquals("https://example.com/a", Normalise.findShareUrl("https://example.com/a b")?.url)
        assertEquals(Text.webUrl("https://example.com/a"), Normalise.cleanShareUrl(" https://example.com/a "))
    }
}
