import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// The offline-first outbox (LAB-PLAN F07), with an injected path monitor: shares made offline wait ("Waiting for
/// connection", not "Not delivered"), and coming back online sends them oldest first in capped passes at least 3
/// minutes apart (F07.1, F07.3).
final class OfflineQueueTests: XCTestCase {
    var dir: URL!
    var clock = Date(timeIntervalSince1970: 1_800_000_000)
    let pairing = try! Pairing(secret: Data(repeating: 5, count: 16), relay: "https://relay.test", name: "Test Daylight")

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-offline-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func makeSender() throws -> ShareSender {
        let s = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir), from: "Test iPhone", session: FakeRelay.session)
        s.relay.sleep = { _ in }
        s.now = { [unowned self] in self.clock }
        return s
    }

    func makeQueue(_ sender: ShareSender, path: FakePath) -> OfflineQueue {
        OfflineQueue(sender: { sender }, path: path, now: { [unowned self] in self.clock })
    }

    func publishedTopics() -> [String] { FakeRelay.with { $0.requests }.filter { $0.hasPrefix("POST") || $0.hasPrefix("PUT") } }

    func testASharedItemWaitsForTheConnection() async throws {
        let sender = try makeSender()
        let path = FakePath()
        let queue = makeQueue(sender, path: path)
        await queue.start()
        path.set(false)
        try await waitFor { await queue.isOnline == false }
        let row = try await queue.send(.link("https://example.com/a", title: "A"), with: sender)
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "network")
        XCTAssertEqual(row.attempts, 0)
        XCTAssertTrue(publishedTopics().isEmpty, "nothing is published offline")
        // 2.5: "Waiting for connection" while offline; v1.1's "Waiting to send" with Lab off.
        let text = LabRowText(row: row, now: clock, ctx: LabRowText.Context(lab: true, online: false))
        XCTAssertEqual(text.label, "Waiting for connection")
        XCTAssertEqual(text.sentence, "It will send when this device is back online.")
        XCTAssertEqual(text.stepLine, "Sent … · On your Daylight · In the Reader")
        XCTAssertEqual(LabRowText(row: row, now: clock, ctx: LabRowText.Context(lab: false, online: false)).label,
                       RowText(row: row, now: clock).label)
        // Back online: it goes at once.
        path.set(true)
        try await waitFor { sender.outbox.row(row.id)?.status == .sent }
        XCTAssertEqual(publishedTopics().count, 1)
        await queue.stop()
    }

    /// F07.3: 70 links queued offline go out in order, in three passes (30, 30, 10), each at least 3 minutes after the
    /// last; a pass sooner than that sends nothing.
    func testSeventyLinksGoInThreePasses() async throws {
        let sender = try makeSender()
        let path = FakePath()
        let queue = makeQueue(sender, path: path)
        var ids: [String] = []
        for i in 0..<70 {
            clock += 1
            ids.append(try await sender.send(.link("https://example.com/\(i)", title: "Item \(i)"), defer: true).id)
        }
        await queue.pathChanged(true)
        XCTAssertEqual(sender.outbox.rows.filter { $0.status == .sent }.count, 30)
        clock += 60
        let early = await queue.flushIfDue()
        XCTAssertEqual(early.count, 0, "3 minutes apart")
        clock += 120
        let second = await queue.flushIfDue()
        XCTAssertEqual(second.count, 30)
        clock += 180
        let third = await queue.flushIfDue()
        XCTAssertEqual(third.count, 10)
        XCTAssertTrue(sender.outbox.rows.allSatisfy { $0.status == .sent })
        // In order: the relay received them oldest first.
        let receiver = try RelayClient(relay: pairing.relay, session: FakeRelay.session)
        receiver.sleep = { _ in }
        var got: [String] = []
        for m in try await receiver.poll(topic: pairing.keys.inboxTopic) {
            if let f = m.frame, let o = try? Frame.open(keys: pairing.keys, purpose: .inbox, frame: f), let id = o.header["id"] as? String {
                got.append(id)
            }
        }
        XCTAssertEqual(got, ids)
        await queue.stop()
    }

    /// F07.3: queued 9 MB files never put more than 18 MB of attachments in one pass; a 413 stops the attachments of
    /// that pass and gives the row v1.1's full sentence.
    func testBigFilesStayUnderTheCapAndA413StopsThePass() async throws {
        let sender = try makeSender()
        let content = Data((0..<DLS.maxItem).map { UInt8(truncatingIfNeeded: $0 &* 7) })
        for i in 0..<4 {
            clock += 1
            _ = try await sender.send(.file(content, name: "book-\(i).pdf", mime: "application/pdf"), compress: false, defer: true)
        }
        var passBytes: [Int] = []
        func uploaded() -> Int { FakeRelay.with { $0.files.values.reduce(0) { $0 + $1.count } } }
        var before = uploaded()
        for _ in 0..<4 {
            let rows = await sender.flushNetwork()
            XCTAssertEqual(rows.count, 1, "a 9 MB file and another would pass 18 MB")
            passBytes.append(uploaded() - before)
            before = uploaded()
        }
        XCTAssertTrue(passBytes.allSatisfy { $0 > 0 && $0 <= Lab.flushMaxAttachmentBytes }, "\(passBytes)")
        XCTAssertTrue(sender.outbox.rows.allSatisfy { $0.status == .sent })

        // A 413: the row is failed/full with v1.1's sentence, and no other attachment goes in that pass.
        FakeRelay.reset()
        let small = Data((0..<400_000).map { UInt8(truncatingIfNeeded: $0) })
        for i in 0..<3 {
            clock += 1
            _ = try await sender.send(.file(small, name: "doc-\(i).pdf", mime: "application/pdf"), compress: false, defer: true)
        }
        FakeRelay.with { $0.failNext = [413] }
        let rows = await sender.flushNetwork()
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.errorCode, "full")
        XCTAssertEqual(rows.first?.http, 413)
        XCTAssertEqual(RowText(row: rows[0], now: clock).sentence,
                       RowText(status: .failed, errorCode: "full", size: 0, created: clock, now: clock).sentence)
        XCTAssertEqual(sender.outbox.rows.filter { $0.status == .failed && $0.errorCode == "network" }.count, 2,
                       "the others still wait")
    }

    /// Lab off: the app sends as v1.1, and rows queued while Lab was on still go (1.3: nothing is lost).
    func testWithoutTheQueueRowsGoOnV11BackOff() async throws {
        let sender = try makeSender()
        let row = try await sender.send(.link("https://example.com/a", title: "A"), defer: true)
        clock += 59
        let none = await sender.resendDue()
        XCTAssertTrue(none.isEmpty, "a deferred row waits like a network failure")
        clock += 2
        let resent = await sender.resendDue()
        XCTAssertEqual(resent.map(\.id), [row.id])
        XCTAssertEqual(resent.first?.status, .sent)
    }

    /// A row the relay refused (429: ntfy.sh's daily quota) while this device stayed online is not the queue's: an
    /// hour of refreshes, one a minute (the Mac app's timer while a row waits), tries it only as v1.1's back-off says
    /// (2, 4, 8 and 16 minutes after each try), and the queue schedules no passes of its own (review finding: a pass
    /// every 3 minutes all day).
    func testARowTheRelayRefusedKeepsItsBackOff() async throws {
        let sender = try makeSender()
        let queue = makeQueue(sender, path: FakePath())
        await queue.pathChanged(true) // the launch's first report: nothing waits
        FakeRelay.with { $0.failNext = Array(repeating: 429, count: 1000) }
        let row = try await sender.send(.link("https://example.com/quota", title: "Quota"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "network")
        XCTAssertEqual(row.attempts, 1)
        XCTAssertEqual(row.http, 429)
        let before = publishedTopics().count
        var tried: [TimeInterval] = []
        let start = clock
        for _ in 0..<60 {
            clock += 60
            let n = await queue.flushIfDue()
            if !n.isEmpty { tried.append(clock.timeIntervalSince(start)) }
        }
        XCTAssertEqual(tried, [120, 360, 840, 1800], "v1.1's back-off")
        XCTAssertEqual(publishedTopics().count - before, 4)
        let scheduled = await queue.hasScheduledPass
        XCTAssertFalse(scheduled)
        await queue.stop()
    }

    /// Coming back online after the path source said offline sends what waits at once, whatever its back-off; a pass
    /// that hits a 429 schedules no follow-up (the rest keeps its back-off until the next reconnect).
    func testComingBackOnlineSendsWhateverTheBackOff() async throws {
        let sender = try makeSender()
        let queue = makeQueue(sender, path: FakePath())
        FakeRelay.with { $0.failNext = [503, 503, 503, 503] }
        let row = try await sender.send(.link("https://example.com/later", title: "Later"))
        XCTAssertEqual(row.errorCode, "network")
        await queue.pathChanged(false)
        clock += 30 // not due by its back-off (2 minutes)
        await queue.pathChanged(true)
        XCTAssertEqual(sender.outbox.row(row.id)?.status, .sent, "a reconnect sends it now")

        // A reconnect pass that meets a 429: no follow-up pass of its own.
        clock += 1
        _ = try await sender.send(.link("https://example.com/a", title: "A"), defer: true)
        _ = try await sender.send(.link("https://example.com/b", title: "B"), defer: true)
        await queue.pathChanged(false)
        clock += 600
        FakeRelay.with { $0.failNext = [429] }
        await queue.pathChanged(true)
        let followUp = await queue.followUp
        let scheduled = await queue.hasScheduledPass
        XCTAssertFalse(followUp)
        XCTAssertFalse(scheduled)
        await queue.stop()
    }

    /// The path source's reports reach the app (its rows read "Waiting for connection" while offline, 2.5).
    func testThePathReachesTheApp() async throws {
        let sender = try makeSender()
        let path = FakePath()
        let heard = Heard()
        let queue = OfflineQueue(sender: { sender }, path: path, now: { [unowned self] in self.clock },
                                 onPath: { online in await heard.add(online) })
        await queue.start()
        path.set(false)
        try await waitFor { await heard.values == [false] }
        path.set(true)
        try await waitFor { await heard.values == [false, true] }
        await queue.stop()
    }

    func waitFor(_ condition: @escaping () async -> Bool, timeout: TimeInterval = 5) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("timed out")
    }
}

/// What a path callback heard.
actor Heard {
    var values: [Bool] = []
    func add(_ v: Bool) { values.append(v) }
}

/// A network path that the test switches.
final class FakePath: NetworkPathSource {
    private var update: (@Sendable (Bool) -> Void)?

    func start(_ update: @escaping @Sendable (Bool) -> Void) { self.update = update }
    func stop() { update = nil }
    func set(_ online: Bool) { update?(online) }
}
