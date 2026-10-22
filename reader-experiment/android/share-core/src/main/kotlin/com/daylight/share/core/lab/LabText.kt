package com.daylight.share.core.lab

import com.daylight.share.core.ItemHeader
import com.daylight.share.core.Kind
import com.daylight.share.core.Text

/**
 * The Lab copy (LAB-PLAN 1.4, 1.6, 2.5 and 2.6's Daylight server section): LAB_TEXT of `share/js/daylight-lab.js`,
 * the one source of every Lab string, ported as [LabStrings] (generated) and pinned by `lab-vectors.json` › labText.
 * Apps show these strings exactly as given: never edit them here (a missing string goes to the share lane first).
 * The server section's state lines are the server module's (`server.ServerMessages`, DESIGN 14.1).
 */
object LabText {
    /** Every string by its dotted id, e.g. "switchFooter", "short.needs-inbox", "rows.reader.label". */
    val strings: Map<String, String> get() = LabStrings.ALL

    /** The string [id]; an unknown id is a programming error. */
    operator fun get(id: String): String = LabStrings.ALL[id] ?: throw IllegalArgumentException("no Lab string $id")

    /**
     * Every LAB_TEXT list by its dotted id ("serverSection.steps", "featureOrder", …). [strings] holds them joined with
     * ","; read a list here, never by splitting that form: an item may hold a comma.
     */
    val lists: Map<String, List<String>> get() = LabStrings.LISTS

    /** The list [id]; an unknown id is a programming error. */
    fun list(id: String): List<String> = LabStrings.LISTS[id] ?: throw IllegalArgumentException("no Lab list $id")

    // ---- 1.6: the switch, its note and the list
    val LAB: String get() = get("lab")
    val SWITCH_FOOTER: String get() = get("switchFooter")
    val NOTE: String get() = get("note")
    val NOTE_BUTTON: String get() = get("noteButton")
    val WHATS_IN_LAB: String get() = get("whatsInLab")
    val READY: String get() = get("ready")
    val SERVER_ROW: String get() = get("serverRow")
    val SERVER_HEADING: String get() = get("serverHeading")
    val COMFORT: String get() = get("comfort")
    val COMFORT_FOOTER: String get() = get("comfortFooter")
    val CHECKING: String get() = get("checking")
    val AD_HOC_MAC: String get() = get("adHocMac")
    val NEVER_CHECKED_IN: String get() = get("neverCheckedIn")

    /** 1.4: the features in list order, then the four server features (listed last, under [SERVER_HEADING]). */
    val FEATURE_ORDER: List<String> get() = list("featureOrder")
    val SERVER_FEATURE_ORDER: List<String> get() = list("serverFeatureOrder")

    /**
     * The Daylight server section's setup steps (2.6, "The rest of the server section's copy"), shown numbered 1-5 under
     * [get] ("serverSection.stepsHeading") while the server's state is needs-server. Step 2 is the server module's
     * RERUN_HELP word for word.
     */
    val SERVER_STEPS: List<String> get() = list("serverSection.steps")

    private val SLOT = Regex("\\{(\\w+)\\}")

    /** Fills {slots}; a slot without a value stays as it is (the JS `fillText`). */
    fun fill(s: String, vars: Map<String, Any?>): String = SLOT.replace(s) { m -> vars[m.groupValues[1]]?.toString() ?: m.value }

    /** {app}: "Send to Daylight", or "Daylight Share" on Android (both roles). Unknown platforms: "Send to Daylight". */
    fun appName(platform: String?): String = platform?.let { strings["appName.$it"] } ?: "Send to Daylight"

    /** A feature's name: its id's (F01…) or a server key's ("files" is "Files over 9 MB"); anything else as given. */
    fun featureName(feature: String?): String {
        val id = if (feature != null && strings.containsKey("features.$feature.name")) feature else Lab.SERVER_KEYS[feature]
        return if (id != null) get("features.$id.name") else feature ?: ""
    }

    /** A feature's sentence in What's in Lab (1.4), or null for an unknown id. */
    fun featureSentence(feature: String): String? = strings["features.$feature.sentence"]

    /** The short state of [state] (What's in Lab, 1.4), or null for an unknown state. */
    fun short(state: String): String? = strings["short.$state"]

    /** The one button a note may carry (1.5): "Open Settings", "Open setting", "Allow", "Copy Server code" or null. */
    fun button(state: String): String? = strings["buttons.$state"]

    /** The states a server decides, or the server module decides for the app (2.6), whose text is STATE_MESSAGES'. */
    private val SERVER_TEXT_STATES = setOf(
        "pairing-mismatch", "server-outdated", "app-outdated", "locked", "needs-key", "needs-domain", "needs-r2",
        "needs-paid", "OFFLINE", "error",
    )

    /**
     * The text for a state (1.4, 1.6; vectors > labText › messages; the JS `needsMessage`).
     * - [short]: the short state (What's in Lab); with [heading], needs-server reads "Not set up" (the server heading).
     * - otherwise the one sentence under a tapped control, with {app} ([app], else the platform's name), {path} (the
     *   platform's notification settings; a platform without one gets the first sentence alone) and {feature} (a feature
     *   id, a server key or a name); for the server's states, [message]: the server module's text, or null.
     * [platform]: iphone | ipad | mac | chrome | safari | web | windows | android | inbox. Unknown states -> null.
     */
    fun needsMessage(
        state: String,
        app: String? = null,
        platform: String? = null,
        feature: String? = null,
        short: Boolean = false,
        heading: Boolean = false,
        message: String? = null,
    ): String? {
        if (short) {
            if (heading) strings["serverHeadingShort.$state"]?.let { return it }
            return short(state)
        }
        if (state == "ready") return READY
        strings["needs.$state"]?.let { needs ->
            val appName = app ?: platform?.let { strings["appName.$it"] } ?: "Send to Daylight"
            val path = platform?.let { strings["notificationsPath.$it"] }
            val text = if (state == "needs-notifications" && path == null) needs.substring(0, needs.indexOf('.') + 1) else needs
            return fill(text, mapOf("app" to appName, "path" to (path ?: ""), "feature" to featureName(feature)))
        }
        if (state in SERVER_TEXT_STATES) return message
        return null
    }

    /** A state as a short state knows it: a state with a short state, else "error" (as the gate maps an unknown state). */
    private fun knownShort(state: String?): String = if (state != null && strings.containsKey("short.$state")) state else "error"

    /**
     * The server's short state where it stands for the whole server (1.4): the line under What's in Lab's server heading
     * and the {short} of the "Daylight server ›" row. needs-server reads "Not set up" here; an unknown state is error.
     */
    fun serverHeadingShort(state: String?): String = needsMessage(knownShort(state), short = true, heading = true)!!

    /** The "Daylight server ›" row's subtitle (1.1): "Optional · Not set up", "Optional · Ready", … */
    fun serverRowSubtitle(state: String?): String = fill(get("serverRowSubtitle"), mapOf("short" to serverHeadingShort(state)))

    /**
     * A server feature's row under the server heading (1.4): its own short state ("Needs a Claude key") only when its
     * state differs from the heading's, else null. Unknown states count as error on both sides.
     */
    fun serverFeatureShort(state: String?, headingState: String?): String? {
        val s = knownShort(state)
        return if (s == knownShort(headingState)) null else needsMessage(s, short = true)
    }

    /** {host} of the server section's lines (2.6): the text without its scheme and anything from the first '/' after it. */
    private fun originHost(origin: String?): String {
        var host = origin ?: ""
        val scheme = host.indexOf("://")
        if (scheme >= 0) host = host.substring(scheme + 3)
        val slash = host.indexOf('/')
        return if (slash >= 0) host.substring(0, slash) else host
    }

    /** The sheet when the server moved (2.6): "Your Daylight server moved to {host}. Use it?" ([moved]: the new origin). */
    fun serverMovedText(moved: String?): String = fill(get("serverSection.moved"), mapOf("host" to originHost(moved)))

    /** The setup link's confirmation (2.6 "Setup link", step 3); [server] is the parsed link's origin. */
    fun setupConfirmText(server: String?): String = fill(get("serverSection.setupConfirmBody"), mapOf("host" to originHost(server)))

    /**
     * The server section's host line (2.6): "{host} · {fingerprint}", {host} filled as [serverMovedText] fills it (the
     * port stays) and [fingerprint] as given (`ServerCode.showFingerprint`). When one side is empty the line is the
     * other alone; both empty give "".
     */
    fun hostLineText(host: String?, fingerprint: String?): String {
        val h = originHost(host)
        val f = fingerprint ?: ""
        if (h.isEmpty() || f.isEmpty()) return h.ifEmpty { f }
        return fill(get("serverSection.hostLine"), mapOf("host" to h, "fingerprint" to f))
    }

    /**
     * The server section's Lab Inbox line (2.6). [lastSeen]: GET /v1/status's `inbox.lastSeen`, an ISO 8601 UTC time
     * read as rule D reads `poll` (2.2.5), or ms since 1970 (a number). Anything else gives the not-yet line.
     */
    fun labInboxSeenText(lastSeen: Any?, now: Long): String {
        val ms: Long? = when (lastSeen) {
            is Double -> if (lastSeen.isNaN() || lastSeen.isInfinite()) null else lastSeen.toLong()
            is Long -> lastSeen
            is Int -> lastSeen.toLong()
            else -> Lab.parseTime(lastSeen)
        }
        if (ms == null) return get("serverSection.labInboxNever")
        return fill(get("serverSection.labInboxSeen"), mapOf("rel" to relativeTime(ms, now)))
    }

    /**
     * A US dollar amount without "US$" (the JS `formatUsd`): cents = n × 100 in double precision, rounded half up, and
     * ".00" left out: 0.227 -> "0.23", 2.5 -> "2.50", 3 -> "3", 1.005 -> "1". Anything but a finite number above 0 is "0".
     */
    fun formatUsd(n: Any?): String {
        val d = (n as? Number)?.toDouble()
        val cents = if (d != null && !d.isNaN() && !d.isInfinite() && d > 0) Math.round(d * 100) else 0L
        val whole = cents / 100
        val frac = cents % 100
        return if (frac != 0L) "$whole.${frac.toString().padStart(2, '0')}" else whole.toString()
    }

    /** "AI today: US$0.23 of US$3" (2.6): [used] = status `usage.ai.usd`, [cap] = `usage.ai.limitUsd`. */
    fun aiTodayText(used: Any?, cap: Any?): String = fill(get("serverSection.aiToday"), mapOf("used" to formatUsd(used), "cap" to formatUsd(cap)))

    /** "just now", "{m} min ago", "{h} h ago" or "{d} days ago" (2.5). A time ahead of [now] is "just now". */
    fun relativeTime(ms: Long, now: Long): String {
        val d = maxOf(0L, now - ms)
        return when {
            d < 60_000 -> get("rel.justNow")
            d < 3_600_000 -> fill(get("rel.minutes"), mapOf("m" to d / 60_000))
            d < 48 * 3_600_000L -> fill(get("rel.hours"), mapOf("h" to d / 3_600_000))
            else -> fill(get("rel.days"), mapOf("d" to d / 86_400_000))
        }
    }

    /** The check-in header above the history (2.5): [ms] from [LabLedger.checkedIn], or null. */
    fun checkedInText(ms: Long?, now: Long): String =
        if (ms == null) NEVER_CHECKED_IN else fill(get("checkedIn"), mapOf("rel" to relativeTime(ms, now)))

    /**
     * What's in Lab's header line (1.4): "Your Daylight: Lab on · checked in 4 min ago", or the needs-inbox short state
     * with the check-in time ("Needs Lab on your Daylight", alone before any check-in).
     */
    fun inboxLabText(inboxLab: Boolean, checkedIn: Long?, now: Long): String {
        if (inboxLab && checkedIn != null) return fill(get("inboxLabOn"), mapOf("rel" to relativeTime(checkedIn, now)))
        if (checkedIn == null) return get("short.needs-inbox")
        return fill(get("inboxLabNeeds"), mapOf("short" to get("short.needs-inbox"), "rel" to relativeTime(checkedIn, now)))
    }

    // ---- W1 strings that labText pins (L1): the per-feature Use switches, the Inbox's row lines and item details

    /**
     * Whether a Lab feature is in use (6.5 Q5; the JS `labUseOn`): Lab is on and, for a feature with a Use switch
     * ([Lab.USE_FEATURES]), that switch is not off. [labUse] holds the stored switches (`labUse.<id>` in Prefs); a
     * missing one means on.
     */
    fun labUseOn(lab: Boolean, labUse: Map<String, Boolean>, feature: String): Boolean {
        if (!lab) return false
        if (feature !in Lab.USE_FEATURES) return true
        return labUse[feature] != false
    }

    /** The Use switch's footer for [feature] (6.5 Q5), or null when it has no Use switch. */
    fun useFooter(feature: String): String? = strings["use.footers.$feature"]

    /** The Use switch's accessibility label: "Use {feature name}". */
    fun useA11y(feature: String): String = fill(get("use.a11y"), mapOf("feature" to featureName(feature)))

    /**
     * The line under an Inbox row's title (F03; the JS `inboxKindLine`): "Page as you saw it" (page, x-cap seen or
     * none), "Clean article", "Excerpt", "Test article", "Link (the Reader downloads it)" (url) or "Document · {MB} MB"
     * (file), then " · from {from}". [extras]: the item's checked extras; an unknown x-cap counts as none.
     */
    fun inboxKindLine(kind: String, extras: Map<String, String> = emptyMap(), size: Long = 0, from: String? = null): String {
        val cap = extras[ItemHeader.X_CAP]?.takeIf { it in ItemHeader.X_CAP_VALUES }
        val line = when {
            cap == "excerpt" -> get("kindLine.excerpt")
            cap == "test" -> get("kindLine.test")
            kind == Kind.URL -> get("kindLine.link")
            kind == Kind.PAGE -> if (cap == "clean") get("kindLine.clean") else get("kindLine.seen")
            else -> fill(get("kindLine.document"), mapOf("mb" to Text.formatMB(size)))
        }
        val f = Text.cleanName(from)
        return if (f.isNotEmpty()) line + fill(get("kindLine.from"), mapOf("from" to f)) else line
    }

    /** "Cleaned from {host}" for an item's x-orig (2.3; its host and port, as text, lowercased), or null without a valid one. */
    fun cleanedFromText(orig: String?): String? {
        val u = Text.webUrl(orig) ?: return null
        var rest = u.substring(u.indexOf("://") + 3)
        rest.indexOf('#').let { if (it >= 0) rest = rest.substring(0, it) }
        rest.indexOf('?').let { if (it >= 0) rest = rest.substring(0, it) }
        val authority = rest.indexOf('/').let { if (it >= 0) rest.substring(0, it) else rest }
        val hostport = authority.substring(authority.lastIndexOf('@') + 1)
        return fill(get("cleanedFrom"), mapOf("host" to hostport.lowercase(java.util.Locale.ROOT)))
    }
}
