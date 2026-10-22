import DaylightShareKit
import Foundation
import SwiftUI

/// The Lab state behind an app's Lab screens (LAB-PLAN 1, 2.6): the Lab switch, the ledger's view of the Daylight, What's
/// in Lab and the Daylight server section. `AppModel` owns one (`AppModel.lab`); the Lab views observe it.
///
/// Like the app model, it never touches storage on the main thread: every read and write, and every server call, runs
/// off it (`LabCenter`), and the results are published on the main actor. While `SharedStore` is still resolving, Lab
/// reads as on (1.2), and the views update once storage settles.
@MainActor
public final class LabModel: ObservableObject {
    public let center: LabCenter
    /// The Lab switch (1.2): on when never set, and while storage is still resolving.
    @Published public private(set) var isOn = true
    /// Whether the first read of storage has come back.
    @Published public private(set) var isLoaded = false
    /// Whether the one-time note was dismissed (1.2).
    @Published public private(set) var noteShown = false
    /// What the ack topic said, per publisher (2.2.6): the Inbox's Lab state, capabilities, check-in and item states.
    @Published public private(set) var ledger: LabLedger.Snapshot = .empty
    /// The "Daylight server ›" row's state (1.1), or nil while it is not known.
    @Published public private(set) var serverRowState: String?
    /// What's in Lab (1.4), or nil before it was first worked out.
    @Published public private(set) var overview: LabCenter.Overview?
    /// The Daylight server section (2.6), or nil while it is being asked for.
    @Published public private(set) var serverView: LabCenter.ServerView?
    /// `LAB_NOTE_ENABLED` (1.2): the one-time note shows only in builds whose app has F01 or F04 (false in W0).
    public var noteEnabled: Bool
    /// `-DLSLab 0|1` (1.7): applied before the first render.
    public let launchValue: Bool?

    private var observer: NSObjectProtocol?
    private var readSeq = 0
    /// Switch writes on their way to storage: until they land, a read does not put the old value back.
    private var writes = 0

    public var store: SharedStore { center.store }

    public init(center: LabCenter, noteEnabled: Bool = false, arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.center = center
        self.noteEnabled = noteEnabled
        launchValue = LabSettings.launchValue(arguments)
        if let on = launchValue { isOn = on }
        reload(first: true)
        observer = NotificationCenter.default.addObserver(forName: .daylightShareChanged, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    public convenience init(store: SharedStore = .shared, noteEnabled: Bool = false,
                            arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.init(center: LabCenter(store: store), noteEnabled: noteEnabled, arguments: arguments)
    }

    /// Runs `body` off the main thread once storage is settled.
    nonisolated static func off<T: Sendable>(_ center: LabCenter, _ body: @escaping @Sendable (LabCenter) async -> T) async -> T {
        await center.store.ready()
        return await Task.detached(priority: .userInitiated) { await body(center) }.value
    }

    struct Read: Sendable {
        var lab: Bool
        var noteShown: Bool
        var ledger: LabLedger.Snapshot
    }

    /// Reads the switch, the note and the ledger again (in the background) and publishes them.
    public func reload() {
        reload(first: false)
    }

    private func reload(first: Bool) {
        Task { await reloadNow(first: first) }
    }

    /// Reads the switch, the note and the ledger off the main thread; returns once published.
    public func reloadNow() async {
        await reloadNow(first: false)
    }

    private func reloadNow(first: Bool) async {
        readSeq += 1
        let seq = readSeq
        let launch = first ? launchValue : nil
        let read = await Self.off(center) { c -> Read in
            // The first start of a build with Lab writes lab = true when the key is missing (1.2); -DLSLab sets it.
            if let launch { LabSettings.setOn(launch, store: c.store) } else { LabSettings.ensureDefault(store: c.store) }
            return Read(lab: c.isOn(), noteShown: c.store.labNoteShown, ledger: c.ledger().snapshot())
        }
        guard seq == readSeq else { return }
        if writes == 0 && read.lab != isOn { isOn = read.lab }
        if read.noteShown != noteShown { noteShown = read.noteShown }
        if read.ledger != ledger { ledger = read.ledger }
        if !isLoaded { isLoaded = true }
        if !isOn {
            overview = nil
            serverView = nil
        }
    }

    // MARK: The switch (1.1, 1.2)

    /// Turns Lab on or off: the screens follow at once; it is saved off the main thread (the app and its extensions
    /// follow through the change notification). Nothing is deleted (1.3).
    public func setOn(_ on: Bool) {
        isOn = on
        if !on {
            overview = nil
            serverView = nil
        }
        writes += 1
        Task {
            await Self.off(center) { c in LabSettings.setOn(on, store: c.store) }
            writes -= 1
            await reloadNow()
            if on { await refreshServerRow() }
        }
    }

    /// Whether to show the one-time note now (1.2, 1.6).
    public var shouldShowNote: Bool { noteEnabled && isLoaded && isOn && !noteShown }

    /// OK on the one-time note.
    public func dismissNote() {
        noteShown = true
        Task { await Self.off(center) { c in c.store.labNoteShown = true } }
    }

    // MARK: The Daylight server row and What's in Lab

    /// The "Daylight server ›" row's subtitle, "Optional · Not set up", or nil while the state is not known.
    public var serverRowSubtitle: String? { serverRowState.map { LabText.serverRowSubtitle($0) } }

    /// Works out the "Daylight server ›" row's state: the last answer when recent, else the server is asked (within
    /// the gate's 5 s) unless `refresh` is false.
    public func refreshServerRow(refresh: Bool = true) async {
        guard isOn else { return }
        let state = await Self.off(center) { c in await c.serverRowState(refresh: refresh) }
        if isOn, let state { serverRowState = state }
    }

    /// Works out What's in Lab (1.4). `refresh`: the list opened, so the ack topic is read and the server asked now.
    public func loadOverview(refresh: Bool = true) async {
        guard isOn else { return }
        let o = await Self.off(center) { c in await c.overview(refresh: refresh) }
        guard isOn else { return }
        overview = o
        if let s = o.serverState { serverRowState = s }
        await reloadNow()
    }

    /// Asks for the Daylight server section (2.6).
    public func loadServerView() async {
        guard isOn else { return }
        let v = await Self.off(center) { c in await c.serverView() }
        guard isOn else { return }
        serverView = v
        if let v { serverRowState = v.state == "ready" || LabCenter.serverWide.contains(v.state) ? v.state : "error" }
    }

    /// A feature's gate (1.5): ready, or the one sentence to show under the tapped control.
    public func gate(_ feature: String) async -> LabGate.Result {
        await Self.off(center) { c in await c.gate(feature) }
    }

    // MARK: The Daylight server section's actions

    /// "Your Daylight server moved to {host}. Use it?" answered Use it.
    public func confirmMove() async {
        _ = await Self.off(center) { c in c.confirmMove() }
        await loadServerView()
    }

    /// Set up with a link, step 4 (confirmed): nil when done, else the message to show.
    public func setup(link: String) async -> String? {
        let error = await Self.off(center) { c in await c.setup(link: link) }
        await loadServerView()
        return error
    }

    /// The Server address field's Save (empty clears it): nil when done, else the message to show.
    public func saveServerAddress(_ text: String) async -> String? {
        let error = await Self.off(center) { c in await c.saveServerAddress(text) }
        await loadServerView()
        return error
    }

    /// The Server code (for Copy Server code), or nil when not paired.
    public func serverCode() async -> String? {
        await Self.off(center) { c in c.server()?.serverCode() }
    }

    // MARK: Rows and the check-in

    /// How a history row reads with Lab (2.5): exactly `RowText` with Lab off or a v1.1 Inbox.
    public func rowText(_ row: OutboxRow, now: Date = Date(), online: Bool? = nil) -> LabRowText {
        LabRowText(row: row, now: now, ctx: LabRowText.Context(lab: isOn, ledger: ledger, rowID: row.id, online: online))
    }

    /// "Your Daylight checked in 4 min ago." (2.5)
    public func checkedInText(now: Date = Date()) -> String {
        LabText.checkedInText(ledger.checkedIn, now: Int64((now.timeIntervalSince1970 * 1000).rounded()))
    }

    /// The status dump's Lab fields (1.7): `lab`, `caps` and `labStates`.
    public var statusFields: [String: Any] {
        let states: [String: Any] = ledger.states.mapValues { ["s": $0.s, "t": $0.t] as [String: Any] }
        return ["lab": isOn, "caps": ledger.caps, "labStates": states]
    }
}
