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

    /// A safe file name (PROTOCOL 5): split on `/` and `\`; in each segment control characters and `: * ? " < > |`
    /// become spaces, whitespace collapses, trim, drop leading dots; drop empty segments; join with a space;
    /// empty -> `fallback`; over 120 characters -> cut, keeping an extension of up to 10 characters.
    public static func safeFileName(_ name: String?, fallback: String = "document") -> String {
        var segments: [String] = []
        var current = String.UnicodeScalarView()
        func flush() {
            var seg = replaceRuns(String(current), { isControl($0) || ":*?\"<>|".unicodeScalars.contains($0) })
            seg = jsTrim(replaceRuns(seg, isJSWhitespace))
            while seg.unicodeScalars.first == "." { seg.unicodeScalars.removeFirst() }
            seg = jsTrim(seg)
            if !seg.isEmpty { segments.append(seg) }
            current = String.UnicodeScalarView()
        }
        for u in (name ?? "").unicodeScalars {
            if u == "/" || u == "\\" { flush() } else { current.append(u) }
        }
        flush()
        var s = segments.joined(separator: " ")
        if s.isEmpty { s = fallback }
        let units = Array(s.utf16)
        if units.count > 120 {
            var ext = ""
            if let dot = units.lastIndex(of: 0x2E), dot > 0, units.count - dot <= 10 {
                ext = String(decoding: units[dot...], as: UTF16.self)
            }
            s = utf16Prefix(s, 120 - ext.utf16.count) + ext
        }
        return s
    }

    // MARK: URLs

    /// An absolute http(s) URL with a host, at most 4096 characters, without whitespace or control characters;
    /// returns the trimmed input, or nil.
    public static func webURL(_ raw: String?) -> String? {
        let s = jsTrim(raw ?? "")
        guard !s.isEmpty, s.utf16.count <= DLS.maxURL else { return nil }
        if s.unicodeScalars.contains(where: isSpaceOrControl) { return nil }
        let lower = s.lowercased()
        let rest: Substring
        if lower.hasPrefix("https://") {
            rest = s.dropFirst(8)
        } else if lower.hasPrefix("http://") {
            rest = s.dropFirst(7)
        } else {
            return nil
        }
        // Authority: up to the first / ? or #; drop user info and port; the host must be non-empty.
        let authority = rest.prefix(while: { $0 != "/" && $0 != "?" && $0 != "#" })
        var hostPort = authority
        if let at = authority.lastIndex(of: "@") { hostPort = authority[authority.index(after: at)...] }
        var host = hostPort
        if hostPort.hasPrefix("[") {
            guard let close = hostPort.firstIndex(of: "]") else { return nil }
            host = hostPort[hostPort.startIndex...close]
            let after = hostPort[hostPort.index(after: close)...]
            if !after.isEmpty && !(after.hasPrefix(":") && after.dropFirst().allSatisfy(\.isASCIIDigit)) { return nil }
        } else if let colon = hostPort.lastIndex(of: ":") {
            host = hostPort[..<colon]
            guard hostPort[hostPort.index(after: colon)...].allSatisfy(\.isASCIIDigit) else { return nil }
        }
        guard !host.isEmpty, !host.contains(where: { "<>^|\\".contains($0) }) else { return nil }
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

    /// A relay base URL: `https://` added when no scheme is given, origin + path, no trailing slash, no query or
    /// fragment. Empty -> the default relay.
    public static func normalizeRelay(_ relay: String?) throws -> String {
        var r = jsTrim(relay ?? "")
        if r.isEmpty { return DLS.defaultRelay }
        let lower = r.lowercased()
        if !(lower.hasPrefix("http://") || lower.hasPrefix("https://")) {
            // Stricter than the JS on purpose: "ftp://x" is refused rather than turned into "https://ftp//x".
            if lower.range(of: "^[a-z][a-z0-9+.-]*://", options: .regularExpression) != nil {
                throw ShareError("relay", "The relay must be http(s).")
            }
            r = "https://" + r
        }
        guard let c = URLComponents(string: r), let scheme = c.scheme?.lowercased(), let host = c.host, !host.isEmpty
        else { throw ShareError("relay", "That relay address isn’t a valid URL.") }
        guard scheme == "https" || scheme == "http" else { throw ShareError("relay", "The relay must be http(s).") }
        var origin = scheme + "://" + (host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host.lowercased())
        if let port = c.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) {
            origin += ":\(port)"
        }
        var path = c.percentEncodedPath
        while path.hasSuffix("/") { path.removeLast() }
        return origin + path
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

extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
