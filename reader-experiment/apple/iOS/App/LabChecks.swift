#if DEBUG
import DaylightShareKit
import DaylightShareUI
import Foundation

/// The iPhone's Lab checks that need the kit (LAB-PLAN F00.1, F00.4, 1.2, 1.7), run by `LabAppTests` in
/// `SendToDaylightTests-iOS` as `AuditScreens` is for the truncation audit: each works on storage of its own (never the
/// app's) and returns what it found as plain values. Debug builds only.
@MainActor
enum LabChecks {
    /// Storage of its own, settled at once; `appGroup` makes it count as the App Group the app and its extensions share.
    static func makeStore(_ name: String, appGroup: String? = nil) -> SharedStore {
        let id = "\(name)-\(UUID().uuidString)"
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dls-labcheck-\(id)", isDirectory: true)
        let defaults = UserDefaults(suiteName: "dls-labcheck-\(id)") ?? .standard
        return SharedStore(defaults: defaults, directory: directory, appGroup: appGroup)
    }

    /// Runs `body` off the main thread (storage is never touched on it).
    nonisolated static func off<T: Sendable>(_ body: @escaping @Sendable () -> T) async -> T {
        await Task.detached(priority: .userInitiated) { body() }.value
    }

    /// Waits (at most `timeout` seconds) until `condition` holds.
    static func waitUntil(_ timeout: TimeInterval = 5, _ condition: () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return await condition()
    }

    // MARK: 1.2: this build's constant

    /// `LAB_NOTE_ENABLED` as the running app applied it (`SendToDaylightApp.makeModel`), and whether its one-time note
    /// would show now.
    static func appNote() -> (enabled: Bool, shows: Bool) {
        (AppModel.shared.lab.noteEnabled, AppModel.shared.lab.shouldShowNote)
    }

    // MARK: F00.1: an update from the last non-Lab build

    struct Upgrade {
        var storedBefore: Bool
        var labOn: Bool
        var storedAfter: Bool
        var noteShows: Bool
        var pairedBefore: String?
        var pairedAfter: String?
        var rowsBefore: [String]
        var rowsAfter: [String]
    }

    /// Storage as the last non-Lab build (P0) leaves it, paired with a history and no Lab key, opened by this build:
    /// Lab is on and stored, no note (W0), and the pairing and history are as they were.
    static func upgrade() async -> Upgrade {
        let store = Self.makeStore("upgrade")
        if let pairing = try? Pairing(secret: Data(repeating: 5, count: 16), relay: "http://127.0.0.1:9", name: "Test Daylight") {
            _ = await store.pair(pairing)
        }
        let rows = HistorySample.rows()
        let before = await off { () -> (Bool, String?, [String]) in
            let outbox = OutboxStore(store: store)
            for row in rows { outbox.save(row) }
            return (store.labIsStored, store.pairing?.code, outbox.rows.map(\.id))
        }
        let lab = LabModel(store: store, noteEnabled: LabBuild.LAB_NOTE_ENABLED, arguments: [])
        let model = AppModel(store: store, lab: lab, arguments: [])
        _ = await waitUntil { lab.isLoaded && model.isLoaded }
        // A read the model started for a change notification can land after ours: read until the history is there.
        _ = await waitUntil {
            await model.reloadNow()
            return model.rows.count == before.2.count
        }
        await lab.reloadNow()
        let after = await off { (store.labIsStored, LabSettings.isOn(store: store)) }
        return Upgrade(storedBefore: before.0, labOn: lab.isOn && after.1, storedAfter: after.0, noteShows: lab.shouldShowNote,
                       pairedBefore: before.1, pairedAfter: model.pairing?.code, rowsBefore: before.2,
                       rowsAfter: model.rows.map(\.id))
    }

    /// A stored Lab off stays off at the next start (1.2: the switch belongs to the app and the device), and `-DLSLab`
    /// overrides what is stored (1.7). -> Lab as each start reads it: stored off, then `-DLSLab 1`, then `-DLSLab 0`.
    static func restarts() async -> [Bool] {
        let store = Self.makeStore("restarts")
        await off { LabSettings.setOn(false, store: store) }
        var out: [Bool] = []
        for arguments in [[], ["-DLSLab", "1"], ["-DLSLab", "0"]] {
            let lab = LabModel(store: store, arguments: arguments)
            _ = await waitUntil { lab.isLoaded }
            await lab.reloadNow()
            out.append(lab.isOn)
        }
        return out
    }

    // MARK: The share sheet follows the app (1.1, 1.2)

    /// The share sheet item's Lab as it reads it at a share, for each stored value of the app's switch (nil: never
    /// stored), with the App Group (`shared`) or with storage of its own (a sideloaded build without the group).
    static func shareSheetLab(stored: Bool?, shared: Bool) async -> Bool {
        let store = Self.makeStore("share", appGroup: shared ? "group.test.daylight" : nil)
        if let stored { await off { LabSettings.setOn(stored, store: store) } }
        let model = ShareExtensionModel(store: store)
        model.start(inputItems: [])
        _ = await waitUntil {
            if case .nothing = model.phase { return true }
            return false
        }
        return model.lab
    }

    // MARK: F00.4: turning Lab off never stops or drops what is queued

    struct Offline {
        var labBefore: Bool
        var queuedStatus: String
        var queuedError: String
        var labAfter: Bool
        var sentStatus: String?
        var publishedToInbox: Int
        var rows: [String]
        var pairedKept: Bool
        var pinKept: Bool
        var statusLab: Any?
        var statusKeys: [String]
    }

    /// Queue an item offline (the relay out of reach), turn Lab off, go back online: the next pass sends it. History,
    /// pairing and the Daylight server's pin are still there, Lab is still off, and the status dump says so (1.7).
    static func offlineThenLabOff() async throws -> Offline {
        let store = Self.makeStore("offline")
        let pairing = try Pairing(secret: Data(repeating: 11, count: 16), relay: StubRelay.origin, name: "Test Daylight")
        _ = await store.pair(pairing)
        let pin: JSONValue = .object(["origin": .string("https://daylight-000000000000.example.workers.dev"),
                                      "fingerprint": .string("00000000")])
        await off { FileServerStore(store: store).set(ServerKeys.pin, pin) }
        let lab = LabModel(store: store, arguments: [])
        let model = AppModel(store: store, lab: lab, arguments: [])
        _ = await waitUntil { lab.isLoaded && model.isLoaded }
        let labBefore = lab.isOn

        StubRelay.reset(online: false)
        let outbox = OutboxStore(store: store)
        let sender = try ShareSender(pairing: pairing, outbox: outbox, from: "iPhone", session: StubRelay.session,
                                     onAckHeader: LabLedger(outbox: outbox).hook())
        sender.relay.retryDelays = []
        let queued = try await sender.send(.link("https://example.com/shared-offline", title: "Shared offline"))

        lab.setOn(false)
        _ = await waitUntil { await off { !LabSettings.isOn(store: store) } }
        await lab.reloadNow()

        StubRelay.reset(online: true)
        sender.now = { Date().addingTimeInterval(10 * 60) } // past the first re-send's wait (2 minutes)
        _ = await sender.tick()
        // A read the model started for a change notification can land after ours: read until the row is there.
        _ = await waitUntil {
            await model.reloadNow()
            return model.rows.contains { $0.id == queued.id && $0.status == .sent }
        }
        let snapshot = model.statusSnapshot()
        let pinKept = await off { FileServerStore(store: store).get(ServerKeys.pin) != nil }
        return Offline(labBefore: labBefore, queuedStatus: queued.status.rawValue, queuedError: queued.errorCode,
                       labAfter: lab.isOn, sentStatus: model.rows.first { $0.id == queued.id }?.status.rawValue,
                       publishedToInbox: StubRelay.published(to: pairing.keys.inboxTopic), rows: model.rows.map(\.id),
                       pairedKept: model.pairing?.code == pairing.code, pinKept: pinKept, statusLab: snapshot["lab"],
                       statusKeys: snapshot.keys.sorted())
    }
}

/// A relay inside the process, for `LabChecks.offlineThenLabOff`: offline, every request fails as with no network;
/// online, publishes are taken (and counted per topic) and polls find nothing.
final class StubRelay: URLProtocol {
    static let origin = "https://relay.daylight.test"
    private static let lock = NSLock()
    private static var online = false
    private static var publishes: [String: Int] = [:]

    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.protocolClasses = [StubRelay.self]
        return URLSession(configuration: c)
    }()

    static func reset(online: Bool) {
        lock.lock()
        self.online = online
        if !online { publishes = [:] }
        lock.unlock()
    }

    static func published(to topic: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return publishes[topic] ?? 0
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == URL(string: origin)?.host
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let online = Self.online
        let publish = request.httpMethod == "POST" || request.httpMethod == "PUT"
        let topic = request.url?.pathComponents.dropFirst().first ?? ""
        if online && publish { Self.publishes[topic, default: 0] += 1 }
        Self.lock.unlock()
        guard online, let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let seconds = Int(Date().timeIntervalSince1970)
        let body = publish ? Data("{\"id\":\"stub\(seconds)\",\"time\":\(seconds),\"event\":\"message\",\"topic\":\"\(topic)\"}".utf8) : Data()
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
#endif
