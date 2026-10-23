import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// Share in place's background answers (LAB-PLAN F04): a fake upload session drives 2xx, 413, 429 and a network error
/// into the v1.1 row states; answers for an attempt the row no longer waits for are ignored; parts that finish more
/// than 3 hours apart make the row due for a re-send at once; a failure posts the notice through a fake notification
/// center (F04.6), and none with "Tell me when a send fails" off or a network failure. Each share has its own session
/// ("com.daylight.share.bg.<attempt>"), one object per identifier in a process; whichever process holds it hears its
/// answers; the app (iPhone and Mac) takes over the sessions of shares 15 minutes old, once each. Rows that go (Remove,
/// Unpair, another pairing) take their frame files and their upload tasks with them, and an answer nothing waits for
/// cancels what is left of its item.
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

    /// Apple's rule for app extensions: one process per background session, one session object per identifier in it.
    /// Each share gets its own identifier (so the app never holds one the extension uses, and a share extension the OS
    /// reuses makes a new one), and a process asking twice for one identifier gets the same object.
    func testEachShareHasItsOwnSession() throws {
        let a = BackgroundPublisher.newAttempt()
        let b = BackgroundPublisher.newAttempt()
        XCTAssertNotEqual(a, b)
        let idA = BackgroundPublisher.sessionIdentifier(attempt: a)
        XCTAssertEqual(idA, "com.daylight.share.bg.\(a)")
        XCTAssertNotEqual(idA, BackgroundPublisher.sessionIdentifier(attempt: b))
        XCTAssertEqual(BackgroundPublisher.attempt(ofSession: idA), a)
        XCTAssertNil(BackgroundPublisher.attempt(ofSession: "com.daylight.share.refresh"))
        XCTAssertNil(BackgroundPublisher.attempt(ofSession: "com.daylight.share.bg"))
        XCTAssertNil(BackgroundPublisher.attempt(ofSession: "com.daylight.share.bg."))

        let registry = BackgroundSessionRegistry<FakeUploads>()
        var made = 0
        let first = registry.session(idA) { made += 1; return FakeUploads() }
        let again = registry.session(idA) { made += 1; return FakeUploads() }
        XCTAssertTrue(first.made)
        XCTAssertFalse(again.made)
        XCTAssertTrue(first.session === again.session, "one session object per identifier in a process")
        XCTAssertEqual(made, 1)
        let other = registry.session(BackgroundPublisher.sessionIdentifier(attempt: b)) { FakeUploads() }
        XCTAssertFalse(other.session === first.session)
        XCTAssertEqual(registry.all.map(\.identifier), [idA, BackgroundPublisher.sessionIdentifier(attempt: b)])

        // Every row of one share carries the share's attempt (its session's name) in its tasks' labels.
        let p = publisher()
        let r1 = try p.start(.link("https://example.com/1", title: "1"), pairing: pairing, attempt: a)
        let r2 = try p.start(.link("https://example.com/2", title: "2"), pairing: pairing, attempt: a)
        XCTAssertEqual(r1.bgAttempt, a)
        XCTAssertEqual(r2.bgAttempt, a)
        XCTAssertEqual(uploads.started.map(\.description), [BackgroundPublisher.describe(id: r1.id, part: 0, attempt: a),
                                                            BackgroundPublisher.describe(id: r2.id, part: 0, attempt: a)])
    }

    /// The answers a session hears go to the outbox wherever it is held (the share extension while it runs, the app
    /// after): the row, the frame files and the failure notice (review finding: the extension dropped them).
    func testASessionsAnswersReachTheOutbox() async throws {
        center.authorized = true
        let box = BackgroundPublisher.SessionBox()
        box.session = uploads
        let answer = BackgroundPublisher.answers(store: store, notices: FailureNotices(center: center, prefs: LabPreferences(store: store)),
                                                 daylightName: { "Test Daylight" }, box: box)
        // `answers` writes to the store's outbox: start on that one.
        let p = BackgroundPublisher(outbox: OutboxStore(store: store), uploads: uploads)
        let row = try p.start(.link("https://example.com/story", title: "A story"), pairing: pairing)
        let frame = uploads.started[0].file
        await answer(uploads.started[0].description, 413, nil)
        let failed = try XCTUnwrap(OutboxStore(store: store).row(row.id))
        XCTAssertEqual(failed.status, .failed)
        XCTAssertEqual(failed.errorCode, "full")
        XCTAssertFalse(FileManager.default.fileExists(atPath: frame.path), "the frame file goes")
        XCTAssertEqual(center.posted.map(\.title), ["Couldn’t send ‘A story’ to Test Daylight"])

        let ok = try p.start(.link("https://example.com/ok", title: "OK"), pairing: pairing)
        await answer(uploads.started[1].description, 200, nil)
        XCTAssertEqual(OutboxStore(store: store).row(ok.id)?.status, .sent)

        // F26: with Lab on, what the answers did is in Setup check's activity log, the 413 with its http.
        let events = ActivityLog(store: store).events
        XCTAssertEqual(events.map(\.type), ["failed", "sent"])
        XCTAssertEqual(events.first?.status, "failed/full")
        XCTAssertEqual(events.first?.http, 413)
        XCTAssertEqual(events.first?.id8, String(row.id.prefix(8)))
        // With Lab off, nothing is logged.
        LabSettings.setOn(false, store: store)
        _ = try p.start(.link("https://example.com/off", title: "Off"), pairing: pairing)
        await answer(uploads.started[2].description, 200, nil)
        XCTAssertEqual(ActivityLog(store: store).events.count, 2)
    }

    /// Review finding (F04, F07.3): a share in place's row that is still uploading must not be sent again by the app.
    /// Once the item is removed (or the app sent it itself, or it was delivered) an answer for its background attempt
    /// changes no row, cancels the attempt's other tasks for the item and deletes its frame files.
    func testAnAnswerNothingWaitsForCancelsTheRestAndDeletesTheFrames() async throws {
        let p = publisher()
        let content = Data((0..<5000).map { UInt8($0 % 251) })
        let row = try p.start(.file(content, name: "big.pdf", mime: "application/pdf", title: "Big"), pairing: pairing, chunkSize: 2000)
        let other = try p.start(.link("https://example.com/other", title: "Other"), pairing: pairing)
        let d = uploads.started.filter { $0.description.hasPrefix(row.id) }.map(\.description)
        XCTAssertEqual(d.count, 3)
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: row.id, in: p.framesDirectory).count, 3)
        // A stray answer for another attempt of a row still sending: nothing changes, its frame files stay.
        let stray = await p.complete(description: BackgroundPublisher.describe(id: row.id, part: 0, attempt: "not-this-one"),
                                     status: 200, error: nil)
        XCTAssertEqual(stray, .ignored)
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: row.id, in: p.framesDirectory).count, 3)
        XCTAssertTrue(uploads.cancelled.isEmpty)
        // Removed: its body and frame files go with it.
        let removed = await outbox.removeRow(row.id)
        XCTAssertEqual(removed?.bgAttempt, row.bgAttempt)
        XCTAssertNil(outbox.readBody(row.id))
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: row.id, in: p.framesDirectory), [])
        // Its first part's answer: ignored, and the item's other parts are cancelled (not the other item's).
        let late = await p.complete(description: d[0], status: 200, error: nil)
        XCTAssertEqual(late, .ignored)
        XCTAssertEqual(Set(uploads.cancelled), Set(d))
        XCTAssertNil(outbox.row(row.id), "a removed row never comes back")
        XCTAssertEqual(outbox.row(other.id)?.status, .sending)
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: other.id, in: p.framesDirectory).count, 1)
        // Delivered before its answer came: the answer deletes the frame file.
        var delivered = try XCTUnwrap(outbox.row(other.id))
        delivered.status = .delivered
        outbox.save(delivered)
        let after = await p.complete(description: BackgroundPublisher.describe(id: other.id, part: 0, attempt: other.bgAttempt!),
                                     status: 200, error: nil)
        XCTAssertEqual(after, .ignored)
        XCTAssertEqual(outbox.row(other.id)?.status, .delivered)
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: other.id, in: p.framesDirectory), [])
    }

    /// Rows that go take their files with them: Clear (delivered and expired) and the 200-row trim drop frame files as
    /// they drop bodies; a pairing change empties `bg/`.
    func testFinishedAndRemovedRowsLeaveNoFrameFiles() async throws {
        let p = publisher()
        let a = try p.start(.file(Data(repeating: 7, count: 3000), name: "a.pdf", mime: "application/pdf"), pairing: pairing,
                            chunkSize: 2000)
        let b = try p.start(.link("https://example.com/b", title: "B"), pairing: pairing)
        var ra = try XCTUnwrap(outbox.row(a.id))
        ra.status = .expired
        outbox.save(ra)
        await outbox.clearFinished()
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: a.id, in: p.framesDirectory), [])
        XCTAssertEqual(FrameFileBuilder.frameFiles(id: b.id, in: p.framesDirectory).count, 1)
        let gone = await outbox.removeAll()
        XCTAssertEqual(gone.map(\.id), [b.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: p.framesDirectory.path), "bg/ goes with the pairing")
    }

    /// Review finding (F07.2, 2.6): Unpair and a pairing with another secret cancel the background uploads of every row
    /// they remove (the whole attempt), so the old pairing's sealed frames never reach the old Daylight afterwards; the
    /// same secret (a new relay) keeps the rows and cancels nothing.
    func testPairingChangesCancelTheBackgroundUploads() async throws {
        var asked: [[String: Set<String>?]] = []
        let saved = BackgroundPublisher.cancelUploads
        BackgroundPublisher.cancelUploads = { gone, _, _ in asked.append(gone) }
        defer { BackgroundPublisher.cancelUploads = saved }
        await store.pair(pairing)
        let p = BackgroundPublisher(outbox: OutboxStore(store: store), uploads: uploads)
        let attempt = BackgroundPublisher.newAttempt()
        _ = try p.start(.link("https://example.com/1", title: "1"), pairing: pairing, attempt: attempt)
        _ = try p.start(.link("https://example.com/2", title: "2"), pairing: pairing, attempt: attempt)
        // The same secret on another relay: nothing goes.
        await store.pair(try Pairing(secret: pairing.secret, relay: "https://relay2.test"))
        XCTAssertTrue(asked.isEmpty)
        XCTAssertEqual(OutboxStore(store: store).rows.count, 2)
        // Another Daylight: every row goes, and the attempt's tasks are cancelled, all of them.
        await store.pair(try Pairing.generate(relay: "https://relay.test", name: "Other Daylight"))
        XCTAssertEqual(asked.count, 1)
        XCTAssertEqual(Array(asked[0].keys), [attempt])
        XCTAssertEqual(asked[0][attempt], .some(nil), "every task of the attempt")
        XCTAssertTrue(OutboxStore(store: store).rows.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: p.framesDirectory.path), "the old pairing's frames go")
        // Unpair does the same.
        let again = BackgroundPublisher.newAttempt()
        _ = try p.start(.link("https://example.com/3", title: "3"), pairing: pairing, attempt: again)
        await store.unpair()
        XCTAssertEqual(asked.count, 2)
        XCTAssertEqual(Array(asked[1].keys), [again])
        // Rows with no background attempt cancel nothing.
        await store.pair(pairing)
        await store.unpair()
        XCTAssertEqual(asked.count, 2)
        // `gone` for Remove: the attempt and the ids that went.
        var r1 = OutboxRow(id: String(repeating: "a", count: 32), kind: .url, header: ItemHeader(id: String(repeating: "a", count: 32), kind: .url, sent: ""),
                           created: clock, status: .sending)
        r1.bgAttempt = "x"
        var r2 = r1
        r2.id = String(repeating: "b", count: 32)
        let r3 = OutboxRow(id: String(repeating: "c", count: 32), kind: .url, header: r1.header, created: clock, status: .failed)
        let some: [String: Set<String>?] = ["x": Set([r1.id, r2.id])]
        let all: [String: Set<String>?] = ["x": .some(nil)]
        XCTAssertEqual(BackgroundPublisher.gone([r1, r2, r3]), some)
        XCTAssertEqual(BackgroundPublisher.gone([r1, r3], all: true), all)
        XCTAssertTrue(BackgroundPublisher.gone([r3]).isEmpty)
    }

    /// The sessions a process holds: their live tasks keep their rows from going stale; one with no task left whose
    /// attempt the outbox no longer waits for is let go, and one the outbox still waits for is kept (its answers may
    /// still be on their way).
    func testLiveAttemptsAndLettingGo() async throws {
        let registry = BackgroundSessionRegistry<FakeUploads>()
        let (a, b, c) = (BackgroundPublisher.newAttempt(), BackgroundPublisher.newAttempt(), BackgroundPublisher.newAttempt())
        let id = "0123456789abcdef0123456789abcdef"
        let live = registry.session(BackgroundPublisher.sessionIdentifier(attempt: a)) { FakeUploads() }.session
        live.live = [BackgroundPublisher.describe(id: id, part: 0, attempt: a)]
        let done = registry.session(BackgroundPublisher.sessionIdentifier(attempt: b)) { FakeUploads() }.session
        let waiting = registry.session(BackgroundPublisher.sessionIdentifier(attempt: c)) { FakeUploads() }.session
        var released: [FakeUploads] = []
        let attempts = await BackgroundPublisher.liveAttempts(in: registry, waiting: [a, c]) { released.append($0) }
        XCTAssertEqual(attempts, [a])
        XCTAssertEqual(released.count, 1)
        XCTAssertTrue(released.first === done)
        XCTAssertEqual(registry.all.map(\.session).count, 2)
        XCTAssertTrue(registry.all.contains { $0.session === waiting })
    }

    /// The app (iPhone and Mac: review finding, the iPhone app is woken only when a session's tasks have all ended)
    /// takes over the sessions of shares 15 minutes old (by then the extension that started them has ended), and only of
    /// rows still sending; each once, so a session it holds counts by its own live tasks from the next tick on.
    func testTheAppTakesOverTheSessionsOfOldSharesOnce() {
        func row(_ n: Int, _ status: OutboxRow.Status, age: TimeInterval, attempt: String?) -> OutboxRow {
            let id = String(format: "%032x", n)
            var r = OutboxRow(id: id, kind: .url, url: "https://e.com/\(n)", header: ItemHeader(id: id, kind: .url, sent: ""),
                              created: clock.addingTimeInterval(-age), status: status)
            r.bgAttempt = attempt
            return r
        }
        let rows = [row(1, .sending, age: 16 * 60, attempt: "old"), row(2, .sending, age: 5 * 60, attempt: "new"),
                    row(3, .sent, age: 60 * 60, attempt: nil), row(4, .sending, age: 60 * 60, attempt: nil),
                    row(5, .failed, age: 60 * 60, attempt: "gone")]
        XCTAssertEqual(BackgroundPublisher.adoptable(rows, now: clock), ["old"])
        XCTAssertEqual(BackgroundPublisher.waiting(rows), ["old", "new"])

        let registry = BackgroundSessionRegistry<FakeUploads>()
        var made: [String] = []
        let first = BackgroundPublisher.adopt(["old", "older"], in: registry) { a in made.append(a); return FakeUploads() }
        XCTAssertEqual(first, ["old", "older"], "taken over just now: not stale on this tick")
        let second = BackgroundPublisher.adopt(["old", "older"], in: registry) { a in made.append(a); return FakeUploads() }
        XCTAssertEqual(second, [], "already held: its own live tasks decide")
        XCTAssertEqual(made.sorted(), ["old", "older"])
    }

    /// Review finding 1's case (F04, F07.3): two shares in place made in Airplane Mode wait in their sessions; the app
    /// opens 20 minutes later. The rows stay `sending` while their tasks live (the OS uploads them when the network is
    /// back), so no tick re-sends them and nothing is uploaded twice; with no task left, v1.1's 15 minutes apply.
    func testRowsWhoseUploadsWaitForTheNetworkAreNotSentAgain() async throws {
        FakeRelay.reset()
        let p = publisher()
        let attempt = BackgroundPublisher.newAttempt()
        let a = try p.start(.file(Data(repeating: 1, count: 3000), name: "a.pdf", mime: "application/pdf"), pairing: pairing,
                            attempt: attempt, chunkSize: 2000)
        let b = try p.start(.file(Data(repeating: 2, count: 3000), name: "b.pdf", mime: "application/pdf"), pairing: pairing,
                            attempt: attempt, chunkSize: 2000)
        uploads.live = uploads.started.map(\.description)
        let sender = try ShareSender(pairing: pairing, outbox: outbox, session: FakeRelay.session)
        sender.relay.sleep = { _ in }
        sender.now = { [unowned self] in self.clock.addingTimeInterval(20 * 60) }
        let rows = outbox.rows
        XCTAssertEqual(BackgroundPublisher.adoptable(rows, now: clock.addingTimeInterval(20 * 60)), [attempt])
        sender.liveBackgroundAttempts = await p.liveAttempts()
        let resent = await sender.resendDue()
        XCTAssertEqual(resent, [], "nothing is sent again while the OS still holds the uploads")
        XCTAssertEqual(FakeRelay.with { $0.answeredPublishes }, 0)
        XCTAssertEqual(outbox.row(a.id)?.status, .sending)
        XCTAssertEqual(outbox.row(b.id)?.status, .sending)
        // The tasks are gone (the OS dropped them): the v1.1 rule re-sends from the stored body.
        uploads.live = []
        sender.liveBackgroundAttempts = await p.liveAttempts()
        let again = await sender.resendDue()
        XCTAssertEqual(again.map(\.status), [.sent, .sent])
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
    /// The attempts it was made for, and the handler its answers go to (the share sheet's fake sessions).
    var attempts: [String] = []
    var answer: BackgroundAnswer?

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
