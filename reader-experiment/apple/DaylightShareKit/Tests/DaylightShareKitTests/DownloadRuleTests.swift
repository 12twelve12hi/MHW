import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// The download rule and poll cap of CHANGES-v1.1 2.6 (PROTOCOL 3.2), which senders use to read acks, and the
/// `sending` takeover of 2.4. Each test pins one rule, so removing or loosening it fails here.
final class DownloadRuleTests: XCTestCase {
    var dir: URL!
    var clock = Date(timeIntervalSince1970: 1_800_000_000)
    let frame = Data("a frame".utf8)

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-tests-\(UUID().uuidString)")
    }

    override func tearDown() {
        FakeRelay.reset()
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func client(_ relay: String = "https://relay.test") throws -> RelayClient {
        let r = try RelayClient(relay: relay, session: FakeRelay.session)
        r.sleep = { _ in }
        return r
    }

    func makeSender(_ pairing: Pairing) throws -> ShareSender {
        let s = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir), session: FakeRelay.session)
        s.relay.sleep = { _ in }
        s.now = { [unowned self] in self.clock }
        return s
    }

    var downloads: [String] { FakeRelay.with { $0.requests.filter { $0.hasPrefix("GET /file/") } } }

    // MARK: Where attachments may come from

    /// An attachment is downloaded only from https, or from the relay's own origin (scheme, host and port).
    func testAttachmentURLsOutsideTheRelaysOriginAreJunk() async throws {
        let https = try client("https://relay.test")
        let a = FakeRelay.inject(topic: "t", frame: frame, time: 1, attachment: true, url: "http://relay.test/file/x.bin")
        let b = FakeRelay.inject(topic: "t", frame: frame, time: 2, attachment: true, url: "http://relay.test:443/file/y.bin")
        let c = FakeRelay.inject(topic: "t", frame: frame, time: 3, attachment: true, url: "ftp://relay.test/file/z.bin")
        let d = FakeRelay.inject(topic: "t", frame: frame, time: 4, attachment: true)
        let got = try await https.poll(topic: "t")
        XCTAssertEqual(got.map(\.id), [a, b, c, d])
        XCTAssertEqual(got.map(\.outcome), [.junk, .junk, .junk, .frame], "an https relay: only https attachments")
        XCTAssertEqual(got.last?.frame, frame)
        XCTAssertEqual(downloads, ["GET /file/\(d).bin"], "nothing is requested from another origin")

        // An http relay: its own origin (its port included) is fine, any other http origin is not.
        FakeRelay.reset()
        let http = try client("http://relay.test:8080")
        let own = FakeRelay.inject(topic: "u", frame: frame, time: 1, attachment: true, url: "http://relay.test:8080/file/m1.bin")
        FakeRelay.inject(topic: "u", frame: frame, time: 2, attachment: true, url: "http://relay.test:9090/file/m2.bin")
        FakeRelay.inject(topic: "u", frame: frame, time: 3, attachment: true, url: "http://relay.test/file/m3.bin")
        let local = try await http.poll(topic: "u")
        XCTAssertEqual(local.map(\.outcome), [.frame, .junk, .junk])
        XCTAssertEqual(downloads, ["GET /file/\(own).bin"])
    }

    // MARK: How much is read

    /// 12,713,984 bytes at most: a larger Content-Length is junk (not read), and so is a body that grows past it.
    func testAttachmentsOverTheCapAreJunk() async throws {
        let relay = try client()
        let cap = DLS.maxAttachment
        XCTAssertEqual(cap, 12_713_984)
        let declared = FakeRelay.inject(topic: "t", frame: frame, time: 1, attachment: true)
        let grows = FakeRelay.inject(topic: "t", frame: frame, time: 2, attachment: true)
        let fits = FakeRelay.inject(topic: "t", frame: frame, time: 3, attachment: true)
        FakeRelay.with { s in
            s.downloadAnswer[declared] = (200, ["Content-Length": String(cap + 1)], Data("short".utf8))
            s.downloadAnswer[grows] = (200, [:], Data(count: cap + 1))
            s.downloadAnswer[fits] = (200, [:], Data(count: cap))
        }
        let got = try await relay.poll(topic: "t")
        XCTAssertEqual(got.map(\.outcome), [.junk, .junk, .frame])
        XCTAssertEqual(got.last?.frame?.count, cap)
    }

    /// A poll answer is read up to 64 MiB; a longer one fails the poll (whatever its Content-Length says).
    func testPollAnswersOverSixtyFourMebibytesFail() async throws {
        let relay = try client()
        XCTAssertEqual(DLS.maxPollResponse, 67_108_864)
        FakeRelay.with { $0.pollAnswer = ([:], Data(repeating: 0x0A, count: DLS.maxPollResponse)) }
        let full = try await relay.poll(topic: "t")
        XCTAssertTrue(full.isEmpty, "64 MiB is read")
        for headers in [[:], ["Content-Length": String(DLS.maxPollResponse + 1)]] {
            FakeRelay.with { $0.pollAnswer = (headers, Data(repeating: 0x0A, count: DLS.maxPollResponse + 1)) }
            do {
                _ = try await relay.poll(topic: "t")
                XCTFail("an answer over 64 MiB was accepted (\(headers))")
            } catch let e as ShareError {
                XCTAssertEqual(e.code, "relay")
                XCTAssertEqual(e.reason, "too-long")
            }
        }
    }

    // MARK: Outcomes

    /// 2xx: frame; 404 and 410: expired; anything else: retry. After a 429 every later attachment in the answer is
    /// retry without a request; message frames are not affected.
    func testDownloadOutcomesAndTheStopAfterA429() async throws {
        let relay = try client()
        var ids: [String] = []
        for (i, status) in [404, 410, 503, 400, 200].enumerated() {
            let id = FakeRelay.inject(topic: "t", frame: frame, time: i, attachment: true)
            if status != 200 { FakeRelay.with { $0.downloadStatus[id] = status } }
            ids.append(id)
        }
        let got = try await relay.poll(topic: "t")
        XCTAssertEqual(got.map(\.outcome), [.expired, .expired, .retry, .retry, .frame])

        FakeRelay.reset()
        let limited = FakeRelay.inject(topic: "u", frame: frame, time: 1, attachment: true)
        FakeRelay.inject(topic: "u", frame: frame, time: 2, attachment: true)
        FakeRelay.inject(topic: "u", frame: frame, time: 3, attachment: false)
        FakeRelay.inject(topic: "u", frame: frame, time: 4, attachment: true)
        FakeRelay.with { $0.downloadStatus[limited] = 429 }
        let after429 = try await relay.poll(topic: "u")
        XCTAssertEqual(after429.map(\.outcome), [.retry, .retry, .frame, .retry])
        XCTAssertEqual(downloads, ["GET /file/\(limited).bin"], "no attachment is requested after the 429")
    }

    /// The sender's ack check holds its cursor on a 429 and on every attachment after it.
    func testAckCursorHoldsAtTheFirstAttachmentAfterA429() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let a = try await sender.send(.link("https://example.com/a"))
        let keys = pairing.keys
        let t = 1_900_000_000
        let ack = try Frame.seal(keys: keys, purpose: .ack, header: AckHeader(ids: [a.id]).json)
        let first = FakeRelay.inject(topic: keys.ackTopic, frame: ack, time: t, attachment: true)
        FakeRelay.inject(topic: keys.ackTopic, frame: ack, time: t + 600, attachment: true)
        FakeRelay.with { $0.downloadStatus[first] = 429 }
        let delivered = try await sender.checkAcks()
        XCTAssertEqual(delivered, 0, "the second copy is not downloaded after the 429")
        XCTAssertEqual(sender.outbox.load().ackSince, t - 1800)
        FakeRelay.with { $0.downloadStatus[first] = nil }
        let later = try await sender.checkAcks()
        XCTAssertEqual(later, 1)
    }

    // MARK: Sending rows (CHANGES-v1.1 2.4)

    /// A row left `sending` (its process stopped mid-attempt) is taken over 15 minutes after its last progress:
    /// `attemptStarted`, else `lastPublish`, else `created`.
    func testAStaleSendingRowIsTakenOverFifteenMinutesAfterItsLastProgress() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let t0 = clock
        var stuck = try await sender.send(.link("https://example.com/stuck"))
        stuck.status = .sending
        stuck.created = t0 - 3600
        stuck.lastPublish = t0 - 1800
        stuck.attemptStarted = t0
        sender.outbox.save(stuck)
        FakeRelay.with { $0.requests = [] }

        clock = t0 + 15 * 60 - 1
        let early = await sender.resendDue()
        XCTAssertTrue(early.isEmpty, "not before 15 minutes after attemptStarted (created and lastPublish are older)")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 0)
        clock = t0 + 15 * 60
        let taken = await sender.resendDue()
        XCTAssertEqual(taken.map(\.id), [stuck.id])
        XCTAssertEqual(taken.first?.status, .sent)

        // Without attemptStarted (a row saved by 1.0 JS or Kotlin): lastPublish counts, then created.
        stuck.status = .sending
        stuck.attemptStarted = nil
        stuck.lastPublish = clock
        stuck.created = clock - 3600
        sender.outbox.save(stuck)
        let t1 = clock
        clock = t1 + 15 * 60 - 1
        let early1 = await sender.resendDue()
        XCTAssertTrue(early1.isEmpty)
        clock = t1 + 15 * 60
        let taken1 = await sender.resendDue()
        XCTAssertEqual(taken1.count, 1)
        stuck.status = .sending
        stuck.lastPublish = nil
        stuck.created = clock
        sender.outbox.save(stuck)
        let t2 = clock
        clock = t2 + 15 * 60 - 1
        let early2 = await sender.resendDue()
        XCTAssertTrue(early2.isEmpty)
        clock = t2 + 15 * 60
        let taken2 = await sender.resendDue()
        XCTAssertEqual(taken2.count, 1)
    }

    /// `attemptStarted` is saved after every accepted frame, the last one included, so a long upload is not taken
    /// over while it makes progress.
    func testEveryAcceptedFrameIsProgress() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        sender.chunkSize = 4000
        let start = clock
        let other = OutboxStore(directory: dir)
        let seen = Recorded()
        // Each publish takes ten minutes; before answering, read what the outbox says (as another process would).
        FakeRelay.onPublish = { [unowned self] _, _ in
            seen.add(other.rows.first?.attemptStarted)
            self.clock += 600
        }
        let row = try await sender.send(.file(DLSCrypto.randomBytes(12_500), name: "paper.pdf"))
        XCTAssertEqual(row.status, .sent)
        let marks = seen.values
        XCTAssertEqual(marks.count, 4)
        XCTAssertEqual(marks, (0..<4).map { Optional(start + Double($0) * 600) }, "saved after each accepted frame")
        XCTAssertEqual(row.attemptStarted, start + 2400, "the last frame too")
        XCTAssertEqual(row.lastPublish, start + 2400)
    }
}

/// Values recorded from another thread.
final class Recorded: @unchecked Sendable {
    private let lock = NSLock()
    private var list: [Date?] = []

    func add(_ value: Date?) {
        lock.lock()
        defer { lock.unlock() }
        list.append(value)
    }

    var values: [Date?] {
        lock.lock()
        defer { lock.unlock() }
        return list
    }
}
