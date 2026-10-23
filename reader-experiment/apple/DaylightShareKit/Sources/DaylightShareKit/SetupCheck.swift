import Foundation

/// Setup check's pure parts (LAB-PLAN F26; LAB-PROTOCOL 2.9.4): the test article, the activity log's events and lines,
/// and Copy diagnostics with `redact`, the JavaScript `testArticle`, `activityEvent`, `appendActivity`, `activityLine`,
/// `diagnosticsReport` and `redactDiagnostics`, pinned by lab-vectors.json › testArticle and › diagnostics. Titles,
/// names, URLs and `from` never go into the log; diagnostics go through `redact` as a whole.
public enum SetupCheck {
    /// The test article's URLs: `https://daylight.invalid/test/<id>` (the server's convention for URLs that never
    /// resolve, so the Reader neither fetches it again nor keeps only a link).
    public static let testURLPrefix = "https://daylight.invalid/test/"
    /// The activity log keeps this many events …
    public static let activityMax = 200
    /// … and diagnostics carry the last this many.
    public static let diagnosticsEvents = 50

    // MARK: The test article

    /// "Send a test article" (F26): a page of about 400 words (LAB_TEXT.testArticle) with `x-cap: "test"`.
    public struct TestArticle: Equatable, Sendable {
        public let id: String
        public let url: String
        public let title: String
        public let content: String
        public let extras: [String: String]

        /// What `ShareSender.send` takes (kind page, this id, so Setup check can follow the row).
        public var input: ItemInput {
            var i = ItemInput.page(html: content, url: url, title: title)
            i.id = id
            i.extras = extras
            return i
        }
    }

    /// The test article for `device` ("Test article from {device}"; "Send to Daylight" without a name). Throws
    /// ShareError("id") for an id that is not 32 lowercase hex digits.
    public static func testArticle(id: String = ItemBuilder.newID(), device: String? = "") throws -> TestArticle {
        guard Lab.isID(id) else { throw ShareError("id", "bad item id") }
        let name = ShareText.cleanName(device)
        let title = ShareText.cleanTitle(LabText.fill(LabText["testArticle.title"],
                                                      ["device": name.isEmpty ? LabText.appName("web") : name]))
        let paras = (1...6).map { "<p>\(JSText.escapeText(LabText["testArticle.p\($0)"]))</p>" }.joined()
        let content = "<!doctype html><html><head><meta charset=\"utf-8\"><title>\(JSText.escapeText(title))</title>"
            + "<meta name=\"dl:capture\" content=\"test\"></head><body><article><h1>"
            + JSText.escapeText(LabText["testArticle.heading"]) + "</h1>\(paras)</article></body></html>"
        return TestArticle(id: id, url: testURLPrefix + id, title: title, content: content, extras: ["x-cap": "test"])
    }

    // MARK: Redaction

    typealias Scalars = JSText.Scalars

    /// One global replace, as `String.prototype.replace` with a `g` pattern does it: `match(s, i)` gives the end of a
    /// match starting at `i` (never at `i` itself), or nil; each match becomes `with`, and the scan goes on after it.
    static func replaceAll(_ s: Scalars, _ with: String, _ match: (Scalars, Int) -> Int?) -> Scalars {
        var out: Scalars = []
        out.reserveCapacity(s.count)
        var i = 0
        while i < s.count {
            if let e = match(s, i), e > i {
                out.append(contentsOf: with.unicodeScalars)
                i = e
            } else {
                out.append(s[i])
                i += 1
            }
        }
        return out
    }

    /// JavaScript `\b` before a word character at `i`: none before it.
    static func wordStart(_ s: Scalars, _ i: Int) -> Bool { i == 0 || !JSText.isWordChar(s[i - 1]) }

    /// JavaScript `\b` after a word character ending at `e`: none after it.
    static func wordEnd(_ s: Scalars, _ e: Int) -> Bool { e >= s.count || !JSText.isWordChar(s[e]) }

    static func isStop(_ u: Unicode.Scalar) -> Bool { JSText.isWS(u) || u == "\"" || u == "'" || u == "<" || u == ">" }

    static func isSchemeChar(_ u: Unicode.Scalar) -> Bool { JSText.isASCIIAlnum(u) || u == "+" || u == "." || u == "-" }

    static func isBase32(_ u: Unicode.Scalar) -> Bool {
        JSText.isASCIILetter(u) || (u.value >= 0x32 && u.value <= 0x37)
    }

    /// Removes what diagnostics must never carry (F26), in this order (LAB-PROTOCOL 2.9.4):
    /// 1. `daylightserver://` (any case) and what follows up to whitespace, `"`, `'`, `<` or `>` → "[server code]";
    /// 2. `SERVER-` (at a word boundary) and the run of `A-Z a-z 0-9 -` after it → "[server code]";
    /// 3. a scheme (the whole run of `A-Z a-z 0-9 + . -` before `://`, possibly empty) + `://` + what follows up to the
    ///    same stops → "[url]";
    /// 4. `www.` (any case, at a word boundary) + at least one character up to the same stops → "[url]";
    /// 5. `dls-` + 32 hex (any case, word boundaries) → "[topic]";
    /// 6. 4 base32 characters and six groups of an optional `-` and 4 more (any case, word boundaries) → "[code]".
    public static func redact(_ text: String?) -> String {
        var s = JSText.scalars(text)
        func run(_ s: Scalars, from: Int, while ok: (Unicode.Scalar) -> Bool) -> Int {
            var e = from
            while e < s.count && ok(s[e]) { e += 1 }
            return e
        }
        s = replaceAll(s, "[server code]") { s, i in
            JSText.hasCI(s, at: i, "daylightserver://") ? run(s, from: i + 17) { !isStop($0) } : nil
        }
        s = replaceAll(s, "[server code]") { s, i in
            guard wordStart(s, i), JSText.has(s, at: i, "SERVER-") else { return nil }
            let e = run(s, from: i + 7) { JSText.isASCIIAlnum($0) || $0 == "-" }
            return e > i + 7 ? e : nil
        }
        s = replaceAll(s, "[url]") { s, i in
            guard i == 0 || !isSchemeChar(s[i - 1]) else { return nil }
            let r = run(s, from: i, while: isSchemeChar)
            guard JSText.has(s, at: r, "://") else { return nil }
            return run(s, from: r + 3) { !isStop($0) }
        }
        s = replaceAll(s, "[url]") { s, i in
            guard wordStart(s, i), JSText.hasCI(s, at: i, "www.") else { return nil }
            let e = run(s, from: i + 4) { !isStop($0) }
            return e > i + 4 ? e : nil
        }
        s = replaceAll(s, "[topic]") { s, i in
            guard wordStart(s, i), JSText.hasCI(s, at: i, "dls-"), i + 36 <= s.count,
                  s[(i + 4)..<(i + 36)].allSatisfy(JSText.isHex), wordEnd(s, i + 36) else { return nil }
            return i + 36
        }
        s = replaceAll(s, "[code]") { s, i in
            guard wordStart(s, i) else { return nil }
            func four(_ at: Int) -> Bool { at + 4 <= s.count && s[at..<(at + 4)].allSatisfy(isBase32) }
            guard four(i) else { return nil }
            var e = i + 4
            for _ in 0..<6 {
                if e < s.count, s[e] == "-", four(e + 1) {
                    e += 5
                } else if four(e) {
                    e += 4
                } else {
                    return nil
                }
            }
            return wordEnd(s, e) ? e : nil
        }
        return JSText.string(s)
    }

    // MARK: The activity log

    /// An activity log entry (F26): when (ms), what happened, the item id's first 8 characters, the kind, the status
    /// ("failed/full") and the HTTP status of the row's last failed publish (0: none). Nothing else, ever.
    public struct ActivityEvent: Codable, Equatable, Sendable {
        public var time: Int64
        public var type: String
        public var id8: String
        public var kind: String
        public var status: String
        public var http: Int

        public init(time: Int64, type: String, id: String = "", kind: String = "", status: String = "", http: Int = 0) {
            self.time = time
            self.type = type
            id8 = String(String.UnicodeScalarView(id.unicodeScalars.prefix(8)))
            self.kind = kind
            self.status = status
            self.http = http
        }

        /// An event about an outbox row: its kind, its status as `rowStatus` gives it ("failed/full") and its `http`.
        public init(time: Int64, type: String, row: OutboxRow) {
            self.init(time: time, type: type, id: row.id, kind: row.kind.rawValue,
                      status: SetupCheck.rowStatus(row.status, errorCode: row.errorCode), http: row.http)
        }

        private enum CodingKeys: String, CodingKey { case time, type, id8, kind, status, http }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            time = try c.decodeIfPresent(Int64.self, forKey: .time) ?? 0
            type = try c.decodeIfPresent(String.self, forKey: .type) ?? ""
            id8 = try c.decodeIfPresent(String.self, forKey: .id8) ?? ""
            kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
            status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
            http = try c.decodeIfPresent(Int.self, forKey: .http) ?? 0
        }

        /// "{ISO time} {type} {id8} {kind} {status} {http}", `-` for an empty field (and for `http` 0).
        public var line: String {
            [Lab.isoTime(time), type, id8, kind, status, http == 0 ? "" : String(http)]
                .map { $0.isEmpty ? "-" : $0 }.joined(separator: " ")
        }
    }

    /// A row's status for the log: "{status}/{errorCode}", or the status alone without an error code.
    public static func rowStatus(_ status: OutboxRow.Status, errorCode: String) -> String {
        errorCode.isEmpty ? status.rawValue : "\(status.rawValue)/\(errorCode)"
    }

    /// The log with `event` appended, keeping the last 200.
    public static func appendActivity(_ log: [ActivityEvent], _ event: ActivityEvent) -> [ActivityEvent] {
        Array((log + [event]).suffix(activityMax))
    }

    // MARK: Copy diagnostics

    /// "Copy diagnostics" (F26): the app and version, platform, Lab on or off, the caps seen, the last check-in (ISO
    /// time and how long ago, or "never"), the outbox's counts by status, the relay as "ntfy.sh" or "custom relay", and
    /// the last 50 events, oldest first, all through `redact`.
    public static func diagnosticsReport(app: String, version: String, platform: String, lab: Bool, caps: [String],
                                         checkedIn: Int64?, rows: [OutboxRow.Status], relay: String,
                                         log: [ActivityEvent], now: Int64) -> String {
        func t(_ id: String) -> String { LabText["diagnostics.\(id)"] }
        let ntfy = (try? ShareText.normalizeRelay(relay)) == DLS.defaultRelay
        let counts = [OutboxRow.Status.sending, .sent, .delivered, .failed, .expired]
            .map { st in "\(st.rawValue) \(rows.filter { $0 == st }.count)" }.joined(separator: " · ")
        let check = checkedIn.map { "\(Lab.isoTime($0)) (\(LabText.relativeTime($0, now: now)))" } ?? t("never")
        let events = log.suffix(diagnosticsEvents).map(\.line)
        let lines = [
            t("heading"),
            LabText.fill(t("app"), ["app": app, "version": version, "platform": platform]),
            LabText.fill(t("lab"), ["state": lab ? t("on") : t("off")]),
            LabText.fill(t("caps"), ["caps": caps.isEmpty ? t("noCaps") : caps.joined(separator: ", ")]),
            LabText.fill(t("checkedIn"), ["time": check]),
            LabText.fill(t("outbox"), ["counts": counts]),
            LabText.fill(t("relay"), ["relay": ntfy ? t("relayNtfy") : t("relayCustom")]),
            t("events"),
        ] + (events.isEmpty ? [t("noEvents")] : events)
        return redact(lines.joined(separator: "\n") + "\n")
    }
}

extension LabText {
    /// The line under a DC-1 Inbox row's title (F03; the JS `inboxKindLine`): "Page as you saw it", "Clean article",
    /// "Excerpt", "Test article", "Link (the Reader downloads it)" or "Document · {MB} MB", then " · from {from}". An
    /// unknown `x-cap` counts as none. (The Inbox's; the Apple apps show the timeline instead.)
    public static func inboxKindLine(kind: ItemKind, extras: [String: String] = [:], size: Int = 0, from: String? = "") -> String {
        let cap = extras["x-cap"].flatMap { ItemHeader.xCapValues.contains($0) ? $0 : nil }
        var line: String
        if cap == "excerpt" {
            line = self["kindLine.excerpt"]
        } else if cap == "test" {
            line = self["kindLine.test"]
        } else if kind == .url {
            line = self["kindLine.link"]
        } else if kind == .page {
            line = self[cap == "clean" ? "kindLine.clean" : "kindLine.seen"]
        } else {
            line = fill(self["kindLine.document"], ["mb": ShareText.formatMB(size)])
        }
        let f = ShareText.cleanName(from)
        if !f.isEmpty { line += fill(self["kindLine.from"], ["from": f]) }
        return line
    }

    /// "Cleaned from {host}" for an item's `x-orig` (2.3; the host and port, lowercased, as text), or nil without a
    /// valid one.
    public static func cleanedFromText(_ orig: String?) -> String? {
        guard let u = ShareText.webURL(orig) else { return nil }
        return fill(self["cleanedFrom"], ["host": JSText.urlParts(u).hostport.lowercased()])
    }
}
