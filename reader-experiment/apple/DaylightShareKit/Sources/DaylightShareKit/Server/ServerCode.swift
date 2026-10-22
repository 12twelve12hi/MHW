import Foundation

/// The Server code, the values derived from it and the setup link (server DESIGN 3.1, 3.2, 3.5), ported from
/// `server/client/daylight-server.js` (LAB-PLAN 2.6's W0 subset) and pinned by `server/vectors/server-vectors.json` ›
/// derived, serverCodeParsing and setupLinks. Labels end in a 0x00 byte; AADs do not.
public enum ServerCode {
    public static let serverAPI = 1
    public static let serverAPIMin = 1
    public static let configRefreshMs: Int64 = 6 * 3_600_000
    public static let statusRefreshMs: Int64 = 10 * 60_000
    public static let configMaxAheadMs: Int64 = 5 * 60_000
    /// The server's feature keys (DESIGN 10.5).
    public static let features = ["ai", "pdf", "email", "feeds", "files", "deliver"]

    static let serverScheme = "daylightserver:"
    static let pairScheme = "daylightshare:"

    static func label(_ name: String) -> String { "dlshare/v1/\(name)\u{0}" }

    static func hexOf(_ name: String, _ parts: Data...) -> String {
        var d = Data()
        for p in parts { d.append(p) }
        return Hex.encode(DLSCrypto.sha256(label: label(name), d))
    }

    /// secret (16 bytes) -> seed (16 bytes). Apps only: the server never sees the secret under Lab delivery.
    public static func deriveSeed(secret: Data) throws -> Data {
        guard secret.count == 16 else { throw ShareError("secret", "secret must be 16 bytes") }
        return Data(DLSCrypto.sha256(label: label("server-seed"), secret).prefix(16))
    }

    static func codeCheck(_ seed: Data) -> UInt8 { DLSCrypto.sha256(label: label("server-code-check"), seed).first! }

    /// URLSearchParams' serializer: application/x-www-form-urlencoded, spaces as "+".
    static func formEncode(_ s: String) -> String {
        var out = ""
        for b in s.utf8 {
            switch b {
            case 0x2A, 0x2D, 0x2E, 0x5F, 0x30...0x39, 0x41...0x5A, 0x61...0x7A:
                out.unicodeScalars.append(Unicode.Scalar(b))
            case 0x20:
                out += "+"
            default:
                let digits = Array("0123456789ABCDEF".unicodeScalars)
                out.unicodeScalars.append("%")
                out.unicodeScalars.append(digits[Int(b >> 4)])
                out.unicodeScalars.append(digits[Int(b & 0x0f)])
            }
        }
        return out
    }

    /// -> "SERVER-XXXX-…-XXXX", or "daylightserver://setup?c=…&r=…&k=…" when the pairing uses another relay than
    /// ntfy.sh or an access `token`.
    public static func format(seed: Data, relay: String? = nil, token: String? = nil) throws -> String {
        guard seed.count == 16 else { throw ShareError("seed", "seed must be 16 bytes") }
        var bytes = seed
        bytes.append(codeCheck(seed))
        let c = Base32.encode(bytes)
        let r = try (relay ?? "").isEmpty ? DLS.defaultRelay : ShareText.normalizeRelay(relay)
        let t = token ?? ""
        if r == DLS.defaultRelay && t.isEmpty {
            var groups: [String] = []
            var rest = Substring(c)
            while !rest.isEmpty {
                groups.append(String(rest.prefix(4)))
                rest = rest.dropFirst(4)
            }
            return "SERVER-" + groups.joined(separator: "-")
        }
        var q = ["c=" + formEncode(c)]
        if r != DLS.defaultRelay { q.append("r=" + formEncode(r)) }
        if !t.isEmpty { q.append("k=" + formEncode(t)) }
        return "daylightserver://setup?" + q.joined(separator: "&")
    }

    static let pairingCodeMessage = "That is your pairing code. The server needs the Server code instead (Lab settings › Daylight server › Copy). Replace the secret’s value."

    /// Upper case, without JavaScript whitespace, "-", "_" and ".".
    static func compact(_ s: String) -> String {
        var v = String.UnicodeScalarView()
        for u in s.uppercased().unicodeScalars where !(ShareText.isJSWhitespace(u) || u == "-" || u == "_" || u == ".") {
            v.append(u)
        }
        return String(v)
    }

    /// 28 base32 characters (0, 1 and 8 read as O, I and B) of seed ‖ check -> the seed; `what` names the code in the
    /// errors.
    static func decodeChars(_ chars: String, check: (Data) -> UInt8, error: (_ reason: String) -> ShareError) throws -> Data {
        let s = compact(chars).replacingOccurrences(of: "0", with: "O").replacingOccurrences(of: "1", with: "I")
            .replacingOccurrences(of: "8", with: "B")
        guard s.utf8.count == 28, s.unicodeScalars.count == 28,
              s.unicodeScalars.allSatisfy({ ($0.value >= 0x41 && $0.value <= 0x5A) || ($0.value >= 0x32 && $0.value <= 0x37) }),
              let bytes = Base32.decode(s), bytes.count == 17 else { throw error("format") }
        let seed = Data(bytes.prefix(16))
        guard check(seed) == bytes[bytes.startIndex + 16] else { throw error("checksum") }
        return seed
    }

    static func decodeServerChars(_ chars: String) throws -> Data {
        try decodeChars(chars, check: codeCheck) { reason in
            reason == "format"
                ? ShareError("server-code", "A Server code is SERVER- followed by 28 letters and digits. Copy it again from Lab settings › Daylight server.", reason: "format")
                : ShareError("server-code", "That Server code doesn’t check out. Copy it again from Lab settings › Daylight server.", reason: "checksum")
        }
    }

    /// A parsed Server code: the `seed`, the relay it names (ntfy.sh by default) and an access `token` (or "").
    public struct Parsed: Equatable {
        public let seed: Data
        public let relay: String
        public let token: String
    }

    /// A Server code (either form) -> `Parsed`. Throws ShareError("server-code") with a sentence and a reason ("format",
    /// "checksum" or "pairing-code": a pairing code or link, so the master secret is never uploaded by mistake).
    public static func parse(_ input: String?) throws -> Parsed {
        let s = ShareText.jsTrim(input ?? "")
        let lower = s.lowercased()
        if lower.hasPrefix(pairScheme) { throw ShareError("server-code", pairingCodeMessage, reason: "pairing-code") }
        if lower.hasPrefix(serverScheme) {
            var query = ""
            if let q = s.firstIndex(of: "?") { query = String(s[s.index(after: q)...].prefix(while: { $0 != "#" })) }
            let p = Pairing.formDecodeQuery(query)
            let seed = try decodeServerChars(p["c"] ?? "")
            return Parsed(seed: seed, relay: try ShareText.normalizeRelay(p["r"] ?? ""), token: ShareText.jsTrim(p["k"] ?? ""))
        }
        let c = compact(s)
        if !c.hasPrefix("SERVER") {
            if (try? PairingCode.parse(s)) != nil { throw ShareError("server-code", pairingCodeMessage, reason: "pairing-code") }
            throw ShareError("server-code", "A Server code starts with SERVER-. Copy it from Lab settings › Daylight server › Server code.", reason: "format")
        }
        return Parsed(seed: try decodeServerChars(String(c.dropFirst(6))), relay: DLS.defaultRelay, token: "")
    }

    /// "3f9a1c2e" -> "3f9a-1c2e", as Lab settings and the deploy summary show it.
    public static func showFingerprint(_ fp: String) -> String { String(fp.prefix(4)) + "-" + String(fp.dropFirst(4).prefix(4)) }

    /// Deterministic item ids for server-made items (feed:<feedId>:<entryKey>, digest:<date>, …).
    public static func serverItemId(seed: Data, origin: String) -> String {
        String(hexOf("server-item-id", seed, Data([0]), Data(origin.utf8)).prefix(32))
    }

    /// -> the values derived from the seed (DESIGN 3.2).
    public static func derive(seed: Data, emailSalt: String = "") throws -> ServerValues {
        guard seed.count == 16 else { throw ShareError("seed", "seed must be 16 bytes") }
        let emailHash = DLSCrypto.sha256(label: label("server-email"), seed + Data(emailSalt.utf8))
        return ServerValues(
            authToken: hexOf("server-auth", seed),
            boxKey: DLSCrypto.sha256(label: label("server-box"), seed),
            configTopic: "dls-" + String(hexOf("server-config-topic", seed).prefix(32)),
            itemTopic: "dls-" + String(hexOf("server-item-topic", seed).prefix(32)),
            ackTopic: "dls-" + String(hexOf("server-ack-topic", seed).prefix(32)),
            emailToken: String(Base32.encode(emailHash).lowercased().prefix(10)),
            fingerprint: String(hexOf("server-fingerprint", seed).prefix(8)),
            workerName: "daylight-" + String(hexOf("server-worker", seed).prefix(12)))
    }

    // MARK: The setup link (3.5)

    static let setupFormatText = "A setup link starts with https://daylight- and ends with #SETUP- and 28 letters and digits. Copy it again: the deploy’s summary in GitHub › Actions says where to find it."
    static let setupHostText = "That link isn’t for a Daylight server: a setup link starts with https://daylight- and its address ends in .workers.dev. Copy it again: the deploy’s summary in GitHub › Actions says where to find it."
    static let setupPairingText = "That is your pairing code. Paste the setup link here instead: it starts with https:// and ends with #SETUP-…."

    /// The only hosts a setup link may name (`SETUP_HOST`): `daylight-<12 hex>.<account subdomain>.workers.dev`, the
    /// deploy's Worker. The app sends this pairing's Server code there, so any other host is refused before anything is
    /// sent; the app also shows the address and asks first (3.5), since anyone can name a Worker like this.
    public static func isSetupHost(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts[2] == "workers", parts[3] == "dev" else { return false }
        let first = parts[0].utf8, sub = parts[1].utf8
        guard parts[0].hasPrefix("daylight-"), first.count == 21,
              first.dropFirst(9).allSatisfy({ ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }) else { return false }
        return !sub.isEmpty && sub.allSatisfy { ($0 >= 0x61 && $0 <= 0x7A) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2D }
    }

    static func setupCheck(_ secret: Data) -> UInt8 { DLSCrypto.sha256(label: label("server-setup-check"), secret).first! }

    /// A parsed setup link: the Worker's origin and the link's one-time secret.
    public struct SetupLink: Equatable, Sendable {
        public let server: String
        public let secret: Data
    }

    /// A setup link -> its server (origin) and secret (the JS `parseSetupLink`). Throws ShareError("setup-link") with a
    /// sentence and a reason: "format", "host" (not a daylight-<12 hex>.<subdomain>.workers.dev address), "checksum",
    /// "server-code" (the Server code was pasted) or "pairing-code". It reads the link as a URL parser does for the
    /// links the deploy makes (case, "/setup/", a default :443, spaces and dashes in the code); a link written in a way
    /// the deploy never writes (a path with dot segments, user info, a percent-encoded host) is refused, never read
    /// differently.
    public static func parseSetupLink(_ input: String?) throws -> SetupLink {
        func fail(_ reason: String) -> ShareError {
            switch reason {
            case "host": return ShareError("setup-link", setupHostText, reason: "host")
            case "checksum":
                return ShareError("setup-link", "That setup link doesn’t check out. Copy it again: the deploy’s summary in GitHub › Actions says where to find it.", reason: "checksum")
            default: return ShareError("setup-link", setupFormatText, reason: "format")
            }
        }
        let s = ShareText.jsTrim(input ?? "")
        let lower = s.lowercased()
        if lower.hasPrefix(serverScheme) || compact(s).hasPrefix("SERVER") {
            throw ShareError("setup-link", "That is the Server code. Paste the setup link here instead: it starts with https:// and ends with #SETUP-….", reason: "server-code")
        }
        if lower.hasPrefix(pairScheme) { throw ShareError("setup-link", setupPairingText, reason: "pairing-code") }
        // A URL parser drops tabs and line breaks anywhere.
        let scalars = Array(s.unicodeScalars.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" })
        // The scheme: ^[A-Za-z][A-Za-z0-9+.-]*:
        var i = 0
        if let f = scalars.first, ShareText.isASCIILetter(f) {
            while i < scalars.count, ShareText.isASCIILetter(scalars[i]) || ShareText.isDigit(scalars[i])
                    || scalars[i] == "+" || scalars[i] == "." || scalars[i] == "-" { i += 1 }
        }
        guard i > 0, i < scalars.count, scalars[i] == ":" else {
            // Not a URL: a pairing code pasted here, or anything else.
            if (try? PairingCode.parse(s)) != nil { throw ShareError("setup-link", setupPairingText, reason: "pairing-code") }
            throw fail("format")
        }
        let scheme = ShareText.string(scalars[0..<i]).lowercased()
        guard scheme == "https" else { throw fail("format") }
        i += 1
        while i < scalars.count, scalars[i] == "/" || scalars[i] == "\\" { i += 1 }
        let authStart = i
        while i < scalars.count, !["/", "\\", "?", "#"].contains(scalars[i]) { i += 1 }
        let authority = scalars[authStart..<i]
        guard !authority.contains("@"), !authority.isEmpty else { throw fail("format") }
        var hostPart = authority[...]
        var portText = ""
        if authority.first == "[" { throw fail("host") }
        if let colon = authority.firstIndex(of: ":") {
            hostPart = authority[authority.startIndex..<colon]
            portText = ShareText.string(authority[(colon + 1)...])
        }
        guard hostPart.allSatisfy({ ShareText.isASCIILetter($0) || ShareText.isDigit($0) || $0 == "-" || $0 == "." || $0 == "_" })
        else { throw fail("format") }
        let host = ShareText.string(hostPart).lowercased()
        if !portText.isEmpty {
            guard portText.unicodeScalars.allSatisfy(ShareText.isDigit), let port = Int(portText.prefix(9)), portText.count < 10,
                  port <= 65535 else { throw fail("format") }
            if port != 443 { throw fail("host") }
        }
        guard !host.isEmpty else { throw fail("format") }
        guard isSetupHost(host) else { throw fail("host") }
        // The path, the query and the fragment.
        let pathStart = i
        while i < scalars.count, scalars[i] != "?" && scalars[i] != "#" { i += 1 }
        let path = ShareText.string(scalars[pathStart..<i]).replacingOccurrences(of: "\\", with: "/")
        guard path == "/setup" || path == "/setup/" else { throw fail("format") }
        if i < scalars.count, scalars[i] == "?" {
            let qStart = i + 1
            while i < scalars.count, scalars[i] != "#" { i += 1 }
            guard qStart == i else { throw fail("format") }
        }
        var fragment = ""
        if i < scalars.count, scalars[i] == "#" {
            guard let decoded = percentDecode(ShareText.string(scalars[(i + 1)...])) else { throw fail("format") }
            fragment = decoded
        }
        var chars = compact(fragment)
        guard chars.hasPrefix("SETUP") else { throw fail("format") }
        chars = String(chars.dropFirst(5))
        let secret = try decodeChars(chars, check: setupCheck) { fail($0) }
        return SetupLink(server: "https://" + host, secret: secret)
    }

    /// `decodeURIComponent`: %XX sequences as UTF-8; nil for a malformed one.
    static func percentDecode(_ s: String) -> String? {
        let u = Array(s.utf8)
        var out: [UInt8] = []
        var i = 0
        while i < u.count {
            if u[i] == 0x25 {
                guard i + 2 < u.count, let h = Hex.decode(String(decoding: u[(i + 1)...(i + 2)], as: UTF8.self)) else { return nil }
                out.append(h[h.startIndex])
                i += 3
            } else {
                out.append(u[i])
                i += 1
            }
        }
        return String(bytes: out, encoding: .utf8)
    }

    /// The setup link's bearer token for POST /v1/setup: hex(SHA-256("dlshare/v1/server-setup-auth" ‖ 0x00 ‖ secret)).
    public static func deriveSetupToken(secret: Data) throws -> String {
        guard secret.count == 16 else { throw ShareError("secret", "secret must be 16 bytes") }
        return hexOf("server-setup-auth", secret)
    }
}

/// The values a Server code gives (DESIGN 3.2). `boxKey` seals config, server items and server acks.
public struct ServerValues: Equatable, Sendable {
    public let authToken: String
    public let boxKey: Data
    public let configTopic: String
    public let itemTopic: String
    public let ackTopic: String
    public let emailToken: String
    public let fingerprint: String
    public let workerName: String
}

/// Frames under the server's box key (DESIGN 3.2): the protocol's frame format with the box key and the AADs
/// "dlshare/v1/server-config", "…server-item" and "…server-ack". W0 apps open config frames only; item and ack are here
/// for the tests and Wave S.
public enum ServerBox {
    public static let config = "config"
    public static let item = "item"
    public static let ack = "ack"
    static let aads = ["config": "dlshare/v1/server-config", "item": "dlshare/v1/server-item", "ack": "dlshare/v1/server-ack"]

    static func aadData(_ name: String) throws -> Data {
        guard let a = aads[name] else { throw ShareError("aad", "unknown box AAD \(name)") }
        return Data(a.utf8)
    }

    /// Seals a header and a body with the box key and AAD `aad` ("config", "item" or "ack").
    public static func seal(values: ServerValues, aad: String, header: JSONOut, body: Data = Data(), nonce: Data? = nil) throws -> Data {
        let a = try aadData(aad)
        let n = nonce ?? DLSCrypto.randomBytes(12)
        guard n.count == 12 else { throw ShareError("nonce", "nonce must be 12 bytes") }
        let h = header.data
        guard h.count <= DLS.maxHeaderBytes else { throw ShareError("header", "header of \(h.count) bytes") }
        let len = UInt32(h.count)
        var plain = Data([UInt8(len >> 24), UInt8((len >> 16) & 0xff), UInt8((len >> 8) & 0xff), UInt8(len & 0xff)])
        plain.append(h)
        plain.append(body)
        var frame = Frame.magic
        frame.append(n)
        frame.append(try DLSCrypto.seal(key: values.boxKey, nonce: n, plaintext: plain, aad: a))
        return frame
    }

    /// -> the header (a JSON object whose `v` is 1) and the body. Throws ShareError("frame") for anything that is not a
    /// valid frame under this key and AAD.
    public static func open(values: ServerValues, aad: String, frame f: Data) throws -> (header: JSONValue, body: Data) {
        let a = try aadData(aad)
        let frame = Data(f)
        guard frame.count >= 4 + 12 + 16 + 4 else { throw ShareError("frame", "too short") }
        guard frame.prefix(4) == Frame.magic else { throw ShareError("frame", "bad magic") }
        let plain: Data
        do {
            plain = Data(try DLSCrypto.open(key: values.boxKey, nonce: frame.subdata(in: 4..<16),
                                            sealed: frame.subdata(in: 16..<frame.count), aad: a))
        } catch {
            throw ShareError("frame", "does not decrypt")
        }
        guard plain.count >= 4 else { throw ShareError("frame", "short plaintext") }
        let hlen = Int(plain[0]) << 24 | Int(plain[1]) << 16 | Int(plain[2]) << 8 | Int(plain[3])
        guard hlen <= plain.count - 4, hlen <= DLS.maxHeaderBytes else { throw ShareError("frame", "bad header length") }
        guard let header = JSONValue.parse(plain.subdata(in: 4..<(4 + hlen))) else { throw ShareError("frame", "bad header") }
        guard header.object != nil, header["v"]?.number == 1 else { throw ShareError("frame", "unsupported header") }
        return (header, plain.subdata(in: (4 + hlen)..<plain.count))
    }
}

/// A checked config (DESIGN 4.1, 4.3): the server's https origin, its API version, fingerprint and delivery mode.
public struct ServerConfig: Equatable, Sendable {
    public var server: String
    public var api: Int
    public var fingerprint: String
    /// "lab" or "v1".
    public var delivery: String
    public var sent: String
    public var id: String

    public init(server: String, api: Int, fingerprint: String, delivery: String, sent: String = "", id: String = "") {
        self.server = server
        self.api = api
        self.fingerprint = fingerprint
        self.delivery = delivery
        self.sent = sent
        self.id = id
    }

    /// As the client module stores it (server/config).
    public var json: JSONValue {
        .object(["server": .string(server), "api": .number(Double(api)), "fingerprint": .string(fingerprint),
                 "delivery": .string(delivery), "sent": .string(sent), "id": .string(id)])
    }

    /// A stored config, or nil.
    public init?(json v: JSONValue?) {
        guard let server = v?["server"]?.string, let api = v?["api"]?.safeInteger, let fp = v?["fingerprint"]?.string else {
            return nil
        }
        self.init(server: server, api: Int(api), fingerprint: fp, delivery: v?["delivery"]?.string == "v1" ? "v1" : "lab",
                  sent: v?["sent"]?.string ?? "", id: v?["id"]?.string ?? "")
    }

    /// The 4.3 rules for an opened config header (the JS `checkConfig`). -> a clean config or nil. `server` must be an
    /// https origin exactly as a URL parser writes it (lowercase host, no default port, no user info, path, query or
    /// fragment; one trailing "/" allowed), `sent` an ISO time no more than 5 minutes ahead of `now`, `api` an integer
    /// >= 1 and `fingerprint` 8 hex digits. It accepts no server the JS refuses (`WebHost`).
    public static func check(_ header: JSONValue?, now: Int64) -> ServerConfig? {
        guard let h = header?.object, h["v"]?.number == 1, h["kind"]?.string == "config" else { return nil }
        guard let s = h["server"]?.string, let origin = httpsOrigin(s) else { return nil }
        guard let sentText = h["sent"]?.string, let sent = Lab.parseTime(sentText), sent <= now + ServerCode.configMaxAheadMs
        else { return nil }
        guard let api = h["api"]?.wholeNumber, api >= 1, api <= Double(Int32.max) else { return nil }
        guard let fp = h["fingerprint"]?.string, fp.utf8.count == 8,
              fp.utf8.allSatisfy({ ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }) else { return nil }
        let id: String
        switch h["id"] {
        case nil, .null?: id = ""
        case let .string(x)?: id = x
        case let .number(d)?: id = ServerMessages.numberText(d)
        case let .bool(b)?: id = b ? "true" : "false"
        default: id = ""
        }
        return ServerConfig(server: origin, api: Int(api), fingerprint: fp, delivery: h["delivery"]?.string == "v1" ? "v1" : "lab",
                            sent: Lab.isoTime(sent), id: id)
    }

    /// `https://host[:port]` exactly as a URL parser serialises its origin (one trailing "/" allowed), else nil.
    static func httpsOrigin(_ server: String) -> String? {
        let s = server.hasSuffix("/") ? String(server.dropLast()) : server
        guard s.hasPrefix("https://") else { return nil }
        let rest = String(s.dropFirst(8))
        var host = rest
        var port = ""
        if rest.hasPrefix("[") {
            guard let close = rest.firstIndex(of: "]") else { return nil }
            host = String(rest[...close])
            let after = rest[rest.index(after: close)...]
            if !after.isEmpty {
                guard after.hasPrefix(":") else { return nil }
                port = String(after.dropFirst())
            }
            guard host.dropFirst().dropLast().unicodeScalars.allSatisfy({ WebHost.isLowerHex($0) || $0 == ":" || $0 == "." })
            else { return nil }
        } else {
            if let colon = rest.firstIndex(of: ":") {
                host = String(rest[..<colon])
                port = String(rest[rest.index(after: colon)...])
            }
            guard !host.isEmpty, host.unicodeScalars.allSatisfy({ WebHost.isHostChar($0) }) else { return nil }
        }
        guard !host.isEmpty, !host.hasPrefix("."), WebHost.isCanonical(host) else { return nil }
        if !port.isEmpty {
            guard port.unicodeScalars.allSatisfy(ShareText.isDigit), port.count <= 5, !port.hasPrefix("0"), let p = Int(port),
                  p <= 65535, p != 443 else { return nil }
        }
        return s
    }
}

/// Whether a host (already lowercase, made of `[a-z0-9_.-]` or a bracketed `[0-9a-f:.]` address) is exactly how a URL
/// parser serialises it, so `new URL("https://" + host).host == host`, as the JS reference compares origins:
/// - a host whose last label (a trailing dot aside) is all digits, or "0x" and hex digits, is an IPv4 address: only the
///   canonical dotted quad serialises as itself;
/// - a bracketed IPv6 address must be in its canonical form (lowercase, no leading zeros, the first longest run of two
///   or more zero pieces as "::", no dotted IPv4 tail);
/// - an "xn--" label is refused here (decoding Punycode would need IDNA; no Daylight server has one).
enum WebHost {
    /// 0-9 and a-f.
    static func isLowerHex(_ u: Unicode.Scalar) -> Bool {
        (u.value >= 0x30 && u.value <= 0x39) || (u.value >= 0x61 && u.value <= 0x66)
    }

    /// a-z, 0-9, "-", "." and "_".
    static func isHostChar(_ u: Unicode.Scalar) -> Bool {
        (u.value >= 0x61 && u.value <= 0x7A) || (u.value >= 0x30 && u.value <= 0x39) || u == "-" || u == "." || u == "_"
    }

    static func isCanonical(_ host: String) -> Bool {
        if host.hasPrefix("[") { return host.hasSuffix("]") && canonicalIPv6(String(host.dropFirst().dropLast())) }
        if endsInANumber(host) { return isDottedQuad(host) }
        return !host.split(separator: ".", omittingEmptySubsequences: false).contains { $0.hasPrefix("xn--") }
    }

    static func endsInANumber(_ host: String) -> Bool {
        var parts = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if parts.last == "" {
            if parts.count == 1 { return false }
            parts.removeLast()
        }
        let last = parts.last ?? ""
        if !last.isEmpty && last.unicodeScalars.allSatisfy(ShareText.isDigit) { return true }
        let l = last.lowercased()
        return l.hasPrefix("0x") && l.dropFirst(2).unicodeScalars.allSatisfy { isLowerHex($0) }
    }

    static func isDottedQuad(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { p in
            guard !p.isEmpty, p.count <= 3, p.unicodeScalars.allSatisfy(ShareText.isDigit), let n = Int(p), n <= 255 else { return false }
            return String(n) == p // no leading zeros
        }
    }

    static func canonicalIPv6(_ s: String) -> Bool {
        guard !s.isEmpty, !s.contains(".") else { return false }
        let halves = s.components(separatedBy: "::")
        guard halves.count <= 2 else { return false }
        func pieces(_ t: String) -> [Int]? {
            if t.isEmpty { return [] }
            var out: [Int] = []
            for p in t.split(separator: ":", omittingEmptySubsequences: false) {
                guard (1...4).contains(p.count), p.unicodeScalars.allSatisfy({ isLowerHex($0) }),
                      let v = Int(p, radix: 16) else { return nil }
                out.append(v)
            }
            return out
        }
        guard let head = pieces(halves[0]) else { return false }
        let tail = halves.count == 2 ? pieces(halves[1]) : []
        guard let tail else { return false }
        var a = [Int](repeating: 0, count: 8)
        if halves.count == 1 {
            guard head.count == 8 else { return false }
            a = head
        } else {
            guard head.count + tail.count <= 7 else { return false }
            for (k, v) in head.enumerated() { a[k] = v }
            for (k, v) in tail.enumerated() { a[8 - tail.count + k] = v }
        }
        return serializeIPv6(a) == s
    }

    /// The URL standard's IPv6 serializer: the first longest run of two or more zero pieces becomes "::".
    static func serializeIPv6(_ a: [Int]) -> String {
        var compress = -1
        var best = 1
        var i = 0
        while i < 8 {
            if a[i] != 0 {
                i += 1
                continue
            }
            var j = i
            while j < 8 && a[j] == 0 { j += 1 }
            if j - i > best {
                best = j - i
                compress = i
            }
            i = j
        }
        var out = ""
        var ignore0 = false
        for k in 0..<8 {
            if ignore0 && a[k] == 0 { continue }
            ignore0 = false
            if compress == k {
                out += k == 0 ? "::" : ":"
                ignore0 = true
                continue
            }
            out += String(a[k], radix: 16)
            if k != 7 { out += ":" }
        }
        return out
    }
}
