import Foundation

public enum ItemKind: String, Codable, CaseIterable {
    case url, page, file
}

/// An item header (PROTOCOL 2.1). Serialised with the JS reference's key order:
/// v, id, kind, url, title, name, mime, size, sha256, enc, sent, from, app, part, parts.
public struct ItemHeader: Codable, Equatable {
    public var id: String
    public var kind: ItemKind
    public var url: String?
    public var title: String?
    public var name: String?
    public var mime: String?
    public var size: Int?
    public var sha256: String?
    public var enc: String?
    public var sent: String
    public var from: String?
    public var app: String?
    public var part: Int?
    public var parts: Int?

    public init(id: String, kind: ItemKind, url: String? = nil, title: String? = nil, name: String? = nil,
                mime: String? = nil, size: Int? = nil, sha256: String? = nil, enc: String? = nil, sent: String,
                from: String? = nil, app: String? = nil, part: Int? = nil, parts: Int? = nil) {
        self.id = id
        self.kind = kind
        self.url = url
        self.title = title
        self.name = name
        self.mime = mime
        self.size = size
        self.sha256 = sha256
        self.enc = enc
        self.sent = sent
        self.from = from
        self.app = app
        self.part = part
        self.parts = parts
    }

    public var isDeflated: Bool { enc == "deflate-raw" }

    public var json: JSONOut {
        var o: [(String, JSONOut)] = [("v", .int(DLS.protocolVersion)), ("id", .string(id)), ("kind", .string(kind.rawValue))]
        if let url { o.append(("url", .string(url))) }
        if let title { o.append(("title", .string(title))) }
        if let name { o.append(("name", .string(name))) }
        if let mime { o.append(("mime", .string(mime))) }
        if let size { o.append(("size", .int(size))) }
        if let sha256 { o.append(("sha256", .string(sha256))) }
        if let enc { o.append(("enc", .string(enc))) }
        o.append(("sent", .string(sent)))
        if let from { o.append(("from", .string(from))) }
        if let app { o.append(("app", .string(app))) }
        if let part { o.append(("part", .int(part))) }
        if let parts { o.append(("parts", .int(parts))) }
        return .object(o)
    }

    /// The UTF-8 JSON bytes that go into a frame.
    public var jsonData: Data { json.data }

    /// This header for part `i` of `n` (parts and part only when n > 1, as in the JS).
    public func forPart(_ i: Int, of n: Int) -> ItemHeader {
        var h = self
        h.part = n > 1 ? i : nil
        h.parts = n > 1 ? n : nil
        return h
    }

    /// Validates an incoming (untrusted) item header and returns a cleaned copy with `enc`, `part` and `parts` set,
    /// or throws ShareError("header"). The same rules as `checkItemHeader` in the JS reference.
    public static func validated(_ h: [String: Any]) throws -> ItemHeader {
        func bad(_ why: String) -> ShareError { ShareError("header", why) }
        guard let id = h["id"] as? String, Hex.isLowerHex(id, count: 32) else { throw bad("id") }
        guard let kindRaw = h["kind"] as? String, let kind = ItemKind(rawValue: kindRaw) else { throw bad("kind") }
        var out = ItemHeader(id: id, kind: kind, sent: "")
        if !JSONRead.isNull(h["url"]) {
            guard let u = ShareText.webURL(JSONRead.coerceString(h["url"])) else { throw bad("url") }
            out.url = u
        }
        if (kind == .url || kind == .page) && out.url == nil { throw bad("url required") }
        let title = ShareText.cleanTitle(JSONRead.isNull(h["title"]) ? "" : JSONRead.coerceString(h["title"]))
        if !title.isEmpty { out.title = title }
        if kind != .url {
            // A page is at most the Reader's 8 MiB; a file at most 256 MiB (v1.1 senders send at most 9 MB).
            let maxSize = kind == .page ? DLS.maxPageHTML : DLS.maxDecoded
            guard let size = JSONRead.integer(h["size"]), size >= 0, size <= maxSize else { throw bad("size") }
            guard let sha = h["sha256"] as? String, Hex.isLowerHex(sha, count: 64) else { throw bad("sha256") }
            out.size = size
            out.sha256 = sha
            if kind == .page {
                out.mime = "text/html"
            } else {
                let m = JSONRead.coerceString(h["mime"])
                out.mime = ShareText.utf16Prefix((m.isEmpty ? "application/octet-stream" : m).lowercased(), 100)
                out.name = ShareText.safeFileName(JSONRead.isNull(h["name"]) ? "" : JSONRead.coerceString(h["name"]))
            }
        }
        let enc = JSONRead.isNull(h["enc"]) ? "identity" : (h["enc"] as? String ?? "")
        guard enc == "identity" || enc == "deflate-raw" else { throw bad("enc") }
        out.enc = enc
        let parts = JSONRead.isNull(h["parts"]) ? 1 : JSONRead.integer(h["parts"])
        let part = JSONRead.isNull(h["part"]) ? 0 : JSONRead.integer(h["part"])
        guard let parts, let part, parts >= 1, parts <= DLS.maxParts, part >= 0, part < parts else { throw bad("parts") }
        out.parts = parts
        out.part = part
        out.sent = (h["sent"] as? String).map { ShareText.utf16Prefix($0, 40) } ?? ""
        let from = ShareText.cleanName(JSONRead.isNull(h["from"]) ? "" : JSONRead.coerceString(h["from"]))
        if !from.isEmpty { out.from = from }
        if let app = h["app"] as? String { out.app = ShareText.utf16Prefix(app, 60) }
        return out
    }
}

/// An ack header (PROTOCOL 2.4): at most `DLS.maxAckIDs` (70) ids, so the frame is always a message.
public struct AckHeader: Equatable {
    public var ids: [String]
    public var sent: String
    public var from: String?

    public init(ids: [String], sent: String = ShareText.isoTimestamp(), from: String? = "Daylight") {
        self.ids = Array(ids.prefix(DLS.maxAckIDs))
        self.sent = sent
        self.from = from
    }

    public var json: JSONOut {
        var o: [(String, JSONOut)] = [("v", .int(DLS.protocolVersion)), ("kind", .string("ack")),
                                      ("ids", .array(ids.map { .string($0) })), ("sent", .string(sent))]
        let f = ShareText.cleanName(from)
        if !f.isEmpty { o.append(("from", .string(f))) }
        return .object(o)
    }

    /// The ids in an ack header from the ack topic (untrusted); nil when it is not an ack.
    public static func ids(in header: [String: Any]) -> [String]? {
        guard header["kind"] as? String == "ack", let ids = header["ids"] as? [Any] else { return nil }
        return ids.compactMap { $0 as? String }
    }
}
