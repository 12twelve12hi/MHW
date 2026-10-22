package com.daylight.share.core.server

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/**
 * The Daylight server's user-facing messages and state mapping (server DESIGN 14, LAB-PLAN 2.6), ported from
 * `server/client/daylight-server.js` under the same names and pinned by `server/vectors/server-vectors.json` ›
 * serverState. The apps show the server's `message` for an error code (14.2) and for the state `error`; every other
 * state shows this module's text for it ([STATE_MESSAGES]), whatever the server sent with it.
 */
object ServerMessages {
    const val RERUN_HELP = "In GitHub › Actions, open the latest ‘Reader experiment - Daylight server’ run and choose Re-run all jobs."

    val STATE_MESSAGES: Map<String, String> = linkedMapOf(
        "needs-server" to "Needs the Daylight server. Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub › Settings › Secrets, then paste the setup link the deploy makes in Lab settings › Daylight server.",
        "pairing-mismatch" to "The Daylight server still has your previous pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE.",
        "server-outdated" to "Update the Daylight server to use this: open the latest “Reader experiment - Daylight server” run in GitHub › Actions and choose Re-run all jobs.",
        "app-outdated" to "Update this app to use the Daylight server.",
        "locked" to "The Daylight server was locked when this device was re-paired. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE.",
        "needs-key" to "Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets), then re-run the deploy, to turn this on.",
        "needs-domain" to "Needs an email domain. Add DAYLIGHT_EMAIL_DOMAIN (a domain on your Cloudflare account) in GitHub › Settings › Secrets, then re-run the deploy.",
        "needs-r2" to "Needs R2 storage on your Cloudflare account. Turn on R2 in the Cloudflare dashboard (it asks for a card; the free tier isn’t charged), then re-run the deploy.",
        "needs-lab-inbox" to "Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.",
        "needs-paid" to "Email-in needs Cloudflare’s Workers Paid plan. Subscribe in the Cloudflare dashboard, set the variable DAYLIGHT_WORKERS_PLAN to paid in GitHub › Settings, then re-run the deploy.",
        "OFFLINE" to "Couldn’t reach the Daylight server. Check your connection and try again.",
    )

    /** Every code the server can answer with; each has a message. */
    val ERROR_CODES = listOf(
        "BAD_REQUEST", "BAD_AUTH", "NOT_FOUND", "NEED_SOURCE", "NEEDS_KEY", "NOT_CONFIGURED", "NEEDS_LAB_INBOX", "FEED_EXISTS",
        "GONE", "LENGTH_REQUIRED", "TOO_LARGE", "AI_TOO_LARGE", "UNSUPPORTED_TYPE", "FEED_INVALID", "URL_BLOCKED", "AI_REFUSED",
        "AI_BAD_INPUT", "LOCKED", "RATE_LIMITED", "AI_DAILY_LIMIT", "AI_QUEUE_FULL", "FEED_LIMIT", "FETCH_FAILED",
        "AI_INCOMPLETE", "AI_BUSY", "AI_KEY_INVALID", "AI_BILLING", "AI_TIMEOUT", "STORAGE_FULL", "SERVER_LIMIT", "BAD_EMAIL",
        "FEED_FLOOD", "SERVER_ERROR", "SETUP_USED",
    )

    /** Every state [DaylightServer.state] and [DaylightServer.noteError] return: a closed set. */
    val SERVER_STATES = listOf(
        "ready", "needs-server", "pairing-mismatch", "server-outdated", "app-outdated", "needs-key", "needs-domain", "needs-r2",
        "needs-lab-inbox", "needs-paid", "locked", "error", "OFFLINE",
    )

    /** The states the app decides itself (DESIGN 4.3, 14.1). No answer from the server can give one of them. */
    val LOCAL_STATES = listOf("needs-server", "pairing-mismatch", "server-outdated", "app-outdated", "OFFLINE")

    /** The states GET /v1/status may give a feature besides `ready` and `error` (10.5, 14.1). Any other is `error`. */
    val STATUS_STATES = listOf("needs-key", "needs-domain", "needs-r2", "needs-lab-inbox", "needs-paid", "locked")

    private val SERVER_CODE = Regex("^[A-Z][A-Z0-9_]{0,39}$")

    /** JavaScript's `Number(x)` for the JSON values an error carries. */
    private fun num(v: Any?): Double = when (v) {
        null -> 0.0
        is Number -> v.toDouble()
        is Boolean -> if (v) 1.0 else 0.0
        is String -> v.trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
        else -> Double.NaN
    }

    private fun fmtNumber(d: Double): String = if (d == Math.floor(d) && !d.isInfinite() && Math.abs(d) < 1e21) d.toLong().toString() else d.toString()

    private fun fmtMB(n: Any?): String = "${fmtNumber(Math.round(num(n) / 1_000_000 * 10) / 10.0)} MB"

    /** `US$` + `Number(n).toFixed(2)` without ".00" (toFixed rounds the exact binary value, halves up). */
    private fun fmtUsd(n: Any?): String {
        val d = num(n)
        if (d.isNaN()) return "US\$NaN"
        val s = BigDecimal(d).setScale(2, RoundingMode.HALF_UP).toPlainString()
        return "US$" + s.removeSuffix(".00")
    }

    private fun fmtTime(iso: Any?): String {
        val t = runCatching { Instant.parse(iso as String) }.getOrNull() ?: return "midnight UTC"
        val z = t.atZone(ZoneOffset.UTC)
        return "%02d:%02d UTC".format(z.hour, z.minute)
    }

    /** `Number(x).toLocaleString('en-US')`. */
    private fun localeNumber(v: Any?): String {
        val d = num(v)
        if (d.isNaN()) return "NaN"
        val f = NumberFormat.getNumberInstance(Locale.US)
        f.maximumFractionDigits = 3
        return f.format(d)
    }

    private fun has(x: Map<String, Any?>, k: String) = x[k] != null

    /** The message for an error code (14.2); unknown codes get the generic sentence. [extra]: the error's fields. */
    fun errorMessage(code: String, extra: Map<String, Any?> = emptyMap()): String = when (code) {
        "AI_KEY_INVALID" -> "Claude didn’t accept the API key. Check ANTHROPIC_API_KEY in GitHub › Settings › Secrets, then re-run the deploy."
        "AI_BILLING" -> "Your Anthropic account is out of credit. Add credit in the Claude Console to keep using AI."
        "AI_DAILY_LIMIT" -> {
            val lr = extra["limitRequests"]
            if (lr != null && num(lr) >= 0) {
                val n = num(lr)
                "You’ve used today’s ${fmtNumber(n)} AI request${if (n == 1.0) "" else "s"} (the server’s daily limit). It resets at ${fmtTime(extra["resetAt"])}. To change the limit, set the repo variable DAYLIGHT_AI_MAX_REQ_DAY in GitHub › Settings › Secrets and variables › Actions › Variables, then re-run the deploy."
            } else if (num(extra["needUsd"]) > 0) {
                "This request could cost up to ${fmtUsd(extra["needUsd"])} with Claude, more than today’s AI limit. Raise the limit in Lab settings (up to ${fmtUsd(extra["ceilingUsd"] ?: 10)})."
            } else {
                "Today’s AI limit is used up. It resets at ${fmtTime(extra["resetAt"])}, or raise it in Lab settings (up to ${fmtUsd(extra["ceilingUsd"] ?: 10)})."
            }
        }
        "AI_TOO_LARGE" -> "This is too long for one AI request (about ${localeNumber(extra["tokens"] ?: 0)} tokens; the limit is ${localeNumber(extra["limit"] ?: 200000)})."
        "AI_QUEUE_FULL" -> "Too many AI requests are waiting. Try again in a few minutes."
        "AI_REFUSED" -> "Claude declined to work on this one."
        "AI_BUSY" -> "Claude is busy right now. Try again in a minute."
        "AI_TIMEOUT" -> "Claude took too long to answer. Try again."
        "AI_INCOMPLETE" -> "Claude’s answer was cut off. Try a shorter length."
        "AI_BAD_INPUT" -> "Claude couldn’t read this document."
        "URL_BLOCKED" -> "The Daylight server can’t open that address."
        "FETCH_FAILED" -> "The Daylight server couldn’t load that page."
        "FEED_INVALID" -> "That address isn’t a feed, and the page doesn’t link to one."
        "FEED_EXISTS" -> "You already follow that feed."
        "FEED_LIMIT" -> "You follow the most feeds the server allows (${extra["limit"]?.let { if (it is Double) fmtNumber(it) else it.toString() } ?: "100"}). Remove one to add another."
        "FEED_FLOOD" -> "This feed was paused because it published too many new items at once."
        "TOO_LARGE" -> "That’s larger than the Daylight server takes (${fmtMB(extra["limit"] ?: 0)})."
        "STORAGE_FULL" -> "The Daylight server’s storage is full. Try again once your Daylight has picked up waiting files."
        "GONE" -> "That file has expired on the Daylight server. Send it again."
        "RATE_LIMITED" -> "Too many requests. Try again in a minute."
        "BAD_AUTH" -> "The Daylight server doesn’t recognise this device’s pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or check DAYLIGHT_SERVER_CODE."
        "SETUP_USED" -> "That setup link was already used for another pairing. Run the deploy with “New setup link” for a fresh one."
        "SETUP_INVALID" -> "That setup link isn’t current. Copy it again: the deploy’s summary in GitHub › Actions says where to find it."
        "SERVER_LIMIT" -> "This was too big for the Daylight server on Cloudflare’s Free plan. It works on the Workers Paid plan."
        "NEEDS_KEY" -> STATE_MESSAGES.getValue("needs-key")
        "NOT_CONFIGURED" -> STATE_MESSAGES.getValue(notConfiguredState(extra["missing"]))
        "NEEDS_LAB_INBOX" -> STATE_MESSAGES.getValue("needs-lab-inbox")
        "LOCKED" -> STATE_MESSAGES.getValue("locked")
        "OFFLINE" -> STATE_MESSAGES.getValue("OFFLINE")
        else -> "Something went wrong on the Daylight server ($code). Try again later."
    }

    /** Text for the states the app decides itself (14.1): needs-server, pairing-mismatch, server-outdated, app-outdated, OFFLINE. */
    fun localMessage(state: String): String = STATE_MESSAGES[state] ?: errorMessage(state)

    /**
     * NOT_CONFIGURED's `missing` -> the state, read in this order (LAB-PLAN 2.6): DAYLIGHT_SERVER_CODE, then
     * DAYLIGHT_EMAIL_DOMAIN, then R2; anything else, a `missing` that is not a list included, is needs-server.
     */
    fun notConfiguredState(missing: Any?): String {
        val m = missing as? List<*> ?: emptyList<Any?>()
        return when {
            "DAYLIGHT_SERVER_CODE" in m -> "needs-server"
            "DAYLIGHT_EMAIL_DOMAIN" in m -> "needs-domain"
            "R2" in m -> "needs-r2"
            else -> "needs-server"
        }
    }

    /**
     * Whether an error JSON's `code` is read (10.4): 1 to 40 characters of A-Z, 0-9 and _, starting with a letter, and
     * not a state the app decides itself (OFFLINE), so a server's answer can never pose as one.
     */
    fun isServerCode(code: Any?): Boolean = code is String && SERVER_CODE.matches(code) && code !in LOCAL_STATES

    /**
     * A feature's entry in GET /v1/status -> {state, message} (14.1; pinned by serverState › fromStatus). `ready` has no
     * message. The [STATUS_STATES] show this module's text for the state, whatever the server sent. `error` shows the
     * server's `message` when it is a non-empty string, else SERVER_ERROR's sentence; any other state is `error` the same
     * way, so the set stays closed. A status without the feature, or an entry without a state: error, NOT_FOUND's text.
     */
    fun stateFromStatus(status: Any?, feature: String): ServerState {
        val fs = (status as? Map<*, *>)?.get("features") as? Map<*, *>
        val f = fs?.get(feature) as? Map<*, *>
        val state = f?.get("state") as? String
        if (state.isNullOrEmpty()) return ServerState("error", errorMessage("NOT_FOUND"))
        if (state == "ready") return ServerState("ready", null)
        if (state in STATUS_STATES) return ServerState(state, STATE_MESSAGES[state])
        val message = (f["message"] as? String)?.takeIf { it.isNotEmpty() } ?: errorMessage("SERVER_ERROR")
        return ServerState("error", message)
    }

    /**
     * An error from the server, the network or discovery -> {state, message} (LAB-PLAN 2.6; pinned by serverState ›
     * fromError). The app's own states and every state an error code maps to show this module's text; `error` shows the
     * server's message (BAD_AUTH: always this module's). An error without a code is OFFLINE.
     */
    fun stateFromError(err: Throwable?): ServerState {
        val e = err as? ServerError
        val code = e?.code?.takeIf { it.isNotEmpty() } ?: "OFFLINE"
        if (code in LOCAL_STATES) return ServerState(code, localMessage(code))
        val mapped = when (code) {
            "LOCKED" -> "locked"
            "NEEDS_KEY" -> "needs-key"
            "NEEDS_LAB_INBOX" -> "needs-lab-inbox"
            "NOT_CONFIGURED" -> notConfiguredState(e?.missing)
            else -> null
        }
        if (mapped != null) return ServerState(mapped, STATE_MESSAGES[mapped])
        if (code == "BAD_AUTH") return ServerState("error", errorMessage("BAD_AUTH"))
        return ServerState("error", e?.message?.takeIf { it.isNotEmpty() } ?: errorMessage(code, e?.extra ?: emptyMap()))
    }

    /** The notice shown once per feature (14.3), with Continue and Cancel; [delivery] is the server's mode ("lab" or "v1"). */
    fun noticeText(feature: String, delivery: String = "lab"): String? {
        val v1 = delivery == "v1"
        return when (feature) {
            "ai", "pdf" -> "Not end-to-end encrypted: to use AI, the text or file goes to your Daylight server and to Claude (Anthropic) in readable form." +
                if (v1) "" else " Links, pages and files you send to your Daylight stay end-to-end encrypted."
            "email" -> "Not end-to-end encrypted: email reaches your Daylight server in readable form, like any email. The server encrypts it before it goes on to your Daylight."
            "feeds" -> "Your feed list is kept on your Daylight server in readable form, so it can check feeds while your devices sleep."
            "files" -> if (v1) {
                "Large files wait on your Daylight server for up to 14 days, encrypted with your pairing key, which your Daylight server also holds."
            } else {
                "Large files wait on your Daylight server for up to 14 days, encrypted with your pairing key; the server can’t open them."
            }
            "v1" -> "Your Daylight server holds your pairing code, so whoever controls your Cloudflare or GitHub account can read everything sent to this Daylight."
            else -> null
        }
    }
}

/** A server feature's state and the one sentence to show for it (null for ready). */
data class ServerState(val state: String, val message: String?) {
    val ready: Boolean get() = state == "ready"
}

/** Anything that answers a server feature's state: a [DaylightServer], or a stub in tests. The Lab gate races it. */
fun interface ServerStateSource {
    fun state(feature: String): ServerState
}

/**
 * An error from the server, the network or discovery (the JS `ServerError`). [code]: the server's error code, OFFLINE,
 * or a state the app decides itself; [status]: the HTTP status (0 without an answer); [extra]: the fields the server
 * sent with it that the apps use (feature, missing, retryAfter, limit, resetAt, missingParts, tokens, estimateUsd,
 * needUsd, limitRequests, reason). The message is the server's when it sent a string, else [ServerMessages.errorMessage].
 */
class ServerError(val code: String, message: String? = null, val status: Int = 0, extra: Map<String, Any?> = emptyMap()) :
    Exception(message?.takeIf { it.isNotEmpty() } ?: ServerMessages.errorMessage(code, extra)) {
    val extra: Map<String, Any?> = extra.filterKeys { it in KEPT && extra[it] != null }

    val feature: Any? get() = extra["feature"]
    val missing: Any? get() = extra["missing"]
    val retryAfter: Any? get() = extra["retryAfter"]
    val limit: Any? get() = extra["limit"]
    val resetAt: Any? get() = extra["resetAt"]
    val reason: Any? get() = extra["reason"]

    override val message: String get() = super.message ?: ServerMessages.errorMessage(code)

    companion object {
        val KEPT = setOf("feature", "missing", "retryAfter", "limit", "resetAt", "missingParts", "tokens", "estimateUsd", "needUsd", "limitRequests", "reason")
    }
}
