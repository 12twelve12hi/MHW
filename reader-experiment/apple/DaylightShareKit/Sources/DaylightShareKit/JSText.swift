import Foundation

/// The textual building blocks of the W1 reference functions (LAB-PROTOCOL 2.9), as `share/js/daylight-lab.js` defines
/// them, so `ShareNormaliser`, `Excerpt` and `SetupCheck` give the JavaScript's results character for character.
///
/// - Text is handled as Unicode scalars (code points), never as Swift `Character`s: a `Character` holds "\r\n" as one,
///   and combining marks with their base, where the reference sees two or more code points.
/// - **Whitespace** is ECMAScript's `\s` (`ShareText.isJSWhitespace`); `\b` is spelled out with ASCII word characters.
/// - **Case-insensitive** matches compare ASCII letters only, as JavaScript's `i` flag does without `u`: never
///   `.caseInsensitive` (ICU folds Unicode case, so "ſ" would match "s" and the Kelvin sign "K" would match "k").
/// - Every pattern is a hand-written scanner, linear in its input, with no regular expression engine: the reference's
///   own patterns were chosen to be linear, and these follow them step for step.
enum JSText {
    typealias Scalars = [Unicode.Scalar]

    static func scalars(_ s: String?) -> Scalars { Array((s ?? "").unicodeScalars) }

    static func string<S: Sequence>(_ s: S) -> String where S.Element == Unicode.Scalar {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s)
        return String(v)
    }

    static func isWS(_ u: Unicode.Scalar) -> Bool { ShareText.isJSWhitespace(u) }

    /// `a === b`: the same code points. (Swift's `==` compares canonical equivalence: "é" equals "e" + U+0301.)
    static func same(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b else { return a == nil && b == nil }
        return a.unicodeScalars.elementsEqual(b.unicodeScalars)
    }

    /// `s.startsWith(p)` and `s.endsWith(p)`, code point by code point (`hasPrefix` compares `Character`s).
    static func startsWith(_ s: String, _ p: String) -> Bool { s.unicodeScalars.starts(with: p.unicodeScalars) }

    static func endsWith(_ s: String, _ p: String) -> Bool {
        s.unicodeScalars.reversed().starts(with: p.unicodeScalars.reversed())
    }

    /// `String.prototype.trim`.
    static func trim(_ s: String) -> String { ShareText.jsTrim(s) }

    /// `String.prototype.trimEnd`.
    static func trimEnd(_ s: String) -> String {
        var a = scalars(s)
        while let last = a.last, isWS(last) { a.removeLast() }
        return string(a)
    }

    /// `s.replace(/\s+/g, ' ')`: each whitespace run becomes one space (not trimmed).
    static func collapse(_ s: String) -> String { ShareText.replaceRuns(s, isWS) }

    /// `String(s).trim().split(/\s+/).filter(Boolean)`: the whitespace-separated words.
    static func words(_ s: String?) -> [String] {
        var out: [String] = []
        var cur = String.UnicodeScalarView()
        for u in (s ?? "").unicodeScalars {
            if isWS(u) {
                if !cur.isEmpty { out.append(String(cur)) }
                cur = String.UnicodeScalarView()
            } else {
                cur.append(u)
            }
        }
        if !cur.isEmpty { out.append(String(cur)) }
        return out
    }

    /// CRLF and CR become LF (`s.replace(/\r\n?/g, '\n')`).
    static func lf(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        var cr = false
        for u in s.unicodeScalars {
            if cr {
                cr = false
                if u == "\n" { continue }
            }
            if u == "\r" {
                out.append("\n")
                cr = true
            } else {
                out.append(u)
            }
        }
        return String(out)
    }

    /// The lines of `s` split at CRLF, CR or LF (`s.split(/\r\n|\r|\n/)`).
    static func lines(_ s: String) -> [String] {
        var out: [String] = []
        var cur = String.UnicodeScalarView()
        var cr = false
        for u in s.unicodeScalars {
            if cr {
                cr = false
                if u == "\n" { continue }
            }
            if u == "\r" || u == "\n" {
                out.append(String(cur))
                cur = String.UnicodeScalarView()
                cr = u == "\r"
            } else {
                cur.append(u)
            }
        }
        out.append(String(cur))
        return out
    }

    /// Text escaped for HTML text: `&`, `<`, `>`.
    static func escapeText(_ s: String) -> String { escape(s, quotes: false) }

    /// Text escaped for a quoted attribute: `escapeText` and `"`.
    static func escapeAttr(_ s: String) -> String { escape(s, quotes: true) }

    /// Scalar by scalar: a `"` followed by a combining mark is still a `"` (a `Character` would hold both).
    private static func escape(_ s: String, quotes: Bool) -> String {
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            switch u {
            case "&": out.append(contentsOf: "&amp;".unicodeScalars)
            case "<": out.append(contentsOf: "&lt;".unicodeScalars)
            case ">": out.append(contentsOf: "&gt;".unicodeScalars)
            case "\"" where quotes: out.append(contentsOf: "&quot;".unicodeScalars)
            default: out.append(u)
            }
        }
        return String(out)
    }

    // MARK: Character classes

    static func isDigit(_ u: Unicode.Scalar) -> Bool { u.value >= 0x30 && u.value <= 0x39 }
    static func isASCIILetter(_ u: Unicode.Scalar) -> Bool { ShareText.isASCIILetter(u) }
    static func isASCIIAlnum(_ u: Unicode.Scalar) -> Bool { isDigit(u) || isASCIILetter(u) }
    static func isHex(_ u: Unicode.Scalar) -> Bool {
        isDigit(u) || (u.value >= 0x41 && u.value <= 0x46) || (u.value >= 0x61 && u.value <= 0x66)
    }

    /// JavaScript's `\w`, which `\b` is made of: ASCII letters, digits and `_`.
    static func isWordChar(_ u: Unicode.Scalar) -> Bool { isASCIIAlnum(u) || u == "_" }

    static func lowerASCII(_ u: Unicode.Scalar) -> Unicode.Scalar { ShareText.lowerASCII(u) }

    /// `s` holds `word` at `i`, comparing ASCII letters case-insensitively (`word` is lowercase ASCII).
    static func hasCI(_ s: Scalars, at i: Int, _ word: String) -> Bool {
        let w = Array(word.unicodeScalars)
        guard i >= 0, i + w.count <= s.count else { return false }
        for k in 0..<w.count where lowerASCII(s[i + k]) != w[k] { return false }
        return true
    }

    /// `s` holds `word` at `i`, exactly.
    static func has(_ s: Scalars, at i: Int, _ word: String) -> Bool {
        let w = Array(word.unicodeScalars)
        guard i >= 0, i + w.count <= s.count else { return false }
        for k in 0..<w.count where s[i + k] != w[k] { return false }
        return true
    }

    /// The index of the first `word` in `s` at or after `from`, or nil.
    static func index(of word: String, in s: Scalars, from: Int = 0) -> Int? {
        let w = Array(word.unicodeScalars)
        guard let first = w.first, from <= s.count - w.count else { return nil }
        var i = max(0, from)
        while i <= s.count - w.count {
            if s[i] == first && has(s, at: i, word) { return i }
            i += 1
        }
        return nil
    }

    static func index(of u: Unicode.Scalar, in s: Scalars, from: Int = 0) -> Int? {
        var i = max(0, from)
        while i < s.count {
            if s[i] == u { return i }
            i += 1
        }
        return nil
    }

    // MARK: URI components

    /// `decodeURIComponent`: every `%XX` decoded as UTF-8 (`+` stays `+`). nil where the JavaScript throws: a `%`
    /// without two hex digits after it, or bytes that are not valid UTF-8 (overlong forms, surrogates, past U+10FFFF, a
    /// bad continuation).
    static func decodeURIComponent(_ s: String) -> String? {
        let a = scalars(s)
        guard a.contains("%") else { return s }
        var out = String.UnicodeScalarView()
        func hexValue(_ u: Unicode.Scalar) -> UInt32? {
            switch u.value {
            case 0x30...0x39: return u.value - 0x30
            case 0x41...0x46: return u.value - 0x41 + 10
            case 0x61...0x66: return u.value - 0x61 + 10
            default: return nil
            }
        }
        /// The byte of the escape "%XX" at k, or nil.
        func byte(at k: Int) -> UInt32? {
            guard k + 2 < a.count, a[k] == "%", let h = hexValue(a[k + 1]), let l = hexValue(a[k + 2]) else { return nil }
            return h * 16 + l
        }
        var i = 0
        while i < a.count {
            guard a[i] == "%" else {
                out.append(a[i])
                i += 1
                continue
            }
            guard let b = byte(at: i) else { return nil }
            i += 3
            if b < 0x80 {
                out.append(Unicode.Scalar(b)!)
                continue
            }
            let n: Int
            if b & 0xE0 == 0xC0 { n = 2 } else if b & 0xF0 == 0xE0 { n = 3 } else if b & 0xF8 == 0xF0 { n = 4 } else { return nil }
            var cp = b & (0xFF >> UInt32(n + 1))
            for _ in 1..<n {
                guard let c = byte(at: i), c & 0xC0 == 0x80 else { return nil }
                cp = (cp << 6) | (c & 0x3F)
                i += 3
            }
            let min: UInt32 = n == 2 ? 0x80 : n == 3 ? 0x800 : 0x10000
            guard cp >= min, cp <= 0x10FFFF, !(0xD800...0xDFFF).contains(cp), let u = Unicode.Scalar(cp) else { return nil }
            out.append(u)
        }
        return String(out)
    }

    /// `encodeURIComponent`: UTF-8, percent-encoded with uppercase hex, except `A-Z a-z 0-9 - _ . ! ~ * ' ( )`. (Swift
    /// strings hold no lone surrogates, so it never fails where the JavaScript would throw.)
    static func encodeURIComponent(_ s: String) -> String {
        let hex = Array("0123456789ABCDEF".unicodeScalars)
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            if isASCIIAlnum(u) || "-_.!~*'()".unicodeScalars.contains(u) {
                out.append(u)
                continue
            }
            for b in String(u).utf8 {
                out.append("%")
                out.append(hex[Int(b >> 4)])
                out.append(hex[Int(b & 15)])
            }
        }
        return String(out)
    }

    // MARK: URLs as text

    /// A URL as text (the input has passed the web URL rule): the JavaScript `urlParts`.
    struct URLParts {
        var scheme: String
        var authority: String
        var hostport: String
        /// Lowercased, without the port; a bracketed IPv6 address keeps its brackets.
        var host: String
        var path: String
        var query: String?
        var fragment: String?

        /// The URL again, with `query` in place of the original (nil: none).
        func joined(query: String?) -> String {
            "\(scheme)://\(authority)\(path)\(query.map { "?" + $0 } ?? "")\(fragment.map { "#" + $0 } ?? "")"
        }
    }

    static func urlParts(_ url: String) -> URLParts {
        let u = scalars(url)
        let i = index(of: "://", in: u) ?? 0
        var rest = Array(u[min(u.count, i + 3)...])
        var fragment: String?
        var query: String?
        if let h = index(of: "#", in: rest) {
            fragment = string(rest[(h + 1)...])
            rest = Array(rest[..<h])
        }
        if let q = index(of: "?", in: rest) {
            query = string(rest[(q + 1)...])
            rest = Array(rest[..<q])
        }
        let slash = index(of: "/", in: rest)
        let authority = slash.map { Array(rest[..<$0]) } ?? rest
        let hostport = authority.lastIndex(of: "@").map { Array(authority[($0 + 1)...]) } ?? authority
        let host: Scalars
        if hostport.first == "[" {
            host = index(of: "]", in: hostport).map { Array(hostport[...$0]) } ?? []
        } else {
            host = index(of: ":", in: hostport).map { Array(hostport[..<$0]) } ?? hostport
        }
        return URLParts(scheme: string(u[..<min(i, u.count)]), authority: string(authority), hostport: string(hostport),
                        host: string(host).lowercased(), path: slash.map { string(rest[$0...]) } ?? "", query: query,
                        fragment: fragment)
    }

    /// `host === domain || host.endsWith('.' + domain)`.
    static func hostIs(_ host: String, _ domain: String) -> Bool { same(host, domain) || endsWith(host, "." + domain) }

    // MARK: HTML as text

    /// Undoes the character references a serialiser writes: `&amp; &lt; &gt; &quot; &#39; &apos;` and numeric ones
    /// (`&#…;` of 1-7 digits, `&#x…;` of 1-6 hex digits; zero, a surrogate or past U+10FFFF stays as written).
    static func decodeEntities(_ s: String) -> String {
        let a = scalars(s)
        guard a.contains("&") else { return s }
        var out = String.UnicodeScalarView()
        var i = 0
        while i < a.count {
            guard a[i] == "&", let (replacement, length) = entity(a, at: i) else {
                out.append(a[i])
                i += 1
                continue
            }
            out.append(contentsOf: replacement.unicodeScalars)
            i += length
        }
        return String(out)
    }

    /// The reference at `i` (`&(amp|lt|gt|quot|apos|#39|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});`): what replaces it and its
    /// length, or nil when none starts there.
    private static func entity(_ a: Scalars, at i: Int) -> (String, Int)? {
        for (name, value) in [("amp", "&"), ("lt", "<"), ("gt", ">"), ("quot", "\""), ("apos", "'"), ("#39", "'")]
        where has(a, at: i + 1, name + ";") {
            return (value, name.unicodeScalars.count + 2)
        }
        guard i + 1 < a.count, a[i + 1] == "#" else { return nil }
        var j = i + 2
        var hex = false
        if j < a.count, a[j] == "x" || a[j] == "X" {
            hex = true
            j += 1
        }
        let start = j
        while j < a.count, hex ? isHex(a[j]) : isDigit(a[j]) { j += 1 }
        let digits = j - start
        guard digits >= 1, digits <= (hex ? 6 : 7), j < a.count, a[j] == ";" else {
            // `&#x;` is not hex: a decimal reference cannot start with x either.
            return nil
        }
        let text = string(a[start..<j])
        let length = j + 1 - i
        guard let n = UInt32(text, radix: hex ? 16 : 10), n > 0, n <= 0x10FFFF, !(0xD800...0xDFFF).contains(n),
              let u = Unicode.Scalar(n) else {
            return (string(a[i..<(j + 1)]), length)
        }
        return (String(u), length)
    }

    /// An attribute's raw value in a tag's attribute text, or nil: the reference's
    /// `/(?:^|[\s"'/])([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g`, taken match by match: the
    /// first whose name, lowercased, is `name` gives its value (quoted with `"` or `'`, or unquoted; "" without one).
    static func attrValue(_ attrs: String, _ name: String) -> String? {
        let a = scalars(attrs)
        let n = a.count
        func isNameChar(_ u: Unicode.Scalar) -> Bool { !isWS(u) && u != "\"" && u != "'" && u != ">" && u != "/" && u != "=" }
        var p = 0
        while p < n {
            // (?:^|[\s"'/]): at the start, the name may begin at once; else one of those characters comes first.
            var start: Int?
            if p == 0 && isNameChar(a[0]) {
                start = 0
            } else if isWS(a[p]) || a[p] == "\"" || a[p] == "'" || a[p] == "/" {
                if p + 1 < n && isNameChar(a[p + 1]) { start = p + 1 }
            }
            guard let s = start else {
                p += 1
                continue
            }
            var e = s
            while e < n && isNameChar(a[e]) { e += 1 }
            let attrName = string(a[s..<e])
            // The optional value: \s*=\s* then "…", '…' or an unquoted run.
            var value: String?
            var end = e
            var k = e
            while k < n && isWS(a[k]) { k += 1 }
            if k < n && a[k] == "=" {
                k += 1
                while k < n && isWS(a[k]) { k += 1 }
                if k < n && (a[k] == "\"" || a[k] == "'") {
                    let q = a[k]
                    if let close = index(of: q, in: a, from: k + 1) {
                        value = string(a[(k + 1)..<close])
                        end = close + 1
                    }
                } else {
                    var v = k
                    while v < n && !isWS(a[v]) && !"\"'=<>`".unicodeScalars.contains(a[v]) { v += 1 }
                    if v > k {
                        value = string(a[k..<v])
                        end = v
                    }
                }
            }
            if same(attrName.lowercased(), name) { return value ?? "" }
            p = end
        }
        return nil
    }

    /// The attribute part of a tag from `from`, `((?:[^<>"']|"[^<"]*"|'[^<']*')*)>`: the index of its closing `>`, or
    /// nil when no tag ends there. Linear: the scan never passes a `<`.
    static func tagEnd(_ s: Scalars, from: Int) -> Int? {
        var j = from
        while j < s.count {
            let c = s[j]
            if c == ">" { return j }
            if c == "<" { return nil }
            if c == "\"" || c == "'" {
                var k = j + 1
                while k < s.count && s[k] != c && s[k] != "<" { k += 1 }
                if k >= s.count || s[k] == "<" { return nil }
                j = k + 1
            } else {
                j += 1
            }
        }
        return nil
    }

    /// One tag: `<` closing? name attrs `>`, from `start` to `end` (exclusive), in scalar offsets.
    struct Tag {
        var start: Int
        var end: Int
        var closing: Bool
        var name: String
        var attrs: String
    }

    static func isTagNameChar(_ u: Unicode.Scalar) -> Bool { isASCIIAlnum(u) || u == "-" }

    /// The reference's `TAG_RE`
    /// (`/<(\/?)([A-Za-z][A-Za-z0-9-]*)(?![A-Za-z0-9-])((?:[^<>"']|"[^<"]*"|'[^<']*')*)>/g`): its matches, left to right.
    static func tags(_ s: Scalars) -> [Tag] {
        var out: [Tag] = []
        var p = index(of: "<", in: s)
        while let at = p {
            var j = at + 1
            let closing = j < s.count && s[j] == "/"
            if closing { j += 1 }
            var tag: Tag?
            if j < s.count, isASCIILetter(s[j]) {
                let nameStart = j
                while j < s.count && isTagNameChar(s[j]) { j += 1 }
                if let gt = tagEnd(s, from: j) {
                    tag = Tag(start: at, end: gt + 1, closing: closing, name: string(s[nameStart..<j]), attrs: string(s[j..<gt]))
                }
            }
            if let tag {
                out.append(tag)
                p = index(of: "<", in: s, from: tag.end)
            } else {
                p = index(of: "<", in: s, from: at + 1)
            }
        }
        return out
    }
}
