import Foundation
#if canImport(Compression)
import Compression

/// Raw DEFLATE (RFC 1951, no zlib or gzip wrapper).
///
/// Apple's `COMPRESSION_ZLIB` (`Algorithm.zlib`) reads and writes exactly this format: Apple documents it as "the raw
/// DEFLATE format as described in IETF RFC 1951", the same as zlib's `deflateInit2`/`inflateInit2` with
/// windowBits -15. The tests check it both ways against zlib itself and against the JavaScript vectors.
public enum RawDeflate {
    /// The input goes to the compressor in pieces of this size, at the same offsets whether it is in memory (`compress`)
    /// or read from a file (`Stream`, F04's `FrameFileBuilder`), so both give the same bytes.
    public static let piece = 65_536

    public static func compress(_ data: Data) throws -> Data {
        var out = Data()
        let stream = try Stream { out.append($0) }
        try stream.write(data)
        try stream.finish()
        return out
    }

    /// Compresses input given in parts (any sizes): what goes in is cut into `piece`-sized writes at fixed offsets, so
    /// the output equals `compress` of the whole. `sink` gets the output as it comes.
    public final class Stream {
        private let filter: OutputFilter
        private var pending = Data()

        public init(_ sink: @escaping (Data) throws -> Void) throws {
            filter = try OutputFilter(.compress, using: .zlib, bufferCapacity: piece) { chunk in
                if let chunk { try sink(chunk) }
            }
        }

        public func write(_ data: Data) throws {
            var start = data.startIndex
            if !pending.isEmpty {
                let take = min(piece - pending.count, data.count)
                pending.append(data[start..<(start + take)])
                start += take
                guard pending.count == piece else { return }
                try filter.write(pending)
                pending = Data()
            }
            // Whole pieces straight from `data`, without a copy of it.
            while data.endIndex - start >= piece {
                try filter.write(data[start..<(start + piece)])
                start += piece
            }
            if start < data.endIndex { pending = Data(data[start..<data.endIndex]) }
        }

        public func finish() throws {
            if !pending.isEmpty { try filter.write(pending) }
            pending = Data()
            try filter.finalize()
        }
    }

    /// Inflates at most `limit` bytes; more throws (a decompression bomb, or a header that lies about its size).
    public static func decompress(_ data: Data, limit: Int) throws -> Data {
        var out = Data()
        let filter = try OutputFilter(.decompress, using: .zlib, bufferCapacity: 65536) { chunk in
            guard let chunk else { return }
            out.append(chunk)
            if out.count > limit { throw ShareError("integrity", "inflated past the declared size") }
        }
        try filter.write(data)
        try filter.finalize()
        return out
    }
}
#endif
