package com.daylight.share.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/** Checks the Kotlin implementation against ../../share/vectors/test-vectors.json (made by the JS reference). */
@Suppress("UNCHECKED_CAST")
class VectorsTest {
    private val v: Map<String, Any?> by lazy {
        val path = System.getProperty("dls.vectors") ?: "../../share/vectors/test-vectors.json"
        Json.parse(File(path).readText()) as Map<String, Any?>
    }

    private fun list(key: String) = (v[key] as List<Any?>).map { it as Map<String, Any?> }
    private fun hex(s: Any?) = Bytes.fromHex(s as String)
    private val s1: ByteArray get() = hex(list("pairing")[0]["secretHex"])

    @Test
    fun pairing() {
        for (p in list("pairing")) {
            val secret = hex(p["secretHex"])
            val label = p["label"] as String
            val pairing = Pairing(secret)
            assertEquals(label, p["code"], pairing.code)
            assertEquals(label, p["codeCompact"], pairing.compactCode)
            assertEquals(label, p["link"], pairing.link())
            val withExtras = Pairing(secret, "https://relay.example.org/ntfy/", "Anjan’s Daylight & co")
            assertEquals(label, p["linkWithRelayAndName"], withExtras.link())
            val keys = Keys.derive(secret)
            assertEquals(label, p["keyHex"], Bytes.toHex(keys.keyBytes))
            assertEquals(label, p["inboxTopic"], keys.inboxTopic)
            assertEquals(label, p["ackTopic"], keys.ackTopic)
            // And back.
            assertArrayEquals(secret, Pairing.parseCode(p["code"] as String))
            assertArrayEquals(secret, Pairing.parse(p["link"] as String).secret)
            val back = Pairing.parse(p["linkWithRelayAndName"] as String)
            assertArrayEquals(secret, back.secret)
            assertEquals("https://relay.example.org/ntfy", back.relay)
            assertEquals("Anjan’s Daylight & co", back.name)
        }
    }

    @Test
    fun codeParsing() {
        for (c in list("codeParsing")) {
            val name = c["name"] as String
            val input = c["input"] as String
            val error = c["error"] as String?
            if (error != null) {
                try {
                    Pairing.parse(input)
                    fail("$name: expected $error")
                } catch (e: ShareException) {
                    assertEquals(name, "code", e.code)
                    assertEquals(name, error, e.reason)
                }
                continue
            }
            val p = Pairing.parse(input)
            assertEquals(name, c["secretHex"], Bytes.toHex(p.secret))
            c["relay"]?.let { assertEquals(name, it, p.relay) }
            c["nameExpected"]?.let { assertEquals(name, it, p.name) }
        }
    }

    @Test
    fun seal() {
        for (s in list("seal")) {
            val name = s["name"] as String
            val keys = Keys.derive(hex(s["secretHex"]))
            val purpose = if (s["purpose"] == "ack") Purpose.ACK else Purpose.INBOX
            val headerJson = s["headerJson"] as String
            val body = hex(s["bodyHex"])
            val frame = FrameCodec.seal(keys, purpose, Bytes.utf8(headerJson), body, hex(s["nonceHex"]))
            assertEquals(name, s["frameHex"], Bytes.toHex(frame))
            assertEquals(name, s["frameBase64"], Bytes.toBase64(frame))
            assertArrayEquals(name, frame, Bytes.fromBase64OrNull(s["frameBase64"] as String))
            val opened = FrameCodec.open(keys, purpose, hex(s["frameHex"]))
            assertEquals(name, headerJson, Json.write(opened.header))
            assertArrayEquals(name, body, opened.body)
        }
    }

    @Test
    fun headersSerialiseLikeJavaScript() {
        // The seal vectors' header JSON came from JSON.stringify: re-serialising the parsed header must give the same bytes.
        for (s in list("seal")) {
            val json = s["headerJson"] as String
            assertEquals(json, Json.write(Json.parse(json)))
        }
        // An item built here has the same header as the JS one (page vector: same fields, same order).
        val keys = Keys.derive(s1)
        val item = list("items").first { (it["name"] as String).startsWith("url") }
        val expect = (item["expect"] as Map<String, Any?>)["header"] as Map<String, Any?>
        val (prepared, _) = ItemBuilder.buildFrames(
            keys,
            OutgoingItem(Kind.URL, id = expect["id"] as String, url = expect["url"] as String, title = expect["title"] as String, sent = expect["sent"] as String),
            null,
        )
        assertEquals(Json.write(expect), Json.write(prepared.header.toJson()))
    }

    @Test
    fun items() {
        val keys = Keys.derive(s1)
        for (item in list("items")) {
            val name = item["name"] as String
            for (spool in listOf<File?>(null, kotlin.io.path.createTempDirectory("dls-spool").toFile())) {
                val r = Reassembler(spool)
                var done: Reassembler.Completed? = null
                val frames = (item["framesHex"] as List<Any?>).map { hex(it) }
                for ((i, f) in frames.withIndex()) {
                    val opened = FrameCodec.open(keys, Purpose.INBOX, f)
                    val out = r.add(opened.header, opened.body)
                    if (i < frames.size - 1) assertNull("$name: complete too early", out) else done = out
                }
                assertNotNull(name, done)
                val expect = item["expect"] as Map<String, Any?>
                val eh = expect["header"] as Map<String, Any?>
                val h = done!!.header
                assertEquals(name, eh["id"], h.id)
                assertEquals(name, eh["kind"], h.kind)
                assertEquals(name, eh["url"], h.url)
                assertEquals(name, eh["title"], h.title)
                assertEquals(name, eh["name"], h.name)
                if (h.kind != Kind.URL) {
                    assertEquals(name, eh["mime"], h.mime)
                    assertEquals(name, (eh["size"] as Double).toLong(), h.size)
                    assertEquals(name, eh["sha256"], h.sha256)
                }
                assertEquals(name, eh["enc"] ?: "identity", h.enc)
                assertEquals(name, eh["sent"], h.sent)
                assertEquals(name, eh["from"], h.from)
                assertEquals(name, eh["app"], h.app)
                val content = done.content.open().use { it.readBytes() }
                expect["contentUtf8"]?.let { assertEquals(name, it, String(content, Charsets.UTF_8)) }
                expect["contentHex"]?.let { assertEquals(name, it, Bytes.toHex(content)) }
                spool?.deleteRecursively()
            }
        }
    }

    @Test
    fun itemsBuiltHereDecodeTheSame() {
        // Our own frames for the same inputs: identity frames match the JS bytes exactly (same header order, same nonce).
        val keys = Keys.derive(s1)
        val pdf = list("items").first { (it["name"] as String).startsWith("pdf file, identity") }
        val eh = (pdf["expect"] as Map<String, Any?>)["header"] as Map<String, Any?>
        val bytes = hex((pdf["expect"] as Map<String, Any?>)["contentHex"])
        val nonces = (0..2).map { Bytes.sha256(Bytes.utf8("nonce/chunk$it")).copyOf(12) }
        val (_, frames) = ItemBuilder.buildFrames(
            keys,
            OutgoingItem(Kind.FILE, id = eh["id"] as String, name = "paper.pdf", mime = "application/pdf", title = "A paper", sent = eh["sent"] as String, from = "Android"),
            bytes, chunkSize = 400, nonces = nonces,
        )
        assertEquals((pdf["framesHex"] as List<Any?>), frames.map { Bytes.toHex(it) })
    }

    @Test
    fun invalidFrames() {
        val keys = Keys.derive(s1)
        for (f in list("invalidFrames")) {
            val purpose = if (f["purpose"] == "ack") Purpose.ACK else Purpose.INBOX
            try {
                FrameCodec.open(keys, purpose, hex(f["frameHex"]))
                fail("${f["name"]}: opened")
            } catch (e: ShareException) {
                assertEquals("frame", e.code)
            }
        }
    }

    @Test
    fun badHeaders() {
        for (b in list("badHeaders")) {
            try {
                ItemHeader.check(b["header"] as Map<String, Any?>)
                fail("${b["name"]}: accepted")
            } catch (e: ShareException) {
                assertEquals("header", e.code)
            }
        }
        // And a frame that decrypts but has only {"v":1} is refused by the reassembler.
        try {
            Reassembler().add(mapOf("v" to 1.0), ByteArray(0))
            fail("empty header accepted")
        } catch (e: ShareException) {
            assertEquals("header", e.code)
        }
    }

    @Test
    fun fileNames() {
        for (f in list("fileNames")) assertEquals(f["input"] as String, f["expect"], Text.safeFileName(f["input"] as String))
    }

    @Test
    fun helpers() {
        assertEquals("https://example.com/a?b=c", Text.findUrl("Look at this https://example.com/a?b=c). More"))
        assertEquals("https://x.org/p", Text.findUrl("Title\nhttps://x.org/p"))
        assertNull(Text.findUrl("no link here"))
        assertNull(Text.webUrl("javascript:alert(1)"))
        assertNull(Text.webUrl("https:///nohost"))
        assertEquals("https://ntfy.sh", Relay.normalize(""))
        assertEquals("https://ntfy.sh", Relay.normalize("ntfy.sh/"))
        assertEquals("http://127.0.0.1:8787", Relay.normalize("http://127.0.0.1:8787/"))
        assertEquals("https://relay.example.org/ntfy", Relay.normalize("HTTPS://Relay.Example.org:443/ntfy/?x=1#y"))
        assertTrue(FrameCodec.isSmall(2850))
        assertFalse(FrameCodec.isSmall(2851))
        assertEquals("a b", Text.cleanName("  a\n\t b "))
        assertEquals(60, Text.cleanName("x".repeat(100)).length)
        val b32 = Base32.encode(byteArrayOf(1, 2, 3, 4, 5))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), Base32.decode(b32))
        assertNull(Bytes.fromBase64OrNull("not base64!"))
        assertNull(Bytes.fromBase64OrNull("QQ==="))
        assertArrayEquals(Bytes.utf8("A"), Bytes.fromBase64OrNull("QQ"))
        assertEquals("2026-10-17T22:00:00.000Z", Bytes.isoTime(Bytes.parseIsoTime("2026-10-17T22:00:00.000Z")!!))
        assertEquals("{\"a\":\"\\u0001\\n\\\"x\\\\\",\"b\":[1,2.5,true,null]}", Json.write(linkedMapOf("a" to "\u0001\n\"x\\", "b" to listOf(1, 2.5, true, null))))
    }
}
