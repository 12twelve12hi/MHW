import Foundation
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

/// String helpers that mirror the JavaScript reference (`webUrl`, `findUrl`, `cleanTitle`, `cleanName`,
/// `safeFileName`, `normalizeRelay`). JavaScript lengths count UTF-16 code units and `[...s]` counts code points; the
/// Swift versions count the same way.
public enum ShareText {
    // MARK: Character classes

    /// JavaScript `\s`: WhiteSpace and LineTerminator.
    static func isJSWhitespace(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F,
             0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    /// `\p{Cc}`.
    static func isControl(_ u: Unicode.Scalar) -> Bool { u.value < 0x20 || (0x7F...0x9F).contains(u.value) }

    static func isSpaceOrControl(_ u: Unicode.Scalar) -> Bool { isJSWhitespace(u) || isControl(u) }

    /// JavaScript `String.prototype.trim`.
    static func jsTrim(_ s: String) -> String {
        let scalars = Array(s.unicodeScalars)
        var a = 0
        var b = scalars.count
        while a < b && isJSWhitespace(scalars[a]) { a += 1 }
        while b > a && isJSWhitespace(scalars[b - 1]) { b -= 1 }
        var v = String.UnicodeScalarView()
        v.append(contentsOf: scalars[a..<b])
        return String(v)
    }

    /// Replaces each run of scalars matching `match` with one space.
    static func replaceRuns(_ s: String, _ match: (Unicode.Scalar) -> Bool) -> String {
        var v = String.UnicodeScalarView()
        var inRun = false
        for u in s.unicodeScalars {
            if match(u) {
                if !inRun { v.append(" ") }
                inRun = true
            } else {
                v.append(u)
                inRun = false
            }
        }
        return String(v)
    }

    /// The first `count` UTF-16 code units, never splitting a surrogate pair.
    static func utf16Prefix(_ s: String, _ count: Int) -> String {
        if s.utf16.count <= count { return s }
        var v = String.UnicodeScalarView()
        var used = 0
        for u in s.unicodeScalars {
            let w = u.value > 0xFFFF ? 2 : 1
            if used + w > count { break }
            v.append(u)
            used += w
        }
        return String(v)
    }

    /// The first `count` code points.
    static func scalarPrefix(_ s: String, _ count: Int) -> String {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s.unicodeScalars.prefix(count))
        return String(v)
    }

    // MARK: Cleaning

    /// Control characters and whitespace runs -> one space, trimmed, at most `max` code points.
    static func clean(_ s: String?, max: Int) -> String {
        let t = jsTrim(replaceRuns(s ?? "", isSpaceOrControl))
        return scalarPrefix(t, max)
    }

    /// A display title (at most 300 code points), or "".
    public static func cleanTitle(_ s: String?) -> String { clean(s, max: DLS.maxTitle) }

    /// A device or Daylight name (at most 60 code points), or "".
    public static func cleanName(_ s: String?) -> String { clean(s, max: DLS.maxName) }

    /// A safe file name (PROTOCOL 5; vectors > fileNames): split on runs of `/` and `\`; in each segment turn each run
    /// of control characters and `: * ? " < > |` into one space and each run of whitespace into one space, drop leading
    /// dots and whitespace, trim; drop empty segments; join with one space; empty -> `fallback`. Over 120 UTF-16 units
    /// or 200 UTF-8 bytes: keep the extension (from the last `.`, if that is not the first character and 1-10 units
    /// follow it) and remove whole code points from the end of the rest until both limits hold. (Swift strings cannot
    /// hold lone surrogates, which the rule removes first.)
    public static func safeFileName(_ name: String?, fallback: String = "document") -> String {
        var segments: [String] = []
        var current = String.UnicodeScalarView()
        func flush() {
            var seg = replaceRuns(String(current), { isControl($0) || ":*?\"<>|".unicodeScalars.contains($0) })
            seg = replaceRuns(seg, isJSWhitespace)
            var v = seg.unicodeScalars[...]
            while let first = v.first, first == "." || isJSWhitespace(first) { v = v.dropFirst() }
            seg = jsTrim(String(String.UnicodeScalarView(v)))
            if !seg.isEmpty { segments.append(seg) }
            current = String.UnicodeScalarView()
        }
        for u in (name ?? "").unicodeScalars {
            if u == "/" || u == "\\" { flush() } else { current.append(u) }
        }
        flush()
        let s = segments.isEmpty ? fallback : segments.joined(separator: " ")
        if s.utf16.count <= 120 && s.utf8.count <= 200 { return s }
        let scalars = Array(s.unicodeScalars)
        var extStart = scalars.count
        if let dot = scalars.lastIndex(of: "."), dot > 0 {
            let after = scalars[(dot + 1)...].reduce(0) { $0 + utf16Width($1) }
            if after >= 1 && after <= 10 { extStart = dot }
        }
        let ext = Array(scalars[extStart...])
        var base = Array(scalars[..<extStart])
        var units = (base + ext).reduce(0) { $0 + utf16Width($1) }
        var bytes = (base + ext).reduce(0) { $0 + utf8Width($1) }
        while let last = base.last, units > 120 || bytes > 200 {
            base.removeLast()
            units -= utf16Width(last)
            bytes -= utf8Width(last)
        }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: base)
        out.append(contentsOf: ext)
        return String(out)
    }

    static func utf16Width(_ u: Unicode.Scalar) -> Int { u.value > 0xFFFF ? 2 : 1 }

    static func utf8Width(_ u: Unicode.Scalar) -> Int {
        switch u.value {
        case 0..<0x80: return 1
        case 0x80..<0x800: return 2
        case 0x800..<0x10000: return 3
        default: return 4
        }
    }

    // MARK: Sizes for people

    /// ceil(bytes / 100,000) / 10 without a trailing ".0": 9,000,001 -> "9.1", 12,000,000 -> "12" (vectors > formatMB).
    public static func formatMB(_ bytes: Int) -> String {
        let tenths = (max(0, bytes) + 99_999) / 100_000
        return tenths % 10 == 0 ? "\(tenths / 10)" : "\(tenths / 10).\(tenths % 10)"
    }

    /// The sentence for content over `DLS.maxItem`, at share time and on an expired / too-large row.
    public static func tooBigMessage(_ size: Int) -> String {
        "Too big to send. Files can be up to 9 MB; this one is \(formatMB(size)) MB."
    }

    // MARK: URLs

    typealias Scalars = ArraySlice<Unicode.Scalar>

    static func string(_ s: Scalars) -> String {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s)
        return String(v)
    }

    static func isDigit(_ u: Unicode.Scalar) -> Bool { u.value >= 0x30 && u.value <= 0x39 }
    static func isASCIILetter(_ u: Unicode.Scalar) -> Bool { (u.value | 0x20) >= 0x61 && (u.value | 0x20) <= 0x7A }
    static func lowerASCII(_ u: Unicode.Scalar) -> Unicode.Scalar {
        u.value >= 0x41 && u.value <= 0x5A ? Unicode.Scalar(u.value + 0x20)! : u
    }

    /// `rest` starts with `prefix`, comparing ASCII letters case-insensitively.
    static func hasPrefixIgnoringCase(_ rest: Scalars, _ prefix: String) -> Bool {
        let p = Array(prefix.unicodeScalars)
        return rest.count >= p.count && zip(rest, p).allSatisfy { lowerASCII($0) == $1 }
    }

    /// Splits `[user@]host[:port]` (the authority without user info is what follows the last `@`) into the host and,
    /// when there is a `:` after it, the port text. Bracketed IPv6 hosts run to the first `]`. nil when a bracket is
    /// not closed or something other than `:port` follows it.
    static func hostAndPort(_ authority: Scalars) -> (host: Scalars, port: Scalars?)? {
        let hostPort = authority.lastIndex(of: "@").map { authority[($0 + 1)...] } ?? authority
        if hostPort.first == "[" {
            guard let close = hostPort.firstIndex(of: "]") else { return nil }
            let after = hostPort[(close + 1)...]
            if after.isEmpty { return (hostPort[...close], nil) }
            guard after.first == ":" else { return nil }
            return (hostPort[...close], after.dropFirst())
        }
        guard let colon = hostPort.firstIndex(of: ":") else { return (hostPort, nil) }
        return (hostPort[..<colon], hostPort[(colon + 1)...])
    }

    /// The web URL rule (PROTOCOL 4 "Web URL"; vectors > urls): the trimmed input unchanged, or nil. Textual, so every
    /// language decides the same way: no whitespace or control characters, at most 4096 UTF-16 units, `http://` or
    /// `https://` (any case), a non-empty host that does not start with `.` and has none of `< > ^ | \`, and a port of
    /// ASCII digits only (after the first `:` of a host that is not bracketed).
    public static func webURL(_ raw: String?) -> String? {
        let s = jsTrim(raw ?? "")
        guard !s.isEmpty, s.utf16.count <= DLS.maxURL else { return nil }
        let u = Array(s.unicodeScalars)[...]
        if u.contains(where: isSpaceOrControl) { return nil }
        let rest: Scalars
        if hasPrefixIgnoringCase(u, "https://") {
            rest = u.dropFirst(8)
        } else if hasPrefixIgnoringCase(u, "http://") {
            rest = u.dropFirst(7)
        } else {
            return nil
        }
        let authority = rest.prefix(while: { $0 != "/" && $0 != "?" && $0 != "#" })
        guard let parts = hostAndPort(authority) else { return nil }
        let host = parts.host
        if let port = parts.port, !port.allSatisfy(isDigit) { return nil }
        guard let first = host.first, first != ".", !host.contains(where: { "<>^|\\".unicodeScalars.contains($0) }) else {
            return nil
        }
        return s
    }

    /// The first http(s) URL in a piece of shared text ("Title https://...").
    public static func findURL(_ text: String?) -> String? {
        let t = text ?? ""
        guard let r = t.range(of: "https?://[^\\s<>\"']+", options: [.regularExpression, .caseInsensitive]) else {
            return nil
        }
        var m = String(t[r])
        while let last = m.last, "),.;!?".contains(last) { m.removeLast() }
        return webURL(m)
    }

    /// The relay URL rule (PROTOCOL 1.3; vectors > relays). Textual, the same in every language: trim; empty ->
    /// `https://ntfy.sh`; whitespace or a control character left inside is an error; a scheme other than http(s) is an
    /// error (never turned into `https://…`), no scheme -> `https://`; drop the query, fragment and user info; the host
    /// is required and lowercased: ASCII letters, digits, `-` and `.` starting with a letter or digit, or a bracketed
    /// IPv6 address of hex digits, `:` and `.` only (no zone id); a port is digits, dropped when it is the text "443"
    /// (https) or "80" (http), so ":0443" stays; no `.` or `..` path segments; trailing slashes removed.
    /// Throws ShareError("relay").
    public static func normalizeRelay(_ relay: String?) throws -> String {
        func bad(_ message: String = "That relay address isn’t valid.") -> ShareError { ShareError("relay", message) }
        let trimmed = jsTrim(relay ?? "")
        if trimmed.isEmpty { return DLS.defaultRelay }
        var s = Array(trimmed.unicodeScalars)[...]
        if s.contains(where: isSpaceOrControl) { throw bad() }
        // A scheme: ^[A-Za-z][A-Za-z0-9+.-]*://
        var scheme = "https"
        if let first = s.first, isASCIILetter(first) {
            let name = s.prefix(while: { isASCIILetter($0) || isDigit($0) || $0 == "+" || $0 == "." || $0 == "-" })
            let after = s[name.endIndex...]
            if hasPrefixIgnoringCase(after, "://") {
                scheme = string(name).lowercased()
                guard scheme == "http" || scheme == "https" else { throw bad("The relay must be an http(s) address.") }
                s = after.dropFirst(3)
            }
        }
        let authority = s.prefix(while: { $0 != "/" && $0 != "?" && $0 != "#" })
        var path = s[authority.endIndex...].prefix(while: { $0 != "?" && $0 != "#" })
        guard let parts = hostAndPort(authority) else { throw bad() }
        let host = string(parts.host).lowercased()
        let port = parts.port.map { string($0) } ?? ""
        guard port.unicodeScalars.allSatisfy(isDigit) else { throw bad() }
        let hs = Array(host.unicodeScalars)
        if hs.first == "[" {
            let inner = hs.dropFirst().dropLast()
            guard hs.count >= 3, hs.last == "]",
                  inner.allSatisfy({ isDigit($0) || ($0.value >= 0x61 && $0.value <= 0x66) || $0 == ":" || $0 == "." })
            else { throw bad() }
        } else {
            guard let first = hs.first, isDigit(first) || (first.value >= 0x61 && first.value <= 0x7A),
                  hs.allSatisfy({ isDigit($0) || ($0.value >= 0x61 && $0.value <= 0x7A) || $0 == "." || $0 == "-" })
            else { throw bad() }
        }
        let shownPort = (scheme == "https" && port == "443") || (scheme == "http" && port == "80") ? "" : port
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        if segments.contains(where: { Array($0) == ["."] || Array($0) == [".", "."] }) { throw bad() }
        while path.last == "/" { path = path.dropLast() }
        return scheme + "://" + host + (shownPort.isEmpty ? "" : ":" + shownPort) + string(path)
    }

    /// The relay as people see it: the normalised relay's host and port, as text ("relay.example.org",
    /// "relay.example.org:8443", "[::1]:8080"). Not `URL.host`, which drops the port. Throws like `normalizeRelay`.
    public static func relayHost(_ relay: String?) throws -> String {
        let r = try normalizeRelay(relay)
        guard let sep = r.range(of: "://") else { return r }
        return String(r[sep.upperBound...].prefix(while: { $0 != "/" }))
    }

    // MARK: Time, MIME types

    /// ISO 8601 UTC with milliseconds, e.g. "2026-10-17T22:00:00.000Z" (JavaScript `toISOString`).
    public static func isoTimestamp(_ date: Date = Date()) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    /// Text types that senders compress (`TEXT_MIMES` in the JS).
    public static func isTextMime(_ mime: String) -> Bool {
        mime.range(of: "^(text/|application/(xhtml\\+xml|json|xml|javascript|x-markdown))",
                   options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static let mimeByExtension: [String: String] = [
        "pdf": "application/pdf",
        "epub": "application/epub+zip",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "odt": "application/vnd.oasis.opendocument.text",
        "rtf": "application/rtf",
        "md": "text/markdown", "markdown": "text/markdown", "mdown": "text/markdown",
        "html": "text/html", "htm": "text/html", "xhtml": "application/xhtml+xml",
        "txt": "text/plain", "text": "text/plain",
        "csv": "text/csv",
        "json": "application/json",
        "xml": "application/xml",
        "mobi": "application/x-mobipocket-ebook",
        "azw3": "application/vnd.amazon.ebook",
        "fb2": "application/x-fictionbook+xml",
        "cbz": "application/vnd.comicbook+zip",
        "djvu": "image/vnd.djvu",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
        "heic": "image/heic",
    ]

    /// The MIME type for a file name's extension; `application/octet-stream` when unknown.
    public static func mimeType(forFileName name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        if let m = mimeByExtension[ext] { return m }
        #if canImport(UniformTypeIdentifiers)
        if !ext.isEmpty, let t = UTType(filenameExtension: ext), let m = t.preferredMIMEType { return m.lowercased() }
        #endif
        return "application/octet-stream"
    }

    private static let extensionByMime: [String: String] = [
        "application/pdf": "pdf",
        "application/epub+zip": "epub",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "doc",
        "application/rtf": "rtf", "text/rtf": "rtf",
        "text/markdown": "md", "text/x-markdown": "md", "application/x-markdown": "md",
        "text/html": "html", "application/xhtml+xml": "xhtml",
        "text/plain": "txt", "text/csv": "csv",
        "application/json": "json", "application/xml": "xml", "text/xml": "xml",
        "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic",
    ]

    /// A file extension for a MIME type, for content that arrives without a file name.
    public static func fileExtension(forMime mime: String) -> String? {
        let m = mime.lowercased()
        if let e = extensionByMime[m] { return e }
        #if canImport(UniformTypeIdentifiers)
        if let t = UTType(mimeType: m), let e = t.preferredFilenameExtension { return e }
        #endif
        return nil
    }
}
