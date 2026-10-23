package com.daylight.share.core.lab

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.regex.Pattern

/**
 * K3 review (Oct 22): the case-insensitive W1 patterns match ASCII letters only, as JS's `i` does without `u`, on
 * every regex engine. The JVM keeps `(?i)` ASCII-only, but Android's java.util.regex runs on ICU, where `(?i)` folds
 * Unicode case: "ſ" (U+017F, long s) then matches s and "K" (U+212A, the Kelvin sign) matches k, so a phone removed
 * more than the JS reference did. [onIcu] compiles a pattern the way a phone reads it, with Unicode case wherever the
 * pattern turns case-insensitivity on, so this JVM test sees what a device would. W1DifferentialTest cannot: it runs
 * the JVM's own engine against node.
 */
class AsciiCaseTest {
    private val longS = '\u017F'
    private val kelvin = '\u212A'

    /** [re] as ICU runs it: `(?i)` with Unicode case folding (Pattern.UNICODE_CASE does that on the JVM). */
    private fun onIcu(re: Regex): Regex = Pattern.compile(re.pattern, Pattern.UNICODE_CASE).toRegex()

    /** Every case-insensitive pattern of Normalise, Excerpt and SetupCheck, by name. */
    private val patterns: List<Pair<String, Regex>>
        get() = listOf("Normalise.URL_RUN" to Normalise.URL_RUN, "Normalise.BODY" to Normalise.BODY) +
            Excerpt.DROP_PATTERNS.flatMap { (name, p) -> listOf("Excerpt <$name" to p.first, "Excerpt </$name>" to p.second) } +
            SetupCheck.REDACTIONS.mapIndexed { i, (re, with) -> "SetupCheck.REDACTIONS[$i] $with" to re }

    /** ASCII words with each s and k swapped for U+017F and U+212A, in every place the patterns look at. */
    private fun swapped(word: String): List<String> = word.indices.filter { word[it].lowercaseChar() == 's' || word[it].lowercaseChar() == 'k' }
        .map { i -> word.substring(0, i) + (if (word[i].lowercaseChar() == 's') longS else kelvin) + word.substring(i + 1) }

    private val inputs: List<String>
        get() {
            val out = ArrayList<String>()
            for (name in Excerpt.DROP) for (w in swapped(name)) out += listOf("<$w>x</$w>", "<p>a<$w>b</$w>c</p>", "<$name>x</$w>y", "<$w/>z")
            for (w in swapped("https")) out += listOf("$w://a/https://e.com", "${w.uppercase()}://a")
            for (w in swapped("daylightserver")) out += "$w://pair?x"
            out += "ww$longS.e.com"
            for (w in swapped("dls")) out += "$w-0123456789abcdef0123456789abcdef"
            out += "${kelvin}BCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23"
            out += "ABCD-EFGH-IJ${kelvin}L-MNOP-Q${longS}ST-UVWX-YZ23"
            out += "ABCDEFGHIJ${kelvin}LMNOPQRSTUVWXYZ23"
            out += "<bod$kelvin><a href=\"https://e.com/x\">x</a>"
            return out
        }

    /** Fails before the fix: `(?i)dls-…` on ICU matches "dlſ-…", `(?i)<style` matches "<ſtyle", and so on. */
    @Test
    fun everyPatternMatchesAsJsDoesOnIcu() {
        val differ = ArrayList<String>()
        for ((name, re) in patterns) for (input in inputs) {
            val jvm = re.findAll(input).map { it.range }.toList()
            val icu = onIcu(re).findAll(input).map { it.range }.toList()
            if (jvm != icu) differ += "$name on \"$input\": the JVM (and JS) match $jvm, ICU $icu"
        }
        assertEquals("ICU must match where the JVM and JS do", emptyList<String>(), differ)
        for ((name, re) in patterns) assertFalse("$name uses (?i), which folds Unicode case on Android: spell the letters with JsText.ci", re.pattern.contains("(?i"))
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
        assertEquals(re.pattern, onIcu(re).pattern)
        assertFalse(onIcu(re).matches("${longS}tyle"))
    }
}
