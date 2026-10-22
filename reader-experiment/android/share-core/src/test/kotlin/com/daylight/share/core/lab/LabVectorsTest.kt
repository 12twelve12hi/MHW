package com.daylight.share.core.lab

import com.daylight.share.core.AckHeader
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
import kotlin.io.path.createTempDirectory

/**
 * Checks the Kotlin Lab port against ../../share/vectors/lab-vectors.json (made by the JS reference, LAB-PROTOCOL
 * 2.8): every W0 section, and the W1 strings labText pins. The W1 sections labExcerpt, diagnostics and testArticle
 * belong to K3 ([LATER]); a section this test does not know fails [everySectionIsPorted], so none is skipped silently.
 */
class LabVectorsTest {
    private val v get() = Vectors.lab
    private fun hex(s: Any?) = Bytes.fromHex(s as String)
    private val keys1: Keys get() = Keys.derive(hex(v["labTopics"].obj()["returnFrame"].obj()["secretHex"]))

    companion object {
        /** The sections this test checks. */
        val PORTED = listOf("constants", "labTopics", "labFrames", "labParse", "labLedger", "labGate", "labHeaderExtras", "labRowText", "labText", "v1Safety")

        /** Sections of later cards (LAB-PLAN 3.5), with the card that ports them. */
        val LATER = mapOf(
            "labExcerpt" to "K3 (W1): Excerpt and classifyShare",
            "diagnostics" to "K3 (W1): redactDiagnostics and the activity log",
            "testArticle" to "K3 (W1): testArticle",
        )
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
        )
        for ((k, value) in kotlin) assertEquals(k, c[k], norm(value))
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
        assertEquals("Copy Server code", LabText.button("needs-server"))
        assertNull(LabText.button("needs-inbox"))
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
