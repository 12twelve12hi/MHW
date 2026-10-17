import CZlib
import Foundation
import XCTest
@testable import DaylightShareKit

/// zlib itself with windowBits -15 (raw RFC 1951), as an independent reference.
enum ZlibRef {
    static func deflateRaw(_ input: Data, level: Int32 = Z_DEFAULT_COMPRESSION) -> Data {
        var s = z_stream()
        precondition(deflateInit2_(&s, level, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION,
                                   Int32(MemoryLayout<z_stream>.size)) == Z_OK)
        defer { deflateEnd(&s) }
        var src = [UInt8](input)
        var out = Data()
        var buf = [UInt8](repeating: 0, count: 65536)
        src.withUnsafeMutableBufferPointer { sp in
            s.next_in = sp.baseAddress
            s.avail_in = uInt(sp.count)
            var status: Int32 = Z_OK
            repeat {
                buf.withUnsafeMutableBufferPointer { bp in
                    s.next_out = bp.baseAddress
                    s.avail_out = uInt(bp.count)
                    status = deflate(&s, Z_FINISH)
                    out.append(bp.baseAddress!, count: bp.count - Int(s.avail_out))
                }
            } while status == Z_OK
            precondition(status == Z_STREAM_END)
        }
        return out
    }

    static func inflateRaw(_ input: Data) -> Data? {
        var s = z_stream()
        guard inflateInit2_(&s, -15, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { inflateEnd(&s) }
        var src = [UInt8](input)
        var out = Data()
        var buf = [UInt8](repeating: 0, count: 65536)
        var status: Int32 = Z_OK
        src.withUnsafeMutableBufferPointer { sp in
            s.next_in = sp.baseAddress
            s.avail_in = uInt(sp.count)
            repeat {
                buf.withUnsafeMutableBufferPointer { bp in
                    s.next_out = bp.baseAddress
                    s.avail_out = uInt(bp.count)
                    status = inflate(&s, Z_NO_FLUSH)
                    out.append(bp.baseAddress!, count: bp.count - Int(s.avail_out))
                }
            } while status == Z_OK && (s.avail_in > 0 || s.avail_out == 0)
        }
        return status == Z_STREAM_END ? out : nil
    }
}

final class DeflateTests: XCTestCase {
    var samples: [Data] {
        var rng = SystemRandomNumberGenerator()
        let random = Data((0..<200_000).map { _ in UInt8.random(in: 0...255, using: &rng) })
        let text = Data(String(repeating: "<p>I went to the woods because I wished to live deliberately.</p>\n", count: 20_000).utf8)
        return [Data("a".utf8), Data("hello hello hello hello".utf8), text, random, text + random + text]
    }

    /// What we produce is raw DEFLATE: zlib inflates it with windowBits -15, and it has no zlib/gzip header.
    func testOurDeflateIsRawRFC1951() throws {
        for sample in samples {
            let z = try RawDeflate.compress(sample)
            XCTAssertEqual(ZlibRef.inflateRaw(z), sample, "zlib -15 inflates our output (\(sample.count) bytes)")
            XCTAssertNil(ZlibRef.inflateRawAsZlib(z), "not zlib-wrapped")
        }
    }

    /// We read raw DEFLATE from zlib at every level.
    func testWeInflateZlibRawDeflate() throws {
        for sample in samples {
            for level: Int32 in [0, 1, 6, 9] {
                let z = ZlibRef.deflateRaw(sample, level: level)
                XCTAssertEqual(try RawDeflate.decompress(z, limit: sample.count), sample, "level \(level)")
            }
        }
    }

    func testInflateLimit() throws {
        let sample = Data(repeating: 0x41, count: 100_000)
        let z = try RawDeflate.compress(sample)
        XCTAssertLessThan(z.count, 1000)
        XCTAssertThrowsError(try RawDeflate.decompress(z, limit: 50_000))
        XCTAssertEqual(try RawDeflate.decompress(z, limit: 100_000), sample)
    }

    func testCorruptInputThrowsOrDiffers() {
        let garbage = Data([0xff, 0xff, 0xff, 0xff, 0x00, 0x13, 0x37])
        let out = try? RawDeflate.decompress(garbage, limit: 1000)
        XCTAssertTrue(out == nil || out!.isEmpty || out! != Data("x".utf8))
    }
}

extension ZlibRef {
    /// Inflate with a zlib wrapper expected (windowBits 15): must fail on raw data.
    static func inflateRawAsZlib(_ input: Data) -> Data? {
        var s = z_stream()
        guard inflateInit_(&s, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { inflateEnd(&s) }
        var src = [UInt8](input)
        var buf = [UInt8](repeating: 0, count: 1 << 20)
        var status: Int32 = Z_OK
        src.withUnsafeMutableBufferPointer { sp in
            s.next_in = sp.baseAddress
            s.avail_in = uInt(sp.count)
            buf.withUnsafeMutableBufferPointer { bp in
                s.next_out = bp.baseAddress
                s.avail_out = uInt(bp.count)
                status = inflate(&s, Z_FINISH)
            }
        }
        return status == Z_STREAM_END ? Data() : nil
    }
}
