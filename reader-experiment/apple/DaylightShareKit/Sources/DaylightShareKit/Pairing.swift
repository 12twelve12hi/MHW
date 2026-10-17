import Foundation

/// The values derived from a pairing secret (PROTOCOL 1.4).
public struct ShareKeys: Equatable {
    /// AES-256-GCM key, 32 bytes.
    public let key: Data
    /// "dls-" + 32 hex characters.
    public let inboxTopic: String
    public let ackTopic: String

    public init(secret: Data) {
        key = DLSCrypto.sha256(label: DLS.labelKey, secret)
        inboxTopic = "dls-" + String(Hex.encode(DLSCrypto.sha256(label: DLS.labelInbox, secret)).prefix(32))
        ackTopic = "dls-" + String(Hex.encode(DLSCrypto.sha256(label: DLS.labelAck, secret)).prefix(32))
    }
}

/// Pairing codes (PROTOCOL 1.2).
public enum PairingCode {
    /// BASE32(secret || SHA-256(secret)[0]): 28 characters, in groups of 4 joined by "-" unless `dashes` is false.
    public static func format(_ secret: Data, dashes: Bool = true) -> String {
        precondition(secret.count == 16, "secret must be 16 bytes")
        var bytes = secret
        bytes.append(DLSCrypto.sha256(secret)[0])
        let code = Base32.encode(bytes)
        guard dashes else { return code }
        var groups: [String] = []
        var i = code.startIndex
        while i < code.endIndex {
            let j = code.index(i, offsetBy: 4, limitedBy: code.endIndex) ?? code.endIndex
            groups.append(String(code[i..<j]))
            i = j
        }
        return groups.joined(separator: "-")
    }

    /// A typed or pasted code -> the 16-byte secret. Forgiving about case, spaces, `-`, `_`, `.` and the look-alikes
    /// 0/1/8; strict about length and the check byte.
    public static func parse(_ input: String) throws -> Data {
        var s = String.UnicodeScalarView()
        for u in input.uppercased().unicodeScalars {
            if ShareText.isJSWhitespace(u) || u == "-" || u == "_" || u == "." { continue }
            switch u {
            case "0": s.append("O")
            case "1": s.append("I")
            case "8": s.append("B")
            default: s.append(u)
            }
        }
        let code = String(s)
        guard code.utf8.count == 28, code.unicodeScalars.count == 28, let bytes = Base32.decode(code), bytes.count == 17
        else {
            throw ShareError("code", "A pairing code has 28 letters and digits (7 groups of 4).", reason: "format")
        }
        let secret = bytes.prefix(16)
        guard DLSCrypto.sha256(Data(secret))[0] == bytes[bytes.startIndex + 16] else {
            throw ShareError("code", "That code doesn’t check out. Look for a typo.", reason: "checksum")
        }
        return Data(secret)
    }
}

/// What a sender stores after pairing: the secret, the relay and the Daylight's display name.
public struct Pairing: Equatable, Codable {
    public let secret: Data
    public var relay: String
    public var name: String

    public init(secret: Data, relay: String = DLS.defaultRelay, name: String = "") throws {
        guard secret.count == 16 else { throw ShareError("secret", "A pairing secret is 16 bytes.") }
        self.secret = secret
        self.relay = try ShareText.normalizeRelay(relay)
        self.name = ShareText.cleanName(name)
    }

    /// A new random pairing (what the Daylight does; used by tests and demos).
    public static func generate(relay: String = DLS.defaultRelay, name: String = "") throws -> Pairing {
        try Pairing(secret: DLSCrypto.randomBytes(16), relay: relay, name: name)
    }

    /// "ABCD-EFGH-…" (7 groups).
    public var code: String { PairingCode.format(secret) }
    public var compactCode: String { PairingCode.format(secret, dashes: false) }
    public var keys: ShareKeys { ShareKeys(secret: secret) }

    /// "your Daylight" when the Daylight sent no name.
    public var displayName: String { name.isEmpty ? "your Daylight" : name }

    /// `daylightshare://pair?c=<code>[&r=<relay>][&n=<name>]`, encoded like the JS (`URLSearchParams`, spaces as %20).
    public var link: String {
        var q = "c=" + Self.formEncode(compactCode)
        if relay != DLS.defaultRelay { q += "&r=" + Self.formEncode(relay) }
        if !name.isEmpty { q += "&n=" + Self.formEncode(name) }
        return "daylightshare://pair?" + q
    }

    /// A pairing link, a typed code, or a code with dashes.
    public static func parse(_ input: String) throws -> Pairing {
        var s = ShareText.jsTrim(input)
        // Also accept a link inside other text ("Pair: daylightshare://pair?c=…").
        if !s.lowercased().hasPrefix(DLS.pairScheme + ":"), let r = s.range(of: DLS.pairScheme + "://", options: .caseInsensitive) {
            s = String(s[r.lowerBound...].prefix(while: { !$0.isWhitespace }))
        }
        if s.lowercased().hasPrefix(DLS.pairScheme + ":") {
            var query = ""
            if let q = s.firstIndex(of: "?") {
                query = String(s[s.index(after: q)...].prefix(while: { $0 != "#" }))
            }
            let params = formDecodeQuery(query)
            let secret = try PairingCode.parse(params["c"] ?? "")
            return try Pairing(secret: secret, relay: params["r"] ?? "", name: params["n"] ?? "")
        }
        return try Pairing(secret: PairingCode.parse(s))
    }

    // MARK: Codable: stored as {code, relay, name}, like the JS `savePairing`.

    private enum CodingKeys: String, CodingKey { case code, relay, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let secret = try PairingCode.parse(try c.decode(String.self, forKey: .code))
        try self.init(secret: secret, relay: try c.decodeIfPresent(String.self, forKey: .relay) ?? "",
                      name: try c.decodeIfPresent(String.self, forKey: .name) ?? "")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(code, forKey: .code)
        try c.encode(relay, forKey: .relay)
        try c.encode(name, forKey: .name)
    }

    // MARK: application/x-www-form-urlencoded, as URLSearchParams does it

    static func formEncode(_ s: String) -> String {
        var out = ""
        for b in s.utf8 {
            switch b {
            case 0x2A, 0x2D, 0x2E, 0x5F, 0x30...0x39, 0x41...0x5A, 0x61...0x7A:
                out.unicodeScalars.append(Unicode.Scalar(b))
            case 0x20:
                out += "%20"
            default:
                let digits = Array("0123456789ABCDEF".unicodeScalars)
                out.unicodeScalars.append("%")
                out.unicodeScalars.append(digits[Int(b >> 4)])
                out.unicodeScalars.append(digits[Int(b & 0x0f)])
            }
        }
        return out
    }

    /// First value of each name; `+` is a space; bad `%` escapes stay as they are.
    static func formDecodeQuery(_ query: String) -> [String: String] {
        var out: [String: String] = [:]
        for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
            let name: Substring
            let value: Substring
            if let eq = pair.firstIndex(of: "=") {
                name = pair[..<eq]
                value = pair[pair.index(after: eq)...]
            } else {
                name = pair
                value = ""
            }
            let k = formDecode(name)
            if out[k] == nil { out[k] = formDecode(value) }
        }
        return out
    }

    static func formDecode(_ s: Substring) -> String {
        let u = Array(s.utf8)
        var bytes: [UInt8] = []
        bytes.reserveCapacity(u.count)
        var i = 0
        func hex(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: return c - 48
            case 65...70: return c - 55
            case 97...102: return c - 87
            default: return nil
            }
        }
        while i < u.count {
            let c = u[i]
            if c == 0x2B {
                bytes.append(0x20)
                i += 1
            } else if c == 0x25, i + 2 < u.count, let h = hex(u[i + 1]), let l = hex(u[i + 2]) {
                bytes.append(h << 4 | l)
                i += 3
            } else {
                bytes.append(c)
                i += 1
            }
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
