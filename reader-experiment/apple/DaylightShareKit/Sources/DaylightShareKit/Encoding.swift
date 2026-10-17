import Foundation

/// Lowercase hex.
public enum Hex {
    private static let digits = Array("0123456789abcdef".utf8)

    public static func encode<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        var out = [UInt8]()
        out.reserveCapacity(bytes.underestimatedCount * 2)
        for b in bytes {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Accepts upper- or lowercase hex; nil for anything else.
    public static func decode(_ s: String) -> Data? {
        let u = Array(s.utf8)
        guard u.count % 2 == 0 else { return nil }
        var out = Data(capacity: u.count / 2)
        var i = 0
        while i < u.count {
            guard let hi = nibble(u[i]), let lo = nibble(u[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }

    private static func nibble(_ c: UInt8) -> UInt8? {
        switch c {
        case 48...57: return c - 48
        case 97...102: return c - 87
        case 65...70: return c - 55
        default: return nil
        }
    }

    /// True for exactly `count` lowercase hex digits.
    static func isLowerHex(_ s: String, count: Int) -> Bool {
        let u = s.utf8
        return u.count == count && u.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// RFC 4648 base32 (A-Z 2-7), no padding.
public enum Base32 {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".utf8)

    public static func encode<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        var out = [UInt8]()
        var buf: UInt32 = 0
        var bits: UInt32 = 0
        for b in bytes {
            buf = (buf << 8) | UInt32(b)
            bits += 8
            while bits >= 5 {
                bits -= 5
                out.append(alphabet[Int((buf >> bits) & 31)])
            }
            buf &= (1 << bits) - 1
        }
        if bits > 0 { out.append(alphabet[Int((buf << (5 - bits)) & 31)]) }
        return String(decoding: out, as: UTF8.self)
    }

    /// Strict alphabet (uppercase only); leftover bits that do not make a whole byte are ignored.
    public static func decode(_ s: String) -> Data? {
        var out = Data()
        var buf: UInt32 = 0
        var bits: UInt32 = 0
        for c in s.utf8 {
            let v: UInt32
            switch c {
            case 65...90: v = UInt32(c - 65)
            case 50...55: v = UInt32(c - 50) + 26
            default: return nil
            }
            buf = (buf << 5) | v
            bits += 5
            if bits >= 8 {
                bits -= 8
                out.append(UInt8((buf >> bits) & 0xff))
            }
            buf &= (1 << bits) - 1
        }
        return out
    }
}

/// Standard base64 with `=` padding and no line breaks (encode); strict decode that accepts missing padding.
public enum Base64 {
    public static func encode(_ data: Data) -> String { data.base64EncodedString() }

    /// Encoded length of `count` bytes.
    public static func encodedLength(_ count: Int) -> Int { (count + 2) / 3 * 4 }

    public static func decode(_ string: String) -> Data? {
        let s = string.trimmingCharacters(in: .whitespacesAndNewlines)
        let n = s.utf8.count
        if n % 4 == 1 { return nil }
        var clean = Substring(s)
        var pad = 0
        while clean.hasSuffix("=") {
            clean = clean.dropLast()
            pad += 1
        }
        if pad > 2 { return nil }
        for c in clean.utf8 {
            let ok = (65...90).contains(c) || (97...122).contains(c) || (48...57).contains(c) || c == 43 || c == 47
            if !ok { return nil }
        }
        var padded = String(clean)
        while padded.utf8.count % 4 != 0 { padded += "=" }
        return Data(base64Encoded: padded)
    }
}

extension Data {
    /// Lowercase hex of the bytes.
    public var hexString: String { Hex.encode(self) }
}
