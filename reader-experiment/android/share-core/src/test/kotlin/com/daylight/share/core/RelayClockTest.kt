package com.daylight.share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [RelayClient.relayClock] (K6 review, LAB-PLAN 5.3.4): the relay's own clock, from a publish's `time` or an answer's
 * Date header, paired with this device's clock, so a DC-1 whose clock runs fast can turn its times into relay times.
 */
class RelayClockTest {
    private class Scripted(private val answer: (String) -> Http.Response) : Http {
        override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response = answer(method)
        override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = throw java.io.IOException("no stream")
    }

    @Test
    fun aPublishsTimeAndAnAnswersDateGiveTheRelaysClock() {
        // This device runs 2 hours fast.
        val relayNow = 1_792_659_600_000L // 2026-10-22T09:00:00Z
        var device = relayNow + 2 * 3_600_000L
        val http = Scripted { method ->
            if (method == "POST") Http.Response(200, emptyMap(), Bytes.utf8("""{"id":"m1","time":${relayNow / 1000}}"""))
            else Http.Response(200, mapOf("date" to "Thu, 22 Oct 2026 09:05:00 GMT"), ByteArray(0))
        }
        val c = RelayClient("https://relay.example.org", http, retryDelaysMs = listOf(0L), clock = { device }, sleeper = {})
        assertNull(c.relayClock)

        c.publish("dls-topic", ByteArray(40))
        assertEquals(RelayClient.RelayClock(relayNow, device), c.relayClock)
        assertEquals(-2 * 3_600_000L, c.relayClock!!.offsetMs)

        device += 5 * 60_000L
        c.poll("dls-topic", "all")
        assertEquals(relayNow + 5 * 60_000L, c.relayClock!!.relayMs)
        assertEquals(-2 * 3_600_000L, c.relayClock!!.offsetMs)

        assertEquals(784_111_777_000L, httpDateMs("Sun, 06 Nov 1994 08:49:37 GMT"))
        assertNull(httpDateMs("yesterday"))
    }
}
