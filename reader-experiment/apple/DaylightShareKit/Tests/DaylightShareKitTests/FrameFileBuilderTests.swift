import Foundation
#if canImport(Darwin)
import Darwin
#endif
import XCTest
@testable import DaylightShareKit

/// Share in place's frame files (LAB-PLAN F04): built from a file in two passes, they equal `ItemBuilder.prepare` +
/// `PreparedItem.frame` byte for byte for the same nonces, for a binary file and for a text file that deflates; and the
/// resident memory grows by less than 40 MB while a 9 MB file is built.
final class FrameFileBuilderTests: XCTestCase {
    var dir: URL!
    let keys = ShareKeys(secret: Data(repeating: 7, count: 16))
    let sent = "2026-10-22T09:00:00.000Z"

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-frames-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func nonces(_ n: Int) -> [Data] { (0..<n).map { i in Data((0..<12).map { UInt8(truncatingIfNeeded: $0 * 31 + i) }) } }

    /// Builds both ways and compares every frame, the header and the encoded body.
    @discardableResult
    func assertSameFrames(_ content: Data, _ input: ItemInput, chunkSize: Int = DLS.chunk, file: StaticString = #filePath,
                          line: UInt = #line) throws -> FrameFileBuilder.Built {
        let source = dir.appendingPathComponent("source-\(UUID().uuidString)")
        try content.write(to: source)
        var memory = input
        memory.content = content
        let prepared = try ItemBuilder.prepare(memory)
        let n = prepared.partCount(chunkSize: chunkSize)
        let ns = nonces(n)
        let built = try FrameFileBuilder.build(source: source, input: input, keys: keys,
                                               encodedURL: dir.appendingPathComponent("\(input.id!).bin"),
                                               framesDirectory: dir.appendingPathComponent("bg"), chunkSize: chunkSize, nonces: ns)
        XCTAssertEqual(built.header, prepared.header, "the header", file: file, line: line)
        XCTAssertEqual(built.header.jsonData, prepared.header.jsonData, "the header's bytes", file: file, line: line)
        XCTAssertEqual(built.parts, n, "parts", file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: built.encodedURL), prepared.encoded, "the encoded body", file: file, line: line)
        XCTAssertEqual(built.encodedLength, prepared.encoded.count, file: file, line: line)
        XCTAssertEqual(built.attachment, prepared.hasAttachment(chunkSize: chunkSize), file: file, line: line)
        for (i, f) in built.frames.enumerated() {
            let expected = try prepared.frame(part: i, keys: keys, chunkSize: chunkSize, nonce: ns[i])
            let stored = try Data(contentsOf: f.url)
            XCTAssertEqual(f.small, Frame.isSmall(expected.count), "part \(i): small", file: file, line: line)
            XCTAssertEqual(f.length, expected.count, file: file, line: line)
            // A message is its base64 text, an attachment its bytes: what the relay is sent (`RelayClient.publishRequest`).
            XCTAssertEqual(stored, f.small ? Data(Base64.encode(expected).utf8) : expected, "part \(i)", file: file, line: line)
        }
        return built
    }

    func testABinaryFileGivesTheSameFrames() throws {
        var g = SystemRandomNumberGenerator()
        let content = Data((0..<(5 * 1_000_000 + 123)).map { _ in UInt8.random(in: 0...255, using: &g) })
        let built = try assertSameFrames(content, ItemInput(kind: .file, id: "0123456789abcdef0123456789abcdef",
                                                            title: "A report", name: "report.pdf", mime: "application/pdf",
                                                            sent: sent, from: "Test iPhone", app: "ios/test"))
        XCTAssertEqual(built.parts, 3)
        XCTAssertNil(built.header.enc, "a PDF is not compressed")
        XCTAssertTrue(built.attachment)
    }

    func testATextFileThatDeflatesGivesTheSameFrames() throws {
        let html = "<!doctype html><html><body>" + String(repeating: "<p>Paywalled article text, line after line.</p>\n", count: 90_000)
            + "</body></html>"
        let built = try assertSameFrames(Data(html.utf8), ItemInput(kind: .page, id: "00112233445566778899aabbccddeeff",
                                                                     url: "https://news.example/story", title: "Story", sent: sent,
                                                                     extras: ["x-cap": "seen"]))
        #if canImport(Compression) || DLS_ZLIB
        XCTAssertEqual(built.header.enc, "deflate-raw")
        #endif
        XCTAssertEqual(built.header.extras, ["x-cap": "seen"])
    }

    /// The pieces of a deflated body that spans chunks still match (the compressor is fed the same pieces).
    func testSmallChunksAndAFileThatDoesNotDeflate() throws {
        let text = (0..<40_000).map { "line \($0) \($0 * 7919 % 104_729)\n" }.joined()
        try assertSameFrames(Data(text.utf8), ItemInput(kind: .file, id: "ffeeddccbbaa99887766554433221100", name: "notes.txt",
                                                        mime: "text/plain", sent: sent), chunkSize: 65_536 * 3)
        var g = SystemRandomNumberGenerator()
        let noise = Data((0..<200_000).map { _ in UInt8.random(in: 0...255, using: &g) })
        let built = try assertSameFrames(noise, ItemInput(kind: .file, id: "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb", name: "noise.txt",
                                                          mime: "text/plain", sent: sent))
        XCTAssertNil(built.header.enc, "not smaller: sent as it is")
        try assertSameFrames(Data(), ItemInput(kind: .file, id: "cccccccccccccccccccccccccccccccc", name: "empty.txt",
                                               mime: "text/plain", sent: sent))
    }

    func testASmallPageIsOneMessage() throws {
        let built = try assertSameFrames(Data("<p>hello</p>".utf8), ItemInput(kind: .page, id: "dddddddddddddddddddddddddddddddd",
                                                                               url: "https://example.com/a", sent: sent))
        XCTAssertEqual(built.parts, 1)
        XCTAssertTrue(built.frames[0].small)
        XCTAssertFalse(built.attachment)
    }

    func testTooBigLeavesNothing() throws {
        let source = dir.appendingPathComponent("big")
        try Data(count: DLS.maxItem + 1).write(to: source)
        let bg = dir.appendingPathComponent("bg")
        XCTAssertThrowsError(try FrameFileBuilder.build(source: source, input: ItemInput(kind: .file, id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                                                                                         name: "big.pdf"),
                                                        keys: keys, encodedURL: dir.appendingPathComponent("big.bin"),
                                                        framesDirectory: bg)) { e in
            XCTAssertEqual((e as? ShareError)?.code, "too-large")
            XCTAssertEqual((e as? ShareError)?.message, ShareText.tooBigMessage(DLS.maxItem + 1))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("big.bin").path))
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", in: bg), [])
    }

    // MARK: Memory (F04.2's 60 MB budget for the extension; 40 MB for the builder)

    #if canImport(Darwin)
    static func residentBytes() -> Int {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count) }
        }
        return kr == KERN_SUCCESS ? Int(info.resident_size) : 0
    }

    func testANineMegabyteFileStaysUnderFortyMegabytes() throws {
        let source = dir.appendingPathComponent("nine.pdf")
        do {
            var g = SystemRandomNumberGenerator()
            try Data((0..<DLS.maxItem).map { _ in UInt8.random(in: 0...255, using: &g) }).write(to: source)
        }
        let baseline = Self.residentBytes()
        XCTAssertGreaterThan(baseline, 0)
        let peak = PeakSampler()
        peak.start()
        let built = try autoreleasepool {
            try FrameFileBuilder.build(source: source, input: ItemInput(kind: .file, id: "99999999999999999999999999999999",
                                                                        name: "nine.pdf", mime: "application/pdf", sent: sent),
                                       keys: keys, encodedURL: dir.appendingPathComponent("nine.bin"),
                                       framesDirectory: dir.appendingPathComponent("bg"))
        }
        let top = peak.stop()
        XCTAssertEqual(built.parts, 5)
        let delta = max(0, top - baseline)
        print("FrameFileBuilder: resident memory grew by \(delta / 1_000_000) MB for a 9 MB file")
        XCTAssertLessThan(delta, 40_000_000)
    }

    /// Samples the resident size every millisecond on its own thread and keeps the largest.
    final class PeakSampler {
        private var thread: Thread?
        private let lock = NSLock()
        private var top = 0
        private var running = true

        func start() {
            top = FrameFileBuilderTests.residentBytes()
            let t = Thread { [unowned self] in
                while true {
                    lock.lock()
                    let go = running
                    top = max(top, FrameFileBuilderTests.residentBytes())
                    lock.unlock()
                    if !go { break }
                    usleep(1000)
                }
            }
            thread = t
            t.start()
        }

        func stop() -> Int {
            lock.lock()
            running = false
            top = max(top, FrameFileBuilderTests.residentBytes())
            let v = top
            lock.unlock()
            return v
        }
    }
    #endif
}
