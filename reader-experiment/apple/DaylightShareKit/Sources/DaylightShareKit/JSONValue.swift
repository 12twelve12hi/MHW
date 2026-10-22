import Foundation

/// A parsed JSON value, read exactly as JavaScript's `JSON.parse` reads it: every number is a `Double` (correctly
/// rounded, so `1.0`, `1e0` and `0.1e1` are 1, `1e400` is infinite and `-0` is -0), the last of two equal keys wins, and
/// anything RFC 8259 refuses (a trailing comma, a control character in a string, text after the value) is refused.
///
/// The Lab readers (LAB-PROTOCOL 2.2.5) parse untrusted headers with it rather than `JSONSerialization`, whose number
/// types and edge cases are not specified: the same bytes then give the same result in Swift, JavaScript and Kotlin, as
/// the `labParse` vectors require. (Swift strings cannot hold a lone surrogate: a `\ud800` escape without its pair
/// becomes U+FFFD, which no Lab field accepts either way.)
public indirect enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    // MARK: Reading

    public var string: String? {
        if case let .string(s) = self { return s }
        return nil
    }

    public var number: Double? {
        if case let .number(d) = self { return d }
        return nil
    }

    public var bool: Bool? {
        if case let .bool(b) = self { return b }
        return nil
    }

    public var array: [JSONValue]? {
        if case let .array(a) = self { return a }
        return nil
    }

    public var object: [String: JSONValue]? {
        if case let .object(o) = self { return o }
        return nil
    }

    public var isNull: Bool { self == .null }

    /// The member `key` of an object (nil for anything else, or a missing member).
    public subscript(key: String) -> JSONValue? { object?[key] }

    /// Rule I of LAB-PROTOCOL 2.2.5: a JSON number (not a string, not a boolean) whose value is a whole number. -0 is 0;
    /// 1.5 and an infinite value are not. -> the value as a Double (it may be past Int64, as 1e300 is), or nil.
    public var wholeNumber: Double? {
        guard case let .number(d) = self, d.isFinite, d.rounded(.towardZero) == d else { return nil }
        return d == 0 ? 0 : d
    }

    /// A whole number within ±2^53 as an Int64 (`Number.isSafeInteger`), else nil.
    public var safeInteger: Int64? {
        guard let d = wholeNumber, abs(d) <= 9_007_199_254_740_991 else { return nil }
        return Int64(d)
    }

    /// The Foundation objects `JSONSerialization` would give: NSNull, Bool, Double, String, arrays and dictionaries.
    public var foundation: Any {
        switch self {
        case .null: return NSNull()
        case let .bool(b): return b
        case let .number(d): return d
        case let .string(s): return s
        case let .array(a): return a.map(\.foundation)
        case let .object(o): return o.mapValues(\.foundation)
        }
    }

    /// A value from `JSONSerialization`'s objects (an NSNumber holding a boolean is a boolean); nil for anything JSON
    /// cannot hold.
    public init?(foundation v: Any?) {
        guard let v else {
            self = .null
            return
        }
        if v is NSNull {
            self = .null
        } else if let s = v as? String {
            self = .string(s)
        } else if let a = v as? [Any] {
            var out: [JSONValue] = []
            for x in a {
                guard let j = JSONValue(foundation: x) else { return nil }
                out.append(j)
            }
            self = .array(out)
        } else if let o = v as? [String: Any] {
            var out: [String: JSONValue] = [:]
            for (k, x) in o {
                guard let j = JSONValue(foundation: x) else { return nil }
                out[k] = j
            }
            self = .object(out)
        } else if let b = Self.boolean(v) {
            self = .bool(b)
        } else if let n = v as? NSNumber {
            self = .number(n.doubleValue)
        } else if let d = v as? Double {
            self = .number(d)
        } else if let i = v as? Int {
            self = .number(Double(i))
        } else if let i = v as? Int64 {
            self = .number(Double(i))
        } else {
            return nil
        }
    }

    /// A boolean whether it is a Swift `Bool` or an NSNumber made from one (JSONSerialization's), else nil.
    static func boolean(_ v: Any) -> Bool? {
        #if canImport(ObjectiveC)
        if let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue }
        return nil
        #else
        return v as? Bool
        #endif
    }

    // MARK: Writing

    /// JSON text: strings escaped as `JSON.stringify` escapes them (`JSONOut`), whole numbers within ±2^53 without a
    /// fraction, other numbers in Swift's shortest round-trip form, members in key order (so the text is stable).
    public var serialized: String {
        var out = ""
        write(into: &out)
        return out
    }

    public var data: Data { Data(serialized.utf8) }

    private func write(into out: inout String) {
        switch self {
        case .null: out += "null"
        case let .bool(b): out += b ? "true" : "false"
        case let .number(d):
            if !d.isFinite {
                out += "null" // as JSON.stringify writes Infinity and NaN
            } else if let i = JSONValue.number(d).safeInteger {
                out += String(i)
            } else {
                out += "\(d)"
            }
        case let .string(s): JSONOut.writeString(s, into: &out)
        case let .array(items):
            out += "["
            for (i, v) in items.enumerated() {
                if i > 0 { out += "," }
                v.write(into: &out)
            }
            out += "]"
        case let .object(members):
            out += "{"
            for (i, k) in members.keys.sorted().enumerated() {
                if i > 0 { out += "," }
                JSONOut.writeString(k, into: &out)
                out += ":"
                members[k]!.write(into: &out)
            }
            out += "}"
        }
    }

    // MARK: Parsing

    /// Parses UTF-8 JSON text; nil when it is not valid UTF-8 or not exactly one JSON value (whitespace around it
    /// allowed).
    public static func parse(_ data: Data) -> JSONValue? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        return parse(text)
    }

    /// Parses JSON text; nil when it is not exactly one JSON value.
    public static func parse(_ text: String) -> JSONValue? {
        var p = Parser(Array(text.unicodeScalars))
        guard let v = p.value(depth: 0) else { return nil }
        p.skipSpace()
        return p.atEnd ? v : nil
    }

    private struct Parser {
        let s: [Unicode.Scalar]
        var i = 0
        /// Deeper nesting than this is refused (no header comes near it; it keeps the recursion bounded).
        static let maxDepth = 512

        init(_ s: [Unicode.Scalar]) {
            self.s = s
        }

        var atEnd: Bool { i >= s.count }

        mutating func skipSpace() {
            while i < s.count, s[i] == " " || s[i] == "\t" || s[i] == "\n" || s[i] == "\r" { i += 1 }
        }

        mutating func literal(_ word: String) -> Bool {
            let w = Array(word.unicodeScalars)
            guard i + w.count <= s.count, Array(s[i..<(i + w.count)]) == w else { return false }
            i += w.count
            return true
        }

        mutating func value(depth: Int) -> JSONValue? {
            guard depth <= Self.maxDepth else { return nil }
            skipSpace()
            guard i < s.count else { return nil }
            switch s[i] {
            case "{":
                i += 1
                var members: [String: JSONValue] = [:]
                skipSpace()
                if i < s.count, s[i] == "}" {
                    i += 1
                    return .object(members)
                }
                while true {
                    skipSpace()
                    guard i < s.count, s[i] == "\"", let key = string() else { return nil }
                    skipSpace()
                    guard i < s.count, s[i] == ":" else { return nil }
                    i += 1
                    guard let v = value(depth: depth + 1) else { return nil }
                    members[key] = v
                    skipSpace()
                    guard i < s.count else { return nil }
                    if s[i] == "," {
                        i += 1
                        continue
                    }
                    if s[i] == "}" {
                        i += 1
                        return .object(members)
                    }
                    return nil
                }
            case "[":
                i += 1
                var items: [JSONValue] = []
                skipSpace()
                if i < s.count, s[i] == "]" {
                    i += 1
                    return .array(items)
                }
                while true {
                    guard let v = value(depth: depth + 1) else { return nil }
                    items.append(v)
                    skipSpace()
                    guard i < s.count else { return nil }
                    if s[i] == "," {
                        i += 1
                        continue
                    }
                    if s[i] == "]" {
                        i += 1
                        return .array(items)
                    }
                    return nil
                }
            case "\"":
                return string().map { .string($0) }
            case "t":
                return literal("true") ? .bool(true) : nil
            case "f":
                return literal("false") ? .bool(false) : nil
            case "n":
                return literal("null") ? .null : nil
            default:
                return number()
            }
        }

        static func isDigit(_ u: Unicode.Scalar) -> Bool { u.value >= 0x30 && u.value <= 0x39 }

        /// -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?, read as the nearest Double (strtod, like JavaScript).
        mutating func number() -> JSONValue? {
            let start = i
            if i < s.count, s[i] == "-" { i += 1 }
            guard i < s.count, Self.isDigit(s[i]) else { return nil }
            if s[i] == "0" {
                i += 1
            } else {
                while i < s.count, Self.isDigit(s[i]) { i += 1 }
            }
            if i < s.count, s[i] == "." {
                i += 1
                guard i < s.count, Self.isDigit(s[i]) else { return nil }
                while i < s.count, Self.isDigit(s[i]) { i += 1 }
            }
            if i < s.count, s[i] == "e" || s[i] == "E" {
                i += 1
                if i < s.count, s[i] == "+" || s[i] == "-" { i += 1 }
                guard i < s.count, Self.isDigit(s[i]) else { return nil }
                while i < s.count, Self.isDigit(s[i]) { i += 1 }
            }
            var text = String.UnicodeScalarView()
            text.append(contentsOf: s[start..<i])
            // Double(String) is strtod: correctly rounded; out of range gives ±infinity (JSON.parse gives Infinity too)
            // or ±0.
            guard let d = Double(String(text)) else { return nil }
            return .number(d)
        }

        mutating func hex4() -> UInt32? {
            guard i + 4 <= s.count else { return nil }
            var v: UInt32 = 0
            for k in 0..<4 {
                let c = s[i + k].value
                let n: UInt32
                switch c {
                case 0x30...0x39: n = c - 0x30
                case 0x41...0x46: n = c - 0x41 + 10
                case 0x61...0x66: n = c - 0x61 + 10
                default: return nil
                }
                v = v << 4 | n
            }
            i += 4
            return v
        }

        /// A string starting at `"`; the index ends after the closing quote.
        mutating func string() -> String? {
            guard i < s.count, s[i] == "\"" else { return nil }
            i += 1
            var out = String.UnicodeScalarView()
            while i < s.count {
                let c = s[i]
                i += 1
                if c == "\"" { return String(out) }
                if c.value < 0x20 { return nil }
                if c != "\\" {
                    out.append(c)
                    continue
                }
                guard i < s.count else { return nil }
                let e = s[i]
                i += 1
                switch e {
                case "\"": out.append("\"")
                case "\\": out.append("\\")
                case "/": out.append("/")
                case "b": out.append("\u{08}")
                case "f": out.append("\u{0C}")
                case "n": out.append("\n")
                case "r": out.append("\r")
                case "t": out.append("\t")
                case "u":
                    guard let u = hex4() else { return nil }
                    if (0xD800...0xDBFF).contains(u) {
                        // A high surrogate: a pair when a low one follows as \uDC00-\uDFFF, else a lone surrogate.
                        let mark = i
                        if i + 1 < s.count, s[i] == "\\", s[i + 1] == "u" {
                            i += 2
                            if let low = hex4(), (0xDC00...0xDFFF).contains(low),
                               let scalar = Unicode.Scalar(0x10000 + ((u - 0xD800) << 10) + (low - 0xDC00)) {
                                out.append(scalar)
                                continue
                            }
                        }
                        i = mark
                        out.append("\u{FFFD}")
                    } else if (0xDC00...0xDFFF).contains(u) {
                        out.append("\u{FFFD}")
                    } else if let scalar = Unicode.Scalar(u) {
                        out.append(scalar)
                    } else {
                        return nil
                    }
                default:
                    return nil
                }
            }
            return nil
        }
    }
}
