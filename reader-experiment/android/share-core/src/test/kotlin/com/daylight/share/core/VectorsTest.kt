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
        for (f in list("fileNamesUtf16")) {
            val units = (f["inputUtf16"] as List<Any?>).map { (it as Double).toInt().toChar() }
            assertEquals(f["name"] as String, f["expect"], Text.safeFileName(String(units.toCharArray())))
        }
        // Every result stays within both limits, whole code points only.
        for (f in list("fileNames")) {
            val out = Text.safeFileName(f["input"] as String)
            assertTrue(out, out.length <= 120 && out.toByteArray(Charsets.UTF_8).size <= 200)
            assertFalse(out, out.isNotEmpty() && Character.isHighSurrogate(out.last()))
        }
    }

    @Test
    fun relays() {
        for (r in list("relays")) {
            val input = r["input"] as String
            if (r["error"] != null) {
                try {
                    val got = Relay.normalize(input)
                    fail("relay ${Json.write(input)}: expected an error, got $got")
                } catch (e: ShareException) {
                    assertEquals(input, r["error"], e.code)
                }
            } else {
                assertEquals(Json.write(input), r["expect"], Relay.normalize(input))
                // Normalising is idempotent, and the Pairing constructor applies it.
                assertEquals(input, r["expect"], Relay.normalize(r["expect"] as String))
                assertEquals(input, r["expect"], Pairing(ByteArray(16), input).relay)
            }
        }
    }

    @Test
    fun urls() {
        for (u in list("urls")) {
            val input = u["input"] as String
            assertEquals(Json.write(input.take(80)), u["expect"], Text.webUrl(input))
        }
    }

    /** A body of [n] zero bytes that is never held in memory; [open] fails when [readable] is false. */
    private fun zeros(n: Long, readable: Boolean = true) = object : Body {
        override val length = n
        override fun open(): java.io.InputStream {
            if (!readable) throw AssertionError("content read before the size check")
            return object : java.io.InputStream() {
                var left = n
                override fun read(): Int = if (left-- > 0) 0 else -1
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (left <= 0) return -1
                    val k = minOf(len.toLong(), left).toInt()
                    java.util.Arrays.fill(b, off, off + k, 0)
                    left -= k
                    return k
                }
            }
        }
        override fun read(offset: Long, len: Int) = ByteArray(len)
    }

    @Test
    fun sizing() {
        val s = v["sizing"] as Map<String, Any?>
        assertEquals((s["chunk"] as Double).toInt(), Limits.CHUNK)
        assertEquals((s["maxItem"] as Double).toLong(), Limits.MAX_ITEM)
        assertEquals((s["maxHeader"] as Double).toInt(), Limits.MAX_HEADER)
        assertEquals((s["largestFrame"] as Double).toInt(), Limits.CHUNK + Limits.MAX_HEADER + FrameCodec.OVERHEAD)
        assertEquals((s["largestFrame"] as Double).toInt(), RelayProbe.PROBE_BYTES)
        assertEquals(12_713_984L, RelayClient.MAX_ATTACHMENT)
        for (c in (s["cases"] as List<Any?>).map { it as Map<String, Any?> }) {
            val size = (c["size"] as Double).toLong()
            val item = OutgoingItem(Kind.FILE, name = "x.pdf", mime = "application/pdf")
            if (c["error"] != null) {
                try {
                    ItemBuilder.prepare(item, zeros(size, readable = false))
                    fail("$size: expected ${c["error"]}")
                } catch (e: ShareException) {
                    assertEquals("$size", c["error"], e.code)
                    assertEquals(Text.tooBigMessage(size), e.message)
                }
                continue
            }
            val p = ItemBuilder.prepare(item, zeros(size), compress = false)
            assertEquals("$size", (c["parts"] as Double).toInt(), p.parts)
            for (i in 0 until p.parts) assertTrue("$size part $i", p.frameLength(i) <= (s["largestFrame"] as Double).toLong())
        }
        // The limit is on the size before compression: 9,000,001 bytes of text are refused though they compress.
        try {
            ItemBuilder.prepare(OutgoingItem(Kind.FILE, name = "a.txt", mime = "text/plain"), zeros(Limits.MAX_ITEM + 1, readable = false))
            fail("text over 9 MB accepted")
        } catch (e: ShareException) {
            assertEquals("too-large", e.code)
            assertTrue(e.message!!.contains("9.1 MB"))
        }
        // A page over 8 MiB keeps its own message (send the link).
        try {
            ItemBuilder.prepare(OutgoingItem(Kind.PAGE, url = "https://example.com/"), zeros(Limits.MAX_PAGE_HTML + 1, readable = false))
            fail("page over 8 MiB accepted")
        } catch (e: ShareException) {
            assertEquals("too-large", e.code)
            assertTrue(e.message!!.contains("link"))
        }
    }

    @Test
    fun invalidItems() {
        val keys = Keys.derive(s1)
        for (item in list("invalidItems")) {
            val name = item["name"] as String
            for (spool in listOf<File?>(null, kotlin.io.path.createTempDirectory("dls-spool").toFile())) {
                val r = Reassembler(spool)
                val frames = (item["framesHex"] as List<Any?>).map { hex(it) }
                try {
                    for (f in frames) {
                        val opened = FrameCodec.open(keys, Purpose.INBOX, f)
                        r.add(opened.header, opened.body)
                    }
                    fail("$name: accepted")
                } catch (e: ShareException) {
                    assertEquals(name, item["error"], e.code)
                }
                for (f in frames) assertFalse(name, r.isPending(ItemHeader.check(FrameCodec.open(keys, Purpose.INBOX, f).header).id))
                spool?.let { assertTrue(name, File(it, "parts").listFiles().isNullOrEmpty()); it.deleteRecursively() }
            }
            // Decoding never writes more than `size` bytes (the bomb inflates to 1 MiB).
            val opened = frames(item).map { FrameCodec.open(keys, Purpose.INBOX, it) }
            val h = ItemHeader.check(opened[0].header)
            var written = 0L
            val counter = object : java.io.OutputStream() {
                override fun write(b: Int) { written++ }
                override fun write(b: ByteArray, off: Int, len: Int) { written += len }
            }
            try {
                Reassembler.decodeVerify(h, opened.sortedBy { ItemHeader.check(it.header).part }.map { it.body.inputStream() }, counter)
                fail("$name: decoded")
            } catch (e: ShareException) {
                assertEquals("integrity", e.code)
            }
            assertTrue("$name wrote $written", written <= h.size!!)
        }
    }

    private fun frames(item: Map<String, Any?>) = (item["framesHex"] as List<Any?>).map { hex(it) }

    @Test
    fun acks() {
        val keys = Keys.derive(s1)
        for (a in list("acks")) {
            val name = a["name"] as String
            val ids = (a["idLabels"] as List<Any?>).map { Bytes.toHex(Bytes.sha256(Bytes.utf8(it as String))).substring(0, 32) }
            val from = a["from"] as String
            val sent = a["sent"] as String
            val headerJson = a["headerJson"] as String
            // The serialisation (no escaping of non-ASCII) is the JS one, id for id.
            val m = linkedMapOf<String, Any?>("v" to 1, "kind" to "ack", "ids" to ids, "sent" to sent, "from" to Text.cleanName(from))
            assertEquals(name, headerJson, Json.write(m))
            val frame = FrameCodec.seal(keys, Purpose.ACK, Bytes.utf8(headerJson))
            assertEquals(name, (a["frameLength"] as Double).toInt(), frame.size)
            assertEquals(name, a["small"], FrameCodec.isSmall(frame.size.toLong()))
            // AckHeader cuts at MAX_ACK_IDS, so every ack frame it builds is a small frame.
            val built = AckHeader(ids, sent, Text.cleanName(from)).toJson()
            assertEquals(name, ids.take(Limits.MAX_ACK_IDS), built["ids"])
            if (ids.size <= Limits.MAX_ACK_IDS) assertEquals(name, headerJson, Json.write(built))
            assertTrue(name, FrameCodec.isSmall(AckHeader.frame(keys, ids, from).size.toLong()))
        }
        assertEquals(70, Limits.MAX_ACK_IDS)
    }

    @Test
    fun statusText() {
        for (c in list("statusText")) {
            val name = c["name"] as String
            val row = c["row"] as Map<String, Any?>
            val t = RowText.of(
                row["status"] as String, row["errorCode"] as String? ?: "", (row["size"] as Double).toLong(),
                (row["created"] as Double).toLong(), (c["now"] as Double).toLong(),
            )
            assertEquals(name, c["label"], t.label)
            assertEquals(name, c["sentence"], t.sentence)
            assertEquals(name, c["action"], t.action)
        }
        for (f in list("formatMB")) assertEquals(f["expect"], Text.formatMB((f["bytes"] as Double).toLong()))
        assertEquals("Too big to send. Files can be up to 9 MB; this one is 14.2 MB.", Text.tooBigMessage(14_200_000))
    }

    @Test
    fun pairingConfirmation() {
        fun pairing(m: Any?): Pairing? = (m as Map<String, Any?>?)?.let { Pairing(hex(it["secretHex"]), it["relay"] as String, it["name"] as String) }
        for (c in list("pairingConfirmation")) {
            val name = c["name"] as String
            val source = if (c["source"] == "app") PairingConfirmation.Source.APP else PairingConfirmation.Source.LINK
            val got = PairingConfirmation.of(pairing(c["current"]), pairing(c["next"])!!, source)
            val e = c["expect"] as Map<String, Any?>
            assertEquals(name, e["ask"], got.ask)
            assertEquals(name, e["title"], got.title)
            assertEquals(name, e["lines"], got.lines)
            assertEquals(name, e["button"], got.button)
            assertEquals(name, e["notice"], got.notice)
        }
    }

    @Test
    fun helpers() {
        assertEquals("https://example.com/a?b=c", Text.findUrl("Look at this https://example.com/a?b=c). More"))
        assertEquals("https://x.org/p", Text.findUrl("Title\nhttps://x.org/p"))
        assertNull(Text.findUrl("no link here"))
        assertNull(Text.webUrl("javascript:alert(1)"))
        assertNull(Text.webUrl("https:///nohost"))
        assertEquals("a b", Text.cleanTitle("a\u2007\u202F b"))
        assertEquals("https://ntfy.sh", Relay.normalize(""))
        assertEquals("https://ntfy.sh", Relay.normalize("ntfy.sh/"))
        assertEquals("http://127.0.0.1:8787", Relay.normalize("http://127.0.0.1:8787/"))
        assertEquals("https://relay.example.org/ntfy", Relay.normalize("HTTPS://Relay.Example.org:443/ntfy/?x=1#y"))
        assertEquals("relay.example.org:8443", Relay.host("https://Relay.Example.org:8443/ntfy/"))
        assertEquals("http://[::1]:8080", Relay.origin("http://[::1]:8080/ntfy"))
        val client = RelayClient("http://127.0.0.1:8787/ntfy")
        assertTrue(client.allowed("http://127.0.0.1:8787/file/x.bin"))
        assertTrue(client.allowed("https://elsewhere.example/file/x.bin"))
        assertFalse(client.allowed("http://127.0.0.1:8788/file/x.bin"))
        assertFalse(client.allowed("http://localhost:8787/file/x.bin"))
        assertFalse(client.allowed("ftp://127.0.0.1:8787/file/x.bin"))
        assertFalse(client.allowed("not a url"))
        assertEquals("0", RelayClient.nextCursor("all", 1000, null))
        assertEquals("200", RelayClient.nextCursor("all", 2000, null))
        assertEquals("500", RelayClient.nextCursor("500", 2000, null)) // never backwards when nothing is held
        assertEquals("100", RelayClient.nextCursor("500", 2000, 1900)) // held: may go back
        assertEquals("1300", RelayClient.nextCursor("500", 3100, null))
        assertTrue(Pairing(ByteArray(16)).sameSecret(Pairing(ByteArray(16), "https://relay.example.org", "x")))
        assertFalse(Pairing(ByteArray(16)).sameSecret(Pairing(ByteArray(15) + byteArrayOf(1))))
        assertEquals("Waiting to send. Couldn’t send right now. It will try again by itself.", RowText.of(Status.FAILED, "network", 0, 0, 0).line)
        assertEquals("Sending…", RowText.of(Status.SENDING, "", 0, 0, 0).line)
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
