#if canImport(DaylightShareUI)
@testable import DaylightShareKit
@testable import DaylightShareUI
import Foundation
import XCTest

/// The app model's sheets and pairing question (the views present `model.presented` from one place).
final class AppModelTests: XCTestCase {
    var root: URL!
    var suite = ""

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dls-model-\(UUID().uuidString)")
        suite = "dls-tests-\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    @MainActor
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("timed out waiting for \(what)"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    /// The reviewer's case: Settings is open (or the file picker, or the scanner) when a daylightshare:// link for
    /// another Daylight arrives. SwiftUI cannot present a second sheet over the first, so the question takes the
    /// first one's place in the single presentation (`presented`), and the open sheet is closed.
    @MainActor
    func testAPairingLinkReplacesTheOpenSheet() async throws {
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        let first = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        await store.pair(first)
        let model = AppModel(store: store)
        try await waitFor("the first read") { model.isLoaded }
        XCTAssertNil(model.presented)

        for sheet in [AppModel.Sheet.settings, .files, .scanner] {
            model.sheet = sheet
            XCTAssertEqual(model.presented, .sheet(sheet))
            let next = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
            await model.handleOpen([URL(string: next.link)!])
            try await waitFor("the question") { model.pendingPairing != nil }
            XCTAssertNil(model.sheet, "the open sheet gives way")
            guard case let .pairing(pending)? = model.presented else { return XCTFail("the question is not presented") }
            XCTAssertEqual(pending.confirmation.button, "Switch")
            model.cancelPairing()
            XCTAssertNil(model.presented)
            XCTAssertEqual(model.pairing, first)
        }

        // The same secret applies at once and leaves an open sheet alone.
        model.sheet = .settings
        await model.handleOpen([URL(string: try Pairing(secret: first.secret, relay: "https://relay2.test").link)!])
        try await waitFor("the new relay") { model.pairing?.relay == "https://relay2.test" }
        XCTAssertEqual(model.presented, .sheet(.settings))
        model.sheet = nil
    }

    /// "Remove" goes through the outbox lock (it waits for an attempt in flight) and the history follows.
    @MainActor
    func testRemoveAndClearUpdateTheHistory() async throws {
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        await store.pair(try Pairing.generate(relay: "https://relay.test"))
        let outbox = OutboxStore(store: store)
        for (i, status) in [OutboxRow.Status.failed, .delivered, .expired].enumerated() {
            let id = String(format: "%032x", i)
            let h = ItemHeader(id: id, kind: .url, url: "https://e.com/\(i)", sent: "")
            outbox.save(OutboxRow(id: id, kind: .url, url: h.url ?? "", header: h, created: Date(), status: status))
        }
        StorageAudit.reset()
        let model = AppModel(store: store)
        try await waitFor("the history") { model.rows.count == 3 }
        model.clearFinished()
        try await waitFor("delivered and expired to go") { model.rows.count == 1 }
        XCTAssertEqual(model.rows.first?.status, .failed)
        model.delete(try XCTUnwrap(model.rows.first))
        try await waitFor("the row to go") { model.rows.isEmpty }
        model.unpair()
        try await waitFor("unpaired") { !model.isPaired }
        XCTAssertEqual(StorageAudit.mainThreadAccesses, [], "storage was touched on the main thread")
        XCTAssertTrue(outbox.rows.isEmpty)
    }

    // MARK: Re-pairing (LAB-PLAN 2.6, DESIGN 3.4 and 12.7)

    static let origin = "https://daylight-0123456789ab.example.workers.dev"
    static let now: Int64 = 1_792_486_800_000

    /// The pairing's Daylight server as an earlier visit to Lab settings left it: pinned, its config cached.
    static func pinServer(_ store: SharedStore, _ pairing: Pairing) throws {
        let v = try ServerCode.derive(seed: ServerCode.deriveSeed(secret: pairing.secret))
        let files = FileServerStore(store: store)
        files.set(ServerKeys.config, ServerConfig(server: origin, api: 1, fingerprint: v.fingerprint, delivery: "lab").json)
        files.set(ServerKeys.configAt, .number(Double(now)))
        files.set(ServerKeys.pin, .object(["origin": .string(origin), "fingerprint": .string(v.fingerprint)]))
    }

    static func token(_ pairing: Pairing) throws -> String {
        try ServerCode.derive(seed: ServerCode.deriveSeed(secret: pairing.secret)).authToken
    }

    static func serverCode(_ pairing: Pairing) throws -> String {
        try ServerCode.format(seed: ServerCode.deriveSeed(secret: pairing.secret), relay: pairing.relay)
    }

    static func lockRequests(_ net: StubNet) -> [URLRequest] {
        net.requests.filter { $0.url?.path == "/v1/admin/lock" && $0.httpMethod == "POST" }
    }

    /// A store paired with one Daylight whose server is pinned, a stub network that takes the lock, and a Lab model on
    /// both (Lab on or off).
    func pinnedPairing(lab on: Bool) async throws -> (SharedStore, Pairing, StubNet, LabModel) {
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        let first = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        await store.pair(first)
        try await Task.detached { try Self.pinServer(store, first) }.value
        let net = StubNet()
        net.json("POST", "\(Self.origin)/v1/admin/lock", ["ok": true])
        let t = Self.now
        let center = LabCenter(store: store, platform: "mac", fetch: net.fetch, now: { t })
        let lab = await LabModel(center: center, arguments: on ? [] : ["-DLSLab", "0"])
        return (store, first, net, lab)
    }

    /// Reads storage off the main thread (the app never reads it on the main thread).
    func stored<T: Sendable>(_ body: @escaping @Sendable () -> T) async -> T {
        await Task.detached { body() }.value
    }

    /// The reviewer's case: a Mac paired with one Daylight has a pinned server; the user scans another Daylight's code
    /// and taps Switch. The old server is locked with the old token before the pairing changes, and the window then
    /// shows the locked text with the new Server code and the re-run help (Settings › Lab too), until OK.
    @MainActor
    func testSwitchLocksTheOldServerAndShowsTheNewServerCode() async throws {
        let (store, first, net, lab) = try await pinnedPairing(lab: true)
        let model = AppModel(store: store, lab: lab, arguments: [])
        try await waitFor("the first read") { model.isLoaded && lab.isLoaded }
        XCTAssertNil(model.presented)
        XCTAssertNil(lab.repaired)

        let second = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
        await model.handleOpen([URL(string: second.link)!])
        try await waitFor("the question") { model.pendingPairing != nil }
        XCTAssertTrue(net.requests.isEmpty, "nothing is locked before Switch")
        model.confirmPairing()
        try await waitFor("the follow-up") {
            if case .repaired? = model.presented { return true }
            return false
        }
        // The pairing is published by the newest storage read, which a change notification may have started after
        // the switch's own: wait for it rather than read it at once.
        try await waitFor("the new pairing") { model.pairing == second }
        let locks = Self.lockRequests(net)
        XCTAssertEqual(locks.count, 1)
        XCTAssertEqual(locks.first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(try Self.token(first))",
                       "locked with the old pairing's token")
        guard case let .repaired(r)? = model.presented else { return XCTFail("the follow-up is not presented") }
        XCTAssertEqual(r.message, ServerMessages.stateMessages["locked"])
        XCTAssertEqual(r.serverCode, try Self.serverCode(second), "the new pairing's Server code")
        XCTAssertEqual(r.rerun, ServerMessages.rerunHelp)
        XCTAssertEqual(lab.repaired, r, "Settings › Lab shows it too")

        // Swiped away: the window lets it go, Settings › Lab keeps it until OK.
        model.presented = nil
        XCTAssertNil(model.presented)
        XCTAssertNotNil(lab.repaired)
        model.dismissRepaired()
        XCTAssertNil(lab.repaired)
        let deadline = Date().addingTimeInterval(5)
        while await stored({ store.labRepairedAt }) != nil {
            if Date() > deadline { return XCTFail("OK was not saved") }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        try await waitFor("the follow-up to stay gone") { lab.repaired == nil && model.presented == nil }
    }

    /// Lab off: the old server is still locked (2.6: "whether Lab is on or off"), and nothing visible changes.
    @MainActor
    func testSwitchWithLabOffLocksAndShowsNothing() async throws {
        let (store, first, net, lab) = try await pinnedPairing(lab: false)
        let model = AppModel(store: store, lab: lab, arguments: [])
        try await waitFor("the first read") { model.isLoaded && lab.isLoaded }
        XCTAssertFalse(lab.isOn)
        let second = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
        await model.handleOpen([URL(string: second.link)!])
        try await waitFor("the question") { model.pendingPairing != nil }
        model.confirmPairing()
        try await waitFor("the banner") { model.banner?.text == "Paired with Kitchen Daylight." }
        try await waitFor("the new pairing") { model.pairing == second }
        XCTAssertEqual(Self.lockRequests(net).first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(try Self.token(first))")
        await lab.reloadNow()
        XCTAssertNil(model.presented, "Lab off: no follow-up")
        XCTAssertNil(lab.repaired)
    }

    /// F00.4's server pin (LAB-PLAN 1.3: nothing is deleted): Lab off, then on again, keeps the pairing and the pinned
    /// Daylight server, and locks nothing; with Lab back on the server row is asked again.
    @MainActor
    func testLabOffAndOnAgainKeepsTheServerPin() async throws {
        let (store, first, net, lab) = try await pinnedPairing(lab: true)
        try await waitFor("the first read") { lab.isLoaded }
        XCTAssertTrue(lab.isOn)
        let pin = await stored { FileServerStore(store: store).get(ServerKeys.pin) }
        XCTAssertNotNil(pin, "no pin to keep")

        for on in [false, true] {
            let word = on ? "on" : "off"
            lab.setOn(on)
            let deadline = Date().addingTimeInterval(5)
            while await stored({ store.lab }) != on {
                if Date() > deadline { return XCTFail("Lab \(word) was not saved") }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
            await lab.reloadNow()
            if on { await lab.refreshServerRow() }
            try await Task.sleep(nanoseconds: 300_000_000) // the switch's own task has run to its end
            let pinNow = await stored { FileServerStore(store: store).get(ServerKeys.pin) }
            let pairedNow = await stored { store.pairing?.code }
            XCTAssertEqual(pinNow, pin, "Lab \(word) changed or removed the server pin")
            XCTAssertEqual(pairedNow, first.code, "Lab \(word) changed the pairing")
            XCTAssertEqual(lab.isOn, on)
        }
        XCTAssertNotNil(lab.serverRowState, "with Lab back on, the server row was not asked again")
        XCTAssertTrue(Self.lockRequests(net).isEmpty, "turning Lab off or on locked a server")
    }

    /// The Share extension's pairing link, confirmed with Switch, locks the old server first too.
    @MainActor
    func testTheShareExtensionLocksTheOldServerFirst() async throws {
        let (store, first, net, _) = try await pinnedPairing(lab: true)
        let model = ShareExtensionModel(store: store)
        model.fetch = net.fetch
        let second = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(object: NSURL(string: second.link)!)]
        model.start(inputItems: [item])
        try await waitFor("the question") {
            if case .confirmPairing = model.phase { return true }
            return false
        }
        XCTAssertTrue(net.requests.isEmpty)
        model.confirmPairing()
        try await waitFor("paired") {
            if case .paired = model.phase { return true }
            return false
        }
        XCTAssertEqual(Self.lockRequests(net).first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(try Self.token(first))")
        let paired = await stored { store.pairing?.code }
        XCTAssertEqual(paired, second.code)
        let mark = await stored { store.labRepairedAt }
        XCTAssertNotNil(mark, "the app shows the follow-up (Settings › Lab)")
    }

    /// The Safari extension's native handler: a confirmed setPairing with another code locks the old server first and
    /// says so (`serverLocked`).
    func testSafariSetPairingLocksTheOldServerFirst() async throws {
        let (store, first, net, _) = try await pinnedPairing(lab: true)
        let other = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
        let asked = await SafariNativeMessaging.answer(["type": "setPairing", "code": other.code], store: store, fetch: net.fetch)
        XCTAssertEqual(asked["ok"] as? Bool, false)
        XCTAssertTrue(net.requests.isEmpty, "nothing is locked before the user confirms")
        let switched = await SafariNativeMessaging.answer(["type": "setPairing", "code": other.code, "confirm": true],
                                                          store: store, fetch: net.fetch)
        XCTAssertEqual(switched["ok"] as? Bool, true)
        XCTAssertEqual(switched["serverLocked"] as? Bool, true)
        XCTAssertEqual(store.pairing?.secret, other.secret)
        XCTAssertEqual(Self.lockRequests(net).first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(try Self.token(first))")
        XCTAssertNotNil(store.labRepairedAt)

        // The same secret again (a new relay): no lock, no serverLocked.
        let moved = await SafariNativeMessaging.answer(
            ["type": "setPairing", "link": try Pairing(secret: other.secret, relay: "https://relay2.test").link], store: store, fetch: net.fetch)
        XCTAssertEqual(moved["ok"] as? Bool, true)
        XCTAssertNil(moved["serverLocked"])
        XCTAssertEqual(Self.lockRequests(net).count, 1)
    }

    // MARK: Lab W1 review fixes (A3)

    /// 2.5's faster checks (F01.1): while the app shows, a link delivered a minute ago with no state yet makes the app
    /// read the ack topic; the Inbox's "reader" state reaches the ledger, the row reads "In your Reader ✓" and VoiceOver
    /// hears it. Settled, or with the window hidden, nothing is read.
    @MainActor
    func testFastChecksBringTheReaderStateWhileTheAppShows() async throws {
        FakeRelay.reset()
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        let pairing = try Pairing.generate(relay: "https://relay.test", name: "Test Daylight")
        await store.pair(pairing)
        let id = "00112233445566778899aabbccddeeff"
        let h = ItemHeader(id: id, kind: .url, url: "https://example.com/long", title: "A long read", sent: "")
        OutboxStore(store: store).save(OutboxRow(id: id, kind: .url, title: "A long read", url: "https://example.com/long",
                                                 header: h, created: Date().addingTimeInterval(-120), status: .delivered,
                                                 delivered: Date().addingTimeInterval(-60)))
        var said: [String] = []
        let post = Announcer.post
        Announcer.post = { said.append($0) }
        defer { Announcer.post = post }
        let model = AppModel(store: store)
        model.relaySession = FakeRelay.session
        try await waitFor("the history") { model.rows.count == 1 && model.lab.isLoaded }
        XCTAssertEqual(model.rowText(model.rows[0]).label, RowText(row: model.rows[0]).label, "no Lab Inbox heard yet")

        // Hidden: no check.
        model.isVisible = false
        let hidden = await model.fastCheck()
        XCTAssertFalse(hidden)
        model.isVisible = true

        // The Lab Inbox says it is in the Reader.
        let now = Int64(Date().timeIntervalSince1970) // a state's `t` is in Unix seconds
        let frame = try LabFrame.build(keys: pairing.keys, inbox: LabInboxInfo(lab: 1, app: "android/1.5.0", caps: ["st"]),
                                       states: [LabState(i: id, s: "reader", t: now)], from: "Test Daylight")
        FakeRelay.inject(topic: pairing.keys.ackTopic, frame: frame, time: Int(Date().timeIntervalSince1970), attachment: false)
        let read = await model.fastCheck()
        XCTAssertTrue(read)
        try await waitFor("the Reader state") { model.lab.ledger.state(id)?.s == "reader" }
        XCTAssertEqual(model.rowText(model.rows[0]).label, "In your Reader ✓")
        try await waitFor("the announcement") { said.contains("In your Reader ✓, A long read") }

        // Settled: no more fast checks.
        let again = await model.fastCheck()
        XCTAssertFalse(again)
    }

    /// F07.1: rows that wait read "Waiting for connection" while the path monitor says offline, and v1.1's words when
    /// it is online or not known (2.5 rule 2); the model publishes the path's state.
    @MainActor
    func testRowsWaitForTheConnectionWhileOffline() async throws {
        FakeRelay.reset()
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        await store.pair(try Pairing.generate(relay: "https://relay.test", name: "Test Daylight"))
        let model = AppModel(store: store)
        model.relaySession = FakeRelay.session
        try await waitFor("the first read") { model.isLoaded && model.lab.isLoaded }
        let path = FakePath()
        model.startOfflineQueue(path: path)
        try await waitFor("offline") {
            path.set(false)
            return model.online == false
        }
        let sent = await model.send(.link("https://example.com/later", title: "Later"))
        let row = try XCTUnwrap(sent)
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.errorCode, "network")
        XCTAssertEqual(row.attempts, 0, "deferred, not tried")
        XCTAssertEqual(model.rowText(row).label, "Waiting for connection")
        XCTAssertEqual(model.rowText(row).sentence, "It will send when this device is back online.")
        // F07.1 (review finding 5): the banner says it in the row's Lab words, not v1.1's "Waiting to send".
        XCTAssertEqual(model.banner?.text, "Waiting for connection. It will send when this device is back online.")
        // F07.2 (review finding 2): the queue lists it, and rows still sending while offline too.
        XCTAssertEqual(QueueSection.waiting(model.rows, online: model.online).map(\.id), [row.id])
        // Back online: v1.1's words while it waits, and the queue sends it.
        path.set(true)
        try await waitFor("online") { model.online == true }
        XCTAssertNotEqual(model.rowText(row).label, "Waiting for connection")
        try await waitFor("sent") { model.rows.first?.status == .sent }
    }

    // MARK: Lab W1 review fixes, round 2 (A3)

    /// A store paired with "Test Daylight" on the in-process relay, and an app model on it (Lab as `lab` says).
    @MainActor
    func pairedModel(lab on: Bool = true) async throws -> (AppModel, SharedStore) {
        FakeRelay.reset()
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        await store.pair(try Pairing.generate(relay: "https://relay.test", name: "Test Daylight"))
        await AppModel.onStorage { LabSettings.setOn(on, store: store) }
        let model = AppModel(store: store, arguments: on ? [] : ["-DLSLab", "0"])
        model.relaySession = FakeRelay.session
        model.pageFetch = { _ in nil }
        try await waitFor("the first read") { model.isLoaded && model.lab.isLoaded }
        XCTAssertEqual(model.lab.isOn, on)
        return (model, store)
    }

    /// Review finding 3 (F16, "every app uses it at every entry point"): with Lab on, the app's own link field, its
    /// drops and the links it is opened with go through smart intake (tracking removed, x-orig kept, typed text by the
    /// text rules); with Lab off they are v1.1's.
    @MainActor
    func testTheAppsOwnEntryPointsUseSmartIntake() async throws {
        let nyt = "https://www.nytimes.com/2026/10/22/science/tides.html?smid=nytcore-ios-share"
        let cleaned = "https://www.nytimes.com/2026/10/22/science/tides.html"
        let (model, _) = try await pairedModel()
        let typed = await model.sendLink(nyt)
        XCTAssertTrue(typed)
        let row = try XCTUnwrap(model.rows.first)
        XCTAssertEqual(row.url, cleaned)
        XCTAssertEqual(row.header.extras["x-orig"], nyt)
        // A bare address stays a link; words with no link are refused as v1.1 refuses them, not sent as a note.
        let bare = await model.sendLink("example.com/story")
        XCTAssertTrue(bare)
        XCTAssertTrue(model.rows.contains { $0.url == "https://example.com/story" }, "\(model.rows.map(\.url))")
        let words = await model.sendLink("remember the milk")
        XCTAssertFalse(words)
        XCTAssertEqual(model.banner?.text, "That isn’t a web address.")
        XCTAssertEqual(model.rows.count, 2)
        // A link the app is opened with goes as given, cleaned.
        await model.handleOpen([URL(string: "https://en.wikipedia.org/wiki/Washington,_D.C.?utm_source=x")!])
        try await waitFor("the opened link") { model.rows.count == 3 }
        let opened = try XCTUnwrap(model.rows.first { $0.url.hasPrefix("https://en.wikipedia.org/") })
        XCTAssertEqual(opened.url, "https://en.wikipedia.org/wiki/Washington,_D.C.")
        XCTAssertEqual(opened.header.extras["x-orig"], "https://en.wikipedia.org/wiki/Washington,_D.C.?utm_source=x")

        // Lab off: v1.1, byte for byte.
        let (off, _) = try await pairedModel(lab: false)
        _ = await off.sendLink(nyt)
        XCTAssertEqual(off.rows.first?.url, nyt)
        XCTAssertNil(off.rows.first?.header.extras["x-orig"])
    }

    /// Review finding 4 (F02e, 1.5): a file refused as over 9 MB is told apart (`Banner.tooBig`), and with Lab on its
    /// banner stays, so "Send files over 9 MB ›" and its note under it do not vanish; with Lab off it goes as v1.1's.
    @MainActor
    func testATooBigFileKeepsItsBannerWithLab() async throws {
        let big = FileManager.default.temporaryDirectory.appendingPathComponent("dls-big-\(UUID().uuidString).pdf")
        XCTAssertTrue(FileManager.default.createFile(atPath: big.path, contents: Data()))
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: 14_000_000)
        try handle.close()
        defer { try? FileManager.default.removeItem(at: big) }
        for on in [true, false] {
            let (model, _) = try await pairedModel(lab: on)
            await model.sendFile(big)
            let banner = try XCTUnwrap(model.banner)
            XCTAssertTrue(banner.text.hasPrefix("Too big to send."), banner.text)
            XCTAssertTrue(banner.tooBig)
            XCTAssertTrue(banner.isError)
            XCTAssertEqual(model.bannerAutoDismisses, !on, "Lab \(on): the too-big banner stays only with Lab on")
            // Any other banner goes by itself.
            model.show("Paired with Test Daylight.")
            XCTAssertFalse(model.banner?.tooBig ?? true)
            XCTAssertTrue(model.bannerAutoDismisses)
        }
    }

    /// Review finding 2 (F07.2): Remove (the queue's Cancel) of a share in place's row cancels its upload tasks and
    /// deletes its frame files, so it is not published when the connection returns.
    @MainActor
    func testRemoveCancelsAShareInPlacesUploads() async throws {
        var asked: [[String: Set<String>?]] = []
        let saved = BackgroundPublisher.cancelUploads
        BackgroundPublisher.cancelUploads = { gone, _, _ in asked.append(gone) }
        defer { BackgroundPublisher.cancelUploads = saved }
        let (model, store) = try await pairedModel()
        let pairing = try XCTUnwrap(model.pairing)
        let p = BackgroundPublisher(outbox: OutboxStore(store: store), uploads: FakeUploads())
        let attempt = BackgroundPublisher.newAttempt()
        let row = try await AppModel.onStorage {
            Result { try p.start(.file(Data(repeating: 4, count: 3000), name: "a.pdf", mime: "application/pdf"), pairing: pairing,
                                 attempt: attempt, chunkSize: 2000) }
        }.get()
        try await waitFor("the row") { model.rows.count == 1 }
        // Offline, the sending row is in the queue.
        XCTAssertEqual(QueueSection.waiting(model.rows, online: false).map(\.id), [row.id])
        XCTAssertEqual(QueueSection.waiting(model.rows, online: true), [])
        XCTAssertEqual(QueueSection.waiting(model.rows, online: nil), [])
        model.delete(try XCTUnwrap(model.rows.first))
        try await waitFor("the row to go") { model.rows.isEmpty }
        try await waitFor("the cancel") { asked.count == 1 }
        let expected: [String: Set<String>?] = [attempt: Set([row.id])]
        XCTAssertEqual(asked.first, expected)
        let frames = await AppModel.onStorage { FrameFileBuilder.frameFiles(id: row.id, in: OutboxStore(store: store).framesURL) }
        XCTAssertEqual(frames, [])
        // A row with no background attempt cancels nothing.
        _ = await model.sendLink("https://example.com/plain")
        model.delete(try XCTUnwrap(model.rows.first))
        try await waitFor("the plain row to go") { model.rows.isEmpty }
        XCTAssertEqual(asked.count, 1)
    }

    /// Review finding 6 (F01, F04): the ledger the Lab model first reads from storage is the baseline, whichever of it
    /// and the history loads first; its empty starting ledger never is. A row already in the Reader at launch is not
    /// said or noticed again; a change after that is.
    func testTheStoredLedgerIsTheBaseline() {
        func ledger(_ states: [String: String]) -> LabLedger.Snapshot {
            LabLedger.Snapshot(publishers: [], inboxLab: true, caps: ["st"], checkedIn: 1,
                               states: states.mapValues { LabLedger.Entry(s: $0, t: 1) })
        }
        var b = LedgerBaseline()
        // The Lab model's starting ledger (not loaded yet): no baseline, nothing new.
        let starting = b.next(.empty, loaded: false)
        XCTAssertNil(starting)
        XCTAssertNil(b.last)
        // Its first read, with a row already in the Reader: the baseline.
        let stored = ledger(["a": "reader"])
        let first = b.next(stored, loaded: true)
        XCTAssertNil(first)
        XCTAssertEqual(b.last, stored)
        let same = b.next(stored, loaded: true)
        XCTAssertNil(same, "no change")
        // A later change is news, against the ledger before it.
        let later = ledger(["a": "reader", "b": "reader"])
        let news = b.next(later, loaded: true)
        XCTAssertEqual(news, stored)
        let rows = ["a", "b"].map { id -> OutboxRow in
            let h = ItemHeader(id: String(repeating: id, count: 32), kind: .url, sent: "")
            return OutboxRow(id: id, kind: .url, title: id, header: h, created: Date(), status: .delivered)
        }
        XCTAssertEqual(Announcer.readerChanges(from: stored, to: later, rows: rows).map(\.id), ["b"])
        XCTAssertEqual(Announcer.readerChanges(from: .empty, to: stored, rows: rows).map(\.id), ["a"],
                       "what the empty ledger as a baseline would have said again")
    }

    /// The same at launch: a delivered row already in the Reader is neither said nor noticed again when the app opens.
    @MainActor
    func testARowAlreadyInTheReaderIsNotAnnouncedAtLaunch() async throws {
        FakeRelay.reset()
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
        let pairing = try Pairing.generate(relay: "https://relay.test", name: "Test Daylight")
        await store.pair(pairing)
        let id = "00112233445566778899aabbccddeeff"
        let h = ItemHeader(id: id, kind: .url, url: "https://example.com/read", title: "Read already", sent: "")
        await AppModel.onStorage {
            OutboxStore(store: store).save(OutboxRow(id: id, kind: .url, title: "Read already", url: "https://example.com/read",
                                                     header: h, created: Date().addingTimeInterval(-600), status: .delivered,
                                                     delivered: Date().addingTimeInterval(-500)))
            LabPreferences(store: store).tellWhenInReader = true
        }
        // An earlier run of the app read the Inbox's "reader" state into the ledger.
        let now = Int64(Date().timeIntervalSince1970)
        let frame = try LabFrame.build(keys: pairing.keys, inbox: LabInboxInfo(lab: 1, app: "android/1.5.0", caps: ["st"]),
                                       states: [LabState(i: id, s: "reader", t: now)], from: "Test Daylight")
        FakeRelay.inject(topic: pairing.keys.ackTopic, frame: frame, time: Int(now), attachment: false)
        let earlier = try await AppModel.onStorage { Result { try DaylightShare.sender(store: store, session: FakeRelay.session) } }.get()
        _ = try await earlier.checkAcks()
        let stored = await AppModel.onStorage { LabLedger(outbox: OutboxStore(store: store)).snapshot().state(id)?.s }
        XCTAssertEqual(stored, "reader")

        var said: [String] = []
        let post = Announcer.post
        Announcer.post = { said.append($0) }
        defer { Announcer.post = post }
        let center = FakeNoticeCenter()
        center.authorized = true
        let model = AppModel(store: store)
        model.notices = FailureNotices(center: center, prefs: LabPreferences(store: store))
        try await waitFor("both reads") { model.isLoaded && model.lab.isLoaded && model.rows.count == 1 }
        try await waitFor("the stored state") { model.lab.ledger.state(id)?.s == "reader" }
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertFalse(said.contains { $0.contains("In your Reader") }, "said again at launch: \(said)")
        XCTAssertTrue(center.posted.isEmpty, "noticed again at launch")
    }

    /// Review finding 7 (1.5): Send a test article is never greyed out; not paired, a tap shows the needs-pairing
    /// sentence under it.
    @MainActor
    func testSendATestArticleSaysPairFirst() {
        XCTAssertEqual(SetupCheckView.testArticleNote(paired: false, platform: "iphone"),
                       LabText.needsMessage("needs-pairing", platform: "iphone"))
        XCTAssertEqual(SetupCheckView.testArticleNote(paired: false, platform: "iphone"),
                       "Pair with your Daylight first: open Daylight Share on the Daylight and scan or type its code here.")
        XCTAssertNil(SetupCheckView.testArticleNote(paired: true))
    }

    /// Review finding 8 (F26): what a maintenance pass or an ack check did goes into the activity log, with the http
    /// behind a failure: a status change by its new status, a row sent again as "resend".
    @MainActor
    func testMaintenanceIsLoggedWithItsHTTP() async throws {
        let h = ItemHeader(id: String(repeating: "a", count: 32), kind: .url, sent: "")
        let t = Date()
        let sent = OutboxRow(id: "a", kind: .url, header: h, created: t, status: .sent, lastPublish: t)
        var full = sent
        full.status = .failed
        full.errorCode = "full"
        full.http = 413
        var again = sent
        again.lastPublish = t.addingTimeInterval(600)
        let delivered = OutboxRow(id: "b", kind: .url, header: h, created: t, status: .delivered)
        let before = [sent, OutboxRow(id: "b", kind: .url, header: h, created: t, status: .sent), sent.with(id: "c")]
        let changes = AppModel.changes(from: before, to: [full, delivered, sent.with(id: "c"), sent.with(id: "new")])
        XCTAssertEqual(changes.map(\.type), ["failed", "delivered"])
        XCTAssertEqual(changes.first?.row.http, 413)
        XCTAssertEqual(AppModel.changes(from: [sent], to: [again]).map(\.type), ["resend"])

        // Through a refresh: a re-send the relay refuses with 429 is in the log with its http.
        let (model, store) = try await pairedModel()
        _ = await model.sendLink("https://example.com/limited")
        var row = try XCTUnwrap(model.rows.first)
        row.lastPublish = Date().addingTimeInterval(-12 * 3600)
        let stale = row
        await AppModel.onStorage { OutboxStore(store: store).save(stale) }
        FakeRelay.with { $0.failNext = [429, 429, 429, 429] }
        await model.refresh()
        let events = await AppModel.onStorage { ActivityLog(store: store).events }
        let last = try XCTUnwrap(events.last)
        XCTAssertEqual(last.type, "failed", "\(events)")
        XCTAssertEqual(last.http, 429)
    }
}

private extension OutboxRow {
    func with(id: String) -> OutboxRow {
        var r = self
        r.id = id
        return r
    }
}
#endif
