#if canImport(DaylightShareUI)
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit
@testable import DaylightShareUI

/// The sender's Lab ledger (LAB-PROTOCOL 2.2.6) as the apps use it: fed through the sender's `onAckHeader`, whether Lab
/// is on or off; removed with the outbox by a pairing with another secret; pruned to the outbox's items. And the Lab
/// switch (1.2): on by default, read and written off the main thread.
final class LabLedgerTests: XCTestCase {
    var root: URL!
    var suite = ""
    let clockStart = Date(timeIntervalSince1970: 1_800_000_000)

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dls-lab-\(UUID().uuidString)")
        suite = "dls-lab-tests-\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    func makeStore() -> SharedStore {
        SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root.appendingPathComponent("store"))
    }

    @MainActor
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("timed out waiting for \(what)"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    func labFrame(_ pairing: Pairing, states: [LabState], app: String = "android/1.5.0",
                  caps: [String] = [Lab.Caps.st, Lab.Caps.tap, Lab.Caps.readerLink], lab: Int = 1) throws -> Data {
        try LabFrame.build(keys: pairing.keys, inbox: LabInboxInfo(lab: lab, app: app, caps: caps, poll: 1_799_999_990_000, live: true),
                           states: states, from: "Test Daylight")
    }

    // MARK: Through the sender

    func testTheSenderFeedsTheLedgerAndOnlyAnAckDelivers() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let outbox = OutboxStore(directory: root.appendingPathComponent("outbox"))
        let ledger = LabLedger(outbox: outbox, now: { 1_800_000_100_000 })
        let sender = try ShareSender(pairing: pairing, outbox: outbox, from: "Test iPhone", session: FakeRelay.session,
                                     onAckHeader: ledger.hook())
        sender.relay.sleep = { _ in }
        sender.now = { Date(timeIntervalSince1970: 1_800_000_090) }
        let link = try await sender.send(.link("https://example.com/story", title: "A story"))
        let file = try await sender.send(.file(Data(repeating: 7, count: 2000), name: "paper.pdf"))
        let later = try await sender.send(.link("https://example.com/later", title: "Later"))

        // The Daylight acks the first two only, and reports a state for all three.
        let ack = AckHeader(ids: [link.id, file.id])
        FakeRelay.inject(topic: pairing.keys.ackTopic, frame: try Frame.seal(keys: pairing.keys, purpose: .ack, header: ack.json),
                         time: 1_800_000_050, attachment: false)
        FakeRelay.inject(topic: pairing.keys.ackTopic,
                         frame: try labFrame(pairing, states: [LabState(i: link.id, s: "reader", t: 1_800_000_060),
                                                               LabState(i: file.id, s: "handed", t: 1_800_000_061),
                                                               LabState(i: later.id, s: "reader", t: 1_800_000_062)]),
                         time: 1_800_000_070, attachment: false)
        let delivered = try await sender.checkAcks()
        XCTAssertEqual(delivered, 2)
        XCTAssertEqual(outbox.row(later.id)?.status, .sent, "no row says Delivered without an ack")

        let snap = ledger.snapshot()
        XCTAssertTrue(snap.inboxLab)
        XCTAssertEqual(snap.caps, ["reader-link", "st", "tap"])
        XCTAssertEqual(snap.checkedIn, 1_800_000_070_000, "the newest relay time; the poll is earlier")
        XCTAssertEqual(snap.state(link.id), LabLedger.Entry(s: "reader", t: 1_800_000_060))
        XCTAssertEqual(snap.publisher("android")?.app, "android/1.5.0")

        let now = Date(timeIntervalSince1970: 1_800_000_100)
        func text(_ id: String, lab: Bool = true) -> LabRowText {
            LabRowText(row: outbox.row(id)!, now: now, ctx: LabRowText.Context(lab: lab, ledger: snap, rowID: id))
        }
        XCTAssertEqual(text(link.id).label, "In your Reader ✓")
        XCTAssertEqual(text(file.id).label, "Handed to the Reader")
        XCTAssertEqual(text(file.id).sentence, "Your Daylight passed it to the Reader. The Reader doesn’t confirm documents yet.")
        XCTAssertEqual(text(later.id).label, "Sent · waiting for your Daylight", "a state shows only on a delivered row")
        // Lab off: exactly v1.1's rows, whatever the ledger knows.
        for id in [link.id, file.id, later.id] {
            XCTAssertEqual(text(id, lab: false).label, RowText(row: outbox.row(id)!, now: now).label)
            XCTAssertNil(text(id, lab: false).stepLine)
        }

        // The ack arrives later: the row becomes delivered and its state shows at once.
        FakeRelay.inject(topic: pairing.keys.ackTopic, frame: try Frame.seal(keys: pairing.keys, purpose: .ack,
                                                                             header: AckHeader(ids: [later.id]).json),
                         time: 1_800_000_080, attachment: false)
        let more = try await sender.checkAcks()
        XCTAssertEqual(more, 1)
        XCTAssertEqual(LabRowText(row: outbox.row(later.id)!, now: now,
                                  ctx: LabRowText.Context(lab: true, ledger: ledger.snapshot(), rowID: later.id)).label, "In your Reader ✓")
        XCTAssertFalse(LabRowText.wantsFastChecks(outbox.rows, now: now, ledger: ledger.snapshot()), "every delivered row is settled")
    }

    func testTheKitsSenderHasTheLedgerWhetherLabIsOnOrOff() async throws {
        let store = makeStore()
        store.lab = false
        await store.pair(try Pairing.generate())
        let sender = try DaylightShare.sender(store: store)
        XCTAssertNotNil(sender.onAckHeader, "the ledger keeps learning with Lab off (1.3)")
    }

    func testTwoPublishersKeepTheirOwnEntries() throws {
        let file = root.appendingPathComponent("two.json")
        let ledger = LabLedger(file: file, now: { 1_800_000_100_000 })
        let pairing = try Pairing.generate()
        for (app, caps, t) in [("android/1.5.0", ["st", "tap"], 1_800_000_010), ("reader-lab/0.27.900", ["st", "reader-doc", "quiet"], 1_800_000_020)] {
            let f = try LabFrame.build(keys: pairing.keys, inbox: LabInboxInfo(lab: 1, app: app, caps: caps), from: "D")
            ledger.record(headerJSON: try Frame.open(keys: pairing.keys, purpose: .ack, frame: f).headerJSON, time: t)
        }
        XCTAssertEqual(ledger.caps(), ["quiet", "reader-doc", "st", "tap"])
        // Daylight Share turns Lab off: its own entry ends its Lab; the Lab Reader's stays.
        let off = try LabFrame.build(keys: pairing.keys, inbox: LabInboxInfo(lab: 0, app: "android/1.5.0"), from: "D")
        ledger.record(headerJSON: try Frame.open(keys: pairing.keys, purpose: .ack, frame: off).headerJSON, time: 1_800_000_030)
        XCTAssertEqual(ledger.caps(), ["quiet", "reader-doc", "st"])
        XCTAssertTrue(ledger.inboxLab())
        XCTAssertEqual(ledger.publishers().map { $0.name }, ["android", "reader-lab"])
    }

    // MARK: Pairing changes and pruning

    func testAPairingWithAnotherSecretRemovesTheLedger() async throws {
        let store = makeStore()
        let first = try Pairing.generate(relay: "https://relay.test")
        await store.pair(first)
        let outbox = OutboxStore(store: store)
        let ledger = LabLedger(outbox: outbox)
        let file = store.directory.appendingPathComponent(LabLedger.fileName)
        let hello = try labFrame(first, states: [])
        ledger.record(headerJSON: try Frame.open(keys: first.keys, purpose: .ack, frame: hello).headerJSON, time: 1_800_000_000)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))

        // The same secret (a new relay): kept.
        await store.pair(try Pairing(secret: first.secret, relay: "https://relay2.test"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path), "the same secret keeps the ledger")
        XCTAssertTrue(ledger.inboxLab() || ledger.checkedIn() != nil)

        // Another secret: gone with the outbox.
        await store.pair(try Pairing.generate())
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "another secret removes lab.json")
        XCTAssertEqual(ledger.snapshot(), .empty)

        ledger.record(headerJSON: try Frame.open(keys: first.keys, purpose: .ack, frame: hello).headerJSON, time: 1_800_000_000)
        await store.unpair()
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "unpairing removes it too")
        // The Lab switch belongs to the device: pairing changes leave it.
        store.lab = false
        await store.pair(try Pairing.generate())
        XCTAssertFalse(store.lab)
    }

    func testPruneKeepsTheOutboxsItemsAndTheLatestStates() throws {
        let ledger = LabLedger(file: root.appendingPathComponent("prune.json"))
        let pairing = try Pairing.generate()
        var ids: [String] = []
        for batch in 0..<11 {
            var states: [LabState] = []
            for k in 0..<24 {
                let id = ItemBuilder.newID()
                ids.append(id)
                states.append(LabState(i: id, s: "reader", t: Int64(1_800_000_000 + batch * 24 + k)))
            }
            let f = try LabFrame.build(keys: pairing.keys, inbox: LabInboxInfo(), states: states)
            ledger.record(headerJSON: try Frame.open(keys: pairing.keys, purpose: .ack, frame: f).headerJSON, time: 1_800_000_000)
        }
        XCTAssertEqual(ledger.snapshot().states.count, 264)
        ledger.prune(keeping: Set(ids.prefix(250)))
        let kept = ledger.snapshot().states
        XCTAssertEqual(kept.count, Lab.ledgerStatesMax)
        XCTAssertEqual(Set(kept.keys), Set(ids[50..<250]), "the latest 200 of the outbox's items")
    }

    // MARK: The Lab switch (1.2)

    func testTheSwitchIsOnUntilTurnedOff() {
        let store = makeStore()
        XCTAssertTrue(store.lab, "a missing key means on")
        XCTAssertFalse(store.labIsStored)
        LabSettings.ensureDefault(store: store)
        XCTAssertTrue(store.labIsStored)
        XCTAssertTrue(LabSettings.isOn(store: store))
        LabSettings.setOn(false, store: store)
        LabSettings.ensureDefault(store: store)
        XCTAssertFalse(LabSettings.isOn(store: store), "a stored value stays")
        XCTAssertFalse(store.labNoteShown)
        XCTAssertEqual(LabSettings.launchValue(["app", "-DLSLab", "0"]), false)
        XCTAssertEqual(LabSettings.launchValue(["app", "-DLSLab", "1"]), true)
        XCTAssertNil(LabSettings.launchValue(["app"]))
        XCTAssertNil(LabSettings.launchValue(["app", "-DLSLab"]))
    }

    @MainActor
    func testTheLabModelNeverTouchesStorageOnTheMainThread() async throws {
        let store = makeStore()
        StorageAudit.reset()
        let model = LabModel(store: store, arguments: ["app", "-DLSLab", "0"])
        XCTAssertFalse(model.isOn, "-DLSLab 0 applies before the first render")
        try await waitFor("the first read") { model.isLoaded }
        XCTAssertFalse(model.isOn)
        let stored = await Task.detached { store.lab }.value
        XCTAssertFalse(stored, "-DLSLab is saved")
        model.setOn(true)
        XCTAssertTrue(model.isOn)
        try await waitFor("the switch to be saved") { model.isOn && !model.shouldShowNote }
        try await Task.sleep(nanoseconds: 200_000_000)
        let saved = await Task.detached { store.lab }.value
        XCTAssertTrue(saved)
        XCTAssertFalse(model.shouldShowNote, "W0 builds show no one-time note (1.2)")
        let gate = await model.gate("F37")
        XCTAssertEqual(gate.state, "needs-pairing")
        XCTAssertEqual(gate.message, "Pair with your Daylight first: open Daylight Share on the Daylight and scan or type its code here.")
        model.setOn(false)
        for _ in 0..<100 {
            if await Task.detached(operation: { store.lab }).value == false { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let off = await model.gate("F37")
        XCTAssertEqual(off.state, "lab-off")
        XCTAssertEqual(off.message, "Turn on Lab in Send to Daylight to use this.")
        XCTAssertEqual(StorageAudit.mainThreadAccesses, [], "storage was touched on the main thread")
    }

    @MainActor
    func testTheAppModelReportsLabInItsStatus() async throws {
        let store = makeStore()
        let model = AppModel(store: store, arguments: ["app", "-DLSLab", "1"])
        try await waitFor("the first read") { model.isLoaded && model.lab.isLoaded }
        let status = model.statusSnapshot()
        XCTAssertEqual(status["lab"] as? Bool, true)
        XCTAssertEqual(status["caps"] as? [String], [])
        XCTAssertNotNil(status["labStates"] as? [String: Any])
    }
}
#endif
