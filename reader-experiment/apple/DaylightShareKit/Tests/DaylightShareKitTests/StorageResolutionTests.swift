#if canImport(DaylightShareUI)
@testable import DaylightShareKit
@testable import DaylightShareUI
import Foundation
import XCTest

/// Storage resolution must never run on, or hold up, the main thread.
///
/// The 1.0 Mac app hung at launch on macOS 15: `SharedStore` resolved its App Group on the main thread, and the probe
/// write into the group container waited behind the "would like to access data from other apps" prompt. These tests
/// stand in a slow (or stuck) container check and require the app model to be ready at once, the check to run off
/// the main thread, and the app to keep working on its own storage meanwhile.
final class StorageResolutionTests: XCTestCase {
    static let group = "group.test.daylight"
    var root: URL!
    var suites: [String] = []

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dls-storage-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
        for s in suites { UserDefaults.standard.removePersistentDomain(forName: s) }
        super.tearDown()
    }

    func makeDefaults() -> UserDefaults {
        let suite = "dls-tests-\(UUID().uuidString)"
        suites.append(suite)
        return UserDefaults(suiteName: suite)!
    }

    /// Records the threads the resolver's steps ran on.
    final class Probe: @unchecked Sendable {
        private let lock = NSLock()
        private var main = false
        private var count = 0
        private var writableChecks = 0

        func record(_ step: String) {
            lock.lock()
            defer { lock.unlock() }
            count += 1
            if step == "isWritable" { writableChecks += 1 }
            if Thread.isMainThread { main = true }
        }

        var ranOnMainThread: Bool { lock.lock(); defer { lock.unlock() }; return main }
        var steps: Int { lock.lock(); defer { lock.unlock() }; return count }
        var containerChecks: Int { lock.lock(); defer { lock.unlock() }; return writableChecks }
    }

    /// A resolver for a fake App Group whose container check (`isWritable`) takes `delay` seconds.
    func resolver(declared: [String] = [StorageResolutionTests.group], delay: TimeInterval, writable: Bool = true,
                  probe: Probe, groupDefaults: UserDefaults) -> AppGroupResolver {
        let container = root.appendingPathComponent("group-container", isDirectory: true)
        return AppGroupResolver(
            declaredGroups: { declared },
            extraGroups: { probe.record("extraGroups"); return [] },
            isAllowed: { _ in probe.record("isAllowed"); return true },
            containerURL: { _ in probe.record("containerURL"); return container },
            isWritable: { url in
                probe.record("isWritable")
                Thread.sleep(forTimeInterval: delay)
                return writable && SharedStore.isWritable(url)
            },
            defaults: { _ in probe.record("defaults"); return groupDefaults })
    }

    @MainActor
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("timed out waiting for \(what)"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    @MainActor
    func testTheAppModelIsReadyAtOnceWhileTheAppGroupIsSlow() async throws {
        let probe = Probe()
        let groupDefaults = makeDefaults()
        let own = makeDefaults()
        let slow = resolver(delay: 1.0, probe: probe, groupDefaults: groupDefaults)
        let start = Date()
        let store = SharedStore(resolver: slow, timeout: 5, privateDefaults: own,
                                privateDirectory: root.appendingPathComponent("own"))
        let model = AppModel(store: store)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertLessThan(elapsed, 0.1, "creating the store and the app model waited \(elapsed) s for the App Group")

        // The main thread is free while the container check runs: the main queue gets to run within 100 ms.
        let ping = Date()
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            DispatchQueue.main.async { cont.resume() }
        }
        XCTAssertLessThan(Date().timeIntervalSince(ping), 0.1)
        XCTAssertEqual(model.storage, .resolving)
        XCTAssertFalse(model.isStorageReady)
        XCTAssertFalse(model.isPaired)

        // The app works meanwhile: pairing is accepted now and saved once storage is settled.
        let pairing = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        XCTAssertNil(model.pair(pairing.link))
        XCTAssertNotNil(model.pair("nonsense"))

        await store.ready()
        try await waitFor("the pairing") { model.isPaired }
        XCTAssertEqual(store.state, .shared(group: Self.group))
        XCTAssertEqual(model.storage, .shared(group: Self.group))
        XCTAssertEqual(model.storageSummary, "Yes")
        XCTAssertEqual(model.pairing, pairing)
        XCTAssertNotNil(groupDefaults.data(forKey: "dls.pairing"), "the pairing went to the App Group")
        XCTAssertEqual(store.directory.path, root.appendingPathComponent("group-container/Library/Application Support/DaylightShare").path)

        XCTAssertGreaterThan(probe.steps, 0)
        XCTAssertFalse(probe.ranOnMainThread, "App Group resolution ran on the main thread")
    }

    @MainActor
    func testAStuckAppGroupFallsBackToTheAppsOwnStorage() async throws {
        let probe = Probe()
        let own = makeDefaults()
        let groupDefaults = makeDefaults()
        // Like the macOS 15 prompt nobody answers: the container check takes far longer than the timeout.
        let stuck = resolver(delay: 0.8, probe: probe, groupDefaults: groupDefaults)
        let start = Date()
        let store = SharedStore(resolver: stuck, timeout: 0.15, privateDefaults: own,
                                privateDirectory: root.appendingPathComponent("own"))
        let model = AppModel(store: store)
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.1)
        await store.ready()
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.6, "ready() waited for the stuck container check")
        guard case .appPrivate = store.state else { return XCTFail("expected the app's own storage, got \(store.state)") }
        XCTAssertFalse(store.isShared)
        try await waitFor("the model to see settled storage") { model.isStorageReady }
        XCTAssertEqual(model.storageSummary, "No (pair them separately)")

        // Fully usable: pairing is saved (in the background), in the app's own storage.
        let pairing = try Pairing.generate(relay: "https://relay.test")
        XCTAssertNil(model.pair(pairing.link))
        try await waitFor("the pairing") { model.isPaired }
        XCTAssertNotNil(own.data(forKey: "dls.pairing"))

        // The late answer from the container check is ignored.
        try await Task.sleep(nanoseconds: 900_000_000)
        guard case .appPrivate = store.state else { return XCTFail("switched storage after the timeout") }
        XCTAssertNil(groupDefaults.data(forKey: "dls.pairing"))
        XCTAssertEqual(model.pairing, pairing)
        XCTAssertFalse(probe.ranOnMainThread)
    }

    @MainActor
    func testABuildWithoutAnAppGroupNeverLooksForOne() async throws {
        let probe = Probe()
        let store = SharedStore(resolver: resolver(declared: [], delay: 5, probe: probe, groupDefaults: makeDefaults()),
                                privateDefaults: makeDefaults(), privateDirectory: root.appendingPathComponent("own"))
        // Settled immediately, so the pairing screen shows without even a spinner.
        XCTAssertTrue(store.isReady)
        guard case .appPrivate = store.state else { return XCTFail("expected the app's own storage") }
        let model = AppModel(store: store)
        XCTAssertTrue(model.isStorageReady)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(probe.steps, 0, "a build without an App Group touched one")

        // The Safari extension's handler answers from its own (empty) storage.
        let answered = expectation(description: "answer")
        SafariNativeMessaging.answerWhenReady(["type": "getPairing"], store: store) { answer in
            XCTAssertEqual(answer["ok"] as? Bool, true)
            XCTAssertEqual(answer["paired"] as? Bool, false)
            XCTAssertEqual(answer["shared"] as? Bool, false)
            answered.fulfill()
        }
        await fulfillment(of: [answered], timeout: 1)
    }

    func testTheSafariHandlerAnswersOffTheMainThreadOnceResolved() {
        let probe = Probe()
        let groupDefaults = makeDefaults()
        let store = SharedStore(resolver: resolver(delay: 0.3, probe: probe, groupDefaults: groupDefaults),
                                privateDefaults: makeDefaults(), privateDirectory: root.appendingPathComponent("own"))
        let answered = expectation(description: "answer")
        let start = Date()
        SafariNativeMessaging.answerWhenReady(["type": "ping"], store: store) { answer in
            XCTAssertEqual(answer["shared"] as? Bool, true)
            XCTAssertEqual(answer["storage"] as? String, "shared (\(Self.group))")
            answered.fulfill()
        }
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.1, "the handler blocked its thread")
        wait(for: [answered], timeout: 3)
        XCTAssertFalse(probe.ranOnMainThread)
    }

    func testAPairingFromAnEarlierBuildWithoutTheGroupMovesIntoIt() async throws {
        let own = makeDefaults()
        let ownDir = root.appendingPathComponent("own")
        let earlier = SharedStore(defaults: own, directory: ownDir)
        let pairing = try Pairing.generate(relay: "https://relay.test", name: "Desk")
        earlier.pair(pairing)
        earlier.deviceName = "Studio Mac"
        let sender = try ShareSender(pairing: pairing, outbox: OutboxStore(store: earlier), session: FakeRelay.session)
        sender.relay.sleep = { _ in }
        // A file keeps its encoded body in the outbox until delivered (a link is header-only).
        let row = try await sender.send(.file(Data("kept".utf8), name: "kept.txt"))
        XCTAssertTrue(row.hasBody)

        let groupDefaults = makeDefaults()
        let store = SharedStore(resolver: resolver(delay: 0, probe: Probe(), groupDefaults: groupDefaults),
                                privateDefaults: own, privateDirectory: ownDir)
        await store.ready()
        XCTAssertTrue(store.isShared)
        XCTAssertEqual(store.pairing, pairing)
        XCTAssertEqual(store.deviceName, "Studio Mac")
        XCTAssertEqual(OutboxStore(store: store).row(row.id)?.name, "kept.txt")
        XCTAssertNotNil(OutboxStore(store: store).readBody(row.id))
        // Moved, not copied: unpairing in the group later must not bring it back.
        XCTAssertNil(own.data(forKey: "dls.pairing"))

        // A group that already has a pairing keeps it.
        let other = try Pairing.generate(relay: "https://relay.test", name: "Other")
        let own2 = makeDefaults()
        SharedStore(defaults: own2, directory: root.appendingPathComponent("own2")).pair(other)
        let store2 = SharedStore(resolver: resolver(delay: 0, probe: Probe(), groupDefaults: groupDefaults),
                                 privateDefaults: own2, privateDirectory: root.appendingPathComponent("own2"))
        await store2.ready()
        XCTAssertEqual(store2.pairing, pairing)
        XCTAssertNotNil(own2.data(forKey: "dls.pairing"))
    }

    @MainActor
    func testTheShareExtensionAsksForTheCodeOnceWithoutAnAppGroup() async throws {
        let store = SharedStore(resolver: resolver(declared: [], delay: 0, probe: Probe(), groupDefaults: makeDefaults()),
                                privateDefaults: makeDefaults(), privateDirectory: root.appendingPathComponent("own"))
        let model = ShareExtensionModel(store: store)
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(object: NSURL(string: "https://example.com/article")!)]
        model.start(inputItems: [item])
        try await waitFor("the pairing screen") { model.phase == .needsPairing }
        XCTAssertFalse(model.sharesPairingWithApp)
        XCTAssertTrue(ShareExtensionView.pasteOnceText.contains("once"))
    }

    func testDeclaredGroupsComeFromTheBuild() {
        #if os(macOS)
        // Ad-hoc and unsigned Mac builds: DAYLIGHT_MAC_APP_GROUP is empty, so no group, not even the default one.
        XCTAssertEqual(SharedStore.declaredGroups(info: ["DaylightAppGroup": ""]), [])
        XCTAssertEqual(SharedStore.declaredGroups(info: nil), [])
        XCTAssertEqual(SharedStore.declaredGroups(info: ["DaylightAppGroup": "$(DAYLIGHT_MAC_APP_GROUP)"]), [])
        XCTAssertEqual(SharedStore.declaredGroups(info: ["DaylightAppGroup": "ABCDE12345.com.daylight.share"]),
                       ["ABCDE12345.com.daylight.share"])
        // This test process is ad-hoc signed and has no App Group entitlement: no group is authorised.
        XCTAssertFalse(SharedStore.signatureAuthorises("ABCDE12345.com.daylight.share"))
        XCTAssertFalse(SharedStore.signatureAuthorises(SharedStore.defaultAppGroup))
        #else
        XCTAssertEqual(SharedStore.declaredGroups(info: ["DaylightAppGroup": ""]), [SharedStore.defaultAppGroup])
        #endif
    }

    /// `SharedStore.shared` in this (unsigned) test process: settled at once, without an App Group.
    func testTheSharedStoreOfAnUnsignedMacProcess() {
        #if os(macOS)
        XCTAssertTrue(SharedStore.shared.isReady)
        XCTAssertNil(SharedStore.shared.appGroup)
        #endif
    }

    /// The 1.1 fix review: no storage read or write (own container or App Group) on the main thread, at startup or
    /// when pairing, renaming, removing or refusing a file. (Sending is covered by the Mac smoke test's status dump.)
    @MainActor
    func testTheAppModelNeverTouchesStorageOnTheMainThread() async throws {
        let own = makeDefaults()
        let ownDir = root.appendingPathComponent("own")
        // Earlier runs left a pairing and a history row (written here, off the main thread).
        let first = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        let header = ItemHeader(id: "00112233445566778899aabbccddeeff", kind: .url, url: "https://e.com", sent: "")
        await Task.detached {
            let earlier = SharedStore(defaults: own, directory: ownDir)
            earlier.pair(first)
            OutboxStore(store: earlier).save(OutboxRow(id: header.id, kind: .url, url: "https://e.com", header: header,
                                                       created: Date(), status: .delivered))
        }.value

        StorageAudit.reset()
        let store = SharedStore(resolver: resolver(declared: [], delay: 0, probe: Probe(), groupDefaults: makeDefaults()),
                                privateDefaults: own, privateDirectory: ownDir)
        let model = AppModel(store: store)
        XCTAssertFalse(model.isLoaded, "the model does not read storage while it is created")
        try await waitFor("the first read") { model.isLoaded }
        XCTAssertEqual(model.pairing, first)
        XCTAssertEqual(model.rows.map(\.id), [header.id])

        // A link from outside with another secret asks first and changes nothing until confirmed.
        let second = try Pairing.generate(relay: "https://relay.test", name: "Kitchen Daylight")
        await model.handleOpen([URL(string: second.link)!])
        try await waitFor("the question") { model.pendingPairing != nil }
        XCTAssertEqual(model.pendingPairing?.confirmation.button, "Switch")
        XCTAssertEqual(model.pendingPairing?.confirmation.title, "Pair with Kitchen Daylight?")
        XCTAssertEqual(model.pairing, first)
        model.cancelPairing()
        XCTAssertNil(model.pendingPairing)

        // The same secret applies without asking and keeps the history.
        await model.handleOpen([URL(string: try Pairing(secret: first.secret, relay: "https://relay2.test", name: "Desk").link)!])
        try await waitFor("the new relay") { model.pairing?.relay == "https://relay2.test" }
        XCTAssertNil(model.pendingPairing)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.banner?.text, "Pairing updated: now sending through relay2.test.")

        // Switching after confirming deletes the old Daylight's history.
        await model.handleOpen([URL(string: second.link)!])
        try await waitFor("the question") { model.pendingPairing != nil }
        model.confirmPairing()
        try await waitFor("the switch") { model.pairing?.secret == second.secret }
        try await waitFor("the history to empty") { model.rows.isEmpty }

        model.setDeviceName("Studio Mac")
        try await waitFor("the device name") { model.deviceName == "Studio Mac" }
        let big = root.appendingPathComponent("big.pdf")
        FileManager.default.createFile(atPath: big.path, contents: nil)
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: 9_500_000)
        try handle.close()
        await model.sendFile(big)
        XCTAssertEqual(model.banner?.text, "Too big to send. Files can be up to 9 MB; this one is 9.5 MB.")
        model.reload()
        await model.reloadNow()

        XCTAssertEqual(StorageAudit.mainThreadAccesses, [], "storage was touched on the main thread")
    }
}
#endif
