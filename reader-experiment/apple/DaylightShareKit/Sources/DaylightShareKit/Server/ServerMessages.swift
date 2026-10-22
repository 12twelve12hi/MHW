import Foundation

/// The Daylight server's user-facing messages and state mapping (server DESIGN 14, LAB-PLAN 2.6), ported from
/// `server/client/daylight-server.js` under the same names and pinned by `server/vectors/server-vectors.json` ›
/// serverState (`ServerVectorTests`). The apps show the server's `message` for an error code (14.2) and for the state
/// `error`; every other state shows this module's text for it (`stateMessages`), whatever the server sent with it.
public enum ServerMessages {
    /// The deploy's re-run step, word for word (LAB_TEXT.serverSection.steps[1] is the same sentence).
    public static let rerunHelp = "In GitHub › Actions, open the latest ‘Reader experiment - Daylight server’ run and choose Re-run all jobs."

    public static let stateMessages: [String: String] = [
        "needs-server": "Needs the Daylight server. Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub › Settings › Secrets, then paste the setup link the deploy makes in Lab settings › Daylight server.",
        "pairing-mismatch": "The Daylight server still has your previous pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE.",
        "server-outdated": "Update the Daylight server to use this: open the latest “Reader experiment - Daylight server” run in GitHub › Actions and choose Re-run all jobs.",
        "app-outdated": "Update this app to use the Daylight server.",
        "locked": "The Daylight server was locked when this device was re-paired. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE.",
        "needs-key": "Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets), then re-run the deploy, to turn this on.",
        "needs-domain": "Needs an email domain. Add DAYLIGHT_EMAIL_DOMAIN (a domain on your Cloudflare account) in GitHub › Settings › Secrets, then re-run the deploy.",
        "needs-r2": "Needs R2 storage on your Cloudflare account. Turn on R2 in the Cloudflare dashboard (it asks for a card; the free tier isn’t charged), then re-run the deploy.",
        "needs-lab-inbox": "Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.",
        "needs-paid": "Email-in needs Cloudflare’s Workers Paid plan. Subscribe in the Cloudflare dashboard, set the variable DAYLIGHT_WORKERS_PLAN to paid in GitHub › Settings, then re-run the deploy.",
        "OFFLINE": "Couldn’t reach the Daylight server. Check your connection and try again.",
    ]

    /// Every code the server can answer with; each has a message.
    public static let errorCodes = [
        "BAD_REQUEST", "BAD_AUTH", "NOT_FOUND", "NEED_SOURCE", "NEEDS_KEY", "NOT_CONFIGURED", "NEEDS_LAB_INBOX", "FEED_EXISTS",
        "GONE", "LENGTH_REQUIRED", "TOO_LARGE", "AI_TOO_LARGE", "UNSUPPORTED_TYPE", "FEED_INVALID", "URL_BLOCKED", "AI_REFUSED",
        "AI_BAD_INPUT", "LOCKED", "RATE_LIMITED", "AI_DAILY_LIMIT", "AI_QUEUE_FULL", "FEED_LIMIT", "FETCH_FAILED",
        "AI_INCOMPLETE", "AI_BUSY", "AI_KEY_INVALID", "AI_BILLING", "AI_TIMEOUT", "STORAGE_FULL", "SERVER_LIMIT", "BAD_EMAIL",
        "FEED_FLOOD", "SERVER_ERROR", "SETUP_USED",
    ]

    /// Every state `DaylightServer.state` and `noteError` return: a closed set.
    public static let serverStates = ["ready", "needs-server", "pairing-mismatch", "server-outdated", "app-outdated",
                                      "needs-key", "needs-domain", "needs-r2", "needs-lab-inbox", "needs-paid", "locked",
                                      "error", "OFFLINE"]
    /// The states the app decides itself (DESIGN 4.3, 14.1). No answer from the server can give one of them.
    public static let localStates = ["needs-server", "pairing-mismatch", "server-outdated", "app-outdated", "OFFLINE"]
    /// The states GET /v1/status may give a feature besides `ready` and `error` (10.5, 14.1). Any other is `error`.
    public static let statusStates = ["needs-key", "needs-domain", "needs-r2", "needs-lab-inbox", "needs-paid", "locked"]

    // MARK: JavaScript's number handling, for the messages that carry numbers

    /// `Number(x)` for a JSON value (nil = undefined).
    static func number(_ v: JSONValue?) -> Double {
        switch v {
        case nil: return .nan
        case .null?: return 0
        case let .bool(b)?: return b ? 1 : 0
        case let .number(d)?: return d
        case let .string(s)?:
            let t = ShareText.jsTrim(s)
            if t.isEmpty { return 0 }
            return Double(t) ?? .nan
        default: return .nan
        }
    }

    /// JavaScript's `String(n)` for a number: whole numbers without a fraction, others in the shortest round-trip form.
    static func numberText(_ d: Double) -> String {
        if d.isNaN { return "NaN" }
        if d.isInfinite { return d > 0 ? "Infinity" : "-Infinity" }
        if d == d.rounded(), abs(d) < 1e21 { return String(format: "%.0f", d) }
        return "\(d)"
    }

    /// `${x}` of a JSON value in a template literal.
    static func templateText(_ v: JSONValue) -> String {
        switch v {
        case .null: return "null"
        case let .bool(b): return b ? "true" : "false"
        case let .number(d): return numberText(d)
        case let .string(s): return s
        case .array, .object: return v.serialized
        }
    }

    /// The value, or nil for JSON null as for a missing one (`x ?? fallback`).
    static func given(_ v: JSONValue?) -> JSONValue? {
        guard let v, v != .null else { return nil }
        return v
    }

    /// "12.7 MB": `Math.round((Number(n) / 1_000_000) * 10) / 10`.
    static func fmtMB(_ v: JSONValue?) -> String {
        "\(numberText(LabText.jsRound(number(v) / 1_000_000 * 10) / 10)) MB"
    }

    /// "US$3", "US$0.13": `Number(n).toFixed(2)` without ".00" (toFixed rounds the exact binary value, halves up).
    static func fmtUsd(_ v: JSONValue?) -> String {
        let d = number(v)
        guard d.isFinite else { return "US$NaN" }
        // The exact decimal value of the double (30 places), rounded half up to cents.
        var exact = Decimal(string: String(format: "%.30f", abs(d)), locale: Locale(identifier: "en_US_POSIX")) ?? 0
        var rounded = Decimal()
        NSDecimalRound(&rounded, &exact, 2, .plain)
        let cents = NSDecimalNumber(decimal: rounded * 100).int64Value
        let text = "\(cents / 100).\(cents % 100 < 10 ? "0" : "")\(cents % 100)"
        let sign = d < 0 && cents != 0 ? "-" : ""
        return "US$" + sign + (text.hasSuffix(".00") ? String(text.dropLast(3)) : text)
    }

    /// "06:00 UTC" for an ISO time, else "midnight UTC" (`new Date(iso)`).
    static func fmtTime(_ v: JSONValue?) -> String {
        guard let s = v?.string, !s.isEmpty else { return "midnight UTC" }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let g = ISO8601DateFormatter()
        g.formatOptions = [.withInternetDateTime]
        guard let date = f.date(from: s) ?? g.date(from: s) else { return "midnight UTC" }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d UTC", c.hour ?? 0, c.minute ?? 0)
    }

    /// `Number(x).toLocaleString('en-US')`.
    static func localeNumber(_ v: JSONValue?) -> String {
        let d = number(v)
        if d.isNaN { return "NaN" }
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 3
        return f.string(from: NSNumber(value: d)) ?? numberText(d)
    }

    // MARK: Messages

    /// The message for an error code (14.2); unknown codes get the generic sentence. `extra`: the error's fields.
    public static func errorMessage(_ code: String, _ extra: [String: JSONValue] = [:]) -> String {
        switch code {
        case "AI_KEY_INVALID":
            return "Claude didn’t accept the API key. Check ANTHROPIC_API_KEY in GitHub › Settings › Secrets, then re-run the deploy."
        case "AI_BILLING": return "Your Anthropic account is out of credit. Add credit in the Claude Console to keep using AI."
        case "AI_DAILY_LIMIT":
            let lr = extra["limitRequests"]
            if let lr, lr != .null, number(lr) >= 0 {
                let n = number(lr)
                return "You’ve used today’s \(numberText(n)) AI request\(n == 1 ? "" : "s") (the server’s daily limit). It resets at \(fmtTime(extra["resetAt"])). To change the limit, set the repo variable DAYLIGHT_AI_MAX_REQ_DAY in GitHub › Settings › Secrets and variables › Actions › Variables, then re-run the deploy."
            }
            let ceiling = given(extra["ceilingUsd"]) ?? .number(10)
            if number(extra["needUsd"]) > 0 {
                return "This request could cost up to \(fmtUsd(extra["needUsd"])) with Claude, more than today’s AI limit. Raise the limit in Lab settings (up to \(fmtUsd(ceiling)))."
            }
            return "Today’s AI limit is used up. It resets at \(fmtTime(extra["resetAt"])), or raise it in Lab settings (up to \(fmtUsd(ceiling)))."
        case "AI_TOO_LARGE":
            let tokens = given(extra["tokens"]) ?? .number(0)
            let limit = given(extra["limit"]) ?? .number(200_000)
            return "This is too long for one AI request (about \(localeNumber(tokens)) tokens; the limit is \(localeNumber(limit)))."
        case "AI_QUEUE_FULL": return "Too many AI requests are waiting. Try again in a few minutes."
        case "AI_REFUSED": return "Claude declined to work on this one."
        case "AI_BUSY": return "Claude is busy right now. Try again in a minute."
        case "AI_TIMEOUT": return "Claude took too long to answer. Try again."
        case "AI_INCOMPLETE": return "Claude’s answer was cut off. Try a shorter length."
        case "AI_BAD_INPUT": return "Claude couldn’t read this document."
        case "URL_BLOCKED": return "The Daylight server can’t open that address."
        case "FETCH_FAILED": return "The Daylight server couldn’t load that page."
        case "FEED_INVALID": return "That address isn’t a feed, and the page doesn’t link to one."
        case "FEED_EXISTS": return "You already follow that feed."
        case "FEED_LIMIT":
            let limit = given(extra["limit"]).map { templateText($0) } ?? "100"
            return "You follow the most feeds the server allows (\(limit)). Remove one to add another."
        case "FEED_FLOOD": return "This feed was paused because it published too many new items at once."
        case "TOO_LARGE":
            return "That’s larger than the Daylight server takes (\(fmtMB(given(extra["limit"]) ?? .number(0))))."
        case "STORAGE_FULL": return "The Daylight server’s storage is full. Try again once your Daylight has picked up waiting files."
        case "GONE": return "That file has expired on the Daylight server. Send it again."
        case "RATE_LIMITED": return "Too many requests. Try again in a minute."
        case "BAD_AUTH":
            return "The Daylight server doesn’t recognise this device’s pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or check DAYLIGHT_SERVER_CODE."
        case "SETUP_USED":
            return "That setup link was already used for another pairing. Run the deploy with “New setup link” for a fresh one."
        case "SETUP_INVALID":
            return "That setup link isn’t current. Copy it again: the deploy’s summary in GitHub › Actions says where to find it."
        case "SERVER_LIMIT":
            return "This was too big for the Daylight server on Cloudflare’s Free plan. It works on the Workers Paid plan."
        case "NEEDS_KEY": return stateMessages["needs-key"]!
        case "NOT_CONFIGURED": return stateMessages[notConfiguredState(extra["missing"])]!
        case "NEEDS_LAB_INBOX": return stateMessages["needs-lab-inbox"]!
        case "LOCKED": return stateMessages["locked"]!
        case "OFFLINE": return stateMessages["OFFLINE"]!
        default: return "Something went wrong on the Daylight server (\(code)). Try again later."
        }
    }

    /// Text for the states the app decides itself (14.1): needs-server, pairing-mismatch, server-outdated,
    /// app-outdated, OFFLINE (and any other state's or code's message).
    public static func localMessage(_ state: String) -> String { stateMessages[state] ?? errorMessage(state) }

    /// NOT_CONFIGURED's `missing` -> the state, read in this order (LAB-PLAN 2.6): DAYLIGHT_SERVER_CODE, then
    /// DAYLIGHT_EMAIL_DOMAIN, then R2; anything else, a `missing` that is not a list included, is needs-server.
    public static func notConfiguredState(_ missing: JSONValue?) -> String {
        let m = (missing?.array ?? []).compactMap(\.string)
        if m.contains("DAYLIGHT_SERVER_CODE") { return "needs-server" }
        if m.contains("DAYLIGHT_EMAIL_DOMAIN") { return "needs-domain" }
        if m.contains("R2") { return "needs-r2" }
        return "needs-server"
    }

    /// Whether an error JSON's `code` is read (10.4): 1 to 40 characters of A-Z, 0-9 and _, starting with a letter, and
    /// not a state the app decides itself (OFFLINE), so a server's answer can never pose as one.
    public static func isServerCode(_ code: String?) -> Bool {
        guard let code, !localStates.contains(code) else { return false }
        let u = Array(code.utf8)
        guard (1...40).contains(u.count), u[0] >= 0x41, u[0] <= 0x5A else { return false }
        return u.allSatisfy { ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x5F }
    }

    /// A feature's entry in GET /v1/status -> {state, message} (14.1; serverState › fromStatus). `ready` has no message.
    /// The `statusStates` show this module's text for the state, whatever the server sent. `error` shows the server's
    /// `message` when it is a non-empty string, else SERVER_ERROR's sentence; any other state is `error` the same way, so
    /// the set stays closed. A status without the feature, or an entry without a state: error, NOT_FOUND's sentence.
    public static func stateFromStatus(_ status: JSONValue?, feature: String) -> ServerState {
        guard let f = status?["features"]?[feature], f.object != nil, let state = f["state"]?.string, !state.isEmpty else {
            return ServerState("error", errorMessage("NOT_FOUND"))
        }
        if state == "ready" { return ServerState("ready", nil) }
        if statusStates.contains(state) { return ServerState(state, stateMessages[state]) }
        if let m = f["message"]?.string, !m.isEmpty { return ServerState("error", m) }
        return ServerState("error", errorMessage("SERVER_ERROR"))
    }

    /// An error from the server, the network or discovery -> {state, message} (LAB-PLAN 2.6; serverState › fromError).
    /// The app's own states and every state an error code maps to show this module's text; `error` shows the error's
    /// message (BAD_AUTH: always this module's). An error without a code (a network failure) is OFFLINE.
    public static func stateFromError(_ err: Error?) -> ServerState {
        var code = "OFFLINE"
        var message: String?
        var missing: JSONValue?
        var extra: [String: JSONValue] = [:]
        if let e = err as? ServerError {
            code = e.code.isEmpty ? "OFFLINE" : e.code
            message = e.message
            missing = e.extra["missing"]
            extra = e.extra
        } else if let e = err as? ShareError, !e.code.isEmpty {
            code = e.code
            message = e.message
        }
        if localStates.contains(code) { return ServerState(code, localMessage(code)) }
        let mapped: String?
        switch code {
        case "LOCKED": mapped = "locked"
        case "NEEDS_KEY": mapped = "needs-key"
        case "NEEDS_LAB_INBOX": mapped = "needs-lab-inbox"
        case "NOT_CONFIGURED": mapped = notConfiguredState(missing)
        default: mapped = nil
        }
        if let mapped { return ServerState(mapped, stateMessages[mapped]) }
        if code == "BAD_AUTH" { return ServerState("error", errorMessage("BAD_AUTH")) }
        if let message, !message.isEmpty { return ServerState("error", message) }
        return ServerState("error", errorMessage(code, extra))
    }

    /// The notice shown once per feature (14.3), with Continue and Cancel; `delivery` is the server's mode ("lab" or
    /// "v1"). nil for a feature without one.
    public static func noticeText(_ feature: String, delivery: String = "lab") -> String? {
        let v1 = delivery == "v1"
        switch feature {
        case "ai", "pdf":
            return "Not end-to-end encrypted: to use AI, the text or file goes to your Daylight server and to Claude (Anthropic) in readable form."
                + (v1 ? "" : " Links, pages and files you send to your Daylight stay end-to-end encrypted.")
        case "email":
            return "Not end-to-end encrypted: email reaches your Daylight server in readable form, like any email. The server encrypts it before it goes on to your Daylight."
        case "feeds":
            return "Your feed list is kept on your Daylight server in readable form, so it can check feeds while your devices sleep."
        case "files":
            return v1
                ? "Large files wait on your Daylight server for up to 14 days, encrypted with your pairing key, which your Daylight server also holds."
                : "Large files wait on your Daylight server for up to 14 days, encrypted with your pairing key; the server can’t open them."
        case "v1":
            return "Your Daylight server holds your pairing code, so whoever controls your Cloudflare or GitHub account can read everything sent to this Daylight."
        default:
            return nil
        }
    }
}

/// A server feature's state and the one sentence to show for it (nil for ready).
public struct ServerState: Equatable, Sendable {
    public let state: String
    public let message: String?

    public init(_ state: String, _ message: String?) {
        self.state = state
        self.message = message
    }

    public var ready: Bool { state == "ready" }
}

/// An error from the server, the network or discovery (the JS `ServerError`). `code`: the server's error code, OFFLINE,
/// or a state the app decides itself; `status`: the HTTP status (0 without an answer); `extra`: the fields the server
/// sent with it that the apps use (feature, missing, retryAfter, limit, resetAt, missingParts, tokens, estimateUsd,
/// needUsd, limitRequests, reason). `message` is the server's when it sent a non-empty string, else
/// `ServerMessages.errorMessage` (made from every field the server sent).
public struct ServerError: Error, LocalizedError, Equatable, CustomStringConvertible {
    public let code: String
    public let status: Int
    public let message: String
    public let extra: [String: JSONValue]

    /// The fields an error keeps (the JS constructor's list).
    public static let kept: Set<String> = ["feature", "missing", "retryAfter", "limit", "resetAt", "missingParts", "tokens",
                                           "estimateUsd", "needUsd", "limitRequests", "reason"]

    /// `fields`: what the server sent with the code (its error object, without `code`); `message` wins over
    /// fields["message"].
    public init(_ code: String, message: String? = nil, status: Int = 0, fields: [String: JSONValue] = [:]) {
        self.code = code
        self.status = status
        let given = message ?? fields["message"]?.string
        self.message = given.flatMap { $0.isEmpty ? nil : $0 } ?? ServerMessages.errorMessage(code, fields)
        extra = fields.filter { Self.kept.contains($0.key) && $0.value != .null }
    }

    public var errorDescription: String? { message }
    public var description: String { "ServerError(\(code)\(status == 0 ? "" : " \(status)")): \(message)" }

    public var feature: String? { extra["feature"]?.string }
    public var missing: JSONValue? { extra["missing"] }
    /// Seconds to wait before trying again, when the server said.
    public var retryAfter: Double? { extra["retryAfter"]?.number }
    public var reason: String? { extra["reason"]?.string }

    /// The error a server's answer makes, as the JS `request` reads it (10.4): an `error` object whose `code` is a
    /// server code (`ServerMessages.isServerCode`) gives that error (with the HTTP status, and its message only when it
    /// is a string); any other answer that is not 2xx gives BAD_AUTH (401) or SERVER_ERROR; a 2xx answer without such an
    /// error object gives nil.
    public static func from(status: Int, body: Data) -> ServerError? {
        let text = String(decoding: body, as: UTF8.self)
        let data = ShareText.jsTrim(text).isEmpty ? nil : JSONValue.parse(text)
        if let err = data?["error"]?.object, let code = err["code"]?.string, ServerMessages.isServerCode(code) {
            var fields = err
            fields["code"] = nil
            if fields["message"]?.string == nil { fields["message"] = nil }
            return ServerError(code, status: status, fields: fields)
        }
        guard (200..<300).contains(status) else {
            return ServerError(status == 401 ? "BAD_AUTH" : "SERVER_ERROR", status: status)
        }
        return nil
    }
}
