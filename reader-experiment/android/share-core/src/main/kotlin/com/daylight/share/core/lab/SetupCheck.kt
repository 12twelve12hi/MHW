package com.daylight.share.core.lab

import com.daylight.share.core.Bytes
import com.daylight.share.core.BytesBody
import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.Limits
import com.daylight.share.core.OutgoingItem
import com.daylight.share.core.Relay
import com.daylight.share.core.ShareException
import com.daylight.share.core.Text
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/**
 * Setup check (LAB-PLAN F26; LAB-PROTOCOL 2.9.4): the test article, the activity log and "Copy diagnostics", as the JS
 * `testArticle`, `activityEvent`, `appendActivity`, `activityLine`, `redactDiagnostics` and `diagnosticsReport` make
 * them, pinned by lab-vectors.json › testArticle and diagnostics. Titles, names, URLs and `from` never enter the log,
 * and whatever is copied goes through [redactDiagnostics].
 */
object SetupCheck {
    const val TEST_URL_PREFIX = "https://daylight.invalid/test/"
    const val ACTIVITY_MAX = 200
    const val DIAGNOSTICS_EVENTS = 50

    /** The test article, ready to send as a page with `x-cap: "test"`. */
    data class TestArticle(val id: String, val kind: String, val url: String, val title: String, val content: String, val extras: Map<String, String>) {
        /** The outgoing item (with this [id]) and its bytes, for `Outbox.send(item, body)`. */
        fun toOutgoing(from: String? = null): Pair<OutgoingItem, BytesBody> =
            OutgoingItem(kind, id = id, url = url, title = title, from = from, extras = extras) to BytesBody(Bytes.utf8(content))
    }

    /**
     * The test article (F26): a page of about 400 words (LAB_TEXT.testArticle), so the Reader neither fetches it again
     * nor keeps only a link: `url` = https://daylight.invalid/test/<id>, `title` = "Test article from {device}" (the
     * device through `Text.cleanName`, default "Send to Daylight"). Throws [ShareException] "id" for a bad [id].
     */
    fun testArticle(id: String = ItemHeader.newId(), device: String? = ""): TestArticle {
        if (!ItemHeader.isId(id)) throw ShareException("id", "bad item id")
        val title = Text.cleanTitle(LabText.fill(LabText["testArticle.title"], mapOf("device" to Text.cleanName(device).ifEmpty { LabText["appName.web"] })))
        val paras = (1..6).joinToString("") { "<p>${JsText.escapeText(LabText["testArticle.p$it"])}</p>" }
        val content = "<!doctype html><html><head><meta charset=\"utf-8\"><title>${JsText.escapeText(title)}</title>" +
            "<meta name=\"dl:capture\" content=\"test\"></head><body><article><h1>${JsText.escapeText(LabText["testArticle.heading"])}</h1>$paras</article></body></html>"
        return TestArticle(id, Kind.PAGE, TEST_URL_PREFIX + id, title, content, mapOf(ItemHeader.X_CAP to "test"))
    }

    private val WS = JsText.WS
    internal val REDACTIONS = listOf(
        Regex("${JsText.ci("daylightserver")}://[^$WS\"'<>]*") to "[server code]",
        Regex("${JsText.WORD_START}SERVER-[A-Za-z0-9-]+") to "[server code]",
        Regex("(?<![A-Za-z0-9+.-])[A-Za-z0-9+.-]*://[^$WS\"'<>]*") to "[url]",
        Regex("${JsText.WORD_START}${JsText.ci("www")}\\.[^$WS\"'<>]+") to "[url]",
        Regex("${JsText.WORD_START}${JsText.ci("dls")}-[0-9a-fA-F]{32}${JsText.WORD_END}") to "[topic]",
        Regex("${JsText.WORD_START}[A-Za-z2-7]{4}(?:-?[A-Za-z2-7]{4}){6}${JsText.WORD_END}") to "[code]",
    )

    /**
     * Removes what diagnostics must never carry, in this order: daylightserver://… links and SERVER- codes ->
     * "[server code]"; anything that looks like a URL (scheme://…, or www.…) -> "[url]"; "dls-" + 32 hex -> "[topic]";
     * 28-character base32 codes, with or without dashes between groups of 4 -> "[code]".
     */
    fun redactDiagnostics(text: String?): String =
        REDACTIONS.fold(text ?: "") { s, (re, with) -> re.replace(s, Regex.escapeReplacement(with)) }

    /** An activity log entry: [time] (ms), [type], [id8] (the id's first 8 characters), [kind], [status], [http]. */
    data class Event(val time: Long, val type: String, val id8: String, val kind: String, val status: String, val http: Int) {
        fun toJson(): Map<String, Any?> = linkedMapOf("time" to time, "type" to type, "id8" to id8, "kind" to kind, "status" to status, "http" to http)

        companion object {
            /** An event read back from [toJson] (an app's stored log); null for anything else. */
            fun fromJson(m: Map<*, *>?): Event? {
                if (m == null) return null
                val time = (m["time"] as? Number)?.toLong() ?: return null
                return Event(time, m["type"] as? String ?: "", m["id8"] as? String ?: "", m["kind"] as? String ?: "", m["status"] as? String ?: "", (m["http"] as? Number)?.toInt() ?: 0)
            }
        }
    }

    /** An event for the log (the JS `activityEvent`): only these fields; titles, names, URLs and `from` never go in. */
    fun activityEvent(time: Long = System.currentTimeMillis(), type: String = "", id: String? = "", kind: String? = "", status: String? = "", http: Int = 0): Event =
        Event(time, type, (id ?: "").take(8), kind ?: "", status ?: "", http)

    /**
     * The log's status for an outbox row, as lab-vectors.json › diagnostics › rowHttp writes it: "{status}/{errorCode}"
     * ("failed/full"), or the status alone. Its `http` goes in [activityEvent]'s own field (OutboxRow.http).
     */
    fun rowStatus(status: String, errorCode: String): String = if (errorCode.isEmpty()) status else "$status/$errorCode"

    /** Appends an event to a log, keeping the last [ACTIVITY_MAX] (200). Returns the new list. */
    fun appendActivity(log: List<Event>?, event: Event): List<Event> = ((log ?: emptyList()) + event).takeLast(ACTIVITY_MAX)

    /** `Date.prototype.toISOString()`, the extended year form included; "-" outside the dates a JS Date holds. */
    internal fun isoString(ms: Long): String {
        if (Math.abs(ms) > 8_640_000_000_000_000L) return "-"
        val y = Instant.ofEpochMilli(ms).atOffset(ZoneOffset.UTC).year
        if (y in 0..9999) return Bytes.isoTime(ms)
        val iso = Bytes.isoTime(ms)
        val rest = iso.substring(iso.indexOf('-', 1)) // from the month on
        return (if (y < 0) "-" else "+") + String.format(Locale.ROOT, "%06d", Math.abs(y)) + rest
    }

    /** One log line: "{ISO time} {type} {id8} {kind} {status} {http}", "-" for an empty field (and for http 0). */
    fun activityLine(e: Event): String =
        listOf(isoString(e.time), e.type, e.id8, e.kind, e.status, if (e.http == 0) "" else e.http.toString())
            .joinToString(" ") { it.ifEmpty { "-" } }

    private val ROW_STATUSES = listOf("sending", "sent", "delivered", "failed", "expired")

    /**
     * "Copy diagnostics" (F26): the app and version, platform, Lab on or off, the caps seen, the last check-in (ISO and
     * relative to [now], or "never"), the outbox's counts by status ([statuses]: each row's status), the relay as
     * "ntfy.sh" or "custom relay", and the last 50 events, all through [redactDiagnostics].
     */
    fun diagnosticsReport(
        app: String = "",
        version: String = "",
        platform: String = "",
        lab: Boolean = true,
        caps: List<String> = emptyList(),
        checkedIn: Long? = null,
        statuses: List<String> = emptyList(),
        relay: String? = "",
        log: List<Event> = emptyList(),
        now: Long = System.currentTimeMillis(),
    ): String {
        fun d(id: String) = LabText["diagnostics.$id"]
        fun fill(id: String, vars: Map<String, Any?>) = LabText.fill(d(id), vars)
        val ntfy = try {
            Relay.normalize(relay) == Limits.DEFAULT_RELAY
        } catch (e: ShareException) {
            false
        }
        val counts = ROW_STATUSES.joinToString(" · ") { st -> "$st ${statuses.count { it == st }}" }
        val check = if (checkedIn != null) "${isoString(checkedIn)} (${LabText.relativeTime(checkedIn, now)})" else d("never")
        val events = log.takeLast(DIAGNOSTICS_EVENTS).map(::activityLine)
        val lines = listOf(
            d("heading"),
            fill("app", mapOf("app" to app, "version" to version, "platform" to platform)),
            fill("lab", mapOf("state" to d(if (lab) "on" else "off"))),
            fill("caps", mapOf("caps" to if (caps.isNotEmpty()) caps.joinToString(", ") else d("noCaps"))),
            fill("checkedIn", mapOf("time" to check)),
            fill("outbox", mapOf("counts" to counts)),
            fill("relay", mapOf("relay" to d(if (ntfy) "relayNtfy" else "relayCustom"))),
            d("events"),
        ) + events.ifEmpty { listOf(d("noEvents")) }
        return redactDiagnostics(lines.joinToString("\n") + "\n")
    }
}
