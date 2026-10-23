package com.daylight.share.core.lab

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.regex.Pattern

/**
 * K3 review (Oct 22): the case-insensitive W1 patterns match ASCII letters only, as JS's `i` does without `u`, on
 * every regex engine. The JVM keeps `(?i)` ASCII-only, but Android's java.util.regex runs on ICU, where `(?i)` closes
 * every literal and every class over Unicode case: "ſ" (U+017F, long s) then matches s and "K" (U+212A, the Kelvin
 * sign) matches k, in a class such as `[A-Z]` as well as for a letter, so a phone removed more than the JS reference
 * did. [icuFind] matches a pattern the way ICU does, so this JVM test sees what a device would. W1DifferentialTest
 * cannot: it runs the JVM's own engine against node.
 */
class AsciiCaseTest {
    private val longS = '\u017F'
    private val kelvin = '\u212A'
    private val ws = JsText.WS

    /** Whether ICU would match [re] case-insensitively: `(?i)` anywhere in it, or the IGNORE_CASE option. */
    private fun caseInsensitive(re: Regex): Boolean = re.pattern.contains("(?i") || RegexOption.IGNORE_CASE in re.options

    /**
     * Unicode simple case folding, one char for one char: the lower case of the upper case ("ſ" -> "S" -> "s", "K" ->
     * "k"), except the Turkic "İ" (U+0130) and "ı" (U+0131), which CaseFolding.txt does not fold (ICU keeps "ı" in a
     * class by itself and "İ" with "i̇", never with i).
     */
    private fun fold(c: Char): Char = if (c == '\u0130' || c == '\u0131') c else Character.toLowerCase(Character.toUpperCase(c))

    private fun fold(s: String): String = buildString(s.length) { for (c in s) append(fold(c)) }

    /**
     * Where [re] matches [input] on ICU. A case-insensitive pattern there matches a character wherever its case fold
     * matches: ICU closes the pattern's letters and classes over case (`[A-Z]` holds "ſ" and "K" too). For patterns
     * like these, whose letters are ASCII, that is the JVM's ASCII-only `(?i)` run on the folded input; the fold keeps
     * the length, so the ranges are the input's own. (The JVM's Pattern.UNICODE_CASE is no stand-in: it tries a
     * character's upper and lower case against a class range, and "K"'s are "K" and "k", neither in A-Z.) Without a
     * case-insensitive flag ICU matches as the JVM does.
     */
    private fun icuFind(re: Regex, input: String): List<IntRange> {
        if (!caseInsensitive(re)) return re.findAll(input).map { it.range }.toList()
        return Pattern.compile(re.pattern, Pattern.CASE_INSENSITIVE).toRegex().findAll(fold(input)).map { it.range }.toList()
    }

    /** Every case-insensitive pattern of Normalise, Excerpt and SetupCheck, by name. */
    private val patterns: List<Pair<String, Regex>>
        get() = listOf("Normalise.URL_RUN" to Normalise.URL_RUN, "Normalise.BODY" to Normalise.BODY) +
            Excerpt.DROP_PATTERNS.flatMap { (name, p) -> listOf("Excerpt <$name" to p.first, "Excerpt </$name>" to p.second) } +
            SetupCheck.REDACTIONS.mapIndexed { i, (re, with) -> "SetupCheck.REDACTIONS[$i] $with" to re }

    /** The same patterns as they were before the K3 review's fix, with `(?i)`. */
    private val before: List<Pair<String, Regex>> = listOf(
        "URL_RUN" to Regex("(?i)https?://[^$ws<>\"]+"),
        "BODY" to Regex("(?i)<body[$ws>]"),
        "<style" to Regex("(?i)<style(?=[$ws/>])"),
        "</style>" to Regex("(?i)</style[$ws]*>"),
        "[server code]" to Regex("(?i)daylightserver://[^$ws\"'<>]*"),
        "www [url]" to Regex("(?i)${JsText.WORD_START}www\\.[^$ws\"'<>]+"),
        "[topic]" to Regex("(?i)${JsText.WORD_START}dls-[0-9a-f]{32}${JsText.WORD_END}"),
        "[code]" to Regex("(?i)${JsText.WORD_START}[A-Z2-7]{4}(?:-?[A-Z2-7]{4}){6}${JsText.WORD_END}"),
    )

    /** ASCII words with each s and k swapped for U+017F and U+212A, in every place the patterns look at. */
    private fun swapped(word: String): List<String> = word.indices.filter { word[it].lowercaseChar() == 's' || word[it].lowercaseChar() == 'k' }
        .map { i -> word.substring(0, i) + (if (word[i].lowercaseChar() == 's') longS else kelvin) + word.substring(i + 1) }

    private val inputs: List<String>
        get() {
            val out = ArrayList<String>()
            for (name in Excerpt.DROP) for (w in swapped(name)) out += listOf("<$w>x</$w>", "<p>a<$w>b</$w>c</p>", "<$name>x</$w>y", "<$w/>z")
            for (w in swapped("https")) out += listOf("$w://a/https://e.com", "${w.uppercase()}://a")
            for (w in swapped("daylightserver")) out += "$w://pair?x"
            out += listOf("ww$longS.e.com", "${longS}www.e.com", "${kelvin}www.e.com")
            for (w in swapped("dls")) out += "$w-0123456789abcdef0123456789abcdef"
            out += "${kelvin}dls-0123456789abcdef0123456789abcdef"
            out += "${kelvin}BCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23"
            out += "ABCD-EFGH-IJ${kelvin}L-MNOP-Q${longS}ST-UVWX-YZ23"
            out += "ABCDEFGHIJ${kelvin}LMNOPQRSTUVWXYZ23"
            out += "<bod$kelvin><a href=\"https://e.com/x\">x</a>"
            return out
        }

    /** Where ICU's answer is not the JVM's (which is JS's: W1DifferentialTest) for [pats] on [inputs]. */
    private fun differences(pats: List<Pair<String, Regex>>): List<String> {
        val out = ArrayList<String>()
        for ((name, re) in pats) for (input in inputs) {
            val jvm = re.findAll(input).map { it.range }.toList()
            val icu = icuFind(re, input)
            if (jvm != icu) out += "$name on \"$input\": the JVM (and JS) match $jvm, ICU $icu"
        }
        return out
    }

    @Test
    fun everyPatternMatchesAsJsDoesOnIcu() {
        assertEquals("ICU must match where the JVM and JS do", emptyList<String>(), differences(patterns))
        for ((name, re) in patterns) {
            assertFalse("$name is case-insensitive, which folds Unicode case on Android: spell the letters with JsText.ci", caseInsensitive(re))
        }
    }

    /**
     * The check above fails on the patterns as they were: through "ſ" in a word (dls-, <style, https and the others)
     * and through "K" in the Server code's `[A-Z2-7]` class and in the word-start class before dls- and www. Only
     * `<body` came out the same: it has no s and no k, the only ASCII letters ICU's case closure adds anything to.
     */
    @Test
    fun theOldPatternsDifferOnIcu() {
        val differ = differences(before)
        for ((name, _) in before) {
            val found = differ.any { it.startsWith("$name on ") }
            assertEquals("$name on ICU, among:\n${differ.joinToString("\n")}", name != "BODY", found)
        }
        assertTrue(differ.joinToString("\n"), differ.any { it.startsWith("www [url] on \"$kelvin") })
        assertTrue(differ.joinToString("\n"), differ.any { it.startsWith("[code] on \"${kelvin}BCD-") })
        assertTrue(differ.joinToString("\n"), differ.any { it.startsWith("[code] on \"ABCDEFGHIJ${kelvin}") })
        assertTrue(differ.joinToString("\n"), differ.any { it.startsWith("[topic] on \"${kelvin}dls-") })
    }

    /**
     * [icuFind] closes a class over case as ICU does (UnicodeSet.closeOver(CASE_INSENSITIVE)): `(?i)[A-Z]` holds A-Z,
     * a-z, "ſ" and "K", and nothing else in the BMP; the JVM's UNICODE_CASE leaves "K" out of the range.
     */
    @Test
    fun aClassIsClosedOverCaseAsIcuDoes() {
        val closed = (0..0xFFFF).map { it.toChar() }.filter { icuFind(Regex("(?i)[A-Z]"), it.toString()).isNotEmpty() }
        assertEquals((('A'..'Z') + ('a'..'z') + longS + kelvin).sorted(), closed.sorted())
        val ascii = (0..0xFFFF).map { it.toChar() }.filter { icuFind(Regex("[A-Za-z]"), it.toString()).isNotEmpty() }
        assertEquals((('A'..'Z') + ('a'..'z')).sorted(), ascii.sorted())
        assertTrue(icuFind(Regex("(?i)k"), "$kelvin").isNotEmpty())
        assertFalse(Pattern.compile("[A-Z]", Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE).matcher("$kelvin").matches())
        assertTrue(Pattern.compile("[A-Z]", Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE).matcher("$longS").matches())
    }

    /** The JS reference's answers (node, share/js/daylight-lab.js) for the review's examples, and ASCII case still folds. */
    @Test
    fun theReferenceAnswers() {
        assertEquals("dl$longS-0123456789abcdef0123456789abcdef", SetupCheck.redactDiagnostics("dl$longS-0123456789abcdef0123456789abcdef"))
        assertEquals("daylight$longS[url]", SetupCheck.redactDiagnostics("daylight${longS}erver://x"))
        assertEquals("ww$longS.e.com", SetupCheck.redactDiagnostics("ww$longS.e.com"))
        assertEquals("${kelvin}BCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23", SetupCheck.redactDiagnostics("${kelvin}BCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23"))
        assertEquals(
            "ABCD-EFGH-IJ${kelvin}L-MNOP-Q${longS}ST-UVWX-YZ23 and [topic]",
            SetupCheck.redactDiagnostics("ABCD-EFGH-IJ${kelvin}L-MNOP-Q${longS}ST-UVWX-YZ23 and dls-0123456789ABCDEF0123456789abcdef"),
        )
        assertEquals("[server code] [url] [topic] [code]", SetupCheck.redactDiagnostics("DayLightServer://x WWW.e.com DLS-0123456789abcdef0123456789ABCDEF abcd-efgh-ijkl-mnop-qrst-uvwx-yz23"))

        assertEquals(Excerpt.Html("&lt;${longS}tyle&gt;x&lt;/${longS}tyle&gt;", false), Excerpt.sanitize("<${longS}tyle>x</${longS}tyle>"))
        assertEquals(Excerpt.Html("<p>a&lt;${longS}cript&gt;b&lt;/${longS}cript&gt;c</p>", false), Excerpt.sanitize("<p>a<${longS}cript>b</${longS}cript>c</p>"))
        assertEquals(Excerpt.Html("<p>ac</p>", false), Excerpt.sanitize("<p>a<STYLE>b</Style >c</p>"))

        assertEquals(Normalise.Found("https://e.com", 10, 23), Normalise.findShareUrl("http$longS://a/https://e.com"))
        assertNull(Normalise.findShareUrl("HTTP$longS://a"))
        assertEquals(Normalise.Found("HTTPS://e.com/A", 4, 19), Normalise.findShareUrl("see HTTPS://e.com/A."))

        assertNull(Normalise.extractAppleNewsTarget("<bod$kelvin><a href=\"https://e.com/x\">x</a>"))
        assertEquals("https://e.com/x", Normalise.extractAppleNewsTarget("<BODY><a href=\"https://e.com/x\">x</a>"))
    }

    @Test
    fun ciSpellsOnlyAsciiLetters() {
        assertEquals("[Dd][Ll][Ss]-", JsText.ci("dls-"))
        assertEquals("[Bb][Oo][Dd][Yy]", JsText.ci("Body"))
        val re = Regex(JsText.ci("style"))
        assertEquals(listOf("style", "STYLE", "StYlE"), listOf("style", "STYLE", "StYlE", "${longS}tyle", "STYLE".replace('S', longS)).filter { re.matches(it) })
        assertFalse(caseInsensitive(re))
        assertTrue(icuFind(re, "${longS}tyle").isEmpty())
        assertTrue(icuFind(Regex("(?i)style"), "${longS}tyle").isNotEmpty())
    }
}
