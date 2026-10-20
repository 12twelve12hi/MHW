package com.daylight.share.core

import java.io.IOException

/**
 * The Inbox's relay check (PROTOCOL 3.4 "Relay check"; CHANGES-v1.1 finding 21): before a relay other than ntfy.sh is
 * saved, it must take the largest frame a sender makes and give it back to this device.
 *
 * 1. `PUT {relay}/dls-probe-<16 random hex>` with 1,966,116 random bytes and `Filename: probe.bin`: the answer must be
 *    200 with an `attachment.url`.
 * 2. `attachment.url` passes the download rule (https, or the relay's own origin), and downloading it returns the same
 *    bytes.
 */
object RelayProbe {
    /** The largest frame a sender makes: CHUNK + MAX_HEADER + 36. */
    const val PROBE_BYTES = Limits.CHUNK + Limits.MAX_HEADER + FrameCodec.OVERHEAD

    const val UNREACHABLE = "Couldn’t reach that relay. Check the address and your connection."
    const val TOO_SMALL = "This relay only takes small files. Its attachment limit must be at least 2 MB."
    const val NO_FILES = "This relay doesn’t accept files. Use ntfy.sh, or turn on attachments on the server."
    const val NEEDS_LOGIN = "This relay needs a login. Send to Daylight can’t use relays that need a login yet."
    const val NO_DOWNLOAD = "Your Daylight can’t download files from this relay. Check the server’s base-url."
    fun errorStatus(status: Int) = "That relay answered with an error (HTTP $status). Try again later."

    /** [ShareException.reason] of a check that could not reach the relay: a background check tries again later. */
    const val REASON_NETWORK = "network"

    /**
     * Checks [relay] (normalised first). Returns null when it passes, else a [ShareException] with code "relay", one of
     * the sentences above as its message, and [ShareException.reason] "network" (unreachable), "status" or "download".
     * Never throws for relay answers (an invalid address throws [ShareException] "relay" from [Relay.normalize]).
     */
    fun check(relay: String, http: Http = UrlConnectionHttp(), bytes: ByteArray = Bytes.random(PROBE_BYTES)): ShareException? {
        val r = Relay.normalize(relay)
        val topic = "dls-probe-" + Bytes.toHex(Bytes.random(8))
        val headers = linkedMapOf(
            "Content-Type" to "application/octet-stream", "Filename" to "probe.bin", "Firebase" to "no", "Cache" to "yes",
        )
        val res = try {
            http.send("PUT", "$r/$topic", headers, bytes, readTimeoutMs = 120_000)
        } catch (e: IOException) {
            return ShareException("relay", UNREACHABLE, REASON_NETWORK, e)
        }
        when {
            res.status == 413 -> return ShareException("relay", TOO_SMALL, "status", status = 413)
            res.status == 400 -> return ShareException("relay", NO_FILES, "status", status = 400)
            res.status == 401 || res.status == 403 -> return ShareException("relay", NEEDS_LOGIN, "status", status = res.status)
            res.status != 200 -> return ShareException("relay", errorStatus(res.status), "status", status = res.status)
        }
        val answer = Bytes.fromUtf8Strict(res.body)?.let { Json.parseObjectOrNull(it.trim()) }
        val url = (answer?.get("attachment") as? Map<*, *>)?.get("url") as? String
            // 200 without an attachment: the relay kept the bytes as a message, or dropped them.
            ?: return ShareException("relay", NO_FILES, "status", status = 200)
        val client = RelayClient(r, http)
        if (!client.allowed(url)) return ShareException("relay", NO_DOWNLOAD, "download")
        val got = client.download(url)
        if (got.outcome != Outcome.FRAME || !got.frame.contentEquals(bytes)) {
            return ShareException("relay", NO_DOWNLOAD, if (got.outcome == Outcome.RETRY && got.status == 0) REASON_NETWORK else "download")
        }
        return null
    }
}
