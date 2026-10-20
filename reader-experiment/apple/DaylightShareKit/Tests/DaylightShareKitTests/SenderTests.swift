import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

final class SenderTests: XCTestCase {
    var dir: URL!
    var clock = Date(timeIntervalSince1970: 1_800_000_000)

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-tests-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func makeSender(_ pairing: Pairing) throws -> ShareSender {
        let s = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir), from: "Test iPhone", app: "ios/test",
                                session: FakeRelay.session)
        s.relay.sleep = { _ in }
        s.now = { [unowned self] in self.clock }
        return s
    }

    func receiver(_ pairing: Pairing) throws -> TestReceiver {
        let r = try RelayClient(relay: pairing.relay, session: FakeRelay.session)
        r.sleep = { _ in }
        return TestReceiver(keys: pairing.keys, relay: r)
    }

    func testLinkIsSentReceivedAndAcked() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let row = try await sender.send(.link("https://example.com/a?b=c", title: "  An\narticle  "))
        XCTAssertEqual(row.status, .sent)
        XCTAssertFalse(row.attachment)
        XCTAssertEqual(row.title, "An article")
        XCTAssertTrue(sender.hasPending)

        // Nothing acked yet.
        let none = try await sender.checkAcks()
        XCTAssertEqual(none, 0)

        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].header.url, "https://example.com/a?b=c")
        XCTAssertEqual(items[0].header.from, "Test iPhone")
        XCTAssertEqual(items[0].header.app, "ios/test")
        XCTAssertEqual(items[0].header.id, row.id)

        let acked = try await sender.checkAcks()
        XCTAssertEqual(acked, 1)
        XCTAssertEqual(sender.outbox.row(row.id)?.status, .delivered)
        XCTAssertFalse(sender.hasPending)
        // The cursor moved to the ack's time minus 5, for this ack topic.
        let state = sender.outbox.load()
        XCTAssertEqual(state.ackTopic, pairing.keys.ackTopic)
        XCTAssertNotNil(state.ackSince)
        // Publishes carry the ntfy headers.
        XCTAssertTrue(FakeRelay.with { $0.requests }.contains { $0.hasPrefix("POST /\(pairing.keys.inboxTopic)") })
    }

    func testPageIsDeflatedAndRoundTrips() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let html = "<html><body>" + String(repeating: "<p>Paywalled article text.</p>", count: 2000) + "</body></html>"
        let row = try await sender.send(.page(html: html, url: "https://news.example/story", title: "Story"))
        XCTAssertEqual(row.header.enc, "deflate-raw")
        XCTAssertEqual(row.header.size, html.utf8.count)
        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(String(data: items[0].content, encoding: .utf8), html)
        XCTAssertEqual(items[0].header.kind, .page)
        XCTAssertEqual(items[0].header.mime, "text/html")
    }

    func testLargeFileGoesInPartsAsAttachments() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        sender.chunkSize = 4000
        let pdf = DLSCrypto.randomBytes(16_500)
        let row = try await sender.send(.file(pdf, name: "../Paper: final?.pdf", title: "Paper"))
        XCTAssertEqual(row.status, .sent)
        XCTAssertTrue(row.attachment)
        XCTAssertEqual(row.name, "Paper final .pdf")
        XCTAssertEqual(row.mime, "application/pdf")
        XCTAssertNil(row.header.enc, "PDFs are not compressed")
        // 4 full 4000-byte chunks go as attachments; the last 500 bytes fit in a message (base64 <= 3800).
        XCTAssertEqual(FakeRelay.with { $0.topics[pairing.keys.inboxTopic]?.count }, 5)
        XCTAssertEqual(FakeRelay.with { $0.requests.filter { $0.hasPrefix("PUT ") }.count }, 4)
        XCTAssertEqual(FakeRelay.with { $0.requests.filter { $0.hasPrefix("POST ") }.count }, 1)
        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].content, pdf)
        let acked = try await sender.checkAcks()
        XCTAssertEqual(acked, 1)
        XCTAssertNil(sender.outbox.readBody(row.id), "body dropped once delivered")
    }

    func testResendAfterElevenHoursThenExpireAndTryAgain() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let row = try await sender.send(.file(Data("# Notes\n".utf8), name: "notes.md"))
        XCTAssertEqual(row.mime, "text/markdown")
        XCTAssertFalse(row.attachment)

        clock += 10 * 3600
        let early = await sender.resendDue()
        XCTAssertEqual(early.count, 0)
        clock += 3600 + 1
        let resent = await sender.resendDue()
        XCTAssertEqual(resent.count, 1)
        XCTAssertEqual(resent.first?.status, .sent)
        XCTAssertEqual(resent.first?.attempts, 0, "attempts count failures since the last success")
        XCTAssertEqual(FakeRelay.with { $0.topics[pairing.keys.inboxTopic]?.count }, 2)

        // Same id and header in both copies; the receiver gets the item once.
        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(items.count, 1)

        // A file that is never acked expires after 7 days, keeps its content, and can be tried again with the same
        // header (`sent` included) until 14 days after the share.
        let start = clock
        let lost = try await sender.send(.file(Data("lost".utf8), name: "lost.txt"))
        clock = start + 7 * 24 * 3600 + 60
        _ = await sender.resendDue()
        var expired = try XCTUnwrap(sender.outbox.row(lost.id))
        XCTAssertEqual(expired.status, .expired)
        XCTAssertEqual(expired.errorCode, "")
        XCTAssertEqual(RowText(row: expired, now: clock).action, .tryAgain)
        XCTAssertNotNil(sender.outbox.readBody(lost.id), "an expired row keeps its content")
        let again = await sender.retry(lost.id)
        XCTAssertEqual(again?.status, .sent)
        XCTAssertEqual(again?.created, clock)
        XCTAssertEqual(again?.header.sent, lost.header.sent, "Try again keeps the header")
        XCTAssertEqual(again?.header.id, lost.header.id)

        // Expired again later; 14 days after its (new) share its content is dropped, and Try again says it is gone.
        clock += 8 * 24 * 3600
        _ = await sender.resendDue()
        expired = try XCTUnwrap(sender.outbox.row(lost.id))
        XCTAssertEqual(expired.status, .expired)
        XCTAssertNotNil(sender.outbox.readBody(lost.id))
        clock += 7 * 24 * 3600
        _ = await sender.resendDue()
        XCTAssertNil(sender.outbox.readBody(lost.id), "content dropped 14 days after the share")
        let gone = await sender.retry(lost.id)
        XCTAssertEqual(gone?.status, .expired)
        XCTAssertEqual(gone?.errorCode, "gone")
        XCTAssertEqual(RowText(row: try XCTUnwrap(gone), now: clock).sentence,
                       "This is no longer stored on this device. Share it again.")
    }

    func testFailedPublishBacksOffAndRecovers() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [500, 500, 500, 500] }
        let row = try await sender.send(.link("https://example.com/x"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "network")
        XCTAssertEqual(row.attempts, 1)
        XCTAssertTrue(row.error.contains("500"), row.error)
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 4, "a 5xx is retried three times in the call")
        XCTAssertEqual(RowText(row: row, now: clock).action, .retryNow)
        let early = await sender.resendDue()
        XCTAssertEqual(early.count, 0, "backoff: 2 minutes after the first failure")
        clock += 121
        let later = await sender.resendDue()
        XCTAssertEqual(later.first?.status, .sent)
        XCTAssertEqual(later.first?.errorCode, "")
    }

    func testRateLimitIsNotRetriedInTheCall() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [429] }
        let row = try await sender.send(.link("https://example.com/x"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "network")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 1, "429 is not retried in the call")
        clock += 121
        let later = await sender.resendDue()
        XCTAssertEqual(later.first?.status, .sent)
    }

    func testRelayFullIsReported() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [413] }
        let row = try await sender.send(.link("https://example.com/x"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "full")
        XCTAssertEqual(row.slowFails, 1)
        XCTAssertEqual(row.error, "HTTP 413")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 1, "413 is not retried")
        XCTAssertNil(RowText(row: row, now: clock).action, "it sends by itself: no button")
    }

    func testTooLargeIsReported() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        do {
            try await sender.send(.file(Data(count: 9_000_001), name: "huge.pdf"))
            XCTFail("should throw")
        } catch let e as ShareError {
            XCTAssertEqual(e.code, "too-large")
            XCTAssertEqual(e.message, "Too big to send. Files can be up to 9 MB; this one is 9.1 MB.")
        }
        // The limit is on the size before compression, though text compresses well.
        do {
            try await sender.send(.file(Data(repeating: 0x61, count: 9_000_001), name: "huge.txt"))
            XCTFail("should throw")
        } catch let e as ShareError {
            XCTAssertEqual(e.code, "too-large")
        }
        XCTAssertTrue(sender.outbox.rows.isEmpty, "nothing is queued")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 0)
        // 9,000,000 bytes go, in 5 frames of at most 1,966,116 bytes.
        let row = try await sender.send(.file(Data(count: 9_000_000), name: "max.pdf"))
        XCTAssertEqual(row.status, .sent, row.error)
        XCTAssertTrue(row.attachment)
        XCTAssertEqual(FakeRelay.with { $0.requests.filter { $0.hasPrefix("PUT ") }.count }, 5)
        XCTAssertLessThanOrEqual(FakeRelay.with { $0.files.values.map(\.count).max() ?? 0 }, 1_966_116)
    }

    // MARK: Re-send timing and failures (CHANGES-v1.1 2.4)

    /// An attachment item that is never acked: published at 0, 3 h 05, 6 h 10 and 18 h 10, then every 12 hours.
    func testAttachmentResendTiming() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let start = clock
        let row = try await sender.send(.file(DLSCrypto.randomBytes(10_000), name: "paper.pdf"))
        XCTAssertTrue(row.attachment)
        func publishes() -> Int { FakeRelay.with { $0.requests.filter { $0.hasPrefix("PUT ") }.count } }
        var at: [TimeInterval] = []
        var seen = publishes()
        XCTAssertEqual(seen, 1)
        var minute: TimeInterval = 0
        while minute <= 31 * 60 {
            minute += 5
            clock = start + minute * 60
            _ = await sender.resendDue()
            if publishes() > seen {
                at.append(minute)
                seen = publishes()
            }
        }
        XCTAssertEqual(at, [185, 370, 1090, 1810], "re-sends at 3 h 05, 6 h 10, 18 h 10, 30 h 10")
    }

    /// 413: failed/full, nothing before 185 minutes, the third in a row ends the row; Try again starts over.
    func testRelayFullWaitsThenExpires() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [413] }
        let row = try await sender.send(.file(DLSCrypto.randomBytes(10_000), name: "paper.pdf"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "full")
        for n in 2...3 {
            clock += 184 * 60
            let early = await sender.resendDue()
            XCTAssertTrue(early.isEmpty, "nothing before 185 minutes")
            clock += 60
            FakeRelay.with { $0.failNext = [413] }
            let r = await sender.resendDue()
            XCTAssertEqual(r.count, 1)
            XCTAssertEqual(r.first?.slowFails, n)
            XCTAssertEqual(r.first?.status, n < 3 ? .failed : .expired)
            XCTAssertEqual(r.first?.errorCode, "full")
        }
        let ended = try XCTUnwrap(sender.outbox.row(row.id))
        XCTAssertEqual(RowText(row: ended, now: clock).sentence,
                       "Too much was sent from this network for hours, so it stopped trying. Try again later.")
        XCTAssertEqual(RowText(row: ended, now: clock).action, .tryAgain)
        clock += 24 * 3600
        let none = await sender.resendDue()
        XCTAssertTrue(none.isEmpty, "an expired row is not re-sent by itself")
        let again = await sender.retry(row.id)
        XCTAssertEqual(again?.status, .sent)
        XCTAssertEqual(again?.slowFails, 0)
        XCTAssertEqual(again?.errorCode, "")
    }

    /// Any other 4xx: failed/refused, retried after 185 minutes (not on the network backoff), no button.
    func testRefusedIsSlow() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [400] }
        let row = try await sender.send(.link("https://example.com/r"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "refused")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 1)
        XCTAssertEqual(RowText(row: row, now: clock).sentence,
                       "The relay set on your Daylight turned this down. It will try again in about 3 hours.")
        XCTAssertNil(RowText(row: row, now: clock).action)
        clock += 30 * 60
        let early = await sender.resendDue()
        XCTAssertTrue(early.isEmpty)
        clock += 155 * 60
        let later = await sender.resendDue()
        XCTAssertEqual(later.first?.status, .sent)
    }

    /// After a 429 a pass publishes nothing more; after a 413 no attachment item, but a link still goes.
    func testPassStopsAfter429() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [500, 500, 500, 500, 500, 500, 500, 500] }
        try await sender.send(.link("https://example.com/1"))
        clock += 1
        try await sender.send(.link("https://example.com/2"))
        XCTAssertEqual(sender.outbox.rows.filter { $0.status == .failed }.count, 2)
        FakeRelay.with { s in
            s.failNext = [429]
            s.requests = []
        }
        clock += 3600
        let r = await sender.resendDue()
        XCTAssertEqual(r.count, 1, "the pass stopped at the 429")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 1)

        // 413 on an attachment: the next attachment item waits, a link still goes.
        FakeRelay.reset()
        let dir2 = dir.appendingPathComponent("second")
        let s2 = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir2), session: FakeRelay.session)
        s2.relay.sleep = { _ in }
        s2.now = { [unowned self] in self.clock }
        FakeRelay.with { $0.failNext = [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500] }
        try await s2.send(.file(DLSCrypto.randomBytes(10_000), name: "a.pdf"))
        clock += 1
        try await s2.send(.file(DLSCrypto.randomBytes(10_000), name: "b.pdf"))
        clock += 1
        try await s2.send(.link("https://example.com/3"))
        FakeRelay.with { s in
            s.failNext = [413]
            s.requests = []
        }
        clock += 3600
        let r2 = await s2.resendDue()
        XCTAssertEqual(r2.map(\.kind), [.file, .url], "after the 413, b.pdf waits and the link goes")
        XCTAssertEqual(r2.first?.errorCode, "full")
        XCTAssertEqual(r2.last?.status, .sent)
    }

    func testOutboxCapKeepsPendingRows() throws {
        let store = OutboxStore(directory: dir)
        let header = ItemHeader(id: "00112233445566778899aabbccddeeff", kind: .url, url: "https://example.com", sent: "")
        func row(_ i: Int, _ status: OutboxRow.Status) -> OutboxRow {
            let id = String(format: "%032x", i)
            var h = header
            h.id = id
            return OutboxRow(id: id, kind: .file, header: h, created: Date(timeIntervalSince1970: 1_800_000_000 + Double(i)),
                             status: status, hasBody: true)
        }
        // Three pending rows older than everything else, then 205 finished ones.
        for i in 0..<3 { store.save(row(i, .failed)) }
        try store.writeBody(row(3, .delivered).id, Data("old".utf8))
        for i in 3..<208 { store.save(row(i, i % 2 == 0 ? .delivered : .expired)) }
        let rows = store.rows
        XCTAssertEqual(rows.count, 200)
        XCTAssertEqual(rows.filter(\.isPending).count, 3, "pending rows are never dropped")
        XCTAssertFalse(rows.contains { $0.id == row(3, .delivered).id }, "the oldest finished rows go")
        XCTAssertNil(store.readBody(row(3, .delivered).id), "with their content")
        XCTAssertTrue(rows.contains { $0.id == row(207, .expired).id })
    }

    /// A download that fails for now holds the ack cursor at its time (minus 30 minutes) until it arrives.
    func testAckCursorHoldsOnRetry() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let a = try await sender.send(.link("https://example.com/a"))
        let b = try await sender.send(.link("https://example.com/b"))
        let keys = pairing.keys
        let t = 1_900_000_000
        let ackA = try Frame.seal(keys: keys, purpose: .ack, header: AckHeader(ids: [a.id]).json)
        let ackB = try Frame.seal(keys: keys, purpose: .ack, header: AckHeader(ids: [b.id]).json)
        let held = FakeRelay.inject(topic: keys.ackTopic, frame: ackA, time: t, attachment: true)
        FakeRelay.inject(topic: keys.ackTopic, frame: ackB, time: t + 3600, attachment: false)
        FakeRelay.with { $0.downloadStatus[held] = 503 }
        let first = try await sender.checkAcks()
        XCTAssertEqual(first, 1)
        XCTAssertEqual(sender.outbox.row(b.id)?.status, .delivered)
        XCTAssertEqual(sender.outbox.row(a.id)?.status, .sent)
        XCTAssertEqual(sender.outbox.load().ackSince, t - 1800, "held at the download to retry")
        // It arrives: delivered, and the cursor moves on.
        FakeRelay.with { $0.downloadStatus[held] = nil }
        let second = try await sender.checkAcks()
        XCTAssertEqual(second, 1)
        XCTAssertEqual(sender.outbox.row(a.id)?.status, .delivered)
        XCTAssertEqual(sender.outbox.load().ackSince, t + 3600 - 1800)
        // An expired attachment (404) does not hold it, and never moves it back.
        let gone = FakeRelay.inject(topic: keys.ackTopic, frame: ackA, time: t + 3000, attachment: true)
        FakeRelay.with { $0.downloadStatus[gone] = 404 }
        _ = try await sender.checkAcks()
        XCTAssertEqual(sender.outbox.load().ackSince, t + 3600 - 1800)
    }

    func testRetryOnSentDoesNothing() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let row = try await sender.send(.link("https://example.com/s"))
        XCTAssertEqual(row.status, .sent)
        XCTAssertNil(RowText(row: row, now: clock).action, "a sent row has no button")
        let count = FakeRelay.with { $0.requests.count }
        let again = await sender.retry(row.id)
        XCTAssertEqual(again, sender.outbox.row(row.id))
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, count, "nothing published")
    }

    /// A row saved by 1.0: no errorCode or slowFails (read as "" and 0); over 9 MB it ends as too-large when due.
    func testRowsSavedByOnePointZero() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let old = """
        {"rows":[{"id":"0123456789abcdef0123456789abcdef","kind":"file","title":"","url":"","name":"big.pdf",
        "mime":"application/pdf","size":14200000,"header":{"id":"0123456789abcdef0123456789abcdef","kind":"file",
        "sent":"2026-10-17T22:00:00.000Z","size":14200000},"created":\(Int(clock.timeIntervalSince1970 * 1000)),
        "status":"sent","lastPublish":\(Int(clock.timeIntervalSince1970 * 1000)),"attachment":true,"attempts":1,
        "error":"","hasBody":true}]}
        """
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(old.utf8).write(to: dir.appendingPathComponent("outbox.json"))
        try sender.outbox.writeBody("0123456789abcdef0123456789abcdef", Data("v1.0 body".utf8))
        let row = try XCTUnwrap(sender.outbox.row("0123456789abcdef0123456789abcdef"))
        XCTAssertEqual(row.errorCode, "")
        XCTAssertEqual(row.slowFails, 0)
        clock += 4 * 3600
        let attempted = await sender.resendDue()
        XCTAssertTrue(attempted.isEmpty)
        let ended = try XCTUnwrap(sender.outbox.row(row.id))
        XCTAssertEqual(ended.status, .expired)
        XCTAssertEqual(ended.errorCode, "too-large")
        XCTAssertNil(sender.outbox.readBody(row.id))
        XCTAssertEqual(RowText(row: ended, now: clock).sentence, "Too big to send. Files can be up to 9 MB; this one is 14.2 MB.")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 0, "nothing published")
    }

    func testBadInputThrows() async throws {
        let sender = try makeSender(try Pairing.generate(relay: "https://relay.test"))
        do {
            try await sender.send(.link("javascript:alert(1)"))
            XCTFail("should throw")
        } catch let e as ShareError {
            XCTAssertEqual(e.code, "url")
        }
        let big = Data(count: DLS.maxPageHTML + 1)
        do {
            try await sender.send(ItemInput(kind: .page, url: "https://example.com", content: big))
            XCTFail("should throw")
        } catch let e as ShareError {
            XCTAssertEqual(e.code, "too-large")
        }
        XCTAssertTrue(sender.outbox.rows.isEmpty)
    }

    func testUnpairingClearsTheOutbox() async throws {
        let sender = try makeSender(try Pairing.generate(relay: "https://relay.test"))
        try await sender.send(.file(Data("x".utf8), name: "a.txt"))
        XCTAssertEqual(sender.outbox.rows.count, 1)
        sender.outbox.removeAll()
        XCTAssertTrue(sender.outbox.rows.isEmpty)
    }

    func testStorePersistsPairing() throws {
        let suite = "dls-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = SharedStore(defaults: defaults, directory: dir)
        XCTAssertNil(store.pairing)
        let p = try Pairing.generate(relay: "https://relay.example.org/x/", name: "Daylight\n DC-1")
        store.pairing = p
        XCTAssertEqual(store.pairing, p)
        XCTAssertEqual(store.pairing?.relay, "https://relay.example.org/x")
        XCTAssertEqual(store.pairing?.name, "Daylight DC-1")
        store.deviceName = "  Mike’s   iPhone "
        XCTAssertEqual(store.deviceName, "Mike’s iPhone")
        store.pairing = nil
        XCTAssertNil(store.pairing)
    }

    func testSafariNativeMessagingAndPairingChanges() async throws {
        let suite = "dls-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = SharedStore(defaults: defaults, directory: dir)
        XCTAssertEqual(SafariNativeMessaging.answer(["type": "getPairing"], store: store)["paired"] as? Bool, false)

        let p = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        XCTAssertEqual(SafariNativeMessaging.answer(["type": "setPairing", "link": p.link], store: store)["ok"] as? Bool, true)
        let a = SafariNativeMessaging.answer(["type": "getPairing"], store: store)
        let got = a["pairing"] as? [String: Any]
        XCTAssertEqual(got?["code"] as? String, p.code)
        XCTAssertEqual(got?["relay"] as? String, "https://relay.test")
        XCTAssertEqual(got?["name"] as? String, "Desk Daylight")
        XCTAssertEqual(try Pairing.parse(got?["link"] as? String ?? ""), p)
        XCTAssertEqual(SafariNativeMessaging.answer(["type": "setPairing", "code": "nope"], store: store)["ok"] as? Bool, false)

        // Re-pairing with the same code keeps the name and the outbox, also with a new relay (the items then go
        // through it); another code drops queued items.
        let sender = try ShareSender(pairing: p, outbox: OutboxStore(store: store), session: FakeRelay.session)
        sender.relay.sleep = { _ in }
        try await sender.send(.link("https://example.com/q"))
        store.pair(try Pairing(secret: p.secret, relay: p.relay))
        XCTAssertEqual(store.pairing?.name, "Desk Daylight")
        XCTAssertEqual(OutboxStore(store: store).rows.count, 1)
        let moved = SafariNativeMessaging.answer(["type": "setPairing", "link": try Pairing(secret: p.secret, relay: "https://relay2.test", name: "Desk Daylight").link], store: store)
        XCTAssertEqual(moved["ok"] as? Bool, true)
        XCTAssertEqual(moved["notice"] as? String, "Pairing updated: now sending through relay2.test.")
        XCTAssertEqual(store.pairing?.relay, "https://relay2.test")
        XCTAssertEqual(OutboxStore(store: store).rows.count, 1, "the same secret keeps the outbox")

        // A different code from the extension's field asks first, and pairs only when confirmed.
        let other = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
        let asked = SafariNativeMessaging.answer(["type": "setPairing", "code": other.code], store: store)
        XCTAssertEqual(asked["ok"] as? Bool, false)
        let confirm = try XCTUnwrap(asked["needsConfirm"] as? [String: Any])
        XCTAssertEqual(confirm["button"] as? String, "Switch")
        XCTAssertEqual((confirm["lines"] as? [String])?.last,
                       "This replaces Desk Daylight. Items not yet delivered to it will not be sent.")
        XCTAssertEqual(store.pairing?.secret, p.secret, "not paired without confirmation")
        XCTAssertEqual(OutboxStore(store: store).rows.count, 1)
        let switched = SafariNativeMessaging.answer(["type": "setPairing", "code": other.code, "confirm": true], store: store)
        XCTAssertEqual(switched["ok"] as? Bool, true)
        XCTAssertEqual(store.pairing?.secret, other.secret)
        XCTAssertEqual(OutboxStore(store: store).rows.count, 0, "another secret deletes the outbox")
        store.unpair()
        XCTAssertNil(store.pairing)
    }

    func testProvisioningProfileAppGroups() {
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict><key>Entitlements</key><dict>
        <key>com.apple.security.application-groups</key><array><string>group.com.daylight.share.ABCDE12345</string></array>
        </dict></dict></plist>
        """
        var data = Data([0x30, 0x82, 0x01, 0x02])
        data.append(Data(plist.utf8))
        data.append(Data([0x00, 0xA0]))
        XCTAssertEqual(SharedStore.appGroups(inProvisioningProfile: data), ["group.com.daylight.share.ABCDE12345"])
    }

    func testTextHelpers() throws {
        XCTAssertEqual(ShareText.findURL("Read this: https://example.com/a(b). Thanks!"), "https://example.com/a(b")
        XCTAssertEqual(DaylightShare.linkFromUserText("example.com/page"), "https://example.com/page")
        XCTAssertEqual(DaylightShare.linkFromUserText("  https://a.example/x  "), "https://a.example/x")
        XCTAssertNil(DaylightShare.linkFromUserText("hello world"))
        XCTAssertNil(ShareText.webURL("file:///etc/passwd"))
        XCTAssertNil(ShareText.webURL("https://"))
        XCTAssertNil(ShareText.webURL("https://exa mple.com"))
        XCTAssertEqual(ShareText.webURL("HTTPS://Example.com:8443/x"), "HTTPS://Example.com:8443/x")
        XCTAssertEqual(try ShareText.normalizeRelay("ntfy.example.com:8443/"), "https://ntfy.example.com:8443")
        XCTAssertEqual(try ShareText.normalizeRelay("https://NTFY.sh:443/?x=1#y"), "https://ntfy.sh")
        XCTAssertEqual(try ShareText.normalizeRelay(""), "https://ntfy.sh")
        XCTAssertThrowsError(try ShareText.normalizeRelay("ftp://x.example"))
        XCTAssertEqual(ShareText.cleanTitle(String(repeating: "é", count: 400)).count, 300)
        XCTAssertEqual(ShareText.isoTimestamp(Date(timeIntervalSince1970: 1_792_274_400)), "2026-10-17T22:00:00.000Z")
        XCTAssertEqual(ShareText.mimeType(forFileName: "Book.EPUB"), "application/epub+zip")
        XCTAssertTrue(ShareText.isTextMime("text/markdown"))
        XCTAssertFalse(ShareText.isTextMime("application/pdf"))
        // Base32/base64 round trips at every length.
        for n in 0..<70 {
            let d = DLSCrypto.randomBytes(n)
            XCTAssertEqual(Base32.decode(Base32.encode(d)), d)
            XCTAssertEqual(Base64.decode(Base64.encode(d)), d)
            XCTAssertEqual(Hex.decode(d.hexString), d)
        }
        XCTAssertNil(Base64.decode("QQ=x"))
        XCTAssertEqual(Base64.decode("QQ"), Data("A".utf8))
    }
}
