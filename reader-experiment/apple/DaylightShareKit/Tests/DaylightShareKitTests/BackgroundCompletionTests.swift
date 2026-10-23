import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// Share in place's background answers (LAB-PLAN F04): a fake upload session drives 2xx, 413, 429 and a network error
/// into the v1.1 row states; answers for an attempt the row no longer waits for are ignored; parts that finish more
/// than 3 hours apart make the row due for a re-send at once; a failure posts the notice through a fake notification
/// center (F04.6), and none with "Tell me when a send fails" off or a network failure.
final class BackgroundCompletionTests: XCTestCase {
    var dir: URL!
    var store: SharedStore!
    var outbox: OutboxStore!
    var uploads: FakeUploads!
    var center: FakeNoticeCenter!
    var clock = Date(timeIntervalSince1970: 1_792_659_600) // 2026-10-22T09:00:00Z
    let pairing = try! Pairing(secret: Data(repeating: 3, count: 16), relay: "https://relay.test", name: "Test Daylight")

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-bg-\(UUID().uuidString)", isDirectory: true)
        let suite = "dls-bg-\(UUID().uuidString)"
        store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: dir)
        outbox = OutboxStore(directory: dir)
        uploads = FakeUploads()
        center = FakeNoticeCenter()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func publisher() -> BackgroundPublisher {
        let p = BackgroundPublisher(outbox: outbox, uploads: uploads,
                                    notices: FailureNotices(center: center, prefs: LabPreferences(store: store)),
                                    daylightName: { "Test Daylight" })
        p.now = { [unowned self] in self.clock }
        return p
    }

    func testALinkGoesInTheBackground() async throws {
        let p = publisher()
        let row = try p.start(.link("https://example.com/story", title: "A story"), pairing: pairing, from: "Test iPhone")
        XCTAssertEqual(row.status, .sending)
        XCTAssertNotNil(row.bgAttempt)
        XCTAssertEqual(row.bgParts, 1)
        XCTAssertEqual(uploads.started.count, 1)
        let u = uploads.started[0]
        XCTAssertEqual(u.request.httpMethod, "POST", "a small frame is a message")
        XCTAssertEqual(u.request.url?.absoluteString, "https://relay.test/\(pairing.keys.inboxTopic)")
        XCTAssertEqual(u.request.value(forHTTPHeaderField: "Firebase"), "no")
        // The file holds the frame's base64 text, which opens to the item.
        let text = try String(contentsOf: u.file, encoding: .utf8)
        let opened = try Frame.open(keys: pairing.keys, purpose: .inbox, frame: try XCTUnwrap(Base64.decode(text)))
        XCTAssertEqual(opened.header["id"] as? String, row.id)
        XCTAssertEqual(opened.header["url"] as? String, "https://example.com/story")
        XCTAssertEqual(opened.header["from"] as? String, "Test iPhone")

        clock += 2
        let outcome = await p.complete(description: u.description, status: 200, error: nil)
        guard case let .sent(sent) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertEqual(sent.status, .sent)
        XCTAssertEqual(sent.lastPublish, clock)
        XCTAssertNil(sent.bgAttempt)
        XCTAssertEqual(outbox.row(row.id)?.status, .sent)
        XCTAssertEqual(RowText(row: sent).label, RowText(status: .sent, errorCode: "", size: 0, created: clock).label)
        XCTAssertFalse(FileManager.default.fileExists(atPath: u.file.path), "the frame file goes")
        XCTAssertTrue(center.posted.isEmpty)
    }

    func test413FailsTheRowAndPostsTheNotice() async throws {
        center.authorized = true
        let p = publisher()
        let row = try p.start(.link("https://example.com/story", title: "A story"), pairing: pairing)
        let outcome = await p.complete(description: uploads.started[0].description, status: 413, error: nil)
        guard case let .failed(failed) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertEqual(failed.status, .failed)
        XCTAssertEqual(failed.errorCode, "full")
        XCTAssertEqual(failed.http, 413)
        XCTAssertEqual(failed.attempts, 1)
        XCTAssertEqual(outbox.row(row.id)?.errorCode, "full")
        // F04.6: "Couldn’t send ‘{title}’ to {name}", "Open to try again.", opening the row.
        XCTAssertEqual(center.posted.count, 1)
        XCTAssertEqual(center.posted.first?.title, "Couldn’t send ‘A story’ to Test Daylight")
        XCTAssertEqual(center.posted.first?.body, "Open to try again.")
        XCTAssertEqual(center.posted.first?.rowID, row.id)
        XCTAssertEqual(center.posted.first?.quiet, false)
        // The v1.1 sentence and button for the row.
        XCTAssertEqual(RowText(row: failed).sentence, RowText(status: .failed, errorCode: "full", size: 0, created: clock).sentence)
    }

    func testNoNoticeWhenTurnedOffNotAllowedOrForTheNetwork() async throws {
        let p = publisher()
        // Not allowed: nothing posted.
        _ = try p.start(.link("https://example.com/a", title: "A"), pairing: pairing)
        _ = await p.complete(description: uploads.started[0].description, status: 403, error: nil)
        XCTAssertTrue(center.posted.isEmpty)
        // Allowed, but "Tell me when a send fails" off.
        center.authorized = true
        LabPreferences(store: store).tellWhenSendFails = false
        _ = try p.start(.link("https://example.com/b", title: "B"), pairing: pairing)
        _ = await p.complete(description: uploads.started[1].description, status: 413, error: nil)
        XCTAssertTrue(center.posted.isEmpty)
        // On again: a 429 or no answer waits for the network (F07), with no notice.
        LabPreferences(store: store).tellWhenSendFails = true
        _ = try p.start(.link("https://example.com/c", title: "C"), pairing: pairing)
        let r429 = await p.complete(description: uploads.started[2].description, status: 429, error: nil)
        guard case let .failed(rate) = r429 else { return XCTFail("\(r429)") }
        XCTAssertEqual(rate.errorCode, "network")
        XCTAssertEqual(rate.http, 429)
        _ = try p.start(.link("https://example.com/d", title: "D"), pairing: pairing)
        let none = await p.complete(description: uploads.started[3].description, status: nil, error: URLError(.notConnectedToInternet))
        guard case let .failed(offline) = none else { return XCTFail("\(none)") }
        XCTAssertEqual(offline.errorCode, "network")
        XCTAssertEqual(offline.http, 0)
        XCTAssertTrue(center.posted.isEmpty)
        // And with Lab off, nothing either (F04 is a Lab feature).
        LabSettings.setOn(false, store: store)
        _ = try p.start(.link("https://example.com/e", title: "E"), pairing: pairing)
        _ = await p.complete(description: uploads.started[4].description, status: 413, error: nil)
        XCTAssertTrue(center.posted.isEmpty)
    }

    func testStaleAnswersAreIgnored() async throws {
        let p = publisher()
        let row = try p.start(.link("https://example.com/a", title: "A"), pairing: pairing)
        let description = uploads.started[0].description
        // Another attempt id, a malformed label, a cancelled task: nothing changes.
        let other = BackgroundPublisher.describe(id: row.id, part: 0, attempt: "not-this-one")
        let o1 = await p.complete(description: other, status: 200, error: nil)
        XCTAssertEqual(o1, .ignored)
        let o2 = await p.complete(description: "junk", status: 200, error: nil)
        XCTAssertEqual(o2, .ignored)
        let o3 = await p.complete(description: description, status: nil, error: URLError(.cancelled))
        XCTAssertEqual(o3, .ignored)
        XCTAssertEqual(outbox.row(row.id)?.status, .sending)
        // The app re-sent the row itself (it went stale): the old attempt's late answer is ignored.
        let sender = try ShareSender(pairing: pairing, outbox: outbox, session: FakeRelay.session)
        FakeRelay.reset()
        sender.relay.sleep = { _ in }
        sender.now = { [unowned self] in self.clock.addingTimeInterval(16 * 60) }
        let resent = await sender.resendDue()
        XCTAssertEqual(resent.map(\.status), [.sent])
        XCTAssertNil(outbox.row(row.id)?.bgAttempt)
        let late = await p.complete(description: description, status: 413, error: nil)
        XCTAssertEqual(late, .ignored)
        XCTAssertEqual(outbox.row(row.id)?.status, .sent)
    }

    /// A row with live tasks for its attempt is not stale; without them the v1.1 rule (15 minutes) applies.
    func testLiveTasksKeepTheRowFromGoingStale() async throws {
        let p = publisher()
        let row = try p.start(.link("https://example.com/a", title: "A"), pairing: pairing)
        let sender = try ShareSender(pairing: pairing, outbox: outbox)
        let later = clock.addingTimeInterval(60 * 60)
        let stored = try XCTUnwrap(outbox.row(row.id))
        uploads.live = uploads.started.map(\.description)
        sender.liveBackgroundAttempts = await p.liveAttempts()
        XCTAssertEqual(sender.liveBackgroundAttempts, [row.bgAttempt!])
        XCTAssertFalse(sender.isDue(stored, at: later))
        uploads.live = []
        sender.liveBackgroundAttempts = await p.liveAttempts()
        XCTAssertTrue(sender.isDue(stored, at: later))
    }

    func testPartsThatFinishHoursApart() async throws {
        let p = publisher()
        let content = Data((0..<5000).map { UInt8($0 % 251) })
        let row = try p.start(.file(content, name: "big.pdf", mime: "application/pdf", title: "Big"), pairing: pairing, chunkSize: 2000)
        XCTAssertEqual(row.bgParts, 3)
        XCTAssertTrue(row.attachment, "parts that finish apart count as an attachment row")
        XCTAssertEqual(outbox.readBody(row.id), content, "the body is kept for re-sends")
        let d = uploads.started.map(\.description)
        let first = clock
        let o0 = await p.complete(description: d[0], status: 200, error: nil)
        XCTAssertEqual(o0, .partSent)
        clock += 600
        let o1 = await p.complete(description: d[1], status: 200, error: nil)
        XCTAssertEqual(o1, .partSent)
        XCTAssertEqual(outbox.row(row.id)?.status, .sending)
        clock = first.addingTimeInterval(3 * 3600 + 60)
        let o2 = await p.complete(description: d[2], status: 200, error: nil)
        guard case let .sent(sent) = o2 else { return XCTFail("\(o2)") }
        let sender = try ShareSender(pairing: pairing, outbox: outbox)
        XCTAssertTrue(sender.isDue(sent, at: clock), "part 0 may have expired: a re-send at once")

        // Within the limit: lastPublish is the first part's completion, and the re-send waits as for an attachment.
        let again = try p.start(.file(content, name: "big2.pdf", mime: "application/pdf"), pairing: pairing, chunkSize: 2000)
        let d2 = uploads.started.suffix(3).map(\.description)
        let start = clock
        _ = await p.complete(description: d2[0], status: 200, error: nil)
        clock += 3600
        _ = await p.complete(description: d2[1], status: 200, error: nil)
        let done = await p.complete(description: d2[2], status: 200, error: nil)
        guard case let .sent(ok) = done else { return XCTFail("\(done)") }
        XCTAssertEqual(ok.id, again.id)
        XCTAssertEqual(ok.lastPublish, start)
        XCTAssertFalse(sender.isDue(ok, at: clock))
        XCTAssertTrue(sender.isDue(ok, at: start.addingTimeInterval(DLS.attachmentWait)))
    }

    func testAFailedPartCancelsTheOthersAndThirdFullExpires() async throws {
        center.authorized = true
        let p = publisher()
        let content = Data((0..<5000).map { UInt8($0 % 251) })
        let row = try p.start(.file(content, name: "big.pdf", mime: "application/pdf", title: "Big"), pairing: pairing, chunkSize: 2000)
        let d = uploads.started.map(\.description)
        _ = await p.complete(description: d[0], status: 200, error: nil)
        let failed = await p.complete(description: d[1], status: 413, error: nil)
        guard case .failed = failed else { return XCTFail("\(failed)") }
        XCTAssertEqual(Set(uploads.cancelled), Set(d), "every task of the attempt is cancelled")
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: row.id, in: p.framesDirectory), [])
        let late = await p.complete(description: d[2], status: 200, error: nil)
        XCTAssertEqual(late, .ignored)
        // Two more full answers in a row: expired, as v1.1's third `full` (and its notice).
        var r = try XCTUnwrap(outbox.row(row.id))
        r.slowFails = 2
        r.status = .sending
        r.bgAttempt = "again"
        outbox.save(r)
        let third = await p.complete(description: BackgroundPublisher.describe(id: row.id, part: 0, attempt: "again"), status: 413, error: nil)
        guard case let .failed(expired) = third else { return XCTFail("\(third)") }
        XCTAssertEqual(expired.status, .expired)
        XCTAssertEqual(center.posted.count, 2)
    }

    func testTheAppAsksForNotificationsOnceAfterAShareInPlace() async {
        let notices = FailureNotices(center: center, prefs: LabPreferences(store: store))
        let none = await notices.askIfNeeded()
        XCTAssertFalse(none, "no share in place yet")
        LabPreferences(store: store).shareInPlaceUsed = true
        let asked = await notices.askIfNeeded()
        XCTAssertTrue(asked)
        let again = await notices.askIfNeeded()
        XCTAssertFalse(again, "once")
        XCTAssertEqual(center.requests, 1)
        let check = await notices.localCheck()
        XCTAssertEqual(check, "needs-notifications")
        center.authorized = true
        let fine = await notices.localCheck()
        XCTAssertNil(fine)
    }

    func testInYourReaderNoticesAreQuietAndOptIn() async throws {
        center.authorized = true
        let notices = FailureNotices(center: center, prefs: LabPreferences(store: store))
        let row = OutboxRow(id: "0123456789abcdef0123456789abcdef", kind: .url, title: "A story", url: "https://example.com/a",
                            header: ItemHeader(id: "0123456789abcdef0123456789abcdef", kind: .url, sent: ""), created: clock,
                            status: .delivered)
        let off = await notices.inReader([row])
        XCTAssertEqual(off, 0, "off by default")
        LabPreferences(store: store).tellWhenInReader = true
        let on = await notices.inReader([row])
        XCTAssertEqual(on, 1)
        XCTAssertEqual(center.posted.last?.title, "In your Reader ✓: A story")
        XCTAssertEqual(center.posted.last?.quiet, true)
    }
}

/// A background session that records what it is asked.
final class FakeUploads: BackgroundUploads {
    struct Upload {
        let request: URLRequest
        let file: URL
        let description: String
    }

    var started: [Upload] = []
    var live: [String] = []
    var cancelled: [String] = []

    func upload(_ request: URLRequest, fromFile file: URL, description: String) {
        started.append(Upload(request: request, file: file, description: description))
    }

    func liveDescriptions() async -> [String] { live }

    func cancel(where matches: @escaping (String) -> Bool) async {
        cancelled += started.map(\.description).filter(matches)
    }
}

/// A notification center that records what is posted.
final class FakeNoticeCenter: NoticeCenter {
    struct Notice {
        let id: String
        let title: String
        let body: String
        let rowID: String
        let quiet: Bool
    }

    var authorized = false
    var posted: [Notice] = []
    var requests = 0

    func isAuthorized() async -> Bool { authorized }

    func requestAuthorization() async -> Bool {
        requests += 1
        return authorized
    }

    func post(id: String, title: String, body: String, rowID: String, quiet: Bool) async {
        posted.append(Notice(id: id, title: title, body: body, rowID: rowID, quiet: quiet))
    }
}
