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
}
#endif
