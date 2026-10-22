#if canImport(DaylightShareUI)
@testable import DaylightShareKit
@testable import DaylightShareUI
import Foundation
import XCTest

/// The Lab views' logic (LAB-PLAN 1.1, 1.5): when a tapped control's note says "Checking your Daylight server…"
/// (`GateTap`), and the share card's own Lab switch (the ad-hoc Mac build's Share menu item).
final class LabViewTests: XCTestCase {
    var root: URL!
    var suites: [String] = []

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dls-labviews-\(UUID().uuidString)")
    }

    override func tearDown() {
        for s in suites { UserDefaults.standard.removePersistentDomain(forName: s) }
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    func makeStore(_ name: String, appGroup: String? = nil) -> SharedStore {
        let suite = "dls-labviews-\(UUID().uuidString)"
        suites.append(suite)
        return SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root.appendingPathComponent(name),
                           appGroup: appGroup)
    }

    @MainActor
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("timed out waiting for \(what)"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    static let notReady = LabGate.Result(ready: false, state: "needs-pairing", message: "m", short: "Pair first", button: nil)

    /// What happened, in order (a reference the escaping `checking` closure can append to).
    @MainActor final class Events {
        var list: [String] = []
        var checking: Int { list.filter { $0 == "checking" }.count }
        func add(_ e: String) { list.append(e) }
    }

    // MARK: "Checking your Daylight server…" (1.5)

    /// A server feature whose gate answers at once (a local check, a cached status) shows its note with nothing said
    /// before it: the checking line is cancelled with the answer and never comes later.
    @MainActor
    func testAnAnswerInTimeSaysNothingBeforeIt() async throws {
        let events = Events()
        let r = await GateTap.run("F37", gate: { Self.notReady }) { events.add("checking") }
        XCTAssertEqual(r, Self.notReady)
        try await Task.sleep(nanoseconds: 2 * GateTap.checkingAfterNs)
        XCTAssertEqual(events.checking, 0)
        XCTAssertEqual(GateTap.checkingAfterNs, 150_000_000, "as the JS and Windows ports (CHECKING_AFTER_MS)")
    }

    /// A server feature whose gate is still waiting says "Checking your Daylight server…" once, before its answer.
    @MainActor
    func testAServerWaitSaysCheckingOnceBeforeTheAnswer() async throws {
        let events = Events()
        let r = await GateTap.run("F02", after: 20_000_000, gate: {
            try? await Task.sleep(nanoseconds: 600_000_000)
            events.add("answer")
            return Self.notReady
        }) { events.add("checking") }
        XCTAssertEqual(r, Self.notReady)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(events.list, ["checking", "answer"])
    }

    /// A feature that is not a server feature (F01's needs-inbox, W1's needs-notifications) never says server words,
    /// however long its gate takes.
    @MainActor
    func testALocalGateNeverSaysServerWords() async throws {
        for feature in ["F01", "F04", "F09", "F33"] {
            XCTAssertFalse(Lab.isServerFeature(feature), feature)
            let events = Events()
            _ = await GateTap.run(feature, after: 10_000_000, gate: {
                try? await Task.sleep(nanoseconds: 200_000_000)
                return Self.notReady
            }) { events.add("checking") }
            try await Task.sleep(nanoseconds: 50_000_000)
            XCTAssertEqual(events.checking, 0, feature)
        }
        for feature in ["F02", "F37", "F19", "F36"] { XCTAssertTrue(Lab.isServerFeature(feature), feature) }
    }

    /// Not paired, What's in Lab, tap "Summaries with Claude": the note is needs-pairing's sentence, and no server was
    /// checked, so "Checking your Daylight server…" is never shown or said.
    @MainActor
    func testNotPairedSummariesSaysPairFirstWithoutChecking() async throws {
        let store = makeStore("unpaired")
        await store.ready()
        let net = StubNet()
        net.hang = true
        let center = LabCenter(store: store, platform: "mac", fetch: net.fetch)
        let events = Events()
        let r = await GateTap.run("F37", gate: { await center.gate("F37") }) { events.add("checking") }
        XCTAssertFalse(r.ready)
        XCTAssertEqual(r.state, "needs-pairing")
        XCTAssertEqual(r.message, LabText.needsMessage("needs-pairing", platform: "mac", feature: "F37"))
        try await Task.sleep(nanoseconds: 2 * GateTap.checkingAfterNs)
        XCTAssertEqual(events.checking, 0)
        XCTAssertEqual(net.requests.count, 0, "no server was asked")
    }

    /// Paired, and the server never answers: the note says "Checking your Daylight server…" until the gate's deadline
    /// gives OFFLINE.
    @MainActor
    func testAServerThatDoesNotAnswerSaysCheckingThenOffline() async throws {
        let store = makeStore("paired")
        await store.pair(try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight"))
        let net = StubNet()
        net.hang = true
        let center = LabCenter(store: store, platform: "mac", fetch: net.fetch)
        let events = Events()
        let r = await GateTap.run("F37", gate: {
            let r = await center.gate("F37", deadlineMs: 600)
            events.add(r.state)
            return r
        }) { events.add("checking") }
        XCTAssertEqual(r.state, "OFFLINE")
        XCTAssertEqual(events.list, ["checking", "OFFLINE"])
    }

    // MARK: What's in Lab opening (1.5)

    /// What's in Lab uses the cached states when it opens and then refreshes (1.5, the JS `labOverview` with refresh
    /// false, then true): after a recent answer (the Settings row's), the server group shows its short state at once,
    /// even while the server is slow to answer now, and the fresh answer follows.
    @MainActor
    func testWhatsInLabShowsTheCachedStatesAtOnce() async throws {
        let store = makeStore("cached")
        await store.pair(try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight"))
        let net = StubNet()
        net.route("GET", "https://relay.test/") { _ in (200, Data()) } // nothing on the config topic: needs-server
        let center = LabCenter(store: store, platform: "mac", fetch: net.fetch)
        let lab = LabModel(center: center, arguments: [])
        try await waitFor("the first read") { lab.isLoaded }
        await lab.refreshServerRow()
        XCTAssertEqual(lab.serverRowState, "needs-server")
        XCTAssertNil(lab.overview)

        net.hang = true // the server and the relay are slow now
        let opening = Task { await lab.openOverview() }
        try await waitFor("the cached states", timeout: 1.5) { lab.overview != nil }
        XCTAssertEqual(lab.overview?.serverState, "needs-server")
        XCTAssertEqual(lab.overview?.serverShort, "Not set up")
        XCTAssertEqual(lab.overview?.fresh, true)
        XCTAssertEqual(lab.overview?.serverRows.map(\.id), ["F02", "F37", "F19", "F36"])
        await opening.value
        XCTAssertEqual(lab.overview?.serverState, "OFFLINE", "then the server is asked, within the gate's 5 s")
    }

    // MARK: The share card's own Lab switch (1.1, F00's Mac edge case)

    /// The card that keeps its own storage (the ad-hoc Mac build's Share menu item) has its own Lab switch on the Mac,
    /// on by default, saved in its own storage through `LabSettings`; the iPhone's share sheet has none (it follows the
    /// app's), and neither has a card that shares the app's storage.
    @MainActor
    func testTheAdHocMacCardHasItsOwnLabSwitch() async throws {
        let own = ShareCardSample.needsPairing.model()
        XCTAssertTrue(own.showsCardSettings)
        XCTAssertTrue(own.lab, "on by default")
        #if os(macOS)
        XCTAssertTrue(own.showsCardLabSwitch)
        #else
        XCTAssertFalse(own.showsCardLabSwitch)
        #endif
        own.setLab(false)
        XCTAssertFalse(own.lab, "the card follows at once")
        try await waitFor("Lab saved in the card's storage") { own.store.defaults.object(forKey: "dls.lab") as? Bool == false }
        XCTAssertFalse(LabSettings.isOn(store: own.store))
        XCTAssertFalse(own.store.comfort, "Lab is not Comfort")

        XCTAssertFalse(ShareCardSample.needsPairing.model(lab: false).lab, "-DLSLab 0: the parity walk's card")
        for sample in [ShareCardSample.reading, .sent, .sentNote, .resultNote, .confirmPairing] {
            XCTAssertFalse(sample.model().showsCardLabSwitch, "\(sample) shares the app's storage")
        }
        let store = makeStore("phases")
        func card(_ phase: ShareExtensionModel.Phase) -> ShareExtensionModel {
            ShareExtensionModel(sample: phase, store: store, summary: "", note: nil, daylightName: "D",
                                sharesPairingWithApp: false, comfort: false)
        }
        XCTAssertFalse(card(.reading).showsCardLabSwitch)
        XCTAssertFalse(card(.sending).showsCardLabSwitch)
        XCTAssertEqual(card(.nothing).showsCardLabSwitch, card(.nothing).showsCardSettings && Self.isMac)
    }

    static var isMac: Bool {
        #if os(macOS)
        return true
        #else
        return false
        #endif
    }

    /// A real share with storage of its own: the first start writes lab = true when the key is missing (1.2), and a
    /// stored "off" is read back; with the App Group the card reads the app's switch and writes nothing.
    @MainActor
    func testTheCardReadsItsOwnLabSwitch() async throws {
        func share(_ store: SharedStore) async throws -> ShareExtensionModel {
            let model = ShareExtensionModel(store: store)
            let item = NSExtensionItem()
            item.attachments = [NSItemProvider(object: NSURL(string: "https://example.com/article")!)]
            model.start(inputItems: [item])
            try await waitFor("the pairing screen") { model.phase == .needsPairing }
            return model
        }
        let fresh = makeStore("fresh")
        let first = try await share(fresh)
        XCTAssertTrue(first.lab)
        XCTAssertEqual(fresh.defaults.object(forKey: "dls.lab") as? Bool, true, "the first start writes lab = true")

        let off = makeStore("off")
        off.lab = false
        let second = try await share(off)
        XCTAssertFalse(second.lab)
        XCTAssertEqual(second.showsCardLabSwitch, Self.isMac)

        let group = makeStore("group", appGroup: "group.test")
        let shared = try await share(group)
        XCTAssertTrue(shared.lab)
        XCTAssertFalse(shared.showsCardSettings)
        XCTAssertFalse(shared.showsCardLabSwitch)
        XCTAssertNil(group.defaults.object(forKey: "dls.lab"), "the app's switch: the card writes nothing")
    }
}
#endif
