#if canImport(DaylightShareUI)
@testable import DaylightShareKit
@testable import DaylightShareUI
import Foundation
import SwiftUI
import XCTest

/// The accessibility baseline (LAB-PLAN F27, not Lab): Comfort's words, storage and test hook; what is said to
/// VoiceOver; the truncation audit's recorder; the UI tests' own storage.
final class AccessibilityBaselineTests: XCTestCase {
    var root: URL!
    var suites: [String] = []

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dls-a11y-\(UUID().uuidString)")
    }

    override func tearDown() {
        for s in suites { UserDefaults.standard.removePersistentDomain(forName: s) }
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    func makeStore() -> SharedStore {
        let suite = "dls-tests-\(UUID().uuidString)"
        suites.append(suite)
        return SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root)
    }

    @MainActor
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("timed out waiting for \(what)"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    func row(_ i: Int, _ status: OutboxRow.Status, title: String = "An article", errorCode: String = "") -> OutboxRow {
        let id = String(format: "%032x", i)
        let h = ItemHeader(id: id, kind: .url, url: "https://e.com/\(i)", title: title, sent: "")
        return OutboxRow(id: id, kind: .url, title: title, url: h.url ?? "", header: h, created: Date(), status: status,
                         errorCode: errorCode)
    }

    // MARK: Comfort

    /// The switch and its footer are LAB_TEXT's (share/vectors/lab-vectors.json › labText.strings).
    func testComfortWordsAreTheSharedCopy() throws {
        let url = URL(fileURLWithPath: #filePath) // …/apple/DaylightShareKit/Tests/DaylightShareKitTests/<this file>
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("share/vectors/lab-vectors.json")
        let vectors = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let strings = try XCTUnwrap((vectors["labText"] as? [String: Any])?["strings"] as? [String: Any])
        XCTAssertEqual(Comfort.title, strings["comfort"] as? String)
        XCTAssertEqual(Comfort.footer, strings["comfortFooter"] as? String)
        XCTAssertEqual(Comfort.footer, "Larger text and buttons, more contrast, no motion.")
        XCTAssertEqual(Comfort.minTarget, 52)
        XCTAssertEqual(Comfort.borderWidth, 2)
        XCTAssertEqual(Comfort.typeSizes, DynamicTypeSize.xxLarge ... DynamicTypeSize.accessibility3)
    }

    func testTheComfortLaunchArgument() {
        XCTAssertEqual(Comfort.launchValue(["app", "-DLSComfort", "1"]), true)
        XCTAssertEqual(Comfort.launchValue(["app", "-DLSComfort", "0"]), false)
        XCTAssertNil(Comfort.launchValue(["app"]))
        XCTAssertNil(Comfort.launchValue(["app", "-DLSComfort"]))
        XCTAssertNil(Comfort.launchValue(["app", "-DLSComfort", "maybe"]))
    }

    /// Off when never set; saved in the shared defaults, so the app's extensions follow it.
    func testComfortIsOffByDefaultAndStored() {
        let store = makeStore()
        XCTAssertFalse(store.comfort)
        store.comfort = true
        XCTAssertTrue(store.comfort)
        XCTAssertTrue(store.defaults.bool(forKey: "dls.comfort"))
        store.comfort = false
        XCTAssertFalse(store.comfort)
    }

    /// The model reads Comfort with everything else (off the main thread), changes it at once, and saves it off the
    /// main thread; `-DLSComfort 1` turns it on before the first render.
    @MainActor
    func testTheModelKeepsComfortOffTheMainThread() async throws {
        let store = makeStore()
        StorageAudit.reset()
        let model = AppModel(store: store, arguments: [])
        try await waitFor("the first read") { model.isLoaded }
        XCTAssertFalse(model.comfort)
        model.setComfort(true)
        XCTAssertTrue(model.comfort, "the windows follow at once")
        try await waitFor("Comfort saved") { store.defaults.bool(forKey: "dls.comfort") }
        await model.reloadNow()
        XCTAssertTrue(model.comfort)
        XCTAssertEqual(StorageAudit.mainThreadAccesses, [], "storage was touched on the main thread")

        store.comfort = false
        let launched = AppModel(store: store, arguments: ["app", "-DLSComfort", "1"])
        XCTAssertTrue(launched.comfort, "-DLSComfort 1 applies before the first render")
        try await waitFor("the launch argument saved") { store.defaults.bool(forKey: "dls.comfort") }
        await launched.reloadNow()
        XCTAssertTrue(launched.comfort)
        XCTAssertEqual(launched.statusSnapshot()["comfort"] as? Bool, true)
    }

    // MARK: Announcements

    func testDeliveredAndNotDeliveredAreAnnounced() {
        let before = [row(1, .sent), row(2, .failed, errorCode: "network"), row(3, .sending), row(4, .delivered)]
        var after = before
        after[0].status = .delivered
        after[1].status = .expired
        after[2].status = .sent
        after.append(row(5, .delivered, title: "New"))
        XCTAssertEqual(Announcer.changes(from: before, to: after), ["Delivered ✓, An article", "Not delivered, An article"])
        XCTAssertEqual(Announcer.changes(from: before, to: before), [])
        XCTAssertEqual(Announcer.changes(from: [], to: after), [], "the first read announces nothing")
    }

    @MainActor
    func testTheModelSaysBannersAndDeliveriesOutLoud() async throws {
        var said: [String] = []
        let post = Announcer.post
        Announcer.post = { said.append($0) }
        defer { Announcer.post = post }

        let store = makeStore()
        await store.pair(try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight"))
        let outbox = OutboxStore(store: store)
        outbox.save(row(1, .sent, title: "Long read"))
        let model = AppModel(store: store, arguments: [])
        try await waitFor("the history") { model.rows.count == 1 }
        XCTAssertEqual(said, [], "loading the history is not news")

        model.show("Sent · waiting for your Daylight")
        XCTAssertEqual(said, ["Sent · waiting for your Daylight"])

        outbox.update { state in state.rows[0].status = .delivered }
        // The change notification starts a read of its own, which may overtake this one: wait for whichever publishes.
        await model.reloadNow()
        try await waitFor("the delivery to be said") { said.last == "Delivered ✓, Long read" }
        XCTAssertEqual(said.filter { $0.hasPrefix("Delivered") }.count, 1, "said once")
    }

    func testTheShareSheetSaysEachOutcome() {
        let sent = RowText(status: .sent, errorCode: "", size: 0, created: Date())
        XCTAssertEqual(ShareExtensionModel.announcement(for: .sent(sent)), "Sent · waiting for your Daylight")
        XCTAssertEqual(ShareExtensionModel.announcement(for: .result(title: "Not sent", message: "Too big to send.")),
                       "Not sent. Too big to send.")
        XCTAssertEqual(ShareExtensionModel.announcement(for: .paired("Paired with Desk Daylight.")), "Paired with Desk Daylight.")
        XCTAssertNil(ShareExtensionModel.announcement(for: .sending))
        XCTAssertNil(ShareExtensionModel.announcement(for: .needsPairing))
        // The note under a sent card or a result is said too (CHANGES-v1.1 2.5).
        let note = ShareText.pageSentAsLinkMessage
        XCTAssertEqual(ShareExtensionModel.announcement(for: .sent(sent), note: note),
                       "Sent · waiting for your Daylight. The page is larger than 8 MB, so its link was sent.")
        XCTAssertEqual(ShareExtensionModel.announcement(for: .result(title: "Not sent", message: "Too big to send."), note: note),
                       "Not sent. Too big to send. The page is larger than 8 MB, so its link was sent.")
        let delivered = RowText(status: .delivered, errorCode: "", size: 0, created: Date())
        XCTAssertEqual(ShareExtensionModel.announcement(for: .sent(delivered), note: note),
                       "Delivered ✓ Saved on your Daylight. The page is larger than 8 MB, so its link was sent.")
        XCTAssertNil(ShareExtensionModel.announcement(for: .needsPairing, note: note))
    }

    // MARK: The share card

    /// Every sample card shows its state without reading or sending anything (the truncation audit and the Lab-off
    /// parity walk use them; `-DLSShareCard <name>`).
    @MainActor
    func testTheShareCardSamples() async throws {
        XCTAssertEqual(ShareCardSample.allCases.map(\.rawValue),
                       ["reading", "sent", "sent-note", "result-note", "needs-pairing", "confirm-pairing"])
        XCTAssertEqual(ShareCardSample.launchValue(["app", "-DLSShareCard", "sent-note"]), .sentNote)
        XCTAssertNil(ShareCardSample.launchValue(["app", "-DLSShareCard", "nonsense"]))
        XCTAssertNil(ShareCardSample.launchValue(["app"]))
        for sample in ShareCardSample.allCases {
            let model = sample.model(comfort: true)
            XCTAssertTrue(model.comfort)
            XCTAssertEqual(model.daylightName, "Test Daylight")
            var finished = false
            model.onFinish = { finished = true }
            model.start(inputItems: [])
            try await Task.sleep(nanoseconds: 50_000_000)
            XCTAssertFalse(finished, "\(sample) started")
            switch (sample, model.phase) {
            case (.reading, .reading), (.needsPairing, .needsPairing):
                break
            case (.sent, .sent(let text)), (.sentNote, .sent(let text)):
                XCTAssertEqual(text.label, "Sent · waiting for your Daylight")
            case (.resultNote, .result(let title, let message)):
                XCTAssertEqual(title, "Waiting to send")
                XCTAssertEqual(message, "Couldn’t send right now. It will try again by itself.")
            case (.confirmPairing, .confirmPairing(let c)):
                XCTAssertEqual(c.title, "Pair with The Daylight in the reading room upstairs?")
                XCTAssertEqual(c.button, "Switch")
            default:
                XCTFail("\(sample) shows \(model.phase)")
            }
            let noted: [ShareCardSample] = [.sentNote, .resultNote]
            XCTAssertEqual(model.note, noted.contains(sample) ? ShareText.pageSentAsLinkMessage : nil, "\(sample)")
        }
    }

    /// A card that keeps its own storage (no App Group) has its own Comfort switch while it waits for the user, and it
    /// is saved there; a card that shares the app's storage follows the app's switch and shows none.
    @MainActor
    func testACardWithItsOwnStorageHasItsOwnComfortSwitch() async throws {
        let own = ShareCardSample.needsPairing.model()
        XCTAssertFalse(own.sharesPairingWithApp)
        XCTAssertTrue(own.showsCardSettings)
        XCTAssertFalse(own.comfort)
        own.setComfort(true)
        XCTAssertTrue(own.comfort, "the card follows at once")
        try await waitFor("Comfort saved in the card's storage") { own.store.defaults.bool(forKey: "dls.comfort") }

        for sample in [ShareCardSample.reading, .sent, .sentNote, .resultNote, .confirmPairing] {
            XCTAssertFalse(sample.model().showsCardSettings, "\(sample) shares the app's storage")
        }

        // In its own storage, every phase that waits for the user shows it; reading, sending and asking do not, and a
        // sent card only when it stays open for its note.
        let store = makeStore()
        func card(_ phase: ShareExtensionModel.Phase, note: String? = nil) -> ShareExtensionModel {
            ShareExtensionModel(sample: phase, store: store, summary: "", note: note, daylightName: "D",
                                sharesPairingWithApp: false, comfort: false)
        }
        let sent = RowText(status: .sent, errorCode: "", size: 0, created: Date())
        XCTAssertTrue(card(.result(title: "Not sent", message: "")).showsCardSettings)
        XCTAssertTrue(card(.paired("Paired with D.")).showsCardSettings)
        XCTAssertTrue(card(.nothing).showsCardSettings)
        XCTAssertTrue(card(.sent(sent), note: ShareText.pageSentAsLinkMessage).showsCardSettings)
        XCTAssertFalse(card(.sent(sent)).showsCardSettings)
        XCTAssertFalse(card(.reading).showsCardSettings)
        XCTAssertFalse(card(.sending).showsCardSettings)
    }

    // MARK: Truncation audit

    func testTheRecorderReportsCutText() {
        let recorder = TruncationRecorder(width: 320)
        recorder.laid("a", "fits", CGRect(x: 16, y: 0, width: 200, height: 40))
        recorder.needed("a", "fits", CGSize(width: 200, height: 40.3))
        recorder.laid("b", "too short", CGRect(x: 16, y: 50, width: 200, height: 20))
        recorder.needed("b", "too short", CGSize(width: 200, height: 60))
        recorder.laid("c", "past the edge", CGRect(x: 200, y: 80, width: 180, height: 20))
        recorder.needed("c", "past the edge", CGSize(width: 180, height: 20))
        recorder.laid("d", "off screen", .zero)
        recorder.needed("d", "off screen", CGSize(width: 100, height: 20))
        recorder.laid("e", "half measured", CGRect(x: 0, y: 0, width: 10, height: 10))
        XCTAssertEqual(recorder.measured, 4)
        XCTAssertEqual(recorder.problems, ["“too short” has 200×20, needs 200×60",
                                           "“past the edge” runs past the edge (200…380 of 320)"])
    }

    // MARK: The UI tests' storage

    /// `-DLSTestStorage` gives a fresh, empty store of the process's own; without it there is none.
    func testUITestStorageIsFreshAndSeparate() throws {
        XCTAssertNil(SharedStore.testStore(arguments: ["app"]))
        let first = try XCTUnwrap(SharedStore.testStore(arguments: ["app", "-DLSTestStorage"]))
        first.deviceName = "Left over"
        first.comfort = true
        let second = try XCTUnwrap(SharedStore.testStore(arguments: ["app", "-DLSTestStorage"]))
        XCTAssertEqual(second.deviceName, "", "a new launch starts empty")
        XCTAssertFalse(second.comfort)
        XCTAssertNil(second.pairing)
        XCTAssertFalse(second.isShared)
        XCTAssertTrue(second.directory.path.hasSuffix("DaylightShare-UITest"))
        UserDefaults.standard.removePersistentDomain(forName: "com.daylight.share.uitest")
        try? FileManager.default.removeItem(at: second.directory)
    }
}
#endif
