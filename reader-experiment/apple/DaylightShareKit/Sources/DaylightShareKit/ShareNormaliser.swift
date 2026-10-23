import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Smart intake (LAB-PLAN F16, F11's link-or-excerpt rule; LAB-PROTOCOL 2.9.1): the JavaScript `normaliseShare`,
/// `classifyShare`, `cleanShareUrl`, `findShareUrl`, `shareTitle`, `isAppleNewsUrl` and `extractAppleNewsTarget`, rule
/// for rule, pinned by `share/vectors/normalise.json` and lab-vectors.json › labExcerpt › classify. Pure: no URL parser,
/// and no network except `normaliseFetchingAppleNews`, the one fetch F16 step 5 allows iPhone and Mac.
///
/// Every share entry point runs it while Lab is on, with F16's Use switch as `clean`:
/// `ShareNormaliser.normalise(text:url:subject:source:clean: LabText.useOn(…, feature: "F16"))`. Text becomes an excerpt
/// only from an explicit selection (6.5 Q1 = b: `source` "selection"); every "headline + link" share stays a link
/// with the headline as its title, and text with no link at all is a note (LAB-DECISIONS, Oct 23).
public enum ShareNormaliser {
    /// `source` for an explicit selection: a Safari share's `selectionText`, or the Options choice "Send as excerpt".
    public static let sourceSelection = "selection"

    /// What `classify` and `normalise` decide.
    public enum Kind: String, Equatable, Sendable {
        case link, excerpt, note, none
    }

    /// A URL found in shared text, with its place there in code points (`start` inclusive, `end` exclusive).
    public struct Found: Equatable, Sendable {
        public let url: String
        public let start: Int
        public let end: Int
    }

    /// `classify`'s answer: the kind, the URL (or nil) and the text without its URL, trimmed.
    public struct Classified: Equatable, Sendable {
        public let kind: Kind
        public let url: String?
        public let text: String
    }

    /// `normalise`'s answer. `url`: cleaned (nil for a note or none); `title`: links only, else nil; `excerpt`: the text
    /// of an excerpt or a note, else nil; `orig`: the URL as shared when the cleaned one differs and it is at most 1,024
    /// characters: send it as `x-orig` (`extras`), which the item builder also leaves out when it would make a small
    /// frame large (LAB-PROTOCOL 2.9.2).
    public struct Result: Equatable, Sendable {
        public let kind: Kind
        public let url: String?
        public let title: String?
        public let excerpt: String?
        public let orig: String?

        public init(kind: Kind, url: String?, title: String?, excerpt: String?, orig: String?) {
            self.kind = kind
            self.url = url
            self.title = title
            self.excerpt = excerpt
            self.orig = orig
        }

        /// The Lab header fields this share asks for: `x-orig` when `orig` is set (`ItemInput.extras`).
        public var extras: [String: String] { orig.map { ["x-orig": $0] } ?? [:] }
    }

    /// Tracking parameters removed from every URL (F16 step 4); every `utm_*` goes too.
    public static let trackingParams = ["fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "mc_cid", "mc_eid",
                                        "igshid", "igsh", "yclid", "twclid", "ttclid", "_hsenc", "_hsmi", "mkt_tok",
                                        "ref_src", "ref_url", "__s", "sr_share"]

    /// Tracking parameters removed on some sites only: `domains` match a host that is one of them or ends in "." + one;
    /// `subdomainsOf` matches a host that ends in "." + it.
    struct SiteRule {
        let domains: [String]
        let subdomainsOf: String?
        let params: [String]
    }

    static let trackingBySite = [
        SiteRule(domains: ["youtube.com", "youtu.be", "open.spotify.com"], subdomainsOf: nil, params: ["si"]),
        SiteRule(domains: ["twitter.com", "x.com"], subdomainsOf: nil, params: ["s", "t"]),
        SiteRule(domains: ["nytimes.com"], subdomainsOf: nil, params: ["smid", "smtyp"]),
        SiteRule(domains: [], subdomainsOf: "substack.com", params: ["r", "triedRedirect", "showWelcome"]),
    ]

    typealias Scalars = JSText.Scalars

    // MARK: Finding the URL (step 1)

    static let urlTrail = Array(".,;:!?'\"»”’".unicodeScalars)

    /// F16 step 1: the first http(s) URL in shared text. Each run of characters other than whitespace, `<`, `>` and `"`
    /// that starts with http:// or https:// (any case), in order, loses its trailing `. , ; : ! ? ' " » ” ’`, and a
    /// trailing `)` or `]` while the run holds fewer `(` than `)` (`[` than `]`), until none applies; the first that
    /// then passes the web URL rule unchanged is the URL. nil when there is none.
    public static func findShareURL(_ text: String?) -> Found? {
        let s = JSText.scalars(text)
        let n = s.count
        func inRun(_ u: Unicode.Scalar) -> Bool { !JSText.isWS(u) && u != "<" && u != ">" && u != "\"" }
        var p = 0
        while p < n {
            // /https?:\/\/[^\s<>"]+/gi at p
            guard JSText.hasCI(s, at: p, "http") else {
                p += 1
                continue
            }
            var j = p + 4
            if j < n && JSText.lowerASCII(s[j]) == "s" && JSText.has(s, at: j + 1, "://") {
                j += 4
            } else if JSText.has(s, at: j, "://") {
                j += 3
            } else {
                p += 1
                continue
            }
            var e = j
            while e < n && inRun(s[e]) { e += 1 }
            guard e > j else {
                p += 1
                continue
            }
            let run = s[p..<e]
            let open = run.filter { $0 == "(" }.count
            var close = run.filter { $0 == ")" }.count
            let openB = run.filter { $0 == "[" }.count
            var closeB = run.filter { $0 == "]" }.count
            var end = e
            while end > p {
                let c = s[end - 1]
                if urlTrail.contains(c) {
                    end -= 1
                } else if c == ")" && open < close {
                    close -= 1
                    end -= 1
                } else if c == "]" && openB < closeB {
                    closeB -= 1
                    end -= 1
                } else {
                    break
                }
            }
            let u = JSText.string(s[p..<end])
            if let w = ShareText.webURL(u), JSText.same(w, u) { return Found(url: u, start: p, end: end) }
            p = e
        }
        return nil
    }

    // MARK: Text fragments

    /// True when the URL's fragment holds a text directive (`:~:text=`), as Chrome on Android shares a selection.
    public static func hasTextFragment(_ url: String?) -> Bool {
        let u = JSText.scalars(url)
        guard let h = JSText.index(of: "#", in: u) else { return false }
        return JSText.index(of: ":~:text=", in: u, from: h) != nil
    }

    /// The URL without its fragment directive (from `:~:` on), and without the `#` when nothing is left before it.
    public static func withoutTextFragment(_ url: String?) -> String {
        let u = JSText.scalars(url)
        guard let h = JSText.index(of: "#", in: u), let k = JSText.index(of: ":~:", in: u, from: h) else { return url ?? "" }
        return JSText.string(u[..<(k == h + 1 ? h : k)])
    }

    /// The quoted text of a URL's first text directive: its start and end (a prefix- and a -suffix left out when more
    /// than one part is left), each percent-decoded (left as it is when that fails) and trimmed, empty parts dropped,
    /// joined with " … ". "" when there is none.
    public static func textFragmentText(_ url: String?) -> String {
        let u = JSText.scalars(url)
        guard let h = JSText.index(of: "#", in: u), let k = JSText.index(of: ":~:", in: u, from: h) else { return "" }
        let directives = JSText.string(u[(k + 3)...]).unicodeScalars.split(separator: "&", omittingEmptySubsequences: false)
        guard let d = directives.first(where: { $0.starts(with: "text=".unicodeScalars) }) else { return "" }
        var parts = d.dropFirst(5).split(separator: ",", omittingEmptySubsequences: false).map { JSText.string($0) }
        if parts.count > 1, JSText.endsWith(parts[0], "-") { parts.removeFirst() }
        if parts.count > 1, JSText.startsWith(parts[parts.count - 1], "-") { parts.removeLast() }
        return parts.map { JSText.trim(JSText.decodeURIComponent($0) ?? $0) }.filter { !$0.isEmpty }.joined(separator: " … ")
    }

    static let quotePairs: [(String, String)] = [("\"", "\""), ("“", "”"), ("'", "'"), ("‘", "’"), ("«", "»"), ("„", "“")]

    /// Removes one pair of quotes around the whole text ("…", “…”, '…', ‘…’, «…», „…“), then trims.
    static func unquote(_ s: String) -> String {
        let u = JSText.scalars(s)
        for (a, b) in quotePairs where u.count >= 2 && JSText.startsWith(s, a) && JSText.endsWith(s, b) {
            return JSText.trim(JSText.string(u[1..<(u.count - 1)]))
        }
        return s
    }

    // MARK: Link or excerpt (step 2)

    /// Link or excerpt (F11 with 6.5 Q1 = b; LAB-PROTOCOL 2.9.1 step 2). The URL is `url` when it passes the web URL
    /// rule, else the first one in `text`; the rest is the text without the found URL, trimmed (a selection given with
    /// its page's `url` loses the URL found in it only when that is the page URL). Then: `source` "selection" → an
    /// excerpt of the rest (a note without a URL, a link when nothing is left, none without either), where with a
    /// text-fragment URL one pair of quotes is removed and an empty rest is the fragment's own text; no URL → a note
    /// (none when empty); everything else → a link with the rest as its title. `title` is unused under 6.5 Q1 = b.
    public static func classify(text: String? = "", url: String? = "", title: String? = "", source: String? = "") -> Classified {
        let t = text ?? ""
        let found = findShareURL(t)
        let given = (url ?? "").isEmpty ? nil : ShareText.webURL(url)
        let u = given ?? found?.url
        let selection = source == sourceSelection
        var take = found != nil
        if selection, let given, let found, !JSText.same(found.url, given) { take = false }
        let rest: String
        if take, let found {
            let s = JSText.scalars(t)
            rest = JSText.trim(JSText.string(s[..<found.start]) + JSText.string(s[found.end...]))
        } else {
            rest = JSText.trim(t)
        }
        if selection {
            var quote = rest
            if let u, hasTextFragment(u) {
                quote = unquote(rest)
                if quote.isEmpty { quote = textFragmentText(u) }
            }
            if !quote.isEmpty { return Classified(kind: u != nil ? .excerpt : .note, url: u, text: quote) }
            return u != nil ? Classified(kind: .link, url: u, text: "") : Classified(kind: .none, url: nil, text: "")
        }
        guard let u else {
            return rest.isEmpty ? Classified(kind: .none, url: nil, text: "") : Classified(kind: .note, url: nil, text: rest)
        }
        return Classified(kind: .link, url: u, text: rest)
    }

    // MARK: Cleaning (step 3)

    static func paramName(_ piece: String) -> String {
        let u = JSText.scalars(piece)
        guard let eq = JSText.index(of: "=", in: u) else { return piece }
        return JSText.string(u[..<eq])
    }

    static func split(_ s: String, _ c: Unicode.Scalar) -> [String] {
        s.unicodeScalars.split(separator: c, omittingEmptySubsequences: false).map { JSText.string($0) }
    }

    /// The first parameter named exactly `name`, percent-decoded as UTF-8 ('+' stays '+'), or nil (also when invalid).
    static func queryParam(_ query: String?, _ name: String) -> String? {
        guard let query else { return nil }
        for piece in split(query, "&") where JSText.same(paramName(piece), name) {
            let u = JSText.scalars(piece)
            let value = JSText.index(of: "=", in: u).map { JSText.string(u[($0 + 1)...]) } ?? ""
            return JSText.decodeURIComponent(value)
        }
        return nil
    }

    /// `/^(?:www\.)?google(?:\.[a-z]{2,3}){1,2}$/` on the lowercased host.
    static func isGoogleHost(_ host: String) -> Bool {
        var h = JSText.scalars(host)[...]
        if JSText.startsWith(host, "www.") { h = h.dropFirst(4) }
        guard h.starts(with: "google".unicodeScalars) else { return false }
        let suffix = Array(h.dropFirst(6))
        guard suffix.first == "." else { return false }
        let groups = suffix.dropFirst().split(separator: ".", omittingEmptySubsequences: false)
        return (1...2).contains(groups.count)
            && groups.allSatisfy { g in (2...3).contains(g.count) && g.allSatisfy { $0.value >= 0x61 && $0.value <= 0x7A } }
    }

    /// One unwrap step of F16 step 3, or nil. The caller checks the result with the web URL rule.
    static func unwrapOnce(_ u: String) -> String? {
        let p = JSText.urlParts(u)
        let path = JSText.scalars(p.path)
        func tail(_ from: Int) -> String {
            JSText.string(path[min(from, path.count)...]) + (p.query.map { "?" + $0 } ?? "") + (p.fragment.map { "#" + $0 } ?? "")
        }
        func firstValid(_ vs: String?...) -> String? { vs.first { $0 != nil && ShareText.webURL($0) != nil } ?? nil }
        let host = p.host
        if isGoogleHost(host) {
            if JSText.startsWith(p.path, "/amp/s/") { return "https://" + tail(7) }
            if JSText.same(p.path, "/url") { return firstValid(queryParam(p.query, "q"), queryParam(p.query, "url")) }
        }
        if JSText.endsWith(host, ".cdn.ampproject.org") {
            if JSText.startsWith(p.path, "/c/s/") || JSText.startsWith(p.path, "/v/s/") { return "https://" + tail(5) }
            if JSText.startsWith(p.path, "/c/") { return "http://" + tail(3) }
        }
        if (JSText.same(host, "l.facebook.com") || JSText.same(host, "lm.facebook.com")) && JSText.same(p.path, "/l.php") {
            return queryParam(p.query, "u")
        }
        if JSText.same(host, "l.instagram.com") && (p.path.isEmpty || JSText.same(p.path, "/")) {
            return queryParam(p.query, "u")
        }
        if (JSText.same(host, "www.linkedin.com") || JSText.same(host, "linkedin.com"))
            && (JSText.same(p.path, "/safety/go") || JSText.same(p.path, "/safety/go/")) {
            return queryParam(p.query, "url")
        }
        if JSText.same(host, "open.substack.com") {
            // /^\/pub\/([A-Za-z0-9-]+)\/p\/([^/]+)(\/.*)?$/
            guard JSText.has(path, at: 0, "/pub/") else { return nil }
            var j = 5
            while j < path.count && (JSText.isASCIIAlnum(path[j]) || path[j] == "-") { j += 1 }
            let pub = JSText.string(path[5..<j])
            guard j > 5, JSText.has(path, at: j, "/p/") else { return nil }
            let slugStart = j + 3
            var k = slugStart
            while k < path.count && path[k] != "/" { k += 1 }
            guard k > slugStart else { return nil }
            return "https://\(pub.lowercased()).substack.com/p/" + JSText.string(path[slugStart...]) + tail(path.count)
        }
        return nil
    }

    static func isTracking(_ name: String, host: String) -> Bool {
        if JSText.startsWith(name, "utm_") || trackingParams.contains(where: { JSText.same($0, name) }) { return true }
        for r in trackingBySite {
            let site = r.subdomainsOf.map { JSText.endsWith(host, "." + $0) } ?? r.domains.contains { JSText.hostIs(host, $0) }
            if site && r.params.contains(where: { JSText.same($0, name) }) { return true }
        }
        return false
    }

    /// F16 step 4: removes tracking parameters. Nothing else changes; a URL with none to remove comes back unchanged.
    static func stripTracking(_ u: String) -> String {
        let p = JSText.urlParts(u)
        guard let query = p.query else { return u }
        let pieces = split(query, "&")
        let keep = pieces.filter { !isTracking(paramName($0), host: p.host) }
        if keep.count == pieces.count { return u }
        let q = keep.filter { !$0.isEmpty }.joined(separator: "&")
        return p.joined(query: q.isEmpty ? nil : q)
    }

    /// F16 steps 3 and 4 on a URL that passes the web URL rule: unwrap redirectors without the network (Google AMP and
    /// /url, the AMP cache, Facebook, Instagram, LinkedIn, open.substack.com; at most 5 steps, each result checked with
    /// the web URL rule), then remove tracking parameters. The cleaned URL (the input itself when nothing applies), or
    /// nil for an input that is not a web URL.
    public static func cleanShareURL(_ url: String?) -> String? {
        guard var cur = ShareText.webURL(url) else { return nil }
        for _ in 0..<5 {
            guard let next = unwrapOnce(cur), let ok = ShareText.webURL(next), !JSText.same(ok, cur) else { break }
            cur = ok
        }
        return stripTracking(cur)
    }

    // MARK: Titles (step 4)

    static let emptyPairs: [Unicode.Scalar: Unicode.Scalar] = ["(": ")", "[": "]", "<": ">", "\"": "\"", "“": "”",
                                                               "‘": "’", "«": "»"]
    static let titleEdge = Array(" -–—:|·\"'“”‘’«»„".unicodeScalars)
    static let titlePunct = Array(".,;!?".unicodeScalars)

    /// A title from shared text whose URL was taken out: the empty pairs a URL leaves behind, () [] <> "" “” ‘’ «» (with
    /// only whitespace inside), become a space; whitespace is collapsed; then, until none applies, whitespace, - – — : |
    /// · and quotes are trimmed from both ends, . , ; ! ? from the start, and . , ; ! ? from the end when a space comes
    /// before them; then `ShareText.cleanTitle`.
    public static func shareTitle(_ text: String?) -> String {
        let src = JSText.scalars(text)
        var paired: Scalars = []
        var i = 0
        while i < src.count {
            if let closer = emptyPairs[src[i]] {
                var k = i + 1
                while k < src.count && JSText.isWS(src[k]) { k += 1 }
                if k < src.count && src[k] == closer {
                    paired.append(" ")
                    i = k + 1
                    continue
                }
            }
            paired.append(src[i])
            i += 1
        }
        let s = JSText.scalars(JSText.collapse(JSText.string(paired)))
        var a = 0
        var b = s.count
        var moved = true
        while moved {
            moved = false
            while a < b && (titleEdge.contains(s[a]) || titlePunct.contains(s[a])) {
                a += 1
                moved = true
            }
            while b > a && titleEdge.contains(s[b - 1]) {
                b -= 1
                moved = true
            }
            var k = b
            while k > a && titlePunct.contains(s[k - 1]) { k -= 1 }
            if k < b && k > a && s[k - 1] == " " {
                b = k
                moved = true
            }
        }
        return ShareText.cleanTitle(JSText.string(s[a..<b]))
    }

    // MARK: normaliseShare

    /// Smart intake (F16), for every entry point while Lab is on. The kind and the URL come from `classify`; the URL is
    /// `cleanShareURL`'s result, or exactly as found or given when `clean` is false (F16's Use switch off, 2.9.6: then
    /// `orig` is nil too). A link's title is `subject` when it is not empty, else the text without its URL
    /// (`shareTitle`); a headline is always a title, however long. Apple News links stay as they are here
    /// (`normaliseFetchingAppleNews` resolves them).
    public static func normalise(text: String? = "", url: String? = "", subject: String? = "", source: String? = "",
                                 clean: Bool = true) -> Result {
        let c = classify(text: text, url: url, title: subject, source: source)
        var outURL: String?
        var orig: String?
        if let cu = c.url {
            let cleaned = clean ? (cleanShareURL(cu) ?? cu) : cu
            outURL = cleaned
            if !JSText.same(cleaned, cu) && cu.utf16.count <= ItemHeader.xOrigMax { orig = cu }
        }
        switch c.kind {
        case .excerpt, .note:
            return Result(kind: c.kind, url: outURL, title: nil, excerpt: c.text, orig: orig)
        case .link:
            var title = ShareText.cleanTitle(subject)
            if title.isEmpty { title = shareTitle(c.text) }
            return Result(kind: .link, url: outURL, title: title.isEmpty ? nil : title, excerpt: nil, orig: orig)
        case .none:
            return Result(kind: .none, url: outURL, title: nil, excerpt: nil, orig: orig)
        }
    }

    // MARK: Apple News (step 5)

    /// True for an Apple News link (apple.news or a subdomain): iPhone and Mac resolve these (F16 step 5).
    public static func isAppleNewsURL(_ url: String?) -> Bool {
        guard let u = ShareText.webURL(url) else { return false }
        return JSText.hostIs(JSText.urlParts(u).host, "apple.news")
    }

    /// The string argument of the first `redirectToUrlAfterTimeout(` + optional whitespace + a quoted string (a
    /// backslash escapes any character inside it), or nil when no such call is complete: the reference's
    /// `/redirectToUrlAfterTimeout\(\s*(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1/`, scanned linearly.
    static func redirectArgument(_ s: Scalars) -> Scalars? {
        var from = 0
        while let at = JSText.index(of: "redirectToUrlAfterTimeout(", in: s, from: from) {
            from = at + 1
            var i = at + 26
            while i < s.count && JSText.isWS(s[i]) { i += 1 }
            guard i < s.count, s[i] == "\"" || s[i] == "'" else { continue }
            let q = s[i]
            var j = i + 1
            while j < s.count {
                if s[j] == "\\" {
                    if j + 1 >= s.count { break }
                    j += 2
                } else if s[j] == q {
                    return Array(s[(i + 1)..<j])
                } else {
                    j += 1
                }
            }
        }
        return nil
    }

    /// JavaScript string escapes undone (`/\\(u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[\s\S])/g`): `\uXXXX` and `\xXX` become
    /// that UTF-16 code unit (a pair of surrogates one character; a lone one U+FFFD), any other `\c` becomes `c`.
    static func unescapeJS(_ s: Scalars) -> String {
        var units: [UInt16] = []
        func hexValue(_ from: Int, _ count: Int) -> UInt16? {
            guard from + count <= s.count, s[from..<(from + count)].allSatisfy(JSText.isHex) else { return nil }
            return UInt16(JSText.string(s[from..<(from + count)]), radix: 16)
        }
        var i = 0
        while i < s.count {
            if s[i] == "\\" && i + 1 < s.count {
                let e = s[i + 1]
                if e == "u", let v = hexValue(i + 2, 4) {
                    units.append(v)
                    i += 6
                    continue
                }
                if e == "x", let v = hexValue(i + 2, 2) {
                    units.append(v)
                    i += 4
                    continue
                }
                units.append(contentsOf: String(e).utf16)
                i += 2
                continue
            }
            units.append(contentsOf: String(s[i]).utf16)
            i += 1
        }
        return String(decoding: units, as: UTF16.self)
    }

    /// F16 step 5, the pure part: the article an Apple News page points to. The string argument of
    /// `redirectToUrlAfterTimeout("…")` (JavaScript escapes undone) when it passes the web URL rule; else the first
    /// `<a …>` after `<body` (followed by whitespace or `>`, any case) whose `href` (character references undone)
    /// passes the web URL rule; else nil.
    public static func extractAppleNewsTarget(_ html: String?) -> String? {
        let s = JSText.scalars(html)
        if let arg = redirectArgument(s), let u = ShareText.webURL(unescapeJS(arg)) { return u }
        var body: Int?
        var p = 0
        while let at = JSText.index(of: "<", in: s, from: p) {
            if JSText.hasCI(s, at: at + 1, "body"), at + 5 < s.count, JSText.isWS(s[at + 5]) || s[at + 5] == ">" {
                body = at
                break
            }
            p = at + 1
        }
        guard let body else { return nil }
        var q = JSText.index(of: "<", in: s, from: body)
        while let at = q {
            let isA = at + 2 < s.count && JSText.lowerASCII(s[at + 1]) == "a" && (JSText.isWS(s[at + 2]) || s[at + 2] == ">")
            if isA, let gt = JSText.tagEnd(s, from: at + 2) {
                if let href = JSText.attrValue(JSText.string(s[(at + 2)..<gt]), "href"),
                   let u = ShareText.webURL(JSText.decodeEntities(href)) {
                    return u
                }
                q = JSText.index(of: "<", in: s, from: gt + 1)
                continue
            }
            q = JSText.index(of: "<", in: s, from: at + 1)
        }
        return nil
    }

    /// Fetches an Apple News page: one GET, at most this long (F16 step 5).
    public static let appleNewsTimeout: TimeInterval = 3
    /// The most of an Apple News page that is read (its redirect sits near the top).
    public static let appleNewsMaxBytes = 2 * 1024 * 1024

    /// What fetches an Apple News page: its text, or nil (any failure). Tests give a stub.
    public typealias PageFetch = @Sendable (URL) async -> String?

    /// One GET on an ephemeral session: no cookies sent or kept, no cache, 3 s in all (F16 step 5).
    public static let ephemeralFetch: PageFetch = { url in
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = appleNewsTimeout
        c.timeoutIntervalForResource = appleNewsTimeout
        c.httpCookieAcceptPolicy = .never
        c.httpShouldSetCookies = false
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: c)
        defer { session.finishTasksAndInvalidate() }
        var req = URLRequest(url: url, timeoutInterval: appleNewsTimeout)
        req.httpMethod = "GET"
        guard let answer = try? await session.data(for: req), let http = answer.1 as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else { return nil }
        let data = answer.0
        let body = data.prefix(appleNewsMaxBytes)
        return String(data: body, encoding: .utf8) ?? String(decoding: body, as: UTF8.self)
    }

    /// `normalise`, and then, for an Apple News link (with `clean`: F16's Use switch off never fetches), the article it
    /// points to: one fetch (`fetch`, ephemeral, 3 s) and `extractAppleNewsTarget`, whose URL goes through `normalise`
    /// again. The title stays the share's; `orig` is the link as shared (the apple.news one). When anything fails, the
    /// apple.news link stays (F16.2).
    public static func normaliseFetchingAppleNews(text: String? = "", url: String? = "", subject: String? = "",
                                                  source: String? = "", clean: Bool = true,
                                                  fetch: PageFetch = ephemeralFetch) async -> Result {
        let r = normalise(text: text, url: url, subject: subject, source: source, clean: clean)
        guard clean, r.kind == .link, let link = r.url, isAppleNewsURL(link), let pageURL = URL(string: link),
              let page = await fetch(pageURL), let target = extractAppleNewsTarget(page) else { return r }
        let t = normalise(url: target)
        guard t.kind == .link, let article = t.url, !isAppleNewsURL(article) else { return r }
        let shared = r.orig ?? link
        return Result(kind: .link, url: article, title: r.title, excerpt: nil,
                      orig: shared.utf16.count <= ItemHeader.xOrigMax && !JSText.same(shared, article) ? shared : nil)
    }
}
