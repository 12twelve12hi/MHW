#if os(macOS) || os(Linux)
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// The F17 skew suite on Apple (LAB-PLAN 2.8): Swift's sender, with and without the Lab ledger, against the JavaScript
/// reference as the Daylight (`apple/scripts/e2e-receiver.mjs`) through the mock ntfy relay: a v1.0 and a v1.1 Inbox as
/// they shipped, the current v1.1 Receiver, and a Lab Inbox (`--lab`: the reference's LabInboxSim), alone, with a
/// second publisher in either handover order, and turned off. Every item is delivered and acked in every pair; Lab
/// states show only when both sides are Lab; a v1.1 sender never trips over a Lab frame.
///
/// Runs when DLS_E2E_RELAY is set (CI starts `node reader-experiment/share/js/mock-relay.mjs`); needs `node`.
final class LabSkewTests: XCTestCase {
    var relay = ""
    var dir: URL!

    override func setUpWithError() throws {
        guard let r = ProcessInfo.processInfo.environment["DLS_E2E_RELAY"], !r.isEmpty else {
            throw XCTSkip("DLS_E2E_RELAY is not set")
        }
        relay = r
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-skew-\(UUID().uuidString)")
    }

    override func tearDown() {
        if let dir { try? FileManager.default.removeItem(at: dir) }
        super.tearDown()
    }

    struct Outcome {
        let rows: [OutboxRow]
        let ids: [ItemKind: String]
        let snapshot: LabLedger.Snapshot
        let ledgerFile: Bool
        let receiver: [String: Any]
    }

    static let html = "<!doctype html><html><head><title>Walden</title></head><body>"
        + String(repeating: "<p>I went to the woods because I wished to live deliberately.</p>", count: 300) + "</body></html>"
    /// 40 kB that do not compress: a file that goes as an attachment.
    static let pdf: Data = {
        var bytes = [UInt8](repeating: 0, count: 40_000)
        for i in bytes.indices { bytes[i] = UInt8(truncatingIfNeeded: i &* 31 &+ (i >> 7)) }
        return Data(bytes)
    }()

    /// Sends a link, a page and a file from a Swift sender (with the ledger when `lab`), lets the JS Daylight poll once
    /// with `args`, then reads the ack topic.
    func run(_ args: [String], lab: Bool = true, file: StaticString = #filePath, line: UInt = #line) async throws -> Outcome {
        let pairing = try Pairing.generate(relay: relay, name: "Skew Daylight")
        let outboxDir = dir.appendingPathComponent(UUID().uuidString)
        let outbox = OutboxStore(directory: outboxDir)
        let ledger = LabLedger(outbox: outbox)
        let sender = try ShareSender(pairing: pairing, outbox: outbox, from: "CI iPhone", app: "ios/skew",
                                     onAckHeader: lab ? ledger.hook() : nil)
        var ids: [ItemKind: String] = [:]
        for input in [ItemInput.link("https://example.com/story", title: "A story"),
                      .page(html: Self.html, url: "https://example.com/walden", title: "Walden"),
                      .file(Self.pdf, name: "paper.pdf")] {
            let row = try await sender.send(input)
            XCTAssertEqual(row.status, .sent, row.error, file: file, line: line)
            ids[row.kind] = row.id
        }
        let output = try runNode(arguments: [relay, pairing.compactCode] + args)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any], output, file: file, line: line)
        XCTAssertEqual((json["items"] as? [Any])?.count, 3, "the Daylight got all three: \(args)", file: file, line: line)
        let delivered = try await sender.checkAcks()
        XCTAssertEqual(delivered, 3, "every item is acked: \(args)", file: file, line: line)
        return Outcome(rows: outbox.rows, ids: ids, snapshot: ledger.snapshot(),
                       ledgerFile: FileManager.default.fileExists(atPath: outboxDir.appendingPathComponent(LabLedger.fileName).path),
                       receiver: json)
    }

    func label(_ o: Outcome, _ kind: ItemKind, lab: Bool = true) -> String {
        let id = o.ids[kind]!
        let row = o.rows.first { $0.id == id }!
        return LabRowText(row: row, ctx: LabRowText.Context(lab: lab, ledger: o.snapshot, rowID: id)).label
    }

    // MARK: Older and v1.1 Inboxes: exactly v1.1's rows

    func testALabSenderWithInboxesThatAreNotLab() async throws {
        for args in [["--peer", "v1.0"], ["--peer", "v1.1"], []] {
            let o = try await run(args)
            XCTAssertTrue(o.rows.allSatisfy { $0.status == .delivered }, "\(args)")
            XCTAssertFalse(o.snapshot.inboxLab, "\(args)")
            XCTAssertEqual(o.snapshot.states, [:], "\(args)")
            XCTAssertNotNil(o.snapshot.checkedIn, "acks are heard: the check-in works with a v1.1 Inbox (2.5): \(args)")
            for kind in ItemKind.allCases {
                XCTAssertEqual(label(o, kind), "Delivered ✓", "\(args) \(kind)")
                let row = o.rows.first { $0.id == o.ids[kind] }!
                XCTAssertEqual(LabRowText(row: row, ctx: LabRowText.Context(lab: true, ledger: o.snapshot, rowID: row.id)),
                               LabRowText(row: row, ctx: LabRowText.Context(lab: false)), "exactly v1.1 (rule 4): \(args) \(kind)")
            }
        }
    }

    // MARK: A Lab Inbox

    func testALabSenderWithALabInbox() async throws {
        let o = try await run(["--lab"])
        let flush = (o.receiver["lab"] as? [String: Any])?["flush"] as? [String: Any]
        XCTAssertEqual(flush?["kind"] as? String, "states")
        XCTAssertEqual((flush?["states"] as? NSNumber)?.intValue, 3, "one Lab frame with the three states")
        XCTAssertEqual(flush?["reason"] as? String, "sent")
        XCTAssertTrue(o.snapshot.inboxLab)
        XCTAssertEqual(o.snapshot.caps, ["reader-link", "st", "tap"])
        XCTAssertEqual(o.snapshot.publisher("android")?.app, "android/1.5.0")
        XCTAssertEqual(label(o, .url), "In your Reader ✓")
        XCTAssertEqual(label(o, .page), "In your Reader ✓")
        XCTAssertEqual(label(o, .file), "Handed to the Reader")
        for kind in ItemKind.allCases { XCTAssertEqual(label(o, kind, lab: false), "Delivered ✓", "Lab off: v1.1 (\(kind))") }

        let w = try await run(["--lab", "--state", "waiting"])
        for kind in ItemKind.allCases { XCTAssertEqual(label(w, kind), "Waiting for a tap on your Daylight", "\(kind)") }
    }

    func testAV11SenderWithALabInbox() async throws {
        let o = try await run(["--lab"], lab: false)
        XCTAssertTrue(o.rows.allSatisfy { $0.status == .delivered }, "a v1.1 sender reads Lab frames as acks without ids")
        XCTAssertFalse(o.ledgerFile, "a sender without the ledger keeps nothing of them")
        for kind in ItemKind.allCases { XCTAssertEqual(RowText(row: o.rows.first { $0.id == o.ids[kind] }!).label, "Delivered ✓") }
    }

    func testTwoPublishersInEitherHandoverOrder() async throws {
        let a = try await run(["--lab", "--hello", "reader-lab/0.27.900"])
        XCTAssertEqual(a.snapshot.publishers.map { $0.name }, ["android", "reader-lab"])
        XCTAssertEqual(a.snapshot.caps, ["quiet", "reader-doc", "reader-link", "st", "tap"])
        XCTAssertEqual(label(a, .file), "Handed to the Reader")

        let b = try await run(["--lab", "--app", "reader-lab/0.27.900", "--caps", "st,reader-link,reader-doc,quiet",
                               "--hello", "android/1.5.0", "--hello-caps", "st,tap,reader-link"])
        XCTAssertEqual(b.snapshot.publishers.map { $0.name }, ["android", "reader-lab"])
        XCTAssertEqual(b.snapshot.caps, ["quiet", "reader-doc", "reader-link", "st", "tap"])
        XCTAssertEqual(b.snapshot.publisher("reader-lab")?.caps, ["st", "reader-link", "reader-doc", "quiet"])
        XCTAssertEqual(label(b, .url), "In your Reader ✓")
    }

    func testAnInboxThatTurnsLabOff() async throws {
        let o = try await run(["--lab", "--lab-off"])
        XCTAssertEqual(((o.receiver["lab"] as? [String: Any])?["off"] as? [String: Any])?["kind"] as? String, "off")
        XCTAssertFalse(o.snapshot.inboxLab, "its lab: 0 frame ends its Lab at once")
        XCTAssertEqual(o.snapshot.publisher("android")?.lab, 0)
        XCTAssertFalse(o.snapshot.states.isEmpty, "the states it sent before are kept, invisibly")
        for kind in ItemKind.allCases { XCTAssertEqual(label(o, kind), "Delivered ✓", "v1.1 rows again (\(kind))") }
    }

    // MARK: node

    func runNode(arguments: [String]) throws -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", EndToEndTests.scriptURL.path] + arguments
        let out = Pipe()
        let err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        XCTAssertEqual(p.terminationStatus, 0, String(decoding: errData, as: UTF8.self))
        return String(decoding: data, as: UTF8.self).split(separator: "\n").last.map(String.init) ?? ""
    }
}
#endif
