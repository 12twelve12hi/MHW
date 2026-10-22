import Foundation

/// Every Lab string (LAB-PLAN 1.4, 1.6, 2.5 and 2.6's Daylight server section), exactly as `LAB_TEXT` in
/// `share/js/daylight-lab.js` gives them: `LabStrings.swift` is generated from it (`scripts/lab-strings.mjs`), and
/// `LabVectorTests` pins every string and every function here to `share/vectors/lab-vectors.json` › labText. Apps show
/// these words and no others; a new string goes into `LAB_TEXT` first (the share lane), then the generator runs.
public enum LabText {
    /// The platforms the texts name (`{app}` and `{path}`): iphone, ipad, mac, chrome, safari, web, windows, android,
    /// inbox.
    public static var platform: String {
        #if os(macOS)
        return "mac"
        #else
        return DaylightShare.defaultDeviceName == "iPad" ? "ipad" : "iphone"
        #endif
    }

    /// The string with that dotted id ("lab", "serverSection.setupRow", "short.needs-key", …), or "" for an id
    /// `LAB_TEXT` does not have.
    public static subscript(_ id: String) -> String { LabStrings.all[id] ?? "" }

    /// The string with that id, or nil.
    public static func string(_ id: String) -> String? { LabStrings.all[id] }

    /// A LAB_TEXT array (serverSection.steps, featureOrder, serverFeatureOrder, excerpt.months), or [].
    public static func list(_ id: String) -> [String] { LabStrings.lists[id] ?? [] }

    /// Every string id → text (for tests and diagnostics).
    public static var all: [String: String] { LabStrings.all }

    /// Fills `{name}` slots; a slot without a value stays as it is (the reference's `fill`).
    public static func fill(_ s: String, _ vars: [String: String]) -> String {
        var out = ""
        var rest = Substring(s)
        while let open = rest.firstIndex(of: "{") {
            out += String(rest[..<open])
            let after = rest[rest.index(after: open)...]
            if let close = after.firstIndex(of: "}") {
                let name = after[..<close]
                if !name.isEmpty, name.unicodeScalars.allSatisfy({ isWordChar($0) }), let v = vars[String(name)] {
                    out += v
                    rest = after[after.index(after: close)...]
                    continue
                }
            }
            out += "{"
            rest = after
        }
        return out + String(rest)
    }

    /// JavaScript `\w`.
    static func isWordChar(_ u: Unicode.Scalar) -> Bool {
        (u.value >= 0x30 && u.value <= 0x39) || (u.value >= 0x41 && u.value <= 0x5A) || (u.value >= 0x61 && u.value <= 0x7A) || u == "_"
    }

    // MARK: 1.6: the switch, its note and the list

    public static var lab: String { self["lab"] }
    public static var switchFooter: String { self["switchFooter"] }
    public static var note: String { self["note"] }
    public static var noteButton: String { self["noteButton"] }
    public static var whatsInLab: String { self["whatsInLab"] }
    public static var ready: String { self["ready"] }
    public static var serverRow: String { self["serverRow"] }
    public static var serverHeading: String { self["serverHeading"] }
    public static var checking: String { self["checking"] }
    public static var adHocMac: String { self["adHocMac"] }

    /// "Send to Daylight" (Apple, the extension, web, Windows) or "Daylight Share" (Android, the Inbox).
    public static func appName(_ platform: String? = nil) -> String {
        string("appName.\(platform ?? Self.platform)") ?? "Send to Daylight"
    }

    /// "Turn on Lab in {app} to use this." (F09 with Lab off).
    public static func labOff(app: String? = nil, platform: String? = nil) -> String {
        fill(self["labOff"], ["app": app ?? appName(platform)])
    }

    // MARK: 1.4: features

    /// The features in list order (the four server features come after, `serverFeatureOrder`).
    public static var featureOrder: [String] { list("featureOrder") }
    public static var serverFeatureOrder: [String] { list("serverFeatureOrder") }

    /// A feature's name: its id's (F01…) or a server key's ("ai" → Summaries with Claude); anything else as given.
    public static func featureName(_ feature: String) -> String {
        if let name = string("features.\(feature).name") { return name }
        if let id = Lab.serverKeys[feature], let name = string("features.\(id).name") { return name }
        return feature
    }

    /// A feature's one sentence (1.4), or "".
    public static func featureSentence(_ feature: String) -> String {
        string("features.\(feature).sentence") ?? Lab.serverKeys[feature].flatMap { string("features.\($0).sentence") } ?? ""
    }

    // MARK: States (1.4, 1.6)

    /// The states the server decides, or the server module decides for the app (2.6), whose text is STATE_MESSAGES'.
    static let serverTextStates: Set<String> = ["pairing-mismatch", "server-outdated", "app-outdated", "locked", "needs-key",
                                                "needs-domain", "needs-r2", "needs-paid", "OFFLINE", "error"]

    /// The short state (What's in Lab), or nil for a state `LAB_TEXT.short` does not have.
    public static func short(_ state: String) -> String? { string("short.\(state)") }

    /// The text for a state (1.4, 1.6; the JS `needsMessage`; vectors > labText > messages).
    /// - `short`: the short state (What's in Lab); with `heading`, needs-server reads "Not set up" (the server heading).
    /// - otherwise the one sentence under a tapped control: `LAB_TEXT.needs` with {app} (from `app`, else the
    ///   platform's name), {path} (the platform's notification settings; a platform without one gets the first sentence
    ///   alone) and {feature} (a feature id, a server key or a name); for the server's states, `message`: the server
    ///   module's text, or nil when it is not given.
    /// Unknown states give nil.
    public static func needsMessage(_ state: String, app: String? = nil, platform: String? = nil, feature: String? = nil,
                                    short: Bool = false, heading: Bool = false, message: String? = nil) -> String? {
        if short {
            if heading, let h = string("serverHeadingShort.\(state)") { return h }
            return Self.short(state)
        }
        if state == "ready" { return ready }
        if let text = string("needs.\(state)") {
            let p = platform ?? Self.platform
            let appText = app ?? Self.appName(p)
            let path = string("notificationsPath.\(p)")
            var t = text
            if state == "needs-notifications" && path == nil, let dot = t.firstIndex(of: ".") {
                t = String(t[...dot])
            }
            return fill(t, ["app": appText, "path": path ?? "", "feature": featureName(feature ?? "")])
        }
        if serverTextStates.contains(state) { return message }
        return nil
    }

    /// The one button a note may carry (1.5): "Open Settings", "Open setting", "Allow" or "Copy Server code"; nil for
    /// none.
    public static func button(_ state: String) -> String? { string("buttons.\(state)") }

    /// A state as a short state knows it: a state of LAB_TEXT.short, else "error".
    static func knownShort(_ state: String) -> String { short(state) != nil ? state : "error" }

    /// The server's short state where it stands for the whole server (1.4): the line under What's in Lab's server
    /// heading and the {short} of the "Daylight server ›" row. needs-server reads "Not set up"; an unknown state is
    /// `error`.
    public static func serverHeadingShort(_ state: String) -> String {
        needsMessage(knownShort(state), short: true, heading: true) ?? ""
    }

    /// The "Daylight server ›" row's subtitle (1.1): "Optional · Not set up", "Optional · Ready", …
    public static func serverRowSubtitle(_ state: String) -> String {
        fill(self["serverRowSubtitle"], ["short": serverHeadingShort(state)])
    }

    /// A server feature's row under the server heading (1.4): its own short state ("Needs a Claude key") only when its
    /// state differs from the heading's, else nil. Unknown states count as `error` on both sides.
    public static func serverFeatureShort(_ state: String, heading: String) -> String? {
        let s = knownShort(state)
        return s == knownShort(heading) ? nil : short(s)
    }

    // MARK: 2.6: the Daylight server section

    /// {host} of the server section's lines: the text without its scheme and anything from the first "/" after it,
    /// read as text (no URL parser: the port stays, as `ShareText.relayHost` keeps it).
    public static func originHost(_ origin: String?) -> String {
        var host = Substring(origin ?? "")
        if let r = host.range(of: "://") { host = host[r.upperBound...] }
        if let slash = host.firstIndex(of: "/") { host = host[..<slash] }
        return String(host)
    }

    /// "Your Daylight server moved to {host}. Use it?" (2.6), for discovery's new origin.
    public static func serverMovedText(_ moved: String?) -> String {
        fill(self["serverSection.moved"], ["host": originHost(moved)])
    }

    /// The setup link's confirmation (2.6 "Setup link", step 3), for `ServerCode.parseSetupLink(link).server`.
    public static func setupConfirmText(_ server: String?) -> String {
        fill(self["serverSection.setupConfirmBody"], ["host": originHost(server)])
    }

    /// The section's host line, "{host} · {fingerprint}" (fingerprint as given: `ServerCode.showFingerprint`); when one
    /// side is empty the line is the other alone, and both empty give "".
    public static func hostLineText(_ host: String?, _ fingerprint: String?) -> String {
        let h = originHost(host), f = fingerprint ?? ""
        if h.isEmpty || f.isEmpty { return h.isEmpty ? f : h }
        return fill(self["serverSection.hostLine"], ["host": h, "fingerprint": f])
    }

    /// The section's Lab Inbox line (2.6) for GET /v1/status's `inbox.lastSeen`: an ISO 8601 UTC time read as rule D
    /// reads `poll` (2.2.5), or ms since 1970 (a JSON number). Anything else gives the not-yet line.
    public static func labInboxSeenText(_ lastSeen: JSONValue?, now: Int64) -> String {
        var ms: Int64?
        switch lastSeen {
        case let .number(d)? where d.isFinite && abs(d) < 9e15: ms = Int64(d.rounded(.down))
        case let .string(s)?: ms = Lab.parseTime(s)
        default: ms = nil
        }
        guard let ms else { return self["serverSection.labInboxNever"] }
        return fill(self["serverSection.labInboxSeen"], ["rel": relativeTime(ms, now: now)])
    }

    /// A US dollar amount without "US$" (`formatUsd`): cents = n × 100 in double precision, rounded half up (never a
    /// printf: 1.005 is "1" and 0.015 is "0.02"), and ".00" left out: 0.227 → "0.23", 2.5 → "2.50", 3 → "3". Anything
    /// but a finite number above 0 is "0".
    public static func formatUsd(_ value: JSONValue?) -> String {
        guard case let .number(n)? = value else { return "0" }
        return formatUsd(n)
    }

    public static func formatUsd(_ n: Double) -> String {
        // (Amounts past US$10^13 are not something the server reports; they are capped rather than overflow.)
        let cents: Int64 = n.isFinite && n > 0 ? Int64(min(jsRound(n * 100), 1e15)) : 0
        let whole = cents / 100, frac = cents % 100
        return frac != 0 ? "\(whole).\(frac < 10 ? "0" : "")\(frac)" : "\(whole)"
    }

    /// JavaScript `Math.round`: the nearest integer, halves toward +infinity (x − floor(x) is exact, so 0.49999999999999994
    /// stays 0, where floor(x + 0.5) would give 1).
    static func jsRound(_ x: Double) -> Double {
        let f = x.rounded(.down)
        return x - f >= 0.5 ? f + 1 : f
    }

    /// "AI today: US$0.23 of US$3" (2.6): used = status `usage.ai.usd`, cap = `usage.ai.limitUsd`.
    public static func aiTodayText(used: JSONValue?, cap: JSONValue?) -> String {
        fill(self["serverSection.aiToday"], ["used": formatUsd(used), "cap": formatUsd(cap)])
    }

    /// The setup steps (2.6), shown numbered 1-5; steps[1] is the server module's RERUN_HELP.
    public static var serverSteps: [String] { list("serverSection.steps") }

    // MARK: 2.5: times and the check-in

    /// "just now", "{m} min ago", "{h} h ago" or "{d} days ago". A time ahead of `now` is "just now".
    public static func relativeTime(_ ms: Int64, now: Int64) -> String {
        let d = max(0, now - ms)
        if d < 60_000 { return self["rel.justNow"] }
        if d < 3_600_000 { return fill(self["rel.minutes"], ["m": String(d / 60_000)]) }
        if d < 48 * 3_600_000 { return fill(self["rel.hours"], ["h": String(d / 3_600_000)]) }
        return fill(self["rel.days"], ["d": String(d / 86_400_000)])
    }

    /// The check-in header above the history (2.5): ms from `LabLedger.checkedIn()`, or nil.
    public static func checkedInText(_ ms: Int64?, now: Int64) -> String {
        guard let ms else { return self["neverCheckedIn"] }
        return fill(self["checkedIn"], ["rel": relativeTime(ms, now: now)])
    }

    /// What's in Lab's header line (1.4): "Your Daylight: Lab on · checked in 4 min ago", or the needs-inbox short state
    /// with the check-in time ("Needs Lab on your Daylight", alone before any check-in).
    public static func inboxLabText(inboxLab: Bool, checkedIn: Int64?, now: Int64) -> String {
        let needs = self["short.needs-inbox"]
        guard let c = checkedIn else { return needs }
        if inboxLab { return fill(self["inboxLabOn"], ["rel": relativeTime(c, now: now)]) }
        return fill(self["inboxLabNeeds"], ["short": needs, "rel": relativeTime(c, now: now)])
    }

    // MARK: W1 (6.5 Q5): the Use switches

    /// Whether a feature is in use (the JS `labUseOn`): Lab on and the feature's Use switch not off; a missing switch is
    /// on, and features without a Use switch follow Lab alone. `uses`: the stored switches (`labUse`), by feature id.
    public static func useOn(lab: Bool, uses: [String: Bool], feature: String) -> Bool {
        guard lab else { return false }
        guard Lab.useFeatures.contains(feature) else { return true }
        return uses[feature] ?? true
    }

    /// "Use" (the switch), "Use {feature}" (its accessibility label) and its footer.
    public static var useLabel: String { self["use.label"] }
    public static func useA11y(_ feature: String) -> String { fill(self["use.a11y"], ["feature": featureName(feature)]) }
    public static func useFooter(_ feature: String) -> String? { string("use.footers.\(feature)") }
}
