import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// Pairing changes and removals against attempts in flight (PROTOCOL 3.3 step 6; the JS reference's
/// `applyPairingChange` and `Sender.remove` run under the sender lock). A row removed while it uploads must never
/// come back, and an item meant for one Daylight must never be sealed for another.
final class OutboxLockTests: XCTestCase {
    var dir: URL!
    var suite = ""
    var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-tests-\(UUID().uuidString)")
        suite = "dls-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)!
    }

    override func tearDown() {
        FakeRelay.reset()
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func sender(_ pairing: Pairing, _ store: SharedStore) throws -> ShareSender {
        let s = try ShareSender(pairing: pairing, outbox: OutboxStore(store: store), session: FakeRelay.session)
        s.relay.sleep = { _ in }
        return s
    }

    /// Starts a share whose publish takes `seconds`; returns once it is in flight.
    func shareInFlight(_ sender: ShareSender, seconds: TimeInterval, done: Flag) async throws -> Task<OutboxRow, Error> {
        FakeRelay.with { $0.publishDelay = seconds }
        let started = Flag()
        FakeRelay.onPublish = { _, _ in started.set() }
        let task = Task { () async throws -> OutboxRow in
            let row = try await sender.send(.link("https://example.com/for-a"))
            done.set()
            return row
        }
        let deadline = Date().addingTimeInterval(5)
        while !started.value && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(started.value, "the publish started")
        return task
    }

    /// The reviewer's case: a slow share to Daylight A, then a link for Daylight B is confirmed. The switch waits for
    /// the attempt, the row does not come back, and nothing is ever published to B.
    func testSwitchingDaylightsWaitsForTheAttemptAndKeepsNothing() async throws {
        let store = SharedStore(defaults: defaults, directory: dir)
        let a = try Pairing.generate(relay: "https://relay.test", name: "A")
        let b = try Pairing.generate(relay: "https://relay.test", name: "B")
        await store.pair(a)
        let done = Flag()
        let share = try await shareInFlight(try sender(a, store), seconds: 0.6, done: done)
        XCTAssertFalse(done.value)
        let deleted = await store.pair(b)
        XCTAssertTrue(deleted)
        XCTAssertEqual(FakeRelay.with { $0.answeredPublishes }, 1, "the pairing change waited for the attempt in flight")
        let row = try await share.value
        XCTAssertEqual(row.status, .sent)
        XCTAssertEqual(store.pairing?.secret, b.secret)
        XCTAssertTrue(OutboxStore(store: store).rows.isEmpty, "the row for A is gone and stays gone")

        FakeRelay.with { $0.publishDelay = 0 }
        let forB = try sender(b, store)
        _ = await forB.tick()
        XCTAssertFalse(FakeRelay.with { $0.requests }.contains { $0.contains(b.keys.inboxTopic) },
                       "nothing meant for A is published to B")
    }

    /// "Remove" during an upload (a Mac auto-refresh re-send, say) waits for it, and the row stays removed.
    func testRemoveWaitsForTheAttemptAndTheRowStaysRemoved() async throws {
        let store = SharedStore(defaults: defaults, directory: dir)
        let a = try Pairing.generate(relay: "https://relay.test")
        await store.pair(a)
        let done = Flag()
        let s = try sender(a, store)
        let share = try await shareInFlight(s, seconds: 0.6, done: done)
        let id = try XCTUnwrap(s.outbox.rows.first?.id)
        let removed = await s.outbox.remove(id)
        XCTAssertTrue(removed)
        XCTAssertEqual(FakeRelay.with { $0.answeredPublishes }, 1, "Remove waited for the attempt in flight")
        _ = try await share.value
        XCTAssertNil(s.outbox.row(id))
        XCTAssertTrue(done.value)

        // Unpairing waits the same way.
        let share2 = try await shareInFlight(s, seconds: 0.4, done: Flag())
        await store.unpair()
        XCTAssertEqual(FakeRelay.with { $0.answeredPublishes }, 2, "unpairing waited for the attempt in flight")
        _ = try await share2.value
        XCTAssertTrue(s.outbox.rows.isEmpty)
        XCTAssertNil(store.pairing)
    }

    /// Another process (the share extension) removes the row while this one uploads it: the attempt publishes no
    /// more frames and does not write the row back. In-process locks cannot cover this; the sender's guard does.
    func testARowRemovedByAnotherProcessMidAttemptIsNotWrittenBack() async throws {
        let a = try Pairing.generate(relay: "https://relay.test")
        let s = try ShareSender(pairing: a, outbox: OutboxStore(directory: dir), session: FakeRelay.session)
        s.relay.sleep = { _ in }
        s.chunkSize = 4000
        let elsewhere = OutboxStore(directory: dir)
        FakeRelay.onPublish = { _, _ in
            // Like the other process's "Remove": straight to the file, without this process's lock.
            for row in elsewhere.rows { elsewhere.removeUnlocked(row.id) }
        }
        let row = try await s.send(.file(DLSCrypto.randomBytes(12_500), name: "paper.pdf"))
        XCTAssertNil(s.outbox.row(row.id), "not written back")
        XCTAssertTrue(s.outbox.rows.isEmpty)
        XCTAssertEqual(FakeRelay.with { $0.requests.filter { $0.hasPrefix("PUT ") || $0.hasPrefix("POST ") }.count }, 1,
                       "no frame after the removal")
        // A later pass has nothing to send.
        FakeRelay.onPublish = nil
        let later = await s.resendDue()
        XCTAssertTrue(later.isEmpty)
    }

    /// The same secret keeps the outbox (a new relay or name), also when it arrives while an attempt is in flight.
    func testTheSameSecretKeepsTheOutbox() async throws {
        let store = SharedStore(defaults: defaults, directory: dir)
        let a = try Pairing.generate(relay: "https://relay.test", name: "Desk")
        await store.pair(a)
        let share = try await shareInFlight(try sender(a, store), seconds: 0.3, done: Flag())
        let deleted = await store.pair(try Pairing(secret: a.secret, relay: "https://relay2.test"))
        XCTAssertFalse(deleted)
        _ = try await share.value
        XCTAssertEqual(OutboxStore(store: store).rows.count, 1)
        XCTAssertEqual(store.pairing?.relay, "https://relay2.test")
        XCTAssertEqual(store.pairing?.name, "Desk", "the name is kept when the new pairing has none")
    }

    // MARK: Pairings saved by 1.0

    /// 1.0 saved relays the stricter 1.1 rule refuses (an underscore in the host). Such a pairing still reads as
    /// paired and sends through that relay, and entering the same code again keeps the outbox.
    func testAPairingSavedByOnePointZeroStaysPaired() async throws {
        let store = SharedStore(defaults: defaults, directory: dir)
        let p = try Pairing.generate()
        XCTAssertThrowsError(try ShareText.normalizeRelay("http://ntfy_box:8080"))
        defaults.set(Data(#"{"code":"\#(p.code)","relay":"http://ntfy_box:8080","name":"Box"}"#.utf8), forKey: "dls.pairing")
        let read = try XCTUnwrap(store.pairing, "a 1.0 relay must not read as 'not paired'")
        XCTAssertEqual(read.secret, p.secret)
        XCTAssertEqual(read.relay, "http://ntfy_box:8080")
        XCTAssertEqual(read.name, "Box")
        XCTAssertEqual(try DaylightShare.sender(store: store).relay.relay, "http://ntfy_box:8080")
        XCTAssertEqual(PairingConfirmation(current: read, next: try Pairing.parse(p.code), source: .app).notice,
                       "Pairing updated: now sending through ntfy.sh.")

        let h = ItemHeader(id: "00112233445566778899aabbccddeeff", kind: .url, url: "https://e.com", sent: "")
        OutboxStore(store: store).save(OutboxRow(id: h.id, kind: .url, url: "https://e.com", header: h, created: Date(),
                                                 status: .failed, errorCode: "network"))
        let deleted = await store.pair(try Pairing.parse(p.code))
        XCTAssertFalse(deleted, "the same Daylight: its items are kept")
        XCTAssertEqual(OutboxStore(store: store).rows.count, 1)

        // Anything 1.0 could not have saved still does not read.
        for relay in ["ftp://box", "http://ntfy_box:8080/?x=1", "http://ntfy_box:8080/", "http://bad host", "box_1:80"] {
            defaults.set(Data(#"{"code":"\#(p.code)","relay":"\#(relay)"}"#.utf8), forKey: "dls.pairing")
            XCTAssertNil(store.pairing, relay)
        }
        XCTAssertThrowsError(try ShareText.storedRelay("ftp://box"))
        XCTAssertEqual(try ShareText.storedRelay("NTFY.example.org/"), "https://ntfy.example.org", "the 1.1 rule first")
    }
}

/// A flag set from another task or thread.
final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var set_ = false

    func set() {
        lock.lock()
        defer { lock.unlock() }
        set_ = true
    }

    var value: Bool {
        lock.lock()
        defer { lock.unlock() }
        return set_
    }
}
