#if os(macOS) || os(Linux)
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// Swift sender -> a real ntfy-compatible relay -> the JavaScript reference receiver -> acks -> Swift.
///
/// Runs when DLS_E2E_RELAY is set (CI starts `node reader-experiment/share/js/mock-relay.mjs` and sets it to
/// http://127.0.0.1:8787); needs `node` on the PATH.
final class EndToEndTests: XCTestCase {
    func testSwiftSenderToJavaScriptReceiver() async throws {
        guard let relay = ProcessInfo.processInfo.environment["DLS_E2E_RELAY"], !relay.isEmpty else {
            throw XCTSkip("DLS_E2E_RELAY is not set")
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-e2e-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let pairing = try Pairing.generate(relay: relay, name: "CI Daylight")
        let sender = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir), from: "CI Mac", app: "macos/e2e")
        sender.chunkSize = 100_000

        let html = "<!doctype html><html><head><title>Walden</title></head><body>"
            + String(repeating: "<p>I went to the woods because I wished to live deliberately, ünïcödé — “quotes”.</p>", count: 3000)
            + "</body></html>"
        let pdf = DLSCrypto.randomBytes(250_000)
        let markdown = Data(String(repeating: "# Heading\n\nSome *markdown* text.\n\n", count: 500).utf8)
        var inputs: [ItemInput] = [
            .link("https://example.com/articles/42?ref=share#top", title: "An article"),
            .page(html: html, url: "https://example.com/walden", title: "Walden"),
            .file(pdf, name: "paper.pdf", title: "A paper"),
            .file(markdown, name: "notes.md"),
        ]
        var rows: [OutboxRow] = []
        for input in inputs {
            let row = try await sender.send(input)
            XCTAssertEqual(row.status, .sent, row.error)
            rows.append(row)
        }
        XCTAssertEqual(rows[1].header.enc, "deflate-raw")
        XCTAssertEqual(rows[3].header.enc, "deflate-raw")
        XCTAssertTrue(rows[2].attachment)

        // A 5 MB file with the real chunk size: 3 frames, each under the relay's 2,000,000-byte attachment limit.
        let bigSender = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir.appendingPathComponent("big")),
                                        from: "CI Mac", app: "macos/e2e")
        let big = ItemInput.file(DLSCrypto.randomBytes(5_000_000), name: "five-megabytes.pdf", title: "Five megabytes")
        let bigRow = try await bigSender.send(big)
        XCTAssertEqual(bigRow.status, .sent, bigRow.error)
        XCTAssertEqual(PreparedItem(header: bigRow.header, encoded: big.content ?? Data()).partCount(), 3)
        inputs.append(big)
        rows.append(bigRow)

        let output = try runNode(script: Self.scriptURL, arguments: [relay, pairing.compactCode])
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any], output)
        let items = try XCTUnwrap(json["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, inputs.count, output)
        for (input, row) in zip(inputs, rows) {
            guard let got = items.first(where: { ($0["header"] as? [String: Any])?["id"] as? String == row.id }) else {
                XCTFail("JS receiver did not get \(row.kind) \(row.id)")
                continue
            }
            let header = got["header"] as? [String: Any] ?? [:]
            XCTAssertEqual(header["kind"] as? String, row.kind.rawValue)
            XCTAssertEqual(header["from"] as? String, "CI Mac")
            XCTAssertEqual(header["app"] as? String, "macos/e2e")
            XCTAssertEqual(header["title"] as? String, row.header.title)
            if row.kind != .file { XCTAssertEqual(header["url"] as? String, row.url) }
            if row.kind == .file { XCTAssertEqual(header["name"] as? String, row.name) }
            let content = input.content ?? Data()
            XCTAssertEqual(JSONRead.integer(got["length"]), content.count, row.kind.rawValue)
            XCTAssertEqual(got["contentSha256"] as? String, DLSCrypto.sha256Hex(content), row.kind.rawValue)
        }

        // The JS receiver acked everything it received.
        let delivered = try await sender.checkAcks()
        XCTAssertEqual(delivered, inputs.count - 1)
        XCTAssertTrue(sender.outbox.rows.allSatisfy { $0.status == .delivered })
        XCTAssertEqual(try await bigSender.checkAcks(), 1)
        XCTAssertEqual(bigSender.outbox.row(bigRow.id)?.status, .delivered)
        XCTAssertEqual(RowText(row: try XCTUnwrap(bigSender.outbox.row(bigRow.id))).label, "Delivered ✓")
    }

    static var scriptURL: URL {
        if let p = ProcessInfo.processInfo.environment["DLS_E2E_SCRIPT"], !p.isEmpty { return URL(fileURLWithPath: p) }
        return URL(fileURLWithPath: #filePath) // …/apple/DaylightShareKit/Tests/DaylightShareKitTests/EndToEndTests.swift
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("scripts/e2e-receiver.mjs")
    }

    func runNode(script: URL, arguments: [String]) throws -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", script.path] + arguments
        let out = Pipe()
        let err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertEqual(p.terminationStatus, 0, String(decoding: errData, as: UTF8.self))
        return text.split(separator: "\n").last.map(String.init) ?? ""
    }
}
#endif
