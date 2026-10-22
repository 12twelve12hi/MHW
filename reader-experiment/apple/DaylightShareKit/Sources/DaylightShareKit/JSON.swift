import Foundation

/// A JSON value for writing headers with a fixed key order, byte-compatible with JavaScript's `JSON.stringify`.
public indirect enum JSONOut: Equatable {
    case string(String)
    case int(Int)
    /// `true` or `false` (Lab frames' `live`).
    case bool(Bool)
    case array([JSONOut])
    case object([(String, JSONOut)])

    public static func == (a: JSONOut, b: JSONOut) -> Bool {
        switch (a, b) {
        case let (.string(x), .string(y)): return x == y
        case let (.int(x), .int(y)): return x == y
        case let (.bool(x), .bool(y)): return x == y
        case let (.array(x), .array(y)): return x == y
        case let (.object(x), .object(y)): return x.count == y.count && zip(x, y).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: return false
        }
    }

    public var data: Data { Data(serialized.utf8) }

    public var serialized: String {
        var out = ""
        write(into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case let .string(s): JSONOut.writeString(s, into: &out)
        case let .int(n): out += String(n)
        case let .bool(b): out += b ? "true" : "false"
        case let .array(items):
            out += "["
            for (i, v) in items.enumerated() {
                if i > 0 { out += "," }
                v.write(into: &out)
            }
            out += "]"
        case let .object(pairs):
            out += "{"
            for (i, (k, v)) in pairs.enumerated() {
                if i > 0 { out += "," }
                JSONOut.writeString(k, into: &out)
                out += ":"
                v.write(into: &out)
            }
            out += "}"
        }
    }

    /// `JSON.stringify` string escaping: `"` `\` and C0 controls only; everything else (including non-ASCII, `/`,
    /// U+2028 and U+2029) is written as is.
    static func writeString(_ s: String, into out: inout String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 {
                    let hex = String(u.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }
}

/// Reading untrusted JSON objects parsed by `JSONSerialization`.
enum JSONRead {
    static func object(_ data: Data) -> [String: Any]? {
        guard let o = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }
        return o as? [String: Any]
    }

    static func isNull(_ v: Any?) -> Bool { v == nil || v is NSNull }

    static func string(_ v: Any?) -> String? { v as? String }

    /// A JSON number that is an integer (like `Number.isInteger`) within JavaScript's safe range; nil for booleans,
    /// strings and fractions.
    static func integer(_ v: Any?) -> Int? {
        guard let v, !(v is NSNull), !(v is String) else { return nil }
        #if canImport(ObjectiveC)
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        #else
        if type(of: v) == Bool.self { return nil }
        let d: Double
        if let n = v as? NSNumber { d = n.doubleValue } else if let i = v as? Int { d = Double(i) } else if let x = v as? Double { d = x } else { return nil }
        #endif
        guard d.isFinite, d.rounded() == d, abs(d) <= 9_007_199_254_740_991 else { return nil }
        return Int(d)
    }

    /// JavaScript `String(v)` for the values a header may carry (used where the JS reference coerces).
    static func coerceString(_ v: Any?) -> String {
        guard let v, !(v is NSNull) else { return "" }
        if let s = v as? String { return s }
        if let i = integer(v) { return String(i) }
        #if canImport(ObjectiveC)
        if let n = v as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            return n.stringValue
        }
        #endif
        return "\(v)"
    }
}
