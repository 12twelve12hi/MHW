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

    /**
     * [RelayClient.readClock]: the relay's clock now, from `/v1/health`'s Date (any status), whatever this device's
     * clock did since the last answer (an NTP correction): the handover's resume reads it (K6 review).
     */
    @Test
    fun readClockAsksTheRelayNow() {
        val relayNow = 1_792_659_600_000L // 2026-10-22T09:00:00Z
        var device = relayNow + 2 * 3_600_000L
        val urls = ArrayList<String>()
        var status = 200
        var date: String? = "Thu, 22 Oct 2026 09:00:00 GMT"
        val http = object : Http {
            override fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?, maxResponseBytes: Long, readTimeoutMs: Int): Http.Response {
                urls += "$method $url"
                if (status == 0) throw java.io.IOException("offline")
                return Http.Response(status, date?.let { mapOf("Date" to it) } ?: emptyMap(), Bytes.utf8("""{"healthy":true}"""))
            }
            override fun stream(url: String, headers: Map<String, String>, readTimeoutMs: Int): Http.LineStream = throw java.io.IOException("no stream")
        }
        val c = RelayClient("https://relay.example.org/", http, clock = { device })
        assertEquals(-2 * 3_600_000L, c.readClock()!!.offsetMs)
        assertEquals(listOf("GET https://relay.example.org/v1/health"), urls)

        // The device's clock is corrected (it ran 2 hours fast): the relay's answer now says so.
        device = relayNow + 60_000L
        date = "Thu, 22 Oct 2026 09:01:00 GMT"
        status = 404
        assertEquals(0L, c.readClock()!!.offsetMs)
        assertEquals(0L, c.relayClock!!.offsetMs)

        // No answer, or one without a Date: null, and the last clock stays.
        status = 0
        assertNull(c.readClock())
        status = 200
        date = null
        assertNull(c.readClock())
        assertEquals(RelayClient.RelayClock(relayNow + 60_000L, relayNow + 60_000L), c.relayClock)
    }
}
