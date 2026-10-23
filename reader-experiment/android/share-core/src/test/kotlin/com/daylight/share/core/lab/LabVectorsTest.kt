package com.daylight.share.core.lab

import com.daylight.share.core.AckHeader
import com.daylight.share.core.Body
import com.daylight.share.core.BytesBody
import com.daylight.share.core.Http
import com.daylight.share.core.OutboxRow
import com.daylight.share.core.Bytes
import com.daylight.share.core.FileOutboxStore
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Json
import com.daylight.share.core.Keys
import com.daylight.share.core.Kind
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Outbox
import com.daylight.share.core.Pairing
import com.daylight.share.core.Purpose
import com.daylight.share.core.RelayClient
import com.daylight.share.core.ShareException
import com.daylight.share.core.Status
import com.daylight.share.core.lab.Vectors.norm
import com.daylight.share.core.server.ServerError
import com.daylight.share.core.server.ServerState
import com.daylight.share.core.server.ServerStateSource
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import kotlin.io.path.createTempDirectory

/**
 * Checks the Kotlin Lab port against ../../share/vectors/lab-vectors.json (made by the JS reference, LAB-PROTOCOL 2.8
 * and 2.9): every W0 section (K0) and every W1 section (K3: labExcerpt, diagnostics, testArticle and the W1 labText
 * cases). A section this test does not know fails [everySectionIsPorted], so none is skipped silently. smart intake's
 * own file, normalise.json, is NormaliseVectorsTest's.
 */
class LabVectorsTest {
    private val v get() = Vectors.lab
    private fun hex(s: Any?) = Bytes.fromHex(s as String)
    private val keys1: Keys get() = Keys.derive(hex(v["labTopics"].obj()["returnFrame"].obj()["secretHex"]))

    companion object {
        /** The sections this test checks. */
        val PORTED = listOf(
            "constants", "labTopics", "labFrames", "labParse", "labLedger", "labGate", "labHeaderExtras", "labRowText", "labText", "v1Safety",
            "labExcerpt", "diagnostics", "testArticle",
        )

        /** Sections of later cards (LAB-PLAN 3.5), with the card that ports them. */
        val LATER = emptyMap<String, String>()
        val META = listOf("protocol", "generatedBy", "notes")
    }

    @Test
    fun everySectionIsPorted() {
        for (s in PORTED) assertTrue("section $s is missing or empty", (v[s] as? Collection<*>)?.isNotEmpty() ?: (v[s] as? Map<*, *>)?.isNotEmpty() ?: false)
        val unknown = v.keys - PORTED.toSet() - LATER.keys - META.toSet()
        assertTrue("lab-vectors.json has sections no Kotlin test reads: $unknown. Port them, or name the card that will in LATER.", unknown.isEmpty())
        for ((s, card) in LATER) if (s in v) println("lab-vectors.json › $s: ported by $card")
    }

    @Test
    fun constants() {
        val c = v["constants"].obj()
        val kotlin = linkedMapOf<String, Any?>(
            "LAB_LEVEL" to Lab.LAB_LEVEL, "MAX_ST_PER_FRAME" to Lab.MAX_ST_PER_FRAME, "MAX_ST_READ" to Lab.MAX_ST_READ, "MAX_CAPS" to Lab.MAX_CAPS,
            "APP_MAX" to Lab.APP_MAX, "T_MAX" to Lab.T_MAX, "HELLO_EVERY_MS" to Lab.HELLO_EVERY_MS, "STATE_DIGEST_WINDOW_MS" to Lab.STATE_DIGEST_WINDOW_MS,
            "STATE_DIGEST_MAX" to Lab.STATE_DIGEST_MAX, "INBOX_STALE_MS" to Lab.INBOX_STALE_MS, "PENDING_MAX" to Lab.PENDING_MAX,
            "LEDGER_STATES_MAX" to Lab.LEDGER_STATES_MAX, "LAB_FRAME_GAP_MS" to Lab.LAB_FRAME_GAP_MS, "LAB_FRAMES_PER_DAY" to Lab.LAB_FRAMES_PER_DAY,
            "LAB_YIELD_MS" to Lab.LAB_YIELD_MS, "LAB_OFF_REPEAT_MS" to Lab.LAB_OFF_REPEAT_MS, "LAB_OFF_REPEATS" to Lab.LAB_OFF_REPEATS,
            "LAB_FLUSH_DELAY_MS" to Lab.LAB_FLUSH_DELAY_MS, "GATE_DEADLINE_MS" to Lab.GATE_DEADLINE_MS, "FAST_CHECK_MS" to Lab.FAST_CHECK_MS,
            "FAST_CHECK_WINDOW_MS" to Lab.FAST_CHECK_WINDOW_MS, "STATE_RANK" to Lab.STATE_RANK, "LAB_STATES" to Lab.LAB_STATES,
            "CAPS" to linkedMapOf("st" to Lab.Caps.ST, "tap" to Lab.Caps.TAP, "readerLink" to Lab.Caps.READER_LINK, "capKind" to Lab.Caps.CAP_KIND, "readerDoc" to Lab.Caps.READER_DOC, "quiet" to Lab.Caps.QUIET),
            "FEATURE_CAPS" to Lab.FEATURE_CAPS, "SERVER_FEATURES" to Lab.SERVER_FEATURES, "SERVER_KEYS" to Lab.SERVER_KEYS, "USE_FEATURES" to Lab.USE_FEATURES,
            // W1 (K3)
            "EXCERPT_MAX_CHARS" to Excerpt.MAX_CHARS, "EXCERPT_LINE_MAX" to Excerpt.LINE_MAX, "EXCERPT_NAME_WORDS" to Excerpt.NAME_WORDS,
            "TEXT_FRAGMENT_WORDS" to Excerpt.TEXT_FRAGMENT_WORDS, "ACTIVITY_MAX" to SetupCheck.ACTIVITY_MAX, "DIAGNOSTICS_EVENTS" to SetupCheck.DIAGNOSTICS_EVENTS,
            "TEST_URL_PREFIX" to SetupCheck.TEST_URL_PREFIX, "EXCERPT_TAGS" to Excerpt.TAGS, "EXCERPT_AS_P" to Excerpt.AS_P, "EXCERPT_DROP" to Excerpt.DROP,
            "TRACKING_PARAMS" to Normalise.TRACKING_PARAMS,
            "TRACKING_BY_SITE" to Normalise.TRACKING_BY_SITE.map { r ->
                if (r.subdomainsOf != null) linkedMapOf("subdomainsOf" to r.subdomainsOf, "params" to r.params) else linkedMapOf("domains" to r.domains, "params" to r.params)
            },
        )
        for ((k, value) in kotlin) assertEquals(k, c[k], norm(value))
        assertEquals("every constant of the vectors has a Kotlin value", c.keys, kotlin.keys)
        assertEquals(Lab.STATE_RANK.keys.toList(), Lab.LAB_STATES)
    }

    @Test
    fun labTopics() {
        val t = v["labTopics"].obj()
        for ((name, aad) in t["aads"].obj()) assertEquals(name, aad, Purpose.of(name).aad)
        try {
            Purpose.of("lab")
            fail("an unknown purpose must throw")
        } catch (e: ShareException) {
            assertEquals("purpose", e.code)
        }
        for (c in t["topics"].objs()) {
            val got = LabTopics.derive(hex(c["secretHex"]))
            assertEquals(c["label"] as String, listOf(c["returnTopic"], c["returnAckTopic"], c["controlTopic"], c["controlAckTopic"]),
                listOf(got.returnTopic, got.returnAckTopic, got.controlTopic, got.controlAckTopic))
        }
        try {
            LabTopics.derive(ByteArray(15))
            fail("a short secret must throw")
        } catch (e: ShareException) {
            assertEquals("secret", e.code)
        }
        val r = t["returnFrame"].obj()
        val keys = Keys.derive(hex(r["secretHex"]))
        val frame = FrameCodec.seal(keys, Purpose.of(r["purpose"] as String), Bytes.utf8(r["headerJson"] as String), ByteArray(0), hex(r["nonceHex"]))
        assertEquals(r["frameHex"], Bytes.toHex(frame))
        assertEquals(r["frameBase64"], Bytes.toBase64(frame))
        assertEquals(Json.parse(r["headerJson"] as String), FrameCodec.open(keys, Purpose.LAB_RETURN, frame).header)
        for (p in r["refusedPurposes"] as List<*>) {
            try {
                FrameCodec.open(keys, Purpose.of(p as String), frame)
                fail("$p must not open a return frame")
            } catch (e: ShareException) {
                assertEquals("$p", "frame", e.code)
            }
        }
    }

    private fun ackJson(a: LabAck): Any? = norm(
        linkedMapOf(
            "inbox" to a.inbox?.let { linkedMapOf("lab" to it.lab, "app" to it.app, "caps" to it.caps, "poll" to it.poll, "live" to it.live) },
            "states" to a.states.map { linkedMapOf("id" to it.i, "s" to it.s, "t" to it.t) },
        ),
    )

    @Test
    fun labFrames() {
        val keys = keys1
        for (c in v["labFrames"].objs()) {
            val name = c["name"] as String
            val nonce = hex(c["nonceHex"])
            val headerJson = c["headerJson"] as String
            val sealed = FrameCodec.seal(keys, Purpose.ACK, Bytes.utf8(headerJson), ByteArray(0), nonce)
            assertEquals(name, c["frameBase64"], Bytes.toBase64(sealed))
            assertEquals(name, c["headerBytes"].long(), Bytes.utf8(headerJson).size.toLong())
            assertEquals(name, c["frameLength"].long(), sealed.size.toLong())
            assertEquals(name, c["base64Length"].long(), Bytes.toBase64(sealed).length.toLong())
            assertEquals(name, c["small"], FrameCodec.isSmall(sealed.size.toLong()))
            // The builder makes the same bytes from the same inputs.
            val h = Json.parse(headerJson).obj()
            val x = h["x-inbox"].obj()
            val inbox = LabInboxInfo((x["lab"] as Double).toInt(), x["app"] as String, (x["caps"] as List<*>).map { it as String }, Lab.parseTime(x["poll"]), x["live"] == true)
            val states = (h["x-st"] as List<*>?)?.objs()?.map { LabState(it["i"] as String, it["s"] as String, it["t"].long()!!) } ?: emptyList()
            val built = LabFrame.build(keys, inbox, states, h["from"] as String? ?: "", h["sent"] as String, nonce)
            assertArrayEquals(name, sealed, built)
            // And reads back as the reference reads it.
            val opened = FrameCodec.open(keys, Purpose.ACK, built)
            assertEquals(name, c["parse"], ackJson(LabFrame.parse(opened.header)))
        }
        val worst = v["labFrames"].objs().first { (it["name"] as String).startsWith("worst case: ") }
        assertEquals(listOf(2572L, 2608L, 3480L), listOf(worst["headerBytes"].long(), worst["frameLength"].long(), worst["base64Length"].long()))
        // Over 24 states, a bad entry or a bad level is refused before anything is sealed.
        val info = LabInboxInfo(1, "android/1.5.0", listOf("st"))
        val s = LabState("0".repeat(32), "reader", 1)
        fun refused(reason: String, block: () -> Unit) {
            try {
                block()
                fail("expected $reason")
            } catch (e: ShareException) {
                assertEquals("lab", e.code)
                assertEquals(reason, e.reason)
            }
        }
        refused("too-many") { LabFrame.build(keys, info, List(25) { s }) }
        refused("entry") { LabFrame.build(keys, info, listOf(s.copy(s = "done"))) }
        refused("entry") { LabFrame.build(keys, info, listOf(s.copy(t = Lab.T_MAX + 1))) }
        refused("entry") { LabFrame.build(keys, info, listOf(s.copy(i = "X".repeat(32)))) }
        refused("lab") { LabFrame.build(keys, info.copy(lab = 100), emptyList()) }
        refused("lab") { LabFrame.build(keys, info.copy(lab = -1), emptyList()) }
        // The 2.2.1 bound: no valid input makes a frame that is not small (LabInboxTest injects one to test halving).
    }

    @Test
    fun labParse() {
        for (c in v["labParse"].objs()) {
            val name = c["name"] as String
            val header = try {
                Json.parse(c["headerJson"] as String)
            } catch (e: Json.ParseException) {
                null // step 1: the platform's parser rejected it
            }
            assertEquals(name, c["expect"], ackJson(LabFrame.parse(header)))
        }
        assertTrue(v["labParse"].objs().size >= 45)
    }

    @Test
    fun labLedger() {
        val tokens = listOf("st", "tap", "reader-link", "cap-kind", "reader-doc", "quiet")
        for (c in v["labLedger"].objs()) {
            val name = c["name"] as String
            val now = c["now"].long()!!
            val ledger = LabLedger(MemoryLabStore()) { now }
            for (step in c["steps"].objs()) ledger.record(Json.parse(step["headerJson"] as String).obj(), step["time"].long())
            val snap = ledger.snapshot()
            val e = c["expect"].obj()
            assertEquals(name, e["states"], norm(snap.states.mapValues { (_, s) -> linkedMapOf("s" to s.s, "t" to s.t) }))
            for ((id, st) in e["states"].obj()) assertEquals(name, st, norm(ledger.state(id)?.let { linkedMapOf("s" to it.s, "t" to it.t) }))
            assertEquals(name, e["inboxLab"], snap.inboxLab)
            assertEquals(name, e["inboxLab"], ledger.inboxLab())
            assertEquals(name, e["caps"], snap.caps)
            assertEquals(name, e["caps"], ledger.caps())
            assertEquals(name, e["hasCap"], norm(tokens.associateWith { snap.hasCap(it) }))
            for (t in tokens) assertEquals("$name $t", e["hasCap"].obj()[t], ledger.hasCap(t))
            assertEquals(name, e["checkedIn"], norm(snap.checkedIn))
            assertEquals(name, e["checkedIn"], norm(ledger.checkedIn()))
            assertEquals(name, e["publishers"], norm(snap.publishers.associate { it.publisher to it.toJson() }))
            assertEquals(name, snap.publishers, ledger.publishers())
        }
    }

    /** A server stub as the vectors describe it; [asked] collects the keys its state was asked for. */
    private fun stubServer(stub: Any?, asked: MutableList<String>): ServerStateSource? = when (stub) {
        null -> null
        "never" -> ServerStateSource { key ->
            asked += key
            Thread.sleep(60_000) // interrupted when the gate's deadline cancels it
            ServerState("ready", null)
        }
        "throws-offline" -> ServerStateSource { key ->
            asked += key
            throw ServerError("OFFLINE", "Couldn’t reach the Daylight server. Check your connection and try again.")
        }
        else -> ServerStateSource { key ->
            asked += key
            ServerState(stub.obj()["state"] as String, stub.obj()["message"] as String?)
        }
    }

    @Test
    fun labGate() {
        for (c in v["labGate"].objs()) {
            val name = c["name"] as String
            val stub = c["ctx"].obj()
            val asked = java.util.Collections.synchronizedList(ArrayList<String>())
            val caps = (stub["caps"] as List<*>?)?.map { it as String } ?: emptyList()
            val messages = stub["serverMessages"] as Map<*, *>?
            val ctx = LabGate.Context(
                lab = stub["lab"] == true,
                paired = stub["paired"] == true,
                hasCap = { it in caps },
                local = (stub["local"] as String?)?.let { l -> { _: String -> l } },
                server = stubServer(stub["server"], asked),
                serverMessage = messages?.let { m -> { s: String -> m[s] as String? } },
                built = (stub["built"] as Boolean?)?.let { b -> { _: String -> b } },
                platform = stub["platform"] as String?,
                // The JS runner's 20 ms deadline, for the server that never answers only: the others answer at once.
                deadlineMs = if (stub["server"] == "never") 50 else 10_000,
            )
            val r = LabGate.run(c["feature"] as String, ctx)
            val got = linkedMapOf("ready" to r.ready, "state" to r.state, "message" to r.message, "short" to r.short, "button" to r.button, "serverKey" to asked.firstOrNull())
            assertEquals(name, c["expect"], norm(got))
        }
    }

    @Test
    fun labHeaderExtras() {
        for (c in v["labHeaderExtras"].objs()) {
            val name = c["name"] as String
            val h = ItemHeader.check(Json.parse(c["headerJson"] as String).obj())
            assertEquals(name, c["expect"], norm(h.extras))
            assertEquals(name, c["expect"], norm(ItemHeader.extrasOf(Json.parse(c["headerJson"] as String).obj()).takeIf { h.part == 0 } ?: emptyMap<String, String>()))
            // toJson carries the extras on part 0 only, and they read back the same.
            val again = ItemHeader.check(Json.parse(Json.write(h.toJson(h.parts > 1))).obj())
            assertEquals(name, h.extras, again.extras)
            if (h.part > 0) assertTrue(name, Json.write(h.toJson(true)).let { "x-cap" !in it && "x-orig" !in it })
        }
        // Without extras a header is exactly v1.1's.
        val plain = ItemHeader("0".repeat(32), Kind.URL, url = "https://example.com/", sent = "2026-10-20T08:00:00.000Z")
        assertEquals("{\"v\":1,\"id\":\"${"0".repeat(32)}\",\"kind\":\"url\",\"url\":\"https://example.com/\",\"sent\":\"2026-10-20T08:00:00.000Z\"}", Json.write(plain.toJson()))
        val lab = plain.copy(extras = linkedMapOf("x-orig" to "https://example.com/?utm_source=x", "x-cap" to "seen"))
        assertTrue(Json.write(lab.toJson()).endsWith(",\"x-cap\":\"seen\",\"x-orig\":\"https://example.com/?utm_source=x\"}"))
        assertEquals("seen", lab.xCap)
        assertEquals("https://example.com/?utm_source=x", lab.xOrig)
    }

    @Test
    fun labRowText() {
        for (c in v["labRowText"].objs()) {
            val name = c["name"] as String
            val row = c["row"].obj()
            val x = c["ctx"].obj()
            val caps = (x["hasCap"] as List<*>?)?.map { it as String }
            val state = when (val s = x["state"]) {
                is Map<*, *> -> s["s"] as String?
                is String -> s
                else -> null
            }
            val ctx = LabRowText.Context(x["lab"] == true, x["inboxLab"] == true, caps?.let { l -> { t: String -> t in l } }, state, x["online"] as Boolean?)
            val d = LabRowText.of(
                row["status"] as String, row["errorCode"] as String? ?: "", row["kind"] as String, row["size"].long() ?: 0,
                row["created"].long() ?: 0, c["now"].long()!!, ctx,
            )
            val got = linkedMapOf("label" to d.label, "sentence" to d.sentence, "action" to d.action, "stepLine" to d.stepLine, "final" to d.final, "a11y" to d.a11yLabel)
            assertEquals(name, c["expect"], norm(got))
        }
    }

    @Test
    fun labTextStrings() {
        val t = v["labText"].obj()
        val strings = t["strings"].obj()
        for ((id, text) in strings) assertEquals(id, text, LabText.strings[id])
        assertEquals("every LAB_TEXT string, and no other", strings.keys, LabText.strings.keys)
        for (f in t["features"].objs()) {
            val id = f["id"] as String
            assertEquals(id, f["name"], LabText.featureName(id))
            assertEquals(id, f["sentence"], LabText.featureSentence(id))
        }
        assertEquals(t["features"].objs().map { it["id"] }, LabText.FEATURE_ORDER + LabText.SERVER_FEATURE_ORDER)
        assertEquals("Files over 9 MB", LabText.featureName("files"))
        assertEquals("Summaries with Claude", LabText.featureName("pdf"))
        assertEquals("Lab", LabText.LAB)
        assertTrue(LabText.strings.values.none { Regex("[A-Za-z]'[A-Za-z]").containsMatchIn(it) })
    }

    @Test
    fun labTextMessages() {
        val t = v["labText"].obj()
        for (m in t["messages"].objs()) {
            val got = LabText.needsMessage(
                m["state"] as String, platform = m["platform"] as String?, feature = m["feature"] as String?,
                short = m["short"] == true, heading = m["heading"] == true, message = m["message"] as String?,
            )
            assertEquals(Json.write(m), m["expect"], got)
        }
        for (c in t["checkedIn"].objs()) assertEquals(Json.write(c), c["expect"], LabText.checkedInText(c["ms"].long(), c["now"].long()!!))
        for (c in t["inboxHeader"].objs()) assertEquals(Json.write(c), c["expect"], LabText.inboxLabText(c["inboxLab"] == true, c["checkedIn"].long(), c["now"].long()!!))
        for (c in t["serverRow"].objs()) {
            assertEquals(c["state"] as String, c["heading"], LabText.serverHeadingShort(c["state"] as String))
            assertEquals(c["state"] as String, c["subtitle"], LabText.serverRowSubtitle(c["state"] as String))
        }
        for (c in t["serverFeature"].objs()) assertEquals(Json.write(c), c["expect"], LabText.serverFeatureShort(c["state"] as String, c["headingState"] as String))
        val s = t["serverSection"].obj()
        for (c in s["moved"].objs()) assertEquals(c["expect"], LabText.serverMovedText(c["moved"] as String))
        for (c in s["labInboxSeen"].objs()) assertEquals(Json.write(c), c["expect"], LabText.labInboxSeenText(c["lastSeen"], c["now"].long()!!))
        for (c in s["aiToday"].objs()) assertEquals(Json.write(c), c["expect"], LabText.aiTodayText(c["used"], c["cap"]))
        for (c in s["setupConfirm"].objs()) assertEquals(c["expect"], LabText.setupConfirmText(c["server"] as String))
        for (c in s["hostLine"].objs()) assertEquals(Json.write(c), c["expect"], LabText.hostLineText(c["host"] as String?, c["fingerprint"] as String?))
        assertEquals("Copy Server code", LabText.button("needs-server"))
        assertNull(LabText.button("needs-inbox"))
    }

    /**
     * The setup steps are a list of five, pinned against the array labText › serverSection › steps: three of them hold a
     * comma, so the joined form in strings is never split. Every other list's items are comma-free, and step 2 is the
     * server module's RERUN_HELP word for word (2.6).
     */
    @Test
    fun labTextLists() {
        val t = v["labText"].obj()
        val steps = t["serverSection"].obj()["steps"] as List<*>
        assertEquals(5, steps.size)
        assertEquals(steps, LabText.SERVER_STEPS)
        assertEquals(steps, LabText.list("serverSection.steps"))
        assertTrue("steps hold commas", LabText.SERVER_STEPS.any { ',' in it })
        val joined = t["strings"].obj()["serverSection.steps"] as String
        assertEquals(joined, LabText.SERVER_STEPS.joinToString(","))
        assertTrue("splitting the joined form does not give the five steps back", joined.split(',').size != 5)
        assertEquals(com.daylight.share.core.server.ServerMessages.RERUN_HELP, LabText.SERVER_STEPS[1])
        assertEquals(setOf("serverSection.steps", "featureOrder", "serverFeatureOrder", "excerpt.months"), LabText.lists.keys)
        for ((id, list) in LabText.lists) {
            assertEquals(id, t["strings"].obj()[id], list.joinToString(","))
            if (id != "serverSection.steps") {
                assertTrue(id, list.none { ',' in it })
                assertEquals(id, list, (t["strings"].obj()[id] as String).split(','))
            }
        }
        assertEquals(12, LabText.list("excerpt.months").size)
    }

    @Test
    fun labTextW1() {
        val t = v["labText"].obj()
        for (c in t["kindLines"].objs()) {
            val i = c["input"].obj()
            val extras = (i["extras"] as Map<*, *>?)?.entries?.associate { (k, x) -> k as String to x as String } ?: emptyMap()
            assertEquals(Json.write(c), c["expect"], LabText.inboxKindLine(i["kind"] as String, extras, i["size"].long() ?: 0, i["from"] as String?))
        }
        for (c in t["cleanedFrom"].objs()) assertEquals(Json.write(c), c["expect"], LabText.cleanedFromText(c["orig"] as String?))
        for (c in t["use"].objs()) {
            val settings = c["settings"] as Map<*, *>?
            val use = (settings?.get("labUse") as Map<*, *>?)?.entries?.associate { (k, x) -> k as String to (x as Boolean) } ?: emptyMap()
            assertEquals(Json.write(c), c["expect"], LabText.labUseOn(settings?.get("lab") != false, use, c["feature"] as String))
        }
        for (c in t["useFeatures"].objs()) {
            assertEquals(c["footer"], LabText.useFooter(c["id"] as String))
            assertEquals(c["a11y"], LabText.useA11y(c["id"] as String))
        }
        assertEquals(t["useFeatures"].objs().map { it["id"] }, Lab.USE_FEATURES)
    }

    // ---- W1 (K3)

    private fun excerptJson(e: Excerpt.Item?): Any? = norm(
        e?.let {
            linkedMapOf<String, Any?>("kind" to it.kind, "mime" to it.mime, "name" to it.name).apply {
                if (it.url != null) put("url", it.url)
                put("title", it.title)
                put("content", it.content)
                put("extras", it.extras)
            }
        },
    )

    private fun sha256Hex(s: String) = Bytes.toHex(java.security.MessageDigest.getInstance("SHA-256").digest(Bytes.utf8(s)))

    /** labExcerpt (F11.3, F11.5): items, the sanitiser, plain text, fragments, dates, names, classifyShare, the limits. */
    @Test
    fun labExcerpt() {
        val e = v["labExcerpt"].obj()
        val utc = java.time.ZoneOffset.UTC
        for (c in e["items"].objs()) {
            val i = c["input"].obj()
            val got = Excerpt.item(
                i["text"] as String?, i["html"] as String?, i["url"] as String?, i["pageTitle"] as String?, i["site"] as String?,
                i["app"] as String?, i["date"], utc,
            )
            assertEquals(c["name"] as String, c["expect"], excerptJson(got))
        }
        for (c in e["sanitize"].objs()) {
            val r = Excerpt.sanitize(c["html"] as String, (c["maxChars"] as Double).toInt())
            assertEquals(c["name"] as String, c["expect"], norm(linkedMapOf("html" to r.html, "trimmed" to r.trimmed)))
        }
        for (c in e["textHtml"].objs()) {
            val r = Excerpt.textHtml(c["text"] as String, (c["maxChars"] as Double).toInt())
            assertEquals(c["name"] as String, c["expect"], norm(linkedMapOf("html" to r.html, "trimmed" to r.trimmed)))
        }
        for (c in e["fragments"].objs()) assertEquals(c["name"] as String, c["expect"], Excerpt.textFragment(c["url"] as String, c["text"] as String))
        for (c in e["dates"].objs()) assertEquals(c["date"].toString(), c["expect"], Excerpt.date(c["date"]))
        for (c in e["fileNames"].objs()) assertEquals(c["name"] as String, c["expect"], Excerpt.fileName(c["text"] as String, c["note"] == true))
        for (c in e["classify"].objs()) {
            val i = c["input"].obj()
            val r = Normalise.classifyShare(i["text"] as String?, i["url"] as String?, i["title"] as String?, i["source"] as String?)
            assertEquals(c["name"] as String, c["expect"], norm(linkedMapOf("kind" to r.kind, "url" to r.url, "text" to r.text)))
        }
        // F11.5: every case that is not rule 1-3 (or nothing at all) is a link, headline + link shares included.
        val links = e["classify"].objs().filter { !Regex("^rule [123]").containsMatchIn(it["name"] as String) && it["name"] != "nothing" }
        assertTrue(links.size >= 7)
        for (c in links) assertEquals("F11.5: ${c["name"]}", "link", c["expect"].obj()["kind"])
        // The 50,000-character limit, in HTML (from text and from HTML) and in Markdown.
        val l = e["limits"].obj()
        val input = l["input"].obj()
        val text = JsText.trim((input["textRepeat"] as String).repeat((input["times"] as Double).toInt()))
        fun pin(s: String, want: Map<String, Any?>, what: String) {
            assertEquals(what, want["length"].long(), s.length.toLong())
            assertEquals(what, want["sha256"], sha256Hex(s))
            assertTrue(what, s.endsWith(want["tail"] as String))
        }
        val url = input["url"] as String
        val pageTitle = input["pageTitle"] as String
        pin(Excerpt.item(text, url = url, pageTitle = pageTitle, date = input["date"])!!.content, l["textItem"].obj(), "text")
        pin(Excerpt.item(text, html = "<p>$text</p>", url = url, pageTitle = pageTitle, date = input["date"])!!.content, l["htmlItem"].obj(), "html")
        pin(Excerpt.markdown(text, input["app"] as String, input["date"]), l["note"].obj(), "note")
    }

    /** diagnostics (F26.2): redaction, activity lines and whole reports. */
    @Test
    fun diagnostics() {
        val d = v["diagnostics"].obj()
        for (c in d["redact"].objs()) assertEquals(c["text"] as String, c["expect"], SetupCheck.redactDiagnostics(c["text"] as String))
        fun event(m: Map<String, Any?>) = SetupCheck.Event(m["time"].long()!!, m["type"] as String, m["id8"] as String, m["kind"] as String, m["status"] as String, (m["http"] as Double).toInt())
        for (c in d["activity"].objs()) {
            val e = event(c["event"].obj())
            assertEquals(c["line"], SetupCheck.activityLine(e))
            assertEquals(c["event"], norm(e.toJson()))
            assertEquals(e, SetupCheck.Event.fromJson(c["event"].obj()))
        }
        for (c in d["reports"].objs()) {
            val i = c["input"].obj()
            val got = SetupCheck.diagnosticsReport(
                app = i["app"] as String, version = i["version"] as String, platform = i["platform"] as String, lab = i["lab"] == true,
                caps = (i["caps"] as List<*>).map { it as String }, checkedIn = i["checkedIn"].long(),
                statuses = i["rows"].objs().map { it["status"] as String }, relay = i["relay"] as String,
                log = i["log"].objs().map(::event), now = i["now"].long()!!,
            )
            assertEquals(c["expect"], got)
        }
    }

    /**
     * diagnostics › rowHttp (F26's activity log, LAB-PROTOCOL 2.7.1, added Oct 22): an [Outbox] against scripted relay
     * answers (an HTTP status, or "network": no answer), with the in-call retries waiting 0 ms, pins each row's status,
     * errorCode and `http` after every step, and the activity line of each row the step returned. A row stored without
     * `http` (v1.0, v1.1) reads as 0.
     */
    @Test
    fun rowHttp() {
        val r = v["diagnostics"].obj()["rowHttp"].obj()
        val items = r["items"].obj()
        assertEquals(15, r["cases"].objs().size)
        for (c in r["cases"].objs()) {
            val name = c["name"] as String
            val answers = ArrayDeque<Any?>()
            var now = 0L
            val http = object : Http {
                override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
                    if (answers.isEmpty()) fail("$name: no answer left for $method $url")
                    val a = answers.removeFirst()
                    if (a == "network") throw IOException("fetch failed")
                    val st = (a as Double).toInt()
                    return Http.Response(st, emptyMap(), if (st in 200..299) Json.write(linkedMapOf("id" to "msg", "time" to now / 1000)).toByteArray() else ByteArray(0))
                }

                override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = throw IOException("no stream")
            }
            val relay = RelayClient(r["relay"] as String, http, retryDelaysMs = (r["retryDelaysMs"] as List<*>).map { (it as Double).toLong() }, clock = { now }, sleeper = {})
            val dir = createTempDirectory("rowhttp").toFile()
            val outbox = Outbox(Pairing(ByteArray(16) { it.toByte() }, r["relay"] as String), FileOutboxStore(dir), relay, "Vectors", "vectors/1", clock = { now })
            fun keyOf(id: String) = items.entries.first { it.value.obj()["id"] == id }.key
            fun item(key: String): Pair<OutgoingItem, Body?> {
                val i = items[key].obj()
                val bytes = i["bytes"].long()
                val o = OutgoingItem(i["kind"] as String, id = i["id"] as String, url = i["url"] as String?, title = i["title"] as String?, name = i["name"] as String?, mime = i["mime"] as String?)
                return o to bytes?.let { n -> BytesBody(ByteArray(n.toInt()) { b -> (b % 251).toByte() }) }
            }
            for ((n, step) in c["steps"].objs().withIndex()) {
                val op = step["op"] as String
                now = step["at"].long()!!
                answers.addAll(step["answers"] as List<*>)
                val returned: List<OutboxRow> = when (op) {
                    "send", "defer" -> item(step["item"] as String).let { (o, b) -> listOf(outbox.send(o, b, defer = op == "defer")) }
                    "retry" -> listOf(outbox.retry(items[step["item"] as String].obj()["id"] as String)!!)
                    "resendDue" -> outbox.resendDue()
                    "flushNetwork" -> outbox.flushNetwork()
                    else -> throw AssertionError("unknown op $op")
                }
                val at = "$name, step ${n + 1} ($op)"
                assertTrue("$at: every answer was asked for, ${answers.size} left", answers.isEmpty())
                val rows = outbox.rows().sortedBy { keyOf(it.id) }.associate { keyOf(it.id) to linkedMapOf("status" to it.status, "errorCode" to it.errorCode, "http" to it.http) }
                val lines = returned.map { SetupCheck.activityLine(SetupCheck.activityEvent(now, op, it.id, it.kind, SetupCheck.rowStatus(it.status, it.errorCode), it.http)) }
                val got = linkedMapOf("returned" to returned.map { keyOf(it.id) }, "rows" to rows, "lines" to lines)
                assertEquals(at, step["expect"], norm(got))
            }
            dir.deleteRecursively()
        }
        // A row stored by v1.0 or v1.1 has no http: it reads as 0 (the Kotlin row form of legacy.stored).
        val legacy = r["legacy"].obj()
        val stored = legacy["stored"].obj()
        val header = linkedMapOf<String, Any?>("v" to 1.0, "kind" to stored["kind"], "id" to stored["id"], "part" to 0.0, "parts" to 1.0, "sent" to stored["sent"], "title" to stored["title"], "url" to stored["url"])
        val row = OutboxRow.fromJson(stored.filterKeys { it !in setOf("id", "kind", "title", "url", "name", "mime", "size", "sent") } + ("header" to header))
        assertEquals(stored["errorCode"], row!!.errorCode)
        assertEquals(legacy["expect"].obj()["http"].long()!!.toInt(), row.http)
        assertEquals(413, OutboxRow.fromJson(row.copy(http = 413).toJson().let { Json.parse(Json.write(it)).obj() })!!.http)
    }

    /** testArticle (F26): the item to send, exactly. */
    @Test
    fun testArticle() {
        for (c in v["testArticle"].objs()) {
            val i = c["input"].obj()
            val a = SetupCheck.testArticle(i["id"] as String, i["device"] as String)
            val got = linkedMapOf("id" to a.id, "kind" to a.kind, "url" to a.url, "title" to a.title, "content" to a.content, "extras" to a.extras)
            assertEquals(c["expect"], norm(got))
        }
    }

    /**
     * v1Safety (2.1 rule 4): each Lab frame opens as an ack whose ids are [] (AckHeader.idsOf), and an Outbox that reads
     * them on its ack topic delivers nothing, while its onAckHeader still hears every one of them.
     */
    @Test
    fun v1Safety() {
        val keys = keys1
        val secret = hex(v["labTopics"].obj()["returnFrame"].obj()["secretHex"])
        var clock = 1_792_483_200_000L
        val http = FakeRelayHttp { clock }
        val pairing = Pairing(secret, "https://relay.test")
        val heard = LinkedHashMap<String, Map<String, Any?>>() // by ntfy message id: a poll overlaps the last one
        val ledgerStore = MemoryLabStore()
        val ledger = LabLedger(ledgerStore) { clock }
        val out = Outbox(
            pairing, FileOutboxStore(createTempDirectory("dls-lab-v1").toFile()), RelayClient(pairing.relay, http, emptyList()), clock = { clock },
            onAckHeader = { h, t, id -> heard[id] = h; ledger.record(h, t) },
        )
        val row = out.send(OutgoingItem(Kind.URL, url = "https://example.com/pending"), null)
        assertEquals(Status.SENT, row.status)
        for (c in v["v1Safety"].objs()) {
            val name = c["name"] as String
            val frame = Bytes.fromBase64OrNull(c["frameBase64"] as String)!!
            val opened = FrameCodec.open(keys, Purpose.ACK, frame)
            assertEquals(name, c["kind"], opened.header["kind"])
            assertEquals(name, c["ackIds"], AckHeader.idsOf(opened.header))
            http.inject(keys.ackTopic, frame)
        }
        clock += 5_000
        assertEquals("no row is delivered by a Lab frame", 0, out.checkAcks())
        assertEquals(Status.SENT, out.row(row.id)!!.status)
        assertEquals(v["v1Safety"].objs().size, heard.size)
        assertTrue("the hello reached the ledger", ledger.inboxLab())
        // A real ack still delivers, and the hook hears it too.
        http.inject(keys.ackTopic, AckHeader.frame(keys, listOf(row.id)))
        clock += 1_000
        assertEquals(1, out.checkAcks())
        assertEquals(v["v1Safety"].objs().size + 1, heard.size)
        // A hook that throws never stops the ack check.
        val other = Outbox(pairing, FileOutboxStore(createTempDirectory("dls-lab-v1b").toFile()), RelayClient(pairing.relay, http, emptyList()), clock = { clock },
            onAckHeader = { _, _, _ -> throw IllegalStateException("boom") })
        val row2 = other.send(OutgoingItem(Kind.URL, url = "https://example.com/second"), null)
        http.inject(keys.ackTopic, AckHeader.frame(keys, listOf(row2.id)))
        clock += 1_000
        assertEquals(1, other.checkAcks())
        assertFalse(heard.isEmpty())
        assertNull(LabFrame.parse(heard.values.last()).inbox)
    }
}
