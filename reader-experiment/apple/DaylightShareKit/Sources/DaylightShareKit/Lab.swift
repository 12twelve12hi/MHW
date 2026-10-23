import Foundation

/// The Lab additions to Daylight Share (reader-experiment/share/LAB-PROTOCOL.md, normative), ported from the JavaScript
/// reference `share/js/daylight-lab.js` under the same names (LAB-PLAN 2.7.3). Everything here passes
/// `share/vectors/lab-vectors.json` (`LabVectorTests`).
///
/// Nothing changes the wire of protocol v1 (revision 1.1): `v` stays 1, Lab frames are ack frames whose `ids` is [],
/// and every v1.0 and v1.1 peer ignores them (LAB-PROTOCOL 2.1). Times: a state's `t` is Unix seconds; `poll`, `at`,
/// `heard` and `checkedIn` are milliseconds since 1970 (UTC), as in the vectors.
public enum Lab {
    public static let level = 1

    /// Capability tokens (2.2.2).
    public enum Caps {
        public static let st = "st"
        public static let tap = "tap"
        public static let readerLink = "reader-link"
        public static let capKind = "cap-kind"
        public static let readerDoc = "reader-doc"
        public static let quiet = "quiet"
        /// Every W0 and W1 token, in the reference's order.
        public static let all = [st, tap, readerLink, capKind, readerDoc, quiet]
    }

    /// Capability tokens kept for later waves (2.2.2): no W0 or W1 code sets or reads them.
    public static let reservedCaps = ["note", "dest", "hold", "lan", "return", "stack", "manifest", "control", "marks",
                                      "queue", "reading", "server"]
    /// The item states (2.2.3).
    public static let states = ["waiting", "held", "inbox", "handed", "failed", "queued", "reader"]
    public static let stateRank: [String: Int] = ["waiting": 1, "held": 2, "inbox": 2, "handed": 3, "failed": 3,
                                                  "queued": 4, "reader": 5]
    /// The states after which a row needs no faster checks (2.5).
    public static let settledStates = ["reader", "queued", "handed", "inbox", "failed", "held"]

    public static let maxStatesPerFrame = 24
    public static let maxStatesRead = 64
    public static let maxCaps = 16
    public static let appMax = 60
    public static let maxLevelWritten = 99
    /// The latest `t` a state may carry (2100-01-01).
    public static let tMax: Int64 = 4_102_444_800
    public static let helloEveryMs: Int64 = 11 * 3_600_000
    public static let stateDigestWindowMs: Int64 = 48 * 3_600_000
    public static let stateDigestMax = 48
    /// A publisher is fresh while its last message is at most this old (2.2.6).
    public static let inboxStaleMs: Int64 = 36 * 3_600_000
    public static let pendingMax = 500
    /// The ledger keeps the states of at most this many items after a prune (2.2.6) …
    public static let ledgerStatesMax = 200
    /// … and at most this many between prunes.
    public static let ledgerStatesHardMax = 1000
    public static let frameGapMs: Int64 = 30_000
    public static let framesPerDay = 30
    public static let yieldMs: Int64 = 3_600_000
    public static let offRepeatMs: Int64 = 48 * 3_600_000
    public static let offRepeats = 5
    public static let flushDelayMs: Int64 = 2_000
    /// The gate's deadline on a server's answer (1.5, 2.6).
    public static let gateDeadlineMs: Int64 = 5_000
    /// While a delivered row of the last 10 minutes has no settled state, a visible app reads acks this often (2.5).
    public static let fastCheckMs: Int64 = 30_000
    public static let fastCheckWindowMs: Int64 = 10 * 60_000
    /// F07's pass coming back online (`ShareSender.flushNetwork`): at most 30 frames and 18 MB of attachment frames …
    public static let flushMaxFrames = 30
    public static let flushMaxAttachmentBytes = 18_000_000
    /// … and passes at least 3 minutes apart, in which ntfy.sh's request bucket refills by 36 (2.7.1).
    public static let flushSpacing: TimeInterval = 180
    /// 9999-12-31T23:59:59.999Z: the latest time an ISO string with a 4-digit year holds.
    public static let maxISOms: Int64 = 253_402_300_799_999

    /// The publishers a sender keeps apart (2.2.6): the part of `app` before the first "/"; anything else is "other".
    public static let publishers = ["android", "reader-lab", "other"]
    /// Lab features (1.4) whose gate needs a capability of the Inbox (F17: in W0 and W1 only the timeline, `st`).
    public static let featureCaps: [String: String] = ["F01": Caps.st]
    /// Lab features that run on the Daylight server, by the server's feature key (2.6).
    public static let serverFeatures: [String: String] = ["F02": "files", "F37": "ai", "F19": "email", "F36": "feeds"]
    /// The server's feature keys (2.6), with the Lab feature each belongs to.
    public static let serverKeys: [String: String] = ["files": "F02", "ai": "F37", "pdf": "F37", "email": "F19",
                                                      "feeds": "F36", "deliver": "F37"]
    /// The features whose What's in Lab row has a Use switch (6.5 Q5): they change how sharing behaves.
    public static let useFeatures = ["F03", "F04", "F08", "F10", "F16", "F33"]

    /// A Lab feature (F02, F37, F19, F36) or a server key ("ai", "files", …) that runs on the Daylight server.
    public static func isServerFeature(_ feature: String) -> Bool {
        serverFeatures[feature] != nil || serverKeys[feature] != nil
    }

    /// The server key a feature asks the server about, or nil for a feature that does not use the server.
    public static func serverKey(_ feature: String) -> String? {
        serverFeatures[feature] ?? (serverKeys[feature] != nil ? feature : nil)
    }

    public static func rank(_ s: String?) -> Int { s.flatMap { stateRank[$0] } ?? 0 }

    /// The merge rule (2.2.6): `a` replaces `b` when there is no `b`, its rank is higher, or the same rank with a later
    /// `t`.
    public static func beats(_ a: LabState, _ b: LabState?) -> Bool {
        guard let b else { return true }
        return rank(a.s) > rank(b.s) || (rank(a.s) == rank(b.s) && a.t > b.t)
    }

    /// The publisher of an `app` (2.2.6): "android", "reader-lab" or "other".
    public static func publisher(of app: String?) -> String {
        let p = (app ?? "").split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return p == "android" || p == "reader-lab" ? p : "other"
    }

    /// 32 lowercase hex digits.
    public static func isID(_ s: String) -> Bool { Hex.isLowerHex(s, count: 32) }

    /// /^[a-z0-9-]{1,16}$/
    public static func isCap(_ s: String) -> Bool {
        let u = s.utf8
        return (1...16).contains(u.count) && u.allSatisfy { ($0 >= 0x61 && $0 <= 0x7A) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2D }
    }

    /// `app` as readers read it (2.2.5): a string made only of printable ASCII (U+0020 to U+007E) cut to 60 characters;
    /// anything else, non-ASCII included, is "".
    static func readApp(_ v: JSONValue?) -> String {
        guard let s = v?.string else { return "" }
        return readApp(s)
    }

    static func readApp(_ s: String) -> String {
        guard s.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value <= 0x7E }) else { return "" }
        return String(s.prefix(appMax)) // printable ASCII: one character is one code unit
    }

    /// `caps` as readers read them (2.2.5): of the first 16 elements, the strings that are tokens, without repeats (the
    /// first stays); anything that is not an array is [].
    static func readCaps(_ v: JSONValue?) -> [String] {
        guard let a = v?.array else { return [] }
        return readCaps(a.prefix(maxCaps).map { $0.string })
    }

    static func readCaps(_ v: [String?]) -> [String] {
        var out: [String] = []
        for c in v.prefix(maxCaps) {
            if let c, isCap(c), !out.contains(c) { out.append(c) }
        }
        return out
    }

    // MARK: Dates (rule D)

    private static func daysFromCivil(_ year: Int64, _ m: Int64, _ d: Int64) -> Int64 {
        let y = m <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    static func isLeap(_ y: Int64) -> Bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }

    static func monthDays(_ y: Int64, _ m: Int64) -> Int64 {
        [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Int(m) - 1]
    }

    /// `YYYY-MM-DDTHH:MM:SS(.f{1,3})?Z` with ASCII digits and valid fields (rule D: checked field by field, never with
    /// a platform date parser) -> ms since 1970 (UTC), else nil. A fraction of 1 or 2 digits is right-padded (.5 =
    /// 500 ms).
    public static func parseTime(_ v: JSONValue?) -> Int64? {
        guard let s = v?.string else { return nil }
        return parseTime(s)
    }

    public static func parseTime(_ s: String) -> Int64? {
        let u = Array(s.utf8)
        func digits(_ from: Int, _ count: Int) -> Int64? {
            guard from + count <= u.count else { return nil }
            var n: Int64 = 0
            for k in from..<(from + count) {
                let c = u[k]
                guard c >= 0x30 && c <= 0x39 else { return nil }
                n = n * 10 + Int64(c - 0x30)
            }
            return n
        }
        // 0123456789012345678
        // YYYY-MM-DDTHH:MM:SS
        guard u.count >= 20, u[4] == 0x2D, u[7] == 0x2D, u[10] == 0x54, u[13] == 0x3A, u[16] == 0x3A,
              let y = digits(0, 4), let mo = digits(5, 2), let d = digits(8, 2), let h = digits(11, 2),
              let mi = digits(14, 2), let se = digits(17, 2) else { return nil }
        var frac: Int64 = 0
        var k = 19
        if u[k] == 0x2E {
            k += 1
            var n = 0
            var f: Int64 = 0
            while k < u.count, u[k] >= 0x30 && u[k] <= 0x39 {
                guard n < 3 else { return nil }
                f = f * 10 + Int64(u[k] - 0x30)
                n += 1
                k += 1
            }
            guard n >= 1 else { return nil }
            for _ in n..<3 { f *= 10 }
            frac = f
        }
        guard k == u.count - 1, u[k] == 0x5A else { return nil }
        guard (1...12).contains(mo), d >= 1, d <= monthDays(y, mo), h <= 23, mi <= 59, se <= 59 else { return nil }
        return (daysFromCivil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + se) * 1_000 + frac
    }

    /// ms since 1970 -> "2026-10-20T07:59:58.000Z" (JavaScript `toISOString`, years 0000-9999).
    public static func isoTime(_ ms: Int64) -> String {
        let days = ms >= 0 ? ms / 86_400_000 : (ms - 86_399_999) / 86_400_000
        let msOfDay = ms - days * 86_400_000
        // civil_from_days (Howard Hinnant)
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
        var y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        if m <= 2 { y += 1 }
        func pad(_ n: Int64, _ w: Int) -> String {
            let s = String(n)
            return String(repeating: "0", count: max(0, w - s.count)) + s
        }
        let h = msOfDay / 3_600_000, mi = msOfDay / 60_000 % 60, se = msOfDay / 1_000 % 60, f = msOfDay % 1_000
        return "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))T\(pad(h, 2)):\(pad(mi, 2)):\(pad(se, 2)).\(pad(f, 3))Z"
    }
}

/// One item state (2.2.1, 2.2.3): item id `i` (32 lowercase hex), state token `s`, and `t`, when the Inbox reached it,
/// in Unix seconds.
public struct LabState: Equatable, Codable, Sendable {
    public let i: String
    public let s: String
    public let t: Int64

    public init(i: String, s: String, t: Int64) {
        self.i = i
        self.s = s
        self.t = t
    }

    /// A checked entry (for a frame), or ShareError("lab") with reason "entry".
    public static func checked(i: String, s: String, t: Int64) throws -> LabState {
        guard Lab.isID(i), Lab.stateRank[s] != nil, t >= 0, t <= Lab.tMax else {
            throw ShareError("lab", "bad state entry", reason: "entry")
        }
        return LabState(i: i, s: s, t: t)
    }

    var json: JSONOut { .object([("i", .string(i)), ("s", .string(s)), ("t", .int(Int(t)))]) }
}

/// The `x-inbox` object of a Lab frame (2.2.1), as a reader reads it (`LabFrame.parse`: `poll` in ms or nil) or as an
/// Inbox describes itself (`LabFrame.build` clamps it with `clamped()`).
public struct LabInboxInfo: Equatable, Sendable {
    /// The Lab level the Inbox speaks; 0 in the one frame sent when Lab is turned off.
    public var lab: Int
    /// "android/<versionName>" or "reader-lab/<versionName>".
    public var app: String
    public var caps: [String]
    /// When the Inbox last polled the inbox topic successfully, ms since 1970; nil when unknown.
    public var poll: Int64?
    /// Instant delivery has a connection open now.
    public var live: Bool

    public init(lab: Int = Lab.level, app: String = "", caps: [String] = [], poll: Int64? = nil, live: Bool = false) {
        self.lab = lab
        self.app = app
        self.caps = caps
        self.poll = poll
        self.live = live
    }

    /// The publisher this Inbox speaks as (2.2.6).
    public var publisher: String { Lab.publisher(of: app) }

    /// Clamped as readers read it (2.2.5; the JS `buildInboxInfo`): `lab` 0-99 (else ShareError("lab") with reason
    /// "lab"); `app` printable ASCII cut to 60 characters, anything else ""; `caps` the first 16 elements that are
    /// tokens, without repeats; `poll` left out unless it is a time from 1970 to 9999.
    public func clamped() throws -> LabInboxInfo {
        guard lab >= 0, lab <= Lab.maxLevelWritten else {
            throw ShareError("lab", "lab must be an integer from 0 to 99", reason: "lab")
        }
        let p = poll.flatMap { (0...Lab.maxISOms).contains($0) ? $0 : nil }
        return LabInboxInfo(lab: lab, app: Lab.readApp(app), caps: Lab.readCaps(caps), poll: p, live: live)
    }

    /// The `x-inbox` JSON, in the reference's order: lab, app, caps, poll (ISO 8601 UTC with ms; left out when
    /// unknown), live.
    public func json() throws -> JSONOut {
        let c = try clamped()
        var o: [(String, JSONOut)] = [("lab", .int(c.lab)), ("app", .string(c.app)), ("caps", .array(c.caps.map { .string($0) }))]
        if let p = c.poll { o.append(("poll", .string(Lab.isoTime(p)))) }
        o.append(("live", .bool(c.live)))
        return .object(o)
    }
}

/// What `LabFrame.parse` reads from an ack-topic header: the Inbox's hello (`inbox`, or nil) and its item `states`.
public struct LabAck: Equatable, Sendable {
    public let inbox: LabInboxInfo?
    public let states: [LabState]

    public init(inbox: LabInboxInfo?, states: [LabState]) {
        self.inbox = inbox
        self.states = states
    }

    public static let none = LabAck(inbox: nil, states: [])
}

/// Lab frames on the ack topic (2.2.1): hellos and item states, sealed exactly like acks.
public enum LabFrame {
    /// The header of a Lab frame, as `build` seals it: v, kind "ack", ids [], sent, from (when it is not empty after
    /// cleaning), x-inbox, and x-st when there are states.
    public static func header(inbox: LabInboxInfo, states: [LabState] = [], from: String = "",
                              sent: String = ShareText.isoTimestamp()) throws -> JSONOut {
        guard states.count <= Lab.maxStatesPerFrame else {
            throw ShareError("lab", "more than \(Lab.maxStatesPerFrame) states", reason: "too-many")
        }
        var o: [(String, JSONOut)] = [("v", .int(DLS.protocolVersion)), ("kind", .string("ack")), ("ids", .array([])),
                                      ("sent", .string(sent))]
        let f = ShareText.cleanName(from)
        if !f.isEmpty { o.append(("from", .string(f))) }
        let x = try inbox.json()
        o.append(("x-inbox", x))
        if !states.isEmpty {
            let entries = try states.map { try LabState.checked(i: $0.i, s: $0.s, t: $0.t).json }
            o.append(("x-st", .array(entries)))
        }
        return .object(o)
    }

    /// Builds a Lab frame (the JS `buildLabFrame`): sealed like an ack (the pairing key, AAD dlshare/v1/ack), `ids` [],
    /// `x-inbox` from `inbox` (clamped) and, when `states` is not empty, `x-st` (at most 24). A hello has no states.
    /// Throws ShareError("lab") with reason "too-many" (over 24 states), "entry" (a bad entry), "lab" (a level outside
    /// 0-99) or "not-small" (base64 over 3,800 characters).
    public static func build(keys: ShareKeys, inbox: LabInboxInfo, states: [LabState] = [], from: String = "",
                             sent: String = ShareText.isoTimestamp(), nonce: Data? = nil) throws -> Data {
        let h = try header(inbox: inbox, states: states, from: from, sent: sent)
        let frame = try Frame.seal(keys: keys, purpose: .ack, header: h, nonce: nonce)
        guard Frame.isSmall(frame.count) else { throw ShareError("lab", "a Lab frame must be a small frame", reason: "not-small") }
        return frame
    }

    /// Reads the Lab fields of an ack-topic header's JSON bytes (2.2.5, exactly; vectors > labParse). Never throws: a
    /// header that does not parse is step 1.
    public static func parse(json: Data) -> LabAck {
        parse(JSONValue.parse(json))
    }

    /// Reads the Lab fields of a parsed ack-topic header (2.2.5, exactly; vectors > labParse). Never throws.
    ///  1. Not an object, `kind` not "ack", or `ids` not an empty array -> nothing.
    ///  2. `x-inbox` an object whose `lab` is an integer (rule I): above `Lab.level` -> nothing at all (a later level is
    ///     unknown); below 0 -> no inbox; else the inbox, its fields clamped.
    ///  3. `x-st` an array: of its first 64 elements, the objects with a valid `i`, a known `s` and an integer `t` from
    ///     0 to 4102444800, in order, repeats included.
    public static func parse(_ header: JSONValue?) -> LabAck {
        guard let h = header?.object, h["kind"]?.string == "ack", let ids = h["ids"]?.array, ids.isEmpty else { return .none }
        var inbox: LabInboxInfo?
        if let x = h["x-inbox"]?.object, let level = x["lab"]?.wholeNumber {
            if level > Double(Lab.level) { return .none }
            if level >= 0 {
                inbox = LabInboxInfo(lab: Int(level), app: Lab.readApp(x["app"]), caps: Lab.readCaps(x["caps"]),
                                     poll: Lab.parseTime(x["poll"]), live: x["live"]?.bool == true)
            }
        }
        var states: [LabState] = []
        if let st = h["x-st"]?.array {
            for e in st.prefix(Lab.maxStatesRead) {
                guard let m = e.object, let i = m["i"]?.string, Lab.isID(i), let s = m["s"]?.string, Lab.stateRank[s] != nil,
                      let t = m["t"]?.wholeNumber, t >= 0, t <= Double(Lab.tMax) else { continue }
                states.append(LabState(i: i, s: s, t: Int64(t)))
            }
        }
        return LabAck(inbox: inbox, states: states)
    }
}
