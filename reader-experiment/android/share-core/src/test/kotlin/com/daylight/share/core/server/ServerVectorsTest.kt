package com.daylight.share.core.server

import com.daylight.share.core.Bytes
import com.daylight.share.core.FrameCodec
import com.daylight.share.core.Http
import com.daylight.share.core.Json
import com.daylight.share.core.Keys
import com.daylight.share.core.Pairing
import com.daylight.share.core.Purpose
import com.daylight.share.core.ShareException
import com.daylight.share.core.lab.FakeRelayHttp
import com.daylight.share.core.lab.Lab
import com.daylight.share.core.lab.LabGate
import com.daylight.share.core.lab.Vectors
import com.daylight.share.core.lab.Vectors.norm
import com.daylight.share.core.lab.long
import com.daylight.share.core.lab.obj
import com.daylight.share.core.lab.objs
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

/**
 * Checks the Kotlin port of the server client's W0 subset (LAB-PLAN 2.6) against ../../server/vectors/server-vectors.json:
 * derived, serverCodeParsing, frames (config), negative (the config parts) and serverState; then discovery, the pin and
 * the move, the status cache and the gate's view of a server, against an in-memory relay and server.
 */
class ServerVectorsTest {
    private val v get() = Vectors.server
    private fun hex(s: Any?) = Bytes.fromHex(s as String)
    private val secret get() = hex(v["secretHex"])
    private val seed get() = ServerCode.deriveSeed(secret)
    private val values get() = ServerCode.derive(seed)

    @Test
    fun derived() {
        val d = v["derived"].obj()
        assertEquals(d["seedHex"], Bytes.toHex(seed))
        assertEquals(d["serverCode"], ServerCode.format(seed))
        assertEquals(d["serverCodeLink"], ServerCode.format(seed, "https://relay.example.org", "tk_live_123"))
        assertEquals(d["serverCode"], ServerCode.format(seed, "https://ntfy.sh/", ""))
        val x = values
        assertEquals(d["authToken"], x.authToken)
        assertEquals(d["configTopic"], x.configTopic)
        assertEquals(d["itemTopic"], x.itemTopic)
        assertEquals(d["ackTopic"], x.ackTopic)
        assertEquals(d["emailToken"], x.emailToken)
        val salted = d["emailTokenWithSalt"].obj()
        assertEquals(salted["emailToken"], ServerCode.derive(seed, salted["salt"] as String).emailToken)
        assertEquals(d["fingerprint"], x.fingerprint)
        assertEquals(d["workerName"], x.workerName)
        for (i in d["serverItemIds"].objs()) assertEquals(i["origin"] as String, i["id"], ServerCode.serverItemId(seed, i["origin"] as String))
        assertEquals("5138-e08d", ServerCode.showFingerprint(x.fingerprint))
        assertEquals(v["pairingCode"], Pairing(secret).code)
        val server = DaylightServer(Pairing(secret), MemoryServerStore(), FakeRelayHttp())
        assertEquals(d["serverCode"], server.serverCode())
    }

    @Test
    fun serverCodeParsing() {
        for (c in v["serverCodeParsing"].objs()) {
            val input = c["input"] as String
            val error = c["error"] as String?
            if (error != null) {
                try {
                    ServerCode.parse(input)
                    fail("$input: expected $error")
                } catch (e: ShareException) {
                    assertEquals(input, "server-code", e.code)
                    assertEquals(input, error, e.reason)
                }
                continue
            }
            val p = ServerCode.parse(input)
            assertEquals(input, c["seedHex"], Bytes.toHex(p.seed))
            assertEquals(input, c["relay"] ?: "https://ntfy.sh", p.relay)
            assertEquals(input, c["token"] ?: "", p.token)
        }
    }

    @Test
    fun configFrame() {
        val c = v["frames"].obj()["config"].obj()
        assertEquals("dlshare/v1/server-config", c["aad"])
        val frame = Bytes.fromBase64OrNull(c["frameBase64"] as String)!!
        val (header, body) = ServerBox.open(values, ServerBox.CONFIG, frame)
        assertEquals(c["header"], header)
        assertEquals(0, body.size)
        @Suppress("UNCHECKED_CAST")
        assertArrayEquals(frame, ServerBox.seal(values, ServerBox.CONFIG, c["header"] as Map<String, Any?>, ByteArray(0), hex(c["nonceHex"])))
        val sent = Bytes.parseIsoTime(c["header"].obj()["sent"] as String)!!
        val cfg = ServerConfig.check(header, sent)!!
        assertEquals(c["header"].obj()["server"], cfg.server)
        assertEquals(1, cfg.api)
        assertEquals(values.fingerprint, cfg.fingerprint)
        assertEquals("lab", cfg.delivery)
        assertEquals("2026-10-20T06:00:00.000Z", cfg.sent)
        assertEquals("2b8e0f6c1d4a4e5f9a0b1c2d3e4f5a6b", cfg.id)
        // 4.3: a config from more than 5 minutes ahead, or of another shape, is refused.
        assertNull(ServerConfig.check(header, sent - ServerCode.CONFIG_MAX_AHEAD_MS - 1))
        fun with(k: String, x: Any?) = LinkedHashMap(header).also { it[k] = x }
        assertNull(ServerConfig.check(with("kind", "ack"), sent))
        assertNull(ServerConfig.check(with("v", 2.0), sent))
        for (bad in listOf("http://daylight.example.org", "https://daylight.example.org/x", "https://Daylight.example.org", "https://daylight.example.org:443",
            "https://u@daylight.example.org", "https://daylight.example.org?x", "https://daylight.example.org#x", "daylight.example.org", "https://")) {
            assertNull(bad, ServerConfig.check(with("server", bad), sent))
        }
        assertEquals("https://daylight.example.org:8443", ServerConfig.check(with("server", "https://daylight.example.org:8443/"), sent)!!.server)
        assertNull(ServerConfig.check(with("api", 1.5), sent))
        assertNull(ServerConfig.check(with("api", 0.0), sent))
        assertNull(ServerConfig.check(with("fingerprint", "5138E08D"), sent))
        assertEquals("v1", ServerConfig.check(with("delivery", "v1"), sent)!!.delivery)
        assertEquals("lab", ServerConfig.check(with("delivery", "other"), sent)!!.delivery)
        // The server's acks and hellos open under the ack AAD (Wave S reads them; W0 only checks the box).
        for (k in listOf("hello", "ack")) {
            val f = v["frames"].obj()[k].obj()
            assertEquals(k, f["header"], ServerBox.open(values, ServerBox.ACK, Bytes.fromBase64OrNull(f["frameBase64"] as String)!!).first)
        }
    }

    @Test
    fun negative() {
        val keys = Keys.derive(secret)
        val frames = v["frames"].obj()
        for (c in v["negative"].objs()) {
            val frame = Bytes.fromBase64OrNull(
                (c["frameBase64"] ?: when (c["frame"]) {
                    "item" -> frames["item"].obj()["parts"].objs()[0]["frameBase64"]
                    else -> frames[c["frame"] as String].obj()["frameBase64"]
                }) as String,
            )!!
            val with = c["openWith"] as String
            try {
                when {
                    with.startsWith("box:") -> ServerBox.open(values, with.removePrefix("box:"), frame)
                    with.startsWith("pairing:") -> FrameCodec.open(keys, Purpose.of(with.removePrefix("pairing:")), frame)
                    else -> error("unknown $with")
                }
                fail("${c["frame"]} opened with $with")
            } catch (e: ShareException) {
                assertEquals(Json.write(c), c["expect"], e.code)
            }
        }
    }

    // ---------------------------------------------------------------------------------------------------- serverState

    private val state get() = v["serverState"].obj()
    private val now get() = state["now"].long()!!
    private val origin = "https://daylight-6c1f0e9a2b44.example.workers.dev"

    /** The JS `stateClient`: a manual address, a cached config and a fresh cached status in which every feature is ready. */
    private fun stateStore(): MemoryServerStore = MemoryServerStore().apply {
        set(ServerKeys.MANUAL_URL, origin)
        set(ServerKeys.CONFIG, linkedMapOf("server" to origin, "api" to 1, "fingerprint" to "3f9a1c2e", "delivery" to "lab", "sent" to "2026-10-20T05:00:00.000Z", "id" to ""))
        set(ServerKeys.CONFIG_AT, now - 60_000)
        set(ServerKeys.STATUS, state["fromStatus"].objs()[0]["status"])
        set(ServerKeys.STATUS_AT, now - 60_000)
    }

    private class AnswerHttp(val answer: (method: String, url: String) -> Http.Response) : Http {
        override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int) = answer(method, url)
        override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = throw IOException("no relay here")
    }

    /** The error a fromError input produces, as the Kotlin client sees it (the JS `errorFor`). */
    private fun errorFor(c: Map<String, Any?>): ServerError {
        c["local"]?.let { return ServerError(it as String, ServerMessages.localMessage(it)) }
        if (c["deadline"] == true) return ServerError("OFFLINE")
        val client = DaylightServer(Pairing(secret), stateStore(), AnswerHttp { _, _ ->
            if (c["network"] == true) throw IOException("Failed to fetch")
            val r = c["response"].obj()
            Http.Response(r["status"].long()!!.toInt(), emptyMap(), Bytes.utf8(r["body"] as String))
        }) { now }
        try {
            client.request("POST", "/v1/ai", json = emptyMap<String, Any?>())
        } catch (e: ServerError) {
            return e
        }
        error("the request did not fail")
    }

    @Test
    fun serverStateFromStatus() {
        assertEquals(state["states"], ServerMessages.SERVER_STATES)
        for (c in state["fromStatus"].objs()) {
            val got = ServerMessages.stateFromStatus(c["status"], c["feature"] as String)
            assertEquals(c["name"] as String, c["expect"], norm(linkedMapOf("state" to got.state, "message" to got.message)))
            assertTrue(got.state in ServerMessages.SERVER_STATES)
        }
    }

    @Test
    fun serverStateFromError() {
        for (c in state["fromError"].objs()) {
            val name = c["name"] as String
            val feature = c["feature"] as String
            val err = errorFor(c)
            // The error the client makes: its code, status and the fields it keeps.
            val fields = linkedMapOf<String, Any?>("code" to err.code, "status" to err.status)
            for (k in listOf("feature", "missing", "retryAfter", "limit", "resetAt")) err.extra[k]?.let { fields[k] = it }
            assertEquals(name, c["error"], norm(fields))
            val expect = c["expect"]
            val got = ServerMessages.stateFromError(err)
            assertEquals(name, expect, norm(linkedMapOf("state" to got.state, "message" to got.message)))
            // noteError returns the same, and does to the cached status what the vector says (the JS `noteEffect`).
            val store = stateStore()
            (c["before"] as Map<*, *>?)?.forEach { (k, x) -> store.set(k as String, x) }
            val client = DaylightServer(Pairing(secret), store, AnswerHttp { _, _ -> throw AssertionError("noteError must not make requests") }) { now }
            val out = client.noteError(feature, err)
            assertEquals(name, got, out)
            val status = store.get(ServerKeys.STATUS)
            val statusAt = store.get(ServerKeys.STATUS_AT)
            val effect: Map<String, Any?> = when {
                status == null -> linkedMapOf("cache" to "dropped", "configRefresh" to (store.get(ServerKeys.CONFIG_AT) == null), "badAuthAt" to store.get(ServerKeys.BAD_AUTH_AT))
                status == norm(state["fromStatus"].objs()[0]["status"]) && statusAt != null -> linkedMapOf("cache" to "kept")
                else -> {
                    val before = state["fromStatus"].objs()[0]["status"].obj()["features"].obj()
                    val after = status.obj()["features"].obj()
                    linkedMapOf("cache" to "updated", "feature" to after.keys.filter { after[it] != before[it] }.joinToString(","), "refresh" to (statusAt == null))
                }
            }
            assertEquals(name, c["noteError"], norm(effect))
            if (effect["cache"] == "updated") {
                assertEquals(name, expect, norm(status.obj()["features"].obj()[effect["feature"]]))
            }
        }
    }

    @Test
    fun messages() {
        for (code in ServerMessages.ERROR_CODES) assertTrue(code, ServerMessages.errorMessage(code).isNotEmpty())
        assertEquals("Something went wrong on the Daylight server (NOPE). Try again later.", ServerMessages.errorMessage("NOPE"))
        assertEquals("That’s larger than the Daylight server takes (12.7 MB).", ServerMessages.errorMessage("TOO_LARGE", mapOf("limit" to 12713984.0)))
        assertEquals("That’s larger than the Daylight server takes (13 MB).", ServerMessages.errorMessage("TOO_LARGE", mapOf("limit" to 12_960_000.0)))
        assertEquals(
            "This request could cost up to US$1.01 with Claude, more than today’s AI limit. Raise the limit in Lab settings (up to US$10).",
            ServerMessages.errorMessage("AI_DAILY_LIMIT", mapOf("needUsd" to 1.005 + 0.004)),
        )
        assertEquals(
            "Today’s AI limit is used up. It resets at 00:00 UTC, or raise it in Lab settings (up to US$2.50).",
            ServerMessages.errorMessage("AI_DAILY_LIMIT", mapOf("resetAt" to "2026-10-21T00:00:00.000Z", "ceilingUsd" to 2.5)),
        )
        assertTrue(ServerMessages.errorMessage("AI_DAILY_LIMIT", mapOf("limitRequests" to 1.0, "resetAt" to "2026-10-21T06:30:00Z")).startsWith("You’ve used today’s 1 AI request (the server’s daily limit). It resets at 06:30 UTC."))
        assertEquals("This is too long for one AI request (about 250,000 tokens; the limit is 200,000).", ServerMessages.errorMessage("AI_TOO_LARGE", mapOf("tokens" to 250000.0)))
        assertEquals("needs-server", ServerMessages.notConfiguredState(listOf("R2", "DAYLIGHT_SERVER_CODE")))
        assertFalse(ServerMessages.isServerCode("OFFLINE"))
        assertTrue(ServerMessages.isServerCode("A" + "B".repeat(39)))
        assertFalse(ServerMessages.isServerCode("needs-server"))
        assertNotNull(ServerMessages.noticeText("ai"))
        assertEquals(ServerMessages.noticeText("ai"), ServerMessages.noticeText("pdf"))
        assertFalse(ServerMessages.noticeText("ai", "v1")!!.contains("stay end-to-end"))
        assertNull(ServerMessages.noticeText("unknown"))
        assertEquals(ServerMessages.STATE_MESSAGES["needs-key"], ServerMessages.stateFromError(ServerError("NEEDS_KEY")).message)
        assertEquals("OFFLINE", ServerMessages.stateFromError(IOException("x")).state)
    }

    // ---------------------------------------------------------------------------------------- the client, end to end

    /** An in-memory relay with the server's config topic, and a server that answers [respond]. */
    private class World(val now: () -> Long) {
        val relay = FakeRelayHttp(now)
        var respond: (method: String, path: String) -> Http.Response = { _, _ -> Http.Response(404, emptyMap(), ByteArray(0)) }
        val requests = ArrayList<String>()
        val http = object : Http {
            override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
                if (url.startsWith("https://relay.test")) return relay.send(method, url, headers, body, maxResponseBytes, readTimeoutMs)
                requests += "$method $url"
                return respond(method, url.substringAfter(".dev").substringAfter(".org"))
            }
            override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int) = relay.stream(url, headers, readTimeoutMs)
        }
    }

    private fun json(status: Int, body: Any?) = Http.Response(status, emptyMap(), Bytes.utf8(Json.write(body)))

    private fun announce(w: World, values: ServerValues, server: String, sent: String) {
        val h = linkedMapOf<String, Any?>("v" to 1, "kind" to "config", "id" to Bytes.toHex(Bytes.random(16)), "sent" to sent, "server" to server, "api" to 1, "fingerprint" to values.fingerprint, "delivery" to "lab")
        w.relay.inject(values.configTopic, ServerBox.seal(values, ServerBox.CONFIG, h))
    }

    @Test
    fun discoveryPinsTheFirstOriginAndAsksBeforeAMove() {
        var clock = 1_792_476_000_000L
        val w = World { clock }
        val pairing = Pairing(Bytes.random(16), "https://relay.test")
        val store = MemoryServerStore()
        val server = DaylightServer(pairing, store, w.http) { clock }
        // Nothing announced: needs-server, and the gate says so with the short sentence.
        assertNull(server.discover())
        assertEquals("needs-server", server.state("ai").state)
        val gate = LabGate.run("F37", LabGate.Context(lab = true, paired = true, server = server, platform = "android"))
        assertEquals("needs-server", gate.state)
        assertEquals("Copy Server code", gate.button)
        // The server announces itself: ready once its status says so.
        announce(w, server.values, "https://daylight-aaaaaaaaaaaa.me.workers.dev", Bytes.isoTime(clock - 60_000))
        w.respond = { _, path ->
            if (path == "/v1/status") json(200, linkedMapOf("features" to ServerCode.FEATURES.associateWith { linkedMapOf("state" to if (it == "email") "needs-domain" else "ready") }))
            else json(404, linkedMapOf("error" to linkedMapOf("code" to "NOT_FOUND")))
        }
        val d = server.discover(force = true)!!
        assertEquals("relay", d.source)
        assertEquals("https://daylight-aaaaaaaaaaaa.me.workers.dev", d.config.server)
        assertEquals("ready", server.state("ai").state)
        assertEquals("needs-domain", server.state("email").state)
        assertEquals(1, w.requests.count { it.endsWith("/v1/status") }) // cached for 10 minutes
        assertTrue(LabGate.run("F37", LabGate.Context(lab = true, paired = true, server = server, platform = "android")).ready)
        assertEquals("later", LabGate.run("files", LabGate.Context(lab = true, paired = true, server = server, built = { false }, platform = "android")).state)
        // A later config with the same fingerprint and another origin: used only after confirmMove.
        clock += ServerCode.CONFIG_REFRESH_MS + 1
        announce(w, server.values, "https://daylight-bbbbbbbbbbbb.me.workers.dev", Bytes.isoTime(clock - 1_000))
        val moved = server.discover()!!
        assertEquals("https://daylight-bbbbbbbbbbbb.me.workers.dev", moved.moved)
        assertEquals("https://daylight-aaaaaaaaaaaa.me.workers.dev", moved.config.server)
        assertEquals("Your Daylight server moved to daylight-bbbbbbbbbbbb.me.workers.dev. Use it?", com.daylight.share.core.lab.LabText.serverMovedText(moved.moved))
        assertTrue(server.confirmMove())
        assertFalse(server.confirmMove())
        assertNull(server.discover(force = true)!!.moved)
        // 423 LOCKED drops the cached status; the next state() asks again.
        w.respond = { _, _ -> json(423, linkedMapOf("error" to linkedMapOf("code" to "LOCKED", "message" to "Locked."))) }
        try {
            server.request("POST", "/v1/ai", json = emptyMap<String, Any?>())
            fail("LOCKED")
        } catch (e: ServerError) {
            assertEquals("locked", server.noteError("ai", e).state)
        }
        assertNull(store.get(ServerKeys.STATUS))
        assertEquals("locked", server.state("ai").state)
        // Re-pairing locks the server with the old token; it never throws.
        w.respond = { _, _ -> Http.Response(204, emptyMap(), ByteArray(0)) }
        assertTrue(server.lockBeforeRepair())
        assertTrue(w.requests.last().startsWith("POST https://daylight-bbbbbbbbbbbb.me.workers.dev/v1/admin/lock"))
    }

    @Test
    fun aPairingMismatchAndAnOutdatedServerAreTheAppsOwnStates() {
        val clock = 1_792_476_000_000L
        val w = World { clock }
        val store = MemoryServerStore()
        store.set(ServerKeys.PIN, linkedMapOf("origin" to "https://daylight-cccccccccccc.me.workers.dev", "fingerprint" to "00000000"))
        val server = DaylightServer(Pairing(Bytes.random(16), "https://relay.test"), store, w.http) { clock }
        assertEquals("pairing-mismatch", server.state("ai").state)
        val h = linkedMapOf<String, Any?>("v" to 1, "kind" to "config", "id" to "x", "sent" to Bytes.isoTime(clock), "server" to "https://daylight-cccccccccccc.me.workers.dev", "api" to 2, "fingerprint" to server.values.fingerprint, "delivery" to "lab")
        w.relay.inject(server.values.configTopic, ServerBox.seal(server.values, ServerBox.CONFIG, h))
        assertEquals("app-outdated", server.state("ai").state)
        // A config sealed for another server is ignored.
        val other = ServerCode.derive(Bytes.random(16))
        w.relay.inject(server.values.configTopic, ServerBox.seal(other, ServerBox.CONFIG, h))
        assertEquals("app-outdated", server.state("ai").state)
    }

    @Test
    fun theGateGivesOfflineAtItsDeadlineAndAStatusTakesAtMostItsWait() {
        val clock = 1_792_476_000_000L
        val store = MemoryServerStore()
        store.set(ServerKeys.MANUAL_URL, "https://daylight.example.org")
        val slow = object : Http {
            override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
                Thread.sleep(30_000)
                return Http.Response(200, emptyMap(), Bytes.utf8("{}"))
            }
            override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = throw IOException("x")
        }
        val server = DaylightServer(Pairing(Bytes.random(16)), store, slow) { clock }
        val t0 = System.nanoTime()
        val r = LabGate.run("F37", LabGate.Context(lab = true, paired = true, server = server, platform = "iphone", deadlineMs = 300))
        assertEquals("OFFLINE", r.state)
        assertEquals("Can’t reach the server", r.short)
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 5_000)
        val t1 = System.nanoTime()
        try {
            server.status(force = true, waitMs = 200)
            fail("OFFLINE")
        } catch (e: ServerError) {
            assertEquals("OFFLINE", e.code)
        }
        assertTrue((System.nanoTime() - t1) / 1_000_000 < 5_000)
        assertEquals(Lab.GATE_DEADLINE_MS, LabGate.Context(lab = true, paired = true).deadlineMs)
    }

    @Test
    fun setManualUrlChecksTheServerAndNoticesShowOnce() {
        val clock = 1_792_476_000_000L
        val w = World { clock }
        w.respond = { _, path ->
            when (path) {
                "/v1/hello" -> json(200, linkedMapOf("service" to "daylight-server"))
                "/v1/status" -> json(200, linkedMapOf("features" to linkedMapOf("ai" to linkedMapOf("state" to "needs-key"))))
                else -> json(404, null)
            }
        }
        val store = MemoryServerStore()
        val server = DaylightServer(Pairing(Bytes.random(16), "https://relay.test"), store, w.http) { clock }
        try {
            server.setManualUrl("ftp://daylight.example.org")
            fail("not https")
        } catch (e: ServerError) {
            assertEquals("BAD_REQUEST", e.code)
        }
        assertEquals("https://daylight.example.org", server.setManualUrl(" https://Daylight.Example.org:443/path "))
        assertEquals("needs-key", server.state("ai").state)
        assertEquals(ServerMessages.STATE_MESSAGES["needs-key"], server.state("ai").message)
        server.clearManualUrl()
        assertNull(store.get(ServerKeys.MANUAL_URL))
        assertNotNull(server.notice("pdf"))
        server.markNoticeShown("pdf")
        assertNull(server.notice("ai"))
        assertNotNull(server.notice("files"))
    }
}
