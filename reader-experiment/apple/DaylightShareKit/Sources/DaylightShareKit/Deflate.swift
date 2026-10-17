import Foundation
#if canImport(Compression)
import Compression

/// Raw DEFLATE (RFC 1951, no zlib or gzip wrapper).
///
/// Apple's `COMPRESSION_ZLIB` (`Algorithm.zlib`) reads and writes exactly this format: Apple documents it as "the raw
/// DEFLATE format as described in IETF RFC 1951", the same as zlib's `deflateInit2`/`inflateInit2` with
/// windowBits -15. The tests check it both ways against zlib itself and against the JavaScript vectors.
public enum RawDeflate {
    public static func compress(_ data: Data) throws -> Data {
        var out = Data()
        let filter = try OutputFilter(.compress, using: .zlib, bufferCapacity: 65536) { chunk in
            if let chunk { out.append(chunk) }
        }
        try filter.write(data)
        try filter.finalize()
        return out
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
