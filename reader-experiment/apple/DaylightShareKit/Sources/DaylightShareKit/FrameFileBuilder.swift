import Foundation

/// An item's frames as files, built from a file without ever holding all of it (LAB-PLAN F04, "Share in place"): the
/// share extension writes them, and a background `URLSession` uploads them after it has closed (`BackgroundPublisher`).
/// Each part's header carries `size`, `sha256` and `parts`, and for text types the part count depends on the compressed
/// length, so it works in two passes:
///
/// 1. **Measure.** Stream the source in `chunkSize` pieces through SHA-256 and, for text types, the raw-DEFLATE
///    compressor, into the encoded body (`encodedURL`: the outbox's stored body, which re-sends read as today). This
///    gives `size`, `sha256`, `enc` and the number of parts.
/// 2. **Seal.** Read the encoded body again part by part and seal each into `<id>-<part>.body` in `framesDirectory`:
///    base64 text for a small frame (a message), the raw frame for a large one (an attachment).
///
/// For the same id, `sent` and nonces the frames equal `ItemBuilder.prepare` + `PreparedItem.frame` byte for byte
/// (`FrameFileBuilderTests`); the compressor is fed the same pieces in both (`RawDeflate.Stream`).
public enum FrameFileBuilder {
    /// One frame file: its part, where it is, whether it goes as a message, and the frame's length in bytes.
    public struct FrameFile: Equatable {
        public let part: Int
        public let url: URL
        public let small: Bool
        public let length: Int
    }

    public struct Built {
        /// Part 0's header without part and parts (with the Lab fields it carries): what the outbox row keeps.
        public let header: ItemHeader
        public let encodedURL: URL
        public let encodedLength: Int
        public let frames: [FrameFile]

        public var id: String { header.id }
        public var parts: Int { frames.count }
        /// Whether any frame goes as an attachment.
        public var attachment: Bool { frames.contains { !$0.small } }
    }

    static func fileName(id: String, part: Int) -> String { "\(id)-\(part).body" }

    /// The frame files of `id` in `directory` (to delete them).
    public static func frameFiles(id: String, in directory: URL) -> [URL] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasPrefix("\(id)-") && $0.hasSuffix(".body") }.map { directory.appendingPathComponent($0) }
    }

    /// Builds the frames of `input` (a page or a file; its `content` is ignored) from the file at `source`. `input`
    /// gives the kind, id, url, title, name, mime, sent, from, app and Lab extras, as `ItemBuilder.prepare` reads them.
    /// Throws as `prepare` does (too big, not a web address), or a file error; on an error nothing is left behind.
    public static func build(source: URL, input: ItemInput, keys: ShareKeys, encodedURL: URL, framesDirectory: URL,
                             chunkSize: Int = DLS.chunk, compress: Bool? = nil, nonces: [Data]? = nil) throws -> Built {
        let kind = input.kind
        guard kind != .url else { throw ShareError("kind", "a link has no file") }
        let id = input.id ?? ItemBuilder.newID()
        guard Hex.isLowerHex(id, count: 32) else { throw ShareError("id", "bad item id") }
        var header = ItemHeader(id: id, kind: kind, sent: "")
        let url = (input.url ?? "").isEmpty ? nil : ShareText.webURL(input.url)
        if kind == .page && url == nil { throw ShareError("url", "That isn’t a web address.") }
        header.url = url
        let title = ShareText.cleanTitle(input.title)
        if !title.isEmpty { header.title = title }
        let size = try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? Int ?? 0
        if kind == .page {
            header.mime = "text/html"
            if size > DLS.maxPageHTML { throw ShareError("too-large", "The page is too large; send the link instead.") }
        }
        if size > DLS.maxItem { throw ShareError.tooLarge(size) }
        if kind == .file {
            header.name = ShareText.safeFileName(input.name)
            let m = (input.mime ?? "").isEmpty ? "application/octet-stream" : input.mime!
            header.mime = ShareText.utf16Prefix(m.lowercased(), 100)
        }
        let fm = FileManager.default
        try fm.createDirectory(at: encodedURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.createDirectory(at: framesDirectory, withIntermediateDirectories: true)
        var written: [URL] = []
        do {
            // 1. Measure: hash the source and write the encoded body, chunk by chunk.
            #if canImport(Compression) || DLS_ZLIB
            let shouldCompress = compress ?? (kind == .page || ShareText.isTextMime(header.mime ?? ""))
            #else
            let shouldCompress = false
            #endif
            let measured = try measure(source: source, to: encodedURL, compress: shouldCompress, chunkSize: chunkSize)
            written.append(encodedURL)
            guard measured.size <= DLS.maxItem else { throw ShareError.tooLarge(measured.size) }
            if kind == .page && measured.size > DLS.maxPageHTML {
                throw ShareError("too-large", "The page is too large; send the link instead.")
            }
            header.size = measured.size
            header.sha256 = measured.sha256
            if measured.deflated { header.enc = "deflate-raw" }
            header.sent = input.sent ?? ShareText.isoTimestamp()
            let from = ShareText.cleanName(input.from)
            if !from.isEmpty { header.from = from }
            if let app = input.app, !app.isEmpty { header.app = ShareText.utf16Prefix(app, 60) }
            header.extras = ItemBuilder.labExtras(input.extras, header: header, encodedLength: measured.encodedLength,
                                                  chunkSize: chunkSize)

            // 2. Seal, part by part.
            let n = PreparedItem.partCount(encodedLength: measured.encodedLength, chunkSize: chunkSize)
            let reader = try FileHandle(forReadingFrom: encodedURL)
            defer { try? reader.close() }
            var frames: [FrameFile] = []
            for i in 0..<n {
                let chunk = try reader.read(upToCount: chunkSize) ?? Data()
                let nonce = nonces.flatMap { i < $0.count ? $0[i] : nil }
                let frame = try Frame.seal(keys: keys, purpose: .inbox, header: header.forPart(i, of: n).json, body: chunk,
                                           nonce: nonce)
                let small = Frame.isSmall(frame.count)
                let file = framesDirectory.appendingPathComponent(fileName(id: id, part: i))
                try (small ? Data(Base64.encode(frame).utf8) : frame).write(to: file, options: .atomic)
                written.append(file)
                frames.append(FrameFile(part: i, url: file, small: small, length: frame.count))
            }
            return Built(header: header, encodedURL: encodedURL, encodedLength: measured.encodedLength, frames: frames)
        } catch {
            for f in written { try? fm.removeItem(at: f) }
            throw error
        }
    }

    struct Measured {
        var size: Int
        var sha256: String
        var deflated: Bool
        var encodedLength: Int
    }

    /// Pass 1: streams `source` through SHA-256 and (when `compress`) the compressor into `out`; keeps the compressed
    /// form only when it is smaller than the source, else `out` holds the source as it is (as `ItemBuilder.prepare`).
    static func measure(source: URL, to out: URL, compress: Bool, chunkSize: Int) throws -> Measured {
        let fm = FileManager.default
        let reader = try FileHandle(forReadingFrom: source)
        defer { try? reader.close() }
        _ = fm.createFile(atPath: out.path, contents: nil)
        let writer = try FileHandle(forWritingTo: out)
        var closed = false
        defer { if !closed { try? writer.close() } }
        var hasher = DLSCrypto.SHA256Stream()
        var size = 0
        var encodedLength = 0
        #if canImport(Compression) || DLS_ZLIB
        var deflater: RawDeflate.Stream?
        if compress {
            deflater = try RawDeflate.Stream { z in
                try writer.write(contentsOf: z)
                encodedLength += z.count
            }
        }
        #else
        let deflater: Void? = nil
        #endif
        while let chunk = try reader.read(upToCount: chunkSize), !chunk.isEmpty {
            hasher.update(chunk)
            size += chunk.count
            if size > DLS.maxItem { throw ShareError.tooLarge(size) }
            #if canImport(Compression) || DLS_ZLIB
            if let deflater {
                try deflater.write(chunk)
                continue
            }
            #endif
            try writer.write(contentsOf: chunk)
            encodedLength += chunk.count
        }
        var deflated = false
        #if canImport(Compression) || DLS_ZLIB
        if let deflater, size > 0 {
            try deflater.finish()
            deflated = encodedLength < size
        }
        #endif
        _ = deflater
        try writer.close()
        closed = true
        if compress && !deflated {
            // Not smaller (or empty): the body is the source as it is.
            try? fm.removeItem(at: out)
            try fm.copyItem(at: source, to: out)
            encodedLength = size
        }
        return Measured(size: size, sha256: hasher.finalizeHex(), deflated: deflated, encodedLength: encodedLength)
    }
}
