package com.daylight.share.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import kotlin.io.path.createTempDirectory

/**
 * A short round trip through a real relay (CI sets DLS_LIVE_RELAY=https://ntfy.sh): a url item as a message and a
 * small file as an attachment, polled back, acked, and the ack read by the sender. Uses a random throwaway pairing.
 */
class LiveRelayTest {
    @Test
    fun roundTripThroughARealRelay() {
        val relayUrl = System.getProperty("dls.liveRelay")
        Assume.assumeTrue("set DLS_LIVE_RELAY to run", !relayUrl.isNullOrBlank())
        val pairing = Pairing(Bytes.random(16), relayUrl!!, "CI Daylight")
        println("live relay ${pairing.relay}, inbox topic ${pairing.keys.inboxTopic}")
        val out = Outbox(pairing, FileOutboxStore(createTempDirectory("dls-live-out").toFile()), from = "CI runner", app = "jvm/ci")
        val link = out.add(OutgoingItem(Kind.URL, url = "https://example.com/daylight-share-ci", title = "CI round trip"), null)
        val bytes = Bytes.random(8_000)
        val file = out.add(OutgoingItem(Kind.FILE, name = "ci.pdf", mime = "application/pdf", title = "CI attachment"), BytesBody(bytes))
        val t0 = System.currentTimeMillis()
        val l = out.publish(link.id)!!
        val f = out.publish(file.id)!!
        println("published: link ${l.status} ${l.error}, file ${f.status} ${f.error} (attachment=${f.attachment}) in ${System.currentTimeMillis() - t0} ms")
        assertEquals(Status.SENT, l.status)
        assertEquals(Status.SENT, f.status)

        val dir = createTempDirectory("dls-live-in").toFile()
        val got = HashMap<String, ByteArray>()
        val receiver = Receiver(pairing, FileReceiverStore(File(dir, "state.json")), Reassembler(File(dir, "spool")), from = "CI Daylight") { done ->
            got[done.header.id] = done.content.open().use { it.readBytes() }
        }
        var tries = 0
        while (got.size < 2 && tries++ < 10) {
            val r = receiver.pollOnce()
            println("poll $tries: items ${r.items.map { it.kind }}, acked ${r.ackIds.size}")
            if (got.size < 2) Thread.sleep(2000)
        }
        assertEquals(setOf(link.id, file.id), got.keys)
        assertArrayEquals(bytes, got[file.id])

        tries = 0
        var delivered = 0
        while (delivered < 2 && tries++ < 10) {
            delivered += out.checkAcks()
            if (delivered < 2) Thread.sleep(2000)
        }
        assertEquals(2, delivered)
        println("live round trip OK in ${System.currentTimeMillis() - t0} ms: delivered by ${out.row(link.id)!!.deliveredBy}")
    }

    /** The relay tells its clock when asked (`readClock`, the handover's resume): `/v1/health`'s Date, near the runner's. */
    @Test
    fun theRelayTellsItsClock() {
        val relayUrl = System.getProperty("dls.liveRelay")
        Assume.assumeTrue("set DLS_LIVE_RELAY to run", !relayUrl.isNullOrBlank())
        val c = RelayClient(relayUrl!!).readClock()
        println("live relay clock: $c")
        assertNotNull("the relay's /v1/health answer had no Date", c)
        assertTrue("the relay's clock is ${c!!.offsetMs} ms from the runner's", Math.abs(c.offsetMs) < 10 * 60_000L)
    }
}
