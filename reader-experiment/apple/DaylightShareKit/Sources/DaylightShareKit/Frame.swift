import Foundation

/// Which topic a frame belongs to; selects the AES-GCM additional data. An explicit map (LAB-PROTOCOL 2.4): every
/// purpose has its own AAD, and a purpose this enum does not name has none (`FramePurpose(rawValue:)` is nil, the JS
/// `aadFor` throws "purpose"), never a default. The four Lab lanes (return and control, with their acks) are derived
/// now and used from W2 and W3 (`LabTopics`).
public enum FramePurpose: String, CaseIterable {
    case inbox, ack
    case labReturn = "lab-return"
    case labReturnAck = "lab-return-ack"
    case labControl = "lab-control"
    case labControlAck = "lab-control-ack"

    /// The AAD's text: "dlshare/v1/inbox", "dlshare/v1/ack", "dlshare/v1/lab-return", …
    public var aadLabel: String {
        switch self {
        case .inbox: return DLS.labelInbox
        case .ack: return DLS.labelAck
        case .labReturn, .labReturnAck, .labControl, .labControlAck: return "dlshare/v1/" + rawValue
        }
    }

    var aad: Data { Data(aadLabel.utf8) }
}

/// A decrypted frame: the header as parsed JSON (untrusted), its exact bytes, and the body.
public struct OpenedFrame {
    public let header: [String: Any]
    public let headerJSON: Data
    public let body: Data
}

/// Frames (PROTOCOL 2): "DLS1" || nonce(12) || AES-256-GCM(key, nonce, u32be(len(header)) || header || body, aad).
public enum Frame {
    public static let magic = Data("DLS1".utf8)
    static let minLength = 4 + 12 + 16 + 4

    /// Seals already-serialised header bytes and a body. `nonce` is for tests; normally a fresh random one is used.
    public static func seal(keys: ShareKeys, purpose: FramePurpose, headerJSON: Data, body: Data = Data(),
                            nonce: Data? = nil) throws -> Data {
        let n = nonce ?? DLSCrypto.randomBytes(12)
        guard n.count == 12 else { throw ShareError("nonce", "nonce must be 12 bytes") }
        guard headerJSON.count <= DLS.maxHeaderBytes else {
            throw ShareError("header", "header of \(headerJSON.count) bytes (at most \(DLS.maxHeaderBytes))")
        }
        let len = UInt32(headerJSON.count)
        var plain = Data(capacity: 4 + headerJSON.count + body.count)
        plain.append(contentsOf: [UInt8(len >> 24), UInt8((len >> 16) & 0xff), UInt8((len >> 8) & 0xff), UInt8(len & 0xff)])
        plain.append(headerJSON)
        plain.append(body)
        let sealed = try DLSCrypto.seal(key: keys.key, nonce: n, plaintext: plain, aad: purpose.aad)
        var frame = Data(capacity: 16 + sealed.count)
        frame.append(magic)
        frame.append(n)
        frame.append(sealed)
        return frame
    }

    public static func seal(keys: ShareKeys, purpose: FramePurpose, header: JSONOut, body: Data = Data(),
                            nonce: Data? = nil) throws -> Data {
        try seal(keys: keys, purpose: purpose, headerJSON: header.data, body: body, nonce: nonce)
    }

    /// Frame bytes -> header and body. Throws ShareError("frame") for anything that is not a valid frame.
    public static func open(keys: ShareKeys, purpose: FramePurpose, frame: Data) throws -> OpenedFrame {
        let f = Data(frame) // index from 0
        guard f.count >= minLength else { throw ShareError("frame", "too short") }
        guard f.prefix(4) == magic else { throw ShareError("frame", "bad magic") }
        let plain: Data
        do {
            plain = Data(try DLSCrypto.open(key: keys.key, nonce: f.subdata(in: 4..<16), sealed: f.subdata(in: 16..<f.count),
                                            aad: purpose.aad))
        } catch {
            throw ShareError("frame", "does not decrypt")
        }
        guard plain.count >= 4 else { throw ShareError("frame", "short plaintext") }
        let hlen = Int(plain[0]) << 24 | Int(plain[1]) << 16 | Int(plain[2]) << 8 | Int(plain[3])
        guard hlen <= plain.count - 4, hlen <= DLS.maxHeaderBytes else { throw ShareError("frame", "bad header length") }
        let headerJSON = plain.subdata(in: 4..<(4 + hlen))
        guard String(data: headerJSON, encoding: .utf8) != nil, let header = JSONRead.object(headerJSON) else {
            throw ShareError("frame", "bad header")
        }
        guard JSONRead.integer(header["v"]) == DLS.protocolVersion else { throw ShareError("frame", "unsupported header") }
        return OpenedFrame(header: header, headerJSON: headerJSON, body: plain.subdata(in: (4 + hlen)..<plain.count))
    }

    /// Whether the frame goes as a message (base64 text, at most 3800 characters) rather than an attachment.
    public static func isSmall(_ frameLength: Int) -> Bool { Base64.encodedLength(frameLength) <= DLS.smallFrameBase64Max }
}

/// What an item is before it is sealed: its header (part 0, without part/parts) and the encoded body.
public struct PreparedItem {
    public var header: ItemHeader
    /// The body after `enc` (empty for `url`).
    public var encoded: Data

    public var id: String { header.id }

    /// Number of frames at `chunkSize`.
    public func partCount(chunkSize: Int = DLS.chunk) -> Int {
        max(1, (encoded.count + chunkSize - 1) / chunkSize)
    }

    /// Seals part `i` with a fresh nonce (or the given one).
    public func frame(part i: Int, keys: ShareKeys, chunkSize: Int = DLS.chunk, nonce: Data? = nil) throws -> Data {
        let n = partCount(chunkSize: chunkSize)
        precondition(i >= 0 && i < n)
        let start = encoded.startIndex + i * chunkSize
        let end = min(encoded.endIndex, start + chunkSize)
        let chunk = encoded.subdata(in: start..<end)
        return try Frame.seal(keys: keys, purpose: .inbox, header: header.forPart(i, of: n).json, body: chunk, nonce: nonce)
    }

    /// Whether any frame at `chunkSize` is too large for a message (it goes as an attachment): such an item is re-sent
    /// on the attachment schedule, and a pass that got a 413 skips it (CHANGES-v1.1 2.4).
    public func hasAttachment(chunkSize: Int = DLS.chunk) -> Bool {
        let n = partCount(chunkSize: chunkSize)
        return (0..<n).contains { i in
            let chunk = min(chunkSize, encoded.count - i * chunkSize)
            return !Frame.isSmall(4 + 12 + 4 + header.forPart(i, of: n).jsonData.count + max(0, chunk) + 16)
        }
    }

    /// All frames (small items; large ones are sealed one part at a time while publishing).
    public func frames(keys: ShareKeys, chunkSize: Int = DLS.chunk, nonces: [Data]? = nil) throws -> [Data] {
        try (0..<partCount(chunkSize: chunkSize)).map { i in
            try frame(part: i, keys: keys, chunkSize: chunkSize, nonce: nonces.flatMap { i < $0.count ? $0[i] : nil })
        }
    }
}

/// What a sender shares.
public struct ItemInput {
    public var kind: ItemKind
    public var id: String?
    public var url: String?
    public var title: String?
    public var name: String?
    public var mime: String?
    public var content: Data?
    public var sent: String?
    public var from: String?
    public var app: String?

    public init(kind: ItemKind, id: String? = nil, url: String? = nil, title: String? = nil, name: String? = nil,
                mime: String? = nil, content: Data? = nil, sent: String? = nil, from: String? = nil, app: String? = nil) {
        self.kind = kind
        self.id = id
        self.url = url
        self.title = title
        self.name = name
        self.mime = mime
        self.content = content
        self.sent = sent
        self.from = from
        self.app = app
    }

    public static func link(_ url: String, title: String? = nil) -> ItemInput { ItemInput(kind: .url, url: url, title: title) }

    public static func page(html: String, url: String, title: String? = nil) -> ItemInput {
        ItemInput(kind: .page, url: url, title: title, content: Data(html.utf8))
    }

    public static func file(_ content: Data, name: String, mime: String? = nil, title: String? = nil,
                            sourceURL: String? = nil) -> ItemInput {
        ItemInput(kind: .file, url: sourceURL, title: title, name: name,
                  mime: mime ?? ShareText.mimeType(forFileName: name), content: content)
    }
}

public enum ItemBuilder {
    /// A new item id: 16 random bytes as lowercase hex.
    public static func newID() -> String { Hex.encode(DLSCrypto.randomBytes(16)) }

    /// Validates, hashes and encodes an item (the JS `buildItemFrames` without the sealing).
    /// `compress`: nil = pages and text types only (the default), true/false to force.
    /// Throws ShareError("too-large", "Too big to send. Files can be up to 9 MB; …") for content over `DLS.maxItem`
    /// bytes before compression (a page over 8 MiB gets the page message: send its link instead).
    public static func prepare(_ item: ItemInput, compress: Bool? = nil) throws -> PreparedItem {
        let kind = item.kind
        let id = item.id ?? newID()
        guard Hex.isLowerHex(id, count: 32) else { throw ShareError("id", "bad item id") }
        var header = ItemHeader(id: id, kind: kind, sent: "")
        let url = (item.url ?? "").isEmpty ? nil : ShareText.webURL(item.url)
        if (kind == .url || kind == .page) && url == nil { throw ShareError("url", "That isn’t a web address.") }
        header.url = url
        let title = ShareText.cleanTitle(item.title)
        if !title.isEmpty { header.title = title }

        var content = Data()
        if kind != .url {
            guard let c = item.content else { throw ShareError("content", "missing content") }
            content = c
            if kind == .page {
                header.mime = "text/html"
                if content.count > DLS.maxPageHTML {
                    throw ShareError("too-large", "The page is too large; send the link instead.")
                }
            }
            // The one limit users see: 9 MB of content before compression, for every relay (PROTOCOL 2.3).
            if content.count > DLS.maxItem { throw ShareError.tooLarge(content.count) }
            if kind == .file {
                header.name = ShareText.safeFileName(item.name)
                let m = (item.mime ?? "").isEmpty ? "application/octet-stream" : item.mime!
                header.mime = ShareText.utf16Prefix(m.lowercased(), 100)
            }
            header.size = content.count
            header.sha256 = DLSCrypto.sha256Hex(content)
        }

        var encoded = content
        let shouldCompress = kind != .url && (compress ?? (kind == .page || ShareText.isTextMime(header.mime ?? "")))
        #if canImport(Compression) || DLS_ZLIB
        if shouldCompress && !content.isEmpty {
            let z = try RawDeflate.compress(content)
            if z.count < content.count {
                encoded = z
                header.enc = "deflate-raw"
            }
        }
        #endif

        header.sent = item.sent ?? ShareText.isoTimestamp()
        let from = ShareText.cleanName(item.from)
        if !from.isEmpty { header.from = from }
        if let app = item.app, !app.isEmpty { header.app = ShareText.utf16Prefix(app, 60) }

        return PreparedItem(header: header, encoded: encoded)
    }
}

/// Collects the parts of items (receiver side; the Daylight Inbox does this, the Apple apps use it in tests).
public final class Reassembler {
    private struct Pending {
        var parts: Int
        var chunks: [Int: Data]
        var header: ItemHeader
    }

    /// A complete, verified item. `header` has no part/parts.
    public struct Item {
        public let header: ItemHeader
        public let content: Data

        /// The Lab fields of part 0 (`x-cap`, `x-orig`; LAB-PROTOCOL 2.3), as the JS `Reassembler.add` returns them.
        public var extras: [String: String] { header.extras }
    }

    private var pending: [String: Pending] = [:]

    public init() {}

    /// Adds one opened frame. Returns the item once all its parts are in and it verifies; nil while incomplete.
    /// Throws ShareError("header") for a header that fails validation, ShareError("integrity") when the content
    /// does not match its size or SHA-256.
    public func add(header raw: [String: Any], body: Data) throws -> Item? {
        let h = try ItemHeader.validated(raw)
        if h.kind == .url {
            var clean = h
            clean.part = nil
            clean.parts = nil
            return Item(header: clean, content: Data())
        }
        let parts = h.parts ?? 1
        let part = h.part ?? 0
        var p = pending[h.id] ?? Pending(parts: parts, chunks: [:], header: h)
        if p.parts != parts { p = Pending(parts: parts, chunks: [:], header: h) }
        p.chunks[part] = Data(body)
        if part == 0 { p.header = h }
        if p.chunks.count < p.parts {
            pending[h.id] = p
            return nil
        }
        pending[h.id] = nil
        var encoded = Data()
        for i in 0..<p.parts { encoded.append(p.chunks[i]!) }
        let size = p.header.size ?? 0
        let content: Data
        if p.header.isDeflated {
            #if canImport(Compression) || DLS_ZLIB
            // Bounded: stops as soon as the output passes `size` (a decompression bomb never gets held).
            do {
                content = try RawDeflate.decompress(encoded, limit: size)
            } catch let e as ShareError {
                throw e
            } catch {
                throw ShareError("integrity", "bad deflate data")
            }
            #else
            throw ShareError("integrity", "deflate-raw is not available on this platform")
            #endif
        } else {
            content = encoded
        }
        guard content.count == size else { throw ShareError("integrity", "size mismatch") }
        guard DLSCrypto.sha256Hex(content) == p.header.sha256 else { throw ShareError("integrity", "sha256 mismatch") }
        var header = p.header
        header.part = nil
        header.parts = nil
        return Item(header: header, content: content)
    }
}
