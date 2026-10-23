import Combine
import DaylightShareKit
import Foundation
import SwiftUI

/// The state behind the iPhone and Mac apps: pairing, history, sending, and the maintenance timer.
///
/// The model never touches storage on the main thread, at launch or later: every read (the pairing and settings in
/// UserDefaults, the outbox files) and every write runs on a background queue, and the results are published on the
/// main actor. `SharedStore` resolves the App Group in the background too; until it is settled (at most
/// `SharedStore.resolutionTimeout`) the model reads this process's own storage, and writes wait for it.
/// `StorageAudit` records any storage access made on the main thread; the CI smoke test requires none.
@MainActor
public final class AppModel: ObservableObject {
    public static let shared = AppModel()

    /// Where the pairing and history live: resolving, the shared App Group, or this app's own storage.
    @Published public private(set) var storage: SharedStore.State
    @Published public private(set) var pairing: Pairing?
    @Published public private(set) var rows: [OutboxRow] = []
    @Published public private(set) var deviceName: String = ""
    @Published public private(set) var sendingCount = 0
    /// Whether the first read of storage has come back (until then `pairing` and `rows` are not known yet).
    @Published public private(set) var isLoaded = false
    /// Comfort (LAB-PLAN F27): larger text and buttons, more contrast, no motion. Off by default; not a Lab setting.
    /// The windows apply it with `.comfort(model.comfort)`; Settings changes it with `setComfort(_:)`.
    @Published public private(set) var comfort = false
    /// Whether the history holds the UI tests' sample rows (`HistorySample`; `-DLSSampleHistory` in the apps' Debug
    /// builds): the model then reads no acks and re-sends nothing, so each row stays in its state.
    public private(set) var holdsSampleHistory = false
    /// A short status line ("Sent · waiting for your Daylight", an error, …), cleared after a few seconds. A file
    /// refused as over 9 MB with Lab on stays until it is tapped away or replaced (`Banner.tooBig`): it carries the F02
    /// entry point and its note (1.5: never an auto-dismissing toast).
    @Published public var banner: Banner?
    /// A pairing that waits for the user's confirmation (PROTOCOL 1.3): a link from outside the app, or a code that
    /// would replace a Daylight with another secret. The views show `PairingConfirmationView` for it; setting it to
    /// nil cancels.
    @Published public var pendingPairing: PendingPairing?
    /// The sheet the window shows (Settings, the file picker, the QR scanner), or nil. Every sheet, and the pairing
    /// question, is presented from one place (`View.appSheets`): SwiftUI shows one sheet at a time, so a pairing link
    /// that arrives while one is open closes it and asks instead (`presented`).
    @Published public var sheet: Sheet?
    /// What the offline queue's path monitor last said (F07): true online, false offline, nil before it said anything
    /// (or before `startOfflineQueue`). With Lab on, rows that wait read "Waiting for connection" while it is false
    /// (`rowText`, 2.5 rule 2); the history re-renders when it changes.
    @Published public private(set) var online: Bool?
    /// Whether the app's window shows (2.5's faster checks run only then): the iPhone app stops its timers in the
    /// background (`stopAutoRefresh`); the Mac app sets this from its window's visibility. True until set.
    public var isVisible = true
    /// Whether the window presents the re-pairing follow-up (`Presented.repaired`, LAB-PLAN 2.6, DESIGN 12.7): set when
    /// this app re-paired with another Daylight while it knew a Daylight server, which it locked first. What it shows
    /// is `lab.repaired` (nil with Lab off, so nothing shows then); Settings › Lab shows it too until OK.
    @Published public private(set) var presentsRepaired = false

    public enum Sheet: String, Identifiable {
        case settings
        /// "Send a file…" (iPhone).
        case files
        /// "Scan the QR code" (iPhone).
        case scanner
        public var id: String { rawValue }
    }

    /// What the window presents (`presented`): the pairing question when one waits (it takes the place of any other
    /// sheet), else `sheet`, else the re-pairing follow-up.
    public enum Presented: Identifiable, Equatable {
        case pairing(PendingPairing)
        case sheet(Sheet)
        case repaired(LabCenter.Repaired)

        public var id: String {
            switch self {
            case let .pairing(p): return "pairing-\(p.id)"
            case let .sheet(s): return s.rawValue
            case .repaired: return "repaired"
            }
        }
    }

    /// Setting it to nil (SwiftUI does when a sheet is dismissed) closes `sheet`, or puts the re-pairing follow-up
    /// aside (Settings › Lab keeps showing it until OK); the pairing question is answered only with its buttons
    /// (`confirmPairing`, `cancelPairing`).
    public var presented: Presented? {
        get {
            if let pendingPairing { return .pairing(pendingPairing) }
            if let sheet { return .sheet(sheet) }
            if presentsRepaired, let r = lab.repaired { return .repaired(r) }
            return nil
        }
        set {
            guard newValue == nil else { return }
            if sheet != nil {
                sheet = nil
            } else if pendingPairing == nil {
                presentsRepaired = false
            }
        }
    }

    public struct Banner: Equatable, Identifiable {
        public let id = UUID()
        public let text: String
        public let isError: Bool
        /// The text is v1.1's too-big sentence (a file over 9 MB was refused): with Lab on, `BannerView(banner:lab:)` puts
        /// the F02 entry point under it ("Send files over 9 MB ›", LAB-PLAN 3.1 F02e), and the banner stays until it is
        /// tapped away or replaced.
        public var tooBig = false
    }

    public struct PendingPairing: Equatable, Identifiable {
        public let id = UUID()
        public let pairing: Pairing
        public let confirmation: PairingConfirmation
    }

    public let store: SharedStore
    /// The Lab switch, the ledger, What's in Lab and the Daylight server section (LAB-PLAN 1, 2.6). Its own observable
    /// object: the Lab views observe it. `-DLSLab 0|1` (1.7) applies before the first render.
    public let lab: LabModel
    private var timer: Timer?
    /// 2.5's faster checks: every `Lab.fastCheckMs` while the app runs its timers (`fastCheck`).
    private var fastTimer: Timer?
    private var fastChecking = false
    private var observer: NSObjectProtocol?
    /// Lab W1 (A3): the ledger's changes ("In your Reader", F01, F27), the offline queue (F07) and the notices (F04).
    private var ledgerWatch: AnyCancellable?
    /// The ledger the next change is compared with (`LedgerBaseline`).
    private var ledgerBaseline = LedgerBaseline()
    /// Share in place's notices (F04): set by the app (`FailureNotices(center: SystemNoticeCenter.shared, …)`) to post
    /// "In your Reader ✓: {title}" while it runs, when that setting is on, and "Couldn’t send …" for the background
    /// answers it hears. nil posts none.
    public var notices: FailureNotices?
    /// Tests: the URL session the senders reach the relay with (a stand-in's); nil: the default.
    var relaySession: URLSession?
    /// What fetches an Apple News page for smart intake (F16, `sendLink`); tests give a stub.
    var pageFetch: ShareNormaliser.PageFetch = ShareNormaliser.ephemeralFetch
    /// The offline queue (F07), once the app starts it (`startOfflineQueue`); with Lab on a share made offline waits.
    public private(set) var offlineQueue: OfflineQueue?
    private var bannerTask: Task<Void, Never>?
    private var reloadSeq = 0
    /// Comfort writes on their way to storage: until they land, a read does not put the old value back.
    private var comfortWrites = 0

    /// `lab`: the Lab model to use (tests give one whose `LabCenter` has a stub network), else one on `store`.
    public init(store: SharedStore = .shared, lab: LabModel? = nil, arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.store = store
        if let lab {
            self.lab = lab
        } else {
            self.lab = LabModel(store: store, arguments: arguments)
        }
        storage = store.state // in memory: no storage access
        // The test hook `-DLSComfort 0|1` (LAB-PLAN 1.7) applies before the first render, and is saved off the main thread.
        if let on = Comfort.launchValue(arguments) { setComfort(on) }
        reload()
        observer = NotificationCenter.default.addObserver(forName: .daylightShareChanged, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        #if canImport(ObjectiveC)
        SharedStore.observeOtherProcesses()
        #endif
        // The ledger, and the Lab model's first read (its stored ledger is the baseline, even when it is empty).
        ledgerWatch = self.lab.$ledger.map { _ in () }.merge(with: self.lab.$isLoaded.map { _ in () }).sink { [weak self] _ in
            Task { @MainActor in self?.ledgerChanged() }
        }
    }

    // MARK: Lab W1 (A3): the ledger, the offline queue, the activity log

    /// The ledger changed (an ack check read Lab frames): rows it has just confirmed in the Reader are said
    /// ("In your Reader ✓, <title>", F27) and, with "Tell me when it’s in my Reader" on, noticed (F04). Lab on only.
    /// The ledger the Lab model first reads from storage is the baseline, whichever of it and the history loads first: a
    /// row already in the Reader at launch is not news.
    private func ledgerChanged() {
        let new = lab.ledger
        guard let old = ledgerBaseline.next(new, loaded: lab.isLoaded), isLoaded, lab.isOn else { return }
        let reached = Announcer.readerChanges(from: old, to: new, rows: rows)
        guard !reached.isEmpty else { return }
        Announcer.announce(Announcer.readerAnnouncement(reached))
        if let notices {
            Task { _ = await Self.offMain { await notices.inReader(reached) } }
        }
    }

    /// Starts the offline queue (F07; the app calls it once, at launch, with `SystemPathSource()`): while Lab is on, a
    /// share made offline is stored and reads "Waiting for connection"; coming back online sends what waits, in passes
    /// at least 3 minutes apart, and `refresh()` (launch, foreground, background refresh) sends what was shared offline;
    /// rows the relay refused keep v1.1's back-off (`OfflineQueue`). The path monitor also sets `online`. With Lab off the
    /// queue sends nothing: rows go on v1.1's back-off (1.3).
    public func startOfflineQueue(path: NetworkPathSource) {
        guard offlineQueue == nil else { return }
        let store = self.store
        let session = relaySession
        let queue = OfflineQueue(sender: { [weak self] in
            guard let self, await self.lab.isOn else { return nil }
            await store.ready()
            return await Self.onStorage { try? DaylightShare.sender(store: store, session: session) }
        }, path: path, onPass: { [weak self] rows in
            guard !rows.isEmpty else { return }
            await Self.onStorage { ActivityLog(store: store).add(type: "flushNetwork", rows: rows) }
            await self?.reloadNow()
        }, onPath: { [weak self] online in
            await self?.setOnline(online)
        })
        offlineQueue = queue
        Task { await queue.start() }
    }

    private func setOnline(_ value: Bool) {
        if online != value { online = value }
    }

    /// Whether this device reported offline (F07's "Waiting for connection"; nil when not known).
    public func isOffline() async -> Bool { await offlineQueue?.shouldDefer ?? false }

    /// How a history row reads (2.5, `LabModel.rowText`) with this device's connection: with Lab on, a row that waits
    /// reads "Waiting for connection" while the path monitor says offline. Exactly `RowText` with Lab off.
    public func rowText(_ row: OutboxRow, now: Date = Date()) -> LabRowText {
        lab.rowText(row, now: now, online: online)
    }

    // MARK: Setup check (F26) and the copied link (F33)

    /// "Send a test article" (F26): the bundled page as `page`, `x-cap: "test"`, titled "Test article from {device}".
    /// Returns its row; Setup check follows it to Delivered and In your Reader (`SetupCheckView`).
    @discardableResult
    public func sendTestArticle() async -> OutboxRow? {
        guard let article = try? SetupCheck.testArticle(device: deviceName) else { return nil }
        guard let row = await send(article.input) else { return nil }
        let store = self.store
        await Self.onStorage {
            LabPreferences(store: store).testArticleID = row.id
            ActivityLog(store: store).add(type: "test", row: row)
        }
        return row
    }

    /// "Copy diagnostics" (F26): the app, version and platform, Lab, the caps seen, the last check-in, the outbox's
    /// counts, the relay ("ntfy.sh" or "custom relay") and the last 50 events, redacted (`SetupCheck.diagnosticsReport`).
    public func diagnostics(app: String, version: String, platform: String, now: Date = Date()) async -> String {
        let store = self.store
        let ledger = lab.ledger
        let on = lab.isOn
        let statuses = rows.map(\.status)
        let relay = pairing?.relay ?? DLS.defaultRelay
        let log = await Self.onStorage { ActivityLog(store: store).events }
        return SetupCheck.diagnosticsReport(app: app, version: version, platform: platform, lab: on, caps: ledger.caps,
                                            checkedIn: ledger.checkedIn, rows: statuses, relay: relay, log: log,
                                            now: Int64((now.timeIntervalSince1970 * 1000).rounded()))
    }

    /// Setup check's activity log (F26), newest last: "{time} {type} {id8} {kind} {status} {http}".
    public func activityLines() async -> [String] {
        let store = self.store
        return await Self.onStorage { ActivityLog(store: store).lines }
    }

    /// F33: what a copied link sends, and its host (`LabShare.copiedLink`; cleaned while F16 is in use), or nil when
    /// the clipboard holds no web link.
    public func copiedLink(_ text: String) -> (input: ItemInput, host: String)? {
        LabShare.copiedLink(text, clean: lab.inUse("F16"))
    }

    /// Appends rows to Setup check's activity log (F26), with Lab on, off the main thread.
    private func log(_ type: String, _ rows: [OutboxRow]) async {
        guard lab.isOn, !rows.isEmpty else { return }
        let store = self.store
        await Self.onStorage { ActivityLog(store: store).add(type: type, rows: rows) }
    }

    /// What a maintenance pass or an ack check did, for Setup check's activity log (F26, as the extension's
    /// `logChanges`): each row whose status changed (its new status: "delivered", "failed", "expired", …) or that went
    /// again ("resend"), with its `http` (the 413 or 429 behind a failure).
    static func changes(from before: [OutboxRow], to after: [OutboxRow]) -> [(type: String, row: OutboxRow)] {
        let was = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return after.compactMap { row -> (type: String, row: OutboxRow)? in
            guard let old = was[row.id], old.status != row.status || old.lastPublish != row.lastPublish else { return nil }
            return (type: old.status != row.status ? row.status.rawValue : "resend", row: row)
        }
    }

    private func logChanges(from before: [OutboxRow], to after: [OutboxRow]) async {
        let changed = Self.changes(from: before, to: after)
        guard lab.isOn, !changed.isEmpty else { return }
        let store = self.store
        await Self.onStorage {
            let log = ActivityLog(store: store)
            for c in changed { log.add(type: c.type, row: c.row) }
        }
    }

    // MARK: Storage, off the main thread

    /// The queue for every storage read and write the model makes (serial: they happen in the order asked).
    private nonisolated static let io = DispatchQueue(label: "com.daylight.share.storage", qos: .userInitiated)

    /// Runs `body` on the storage queue and returns its result.
    nonisolated static func onStorage<T>(_ body: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { (cont: CheckedContinuation<T, Never>) in
            io.async { cont.resume(returning: body()) }
        }
    }

    /// A sender for the stored pairing, read on the storage queue (for background refresh), or nil when not paired.
    public nonisolated static func backgroundSender(store: SharedStore = .shared) async -> ShareSender? {
        await store.ready()
        return await onStorage { try? DaylightShare.sender(store: store) }
    }

    struct Snapshot {
        var state: SharedStore.State
        var pairing: Pairing?
        var rows: [OutboxRow]
        var deviceName: String
        var comfort: Bool
    }

    nonisolated static func readSnapshot(_ store: SharedStore) -> Snapshot {
        Snapshot(state: store.state, pairing: store.pairing, rows: OutboxStore(store: store).rows, deviceName: store.deviceName,
                 comfort: store.comfort)
    }

    // MARK: State

    public var isPaired: Bool { pairing != nil }
    /// Whether storage is settled (the App Group resolved, or this app's own storage chosen).
    public var isStorageReady: Bool { storage != .resolving }

    /// For Settings: whether the extensions see the app's pairing.
    public var storageSummary: String {
        switch storage {
        case .resolving: return "Checking…"
        case .shared: return "Yes"
        case .appPrivate: return "No (pair them separately)"
        }
    }
    public var daylightName: String { pairing?.displayName ?? "your Daylight" }
    public var defaultDeviceName: String { DaylightShare.defaultDeviceName }

    /// Reads the pairing, settings and history again (in the background) and publishes them.
    public func reload() {
        Task { await reloadNow() }
    }

    /// Reads the pairing, settings and history on the storage queue and publishes them; returns once published.
    public func reloadNow() async {
        reloadSeq += 1
        let seq = reloadSeq
        let store = self.store
        let snapshot = await Self.onStorage { Self.readSnapshot(store) }
        guard seq == reloadSeq else { return } // a newer read is on its way
        if snapshot.state != storage { storage = snapshot.state }
        if snapshot.pairing != pairing { pairing = snapshot.pairing }
        if snapshot.rows != rows {
            // F27: "Delivered ✓, <title>" (or "Not delivered, …") is said out loud when a row gets there.
            if isLoaded {
                let changes = Announcer.changes(from: rows, to: snapshot.rows)
                if !changes.isEmpty { Announcer.announce(changes.joined(separator: ". ")) }
            }
            rows = snapshot.rows
        }
        if snapshot.deviceName != deviceName { deviceName = snapshot.deviceName }
        if comfortWrites == 0 && snapshot.comfort != comfort { comfort = snapshot.comfort }
        if !isLoaded { isLoaded = true }
        writeStatus()
    }

    /// Runs `body` on the storage queue once storage is settled, then publishes the new state.
    private func write(_ body: @escaping @Sendable (SharedStore) -> Void) async {
        let store = self.store
        await store.ready()
        await Self.onStorage { body(store) }
        await reloadNow()
    }

    /// Runs one of the kit's locked changes (pairing, unpairing, removing: they wait for an attempt in flight) off the
    /// main thread once storage is settled, then publishes the new state.
    private func change(_ body: @escaping @Sendable (SharedStore) async -> Void) async {
        let store = self.store
        await store.ready()
        await Self.offMain { await body(store) }
        await reloadNow()
    }

    /// Runs `body` in a detached task: never on the main thread, whoever awaits it.
    public nonisolated static func offMain<T: Sendable>(_ body: @escaping @Sendable () async -> T) async -> T {
        await Task.detached(priority: .userInitiated) { await body() }.value
    }

    /// Whether the banner showing now goes by itself after 5 s (tests: a too-big banner with Lab on stays).
    var bannerAutoDismisses: Bool { bannerTask != nil }

    /// Shows a banner (and says it to VoiceOver, F27), cleared after 5 s. `tooBig`: the text is the too-big sentence of a
    /// file refused as over 9 MB; with Lab on that banner carries the F02 entry point and stays until it is tapped away or
    /// replaced (`Banner.tooBig`).
    public func show(_ text: String, error: Bool = false, tooBig: Bool = false) {
        var b = Banner(text: text, isError: error)
        b.tooBig = tooBig
        banner = b
        Announcer.announce(text)
        bannerTask?.cancel()
        bannerTask = nil
        if tooBig && lab.isOn { return }
        bannerTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if !Task.isCancelled { self?.banner = nil }
        }
    }

    // MARK: Pairing and settings

    /// Pairs from a typed, pasted or scanned code or `daylightshare://` link. Returns an error message for input that
    /// is not a pairing code, else nil. `source` is `.app` for the app's own pairing screen (it asks only when the
    /// code would replace a Daylight with another secret) and `.link` for a pairing that arrives from outside (it
    /// always asks, unless the secret is the current one). When asking, `pendingPairing` is set.
    @discardableResult
    public func pair(_ input: String, source: PairingConfirmation.Source = .app) -> String? {
        do {
            let p = try Pairing.parse(input)
            Task { await offer(p, source: source) }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    /// Decides whether to ask (PROTOCOL 1.3), against the stored pairing.
    public func offer(_ p: Pairing, source: PairingConfirmation.Source) async {
        let store = self.store
        await store.ready()
        let current = await Self.onStorage { store.pairing }
        let confirmation = PairingConfirmation(current: current, next: p, source: source)
        if confirmation.ask {
            // In one update: the open sheet (Settings, the file picker, the scanner) gives way to the question.
            sheet = nil
            pendingPairing = PendingPairing(pairing: p, confirmation: confirmation)
        } else {
            await apply(p, notice: confirmation.notice)
        }
    }

    /// "Pair" or "Switch" on the confirmation.
    public func confirmPairing() {
        guard let pending = pendingPairing else { return }
        pendingPairing = nil
        Task { await apply(pending.pairing, notice: nil) }
    }

    /// "Cancel" on the confirmation: nothing changes.
    public func cancelPairing() {
        pendingPairing = nil
    }

    private func apply(_ p: Pairing, notice: String?) async {
        let lock = await changePairing(p)
        show(notice ?? "Paired with \(p.displayName).")
        if lock.known {
            // The old pairing's Daylight server was locked (or tried): the follow-up shows the locked text with the new
            // Server code and the re-run help (DESIGN 12.7), while Lab is on.
            await lab.reloadNow()
            presentsRepaired = lab.repaired != nil
        }
        await refresh()
    }

    /// Every pairing change goes through `LabCenter.pair` (LAB-PLAN 2.6 "Re-pairing"): with another secret, a Daylight
    /// server that knows the old pairing is locked first, Lab on or off. Off the main thread, once storage is settled.
    private func changePairing(_ p: Pairing) async -> LabCenter.RepairLock {
        let center = lab.center
        await store.ready()
        let lock = await Self.offMain { await center.pair(p) }
        await reloadNow()
        return lock
    }

    /// OK on the re-pairing follow-up: it closes and is not shown again (until another re-pairing).
    public func dismissRepaired() {
        presentsRepaired = false
        lab.dismissRepaired()
    }

    /// Unpairs (the outbox goes too; a typed Server address is forgotten, `LabCenter.unpair`) and closes Settings, where
    /// Unpair is: there is nothing left to set.
    public func unpair() {
        sheet = nil
        presentsRepaired = false
        let center = lab.center
        Task {
            await change { _ in await center.unpair() }
            await lab.reloadNow()
        }
    }

    public func setDeviceName(_ name: String) {
        Task { await write { $0.deviceName = name } }
    }

    /// Turns Comfort on or off: the windows follow at once; it is saved off the main thread.
    public func setComfort(_ on: Bool) {
        comfort = on
        comfortWrites += 1
        Task {
            await write { $0.comfort = on }
            comfortWrites -= 1
        }
    }

    /// Changes the relay of the current pairing (it must match the Daylight's). The outbox is kept (same secret), so
    /// waiting items go through the new relay. Returns an error message or nil.
    public func setRelay(_ relay: String) -> String? {
        guard var p = pairing else { return "Not paired." }
        do {
            p.relay = try ShareText.normalizeRelay(relay)
            let changed = p
            Task {
                _ = await changePairing(changed)
                await refresh()
            }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    // MARK: Sending

    /// A sender for the stored pairing (read on the storage queue), or nil when not paired.
    private func sender() async -> ShareSender? {
        let store = self.store
        let session = relaySession
        await store.ready()
        return await Self.onStorage { try? DaylightShare.sender(store: store, session: session) }
    }

    /// Sends one item and reports the outcome in the banner: the row's label and sentence (CHANGES-v1.1 2.5), or why
    /// it was refused. Returns the outbox row.
    @discardableResult
    public func send(_ input: ItemInput) async -> OutboxRow? {
        guard let sender = await sender() else {
            show("Pair with your Daylight first.", error: true)
            return nil
        }
        sendingCount += 1
        defer { sendingCount -= 1 }
        do {
            // F07: with Lab on, a share made offline waits for the connection instead of failing now.
            var deferred = false
            if lab.isOn { deferred = await isOffline() }
            let row = try await sender.send(input, defer: deferred)
            await log(deferred ? "defer" : "send", [row])
            await reloadNow()
            // With Lab on, the row's own Lab words (2.5): "Waiting for connection. It will send when this device is back
            // online." for a share made offline (F07.1); otherwise they are v1.1's.
            let text = lab.isOn ? rowText(row).message : RowText(row: row).message
            show(text, error: RowText.isTrouble(row.status))
            if row.status == .sent { followUp(sender) }
            return row
        } catch {
            show((error as? ShareError)?.message ?? error.localizedDescription, error: true,
                 tooBig: (error as? ShareError)?.code == "too-large")
            await reloadNow()
            return nil
        }
    }

    /// "Send a link" (the iPhone's and Mac's link field, the Mac's Send copied link and its drops): a URL, text
    /// containing one, or a bare domain. Returns whether it was sent. With Lab on it goes through smart intake (F16, every
    /// entry point; `LabShare.typedLink`): tracking removed and redirectors unwrapped while F16 is in use, `x-orig` when
    /// that changed it, an Apple News link resolved; typed text follows normaliseShare's text rules ("example.com/story"
    /// is still a link; text with no link is "That isn’t a web address.", never a note). `given`: a URL handed over as
    /// one (a drop, a `.webloc`, a link the app was opened with), sent as given when it passes the web URL rule. With Lab
    /// off it is v1.1's, exactly.
    @discardableResult
    public func sendLink(_ text: String, title: String? = nil, given: Bool = false) async -> Bool {
        if lab.isOn {
            let clean = lab.inUse("F16")
            guard let input = await LabShare.typedLink(text, title: title, given: given, clean: clean, fetch: pageFetch) else {
                show("That isn’t a web address.", error: true)
                return false
            }
            return await send(input) != nil
        }
        guard let url = DaylightShare.linkFromUserText(text) else {
            show("That isn’t a web address.", error: true)
            return false
        }
        return await send(.link(url, title: title)) != nil
    }

    /// Sends files (from a picker, a drop, the Dock or "Open With"). `.webloc` and `.url` shortcuts send their link.
    public func sendFiles(_ urls: [URL]) async {
        for url in urls { await sendFile(url) }
    }

    /// What a file the user picked holds, read off the main thread: a shortcut's link, or the file (refused up front
    /// when it is over 9 MB, before it is read).
    enum FileInput {
        case link(String, title: String)
        case item(ItemInput)
        case refused(String)
        /// Over 9 MB: v1.1's too-big sentence (with Lab on, the F02 entry point goes under it).
        case tooBig(String)
    }

    nonisolated static func readFile(_ url: URL) -> FileInput {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        if let link = linkInShortcutFile(url) { return .link(link, title: url.deletingPathExtension().lastPathComponent) }
        do {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
            if values.isDirectory == true { return .refused("“\(name)” is a folder. Send a file instead.") }
            if let size = values.fileSize, size > DLS.maxItem { return .tooBig(ShareText.tooBigMessage(size)) }
            let data = try Data(contentsOf: url, options: .alwaysMapped)
            if data.count > DLS.maxItem { return .tooBig(ShareText.tooBigMessage(data.count)) }
            return .item(.file(data, name: name))
        } catch {
            return .refused("Couldn’t read “\(name)”: \(error.localizedDescription)")
        }
    }

    public func sendFile(_ url: URL) async {
        switch await Self.onStorage({ Self.readFile(url) }) {
        case let .link(link, title):
            // A shortcut's link is a link given as one: with Lab on, smart intake (F16) as at every entry point.
            if lab.isOn {
                await sendLink(link, title: title, given: true)
            } else {
                await send(.link(link, title: title))
            }
        case let .item(input):
            await send(input)
        case let .refused(message):
            show(message, error: true)
        case let .tooBig(message):
            show(message, error: true, tooBig: true)
        }
    }

    /// The link in a `.webloc` (plist) or `.url` (Windows Internet Shortcut) file.
    nonisolated static func linkInShortcutFile(_ url: URL) -> String? {
        switch url.pathExtension.lowercased() {
        case "webloc":
            guard let data = try? Data(contentsOf: url),
                  let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
                  let s = plist["URL"] as? String else { return nil }
            return ShareText.webURL(s)
        case "url":
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            for line in text.split(whereSeparator: \.isNewline) where line.lowercased().hasPrefix("url=") {
                return ShareText.webURL(String(line.dropFirst(4)))
            }
            return nil
        default:
            return nil
        }
    }

    /// Handles URLs the app was opened with: a `daylightshare://` link asks before it pairs (unless it is the current
    /// pairing), files are sent, web links are sent.
    public func handleOpen(_ urls: [URL]) async {
        for url in urls {
            if url.scheme?.lowercased() == "daylightshare" {
                if let error = pair(url.absoluteString, source: .link) { show(error, error: true) }
            } else if url.isFileURL {
                await sendFile(url)
            } else if let link = ShareText.webURL(url.absoluteString) {
                // With Lab on, through smart intake (F16) as a link given as one; with Lab off, v1.1's.
                if lab.isOn {
                    await sendLink(link, given: true)
                } else {
                    await send(.link(link))
                }
            }
        }
    }

    /// "Retry now" or "Try again" on a row (not on the UI tests' sample history, which stays as it is).
    public func retry(_ row: OutboxRow) async {
        guard !holdsSampleHistory, let sender = await sender() else { return }
        sendingCount += 1
        defer { sendingCount -= 1 }
        let r = await sender.retry(row.id)
        if let r { await log("retry", [r]) }
        await reloadNow()
        if let r {
            if RowText.isTrouble(r.status) { show(RowText(row: r).message, error: true) }
            if r.status == .sent { followUp(sender) }
        }
    }

    /// "Remove" (and the queue's Cancel, F07.2): waits for an attempt in flight, so the row does not come back. The row's
    /// stored body and frame files go, and a share in place's upload tasks for it are cancelled
    /// (`BackgroundPublisher.cancel`), so it is not published when the connection returns.
    public func delete(_ row: OutboxRow) {
        let id = row.id
        let notices = self.notices
        Task {
            await change { store in
                guard let gone = await OutboxStore(store: store).removeRow(id) else { return }
                await BackgroundPublisher.cancel(BackgroundPublisher.gone([gone]), store: store, notices: notices)
            }
        }
    }

    public func clearFinished() {
        Task { await change { await OutboxStore(store: $0).clearFinished() } }
    }

    private var launchArgumentsHandled = false

    /// Hooks for the CI smoke tests (and handy for debugging): `-DLSPairLink <daylightshare://…>` pairs without asking
    /// (only someone who starts the app can pass it) and `-DLSSendLink <url>` sends a link, once per launch.
    /// (`-DLSStatusDump` is read by `noteRendered()`, `-DLSComfort 0|1` by `init`, `-DLSTestStorage` by
    /// `SharedStore.shared`.)
    ///
    /// `sampleHistory` (the apps pass `HistorySample.isRequested()` in Debug builds only: `-DLSSampleHistory` with
    /// `-DLSTestStorage`) puts `HistorySample.rows` in the history once the pairing is in place (the ones numbered after
    /// the argument, "3,4", or all six), and holds them there (`holdsSampleHistory`).
    public func handleLaunchArguments(_ args: [String] = ProcessInfo.processInfo.arguments,
                                      sampleHistory: Bool = false) async {
        guard !launchArgumentsHandled else { return }
        launchArgumentsHandled = true
        // Set before the pairing below: a refresh that finds that pairing finds this set too, and leaves the rows be.
        if sampleHistory { holdsSampleHistory = true }
        func value(_ flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        if let link = value("-DLSPairLink") {
            do {
                let p = try Pairing.parse(link)
                _ = await changePairing(p)
            } catch {
                show((error as? ShareError)?.message ?? error.localizedDescription, error: true)
            }
        }
        if sampleHistory {
            // After the pairing, which empties the outbox when it is a new one.
            let now = Date()
            let only = HistorySample.picked(args)
            await write { store in
                OutboxStore(store: store).update { $0.rows = HistorySample.rows(now: now, only: only) }
            }
        }
        if let url = value("-DLSSendLink") { await sendLink(url) }
    }

    // MARK: Maintenance (PROTOCOL 3.3)

    /// Reads acks and re-sends what is due (not while the history holds the UI tests' sample rows). Call it at launch,
    /// in the foreground and from background refresh (`BGAppRefreshTask`): with Lab on it also sends what was shared
    /// offline (F07, `OfflineQueue.flushIfDue`).
    public func refresh() async {
        await reloadNow()
        // Checked once the sender is known: there is one only after the launch's pairing, which comes after
        // `holdsSampleHistory` is set.
        guard let sender = await sender(), !holdsSampleHistory else { return }
        let before = rows
        await followBackgroundUploads(sender)
        _ = await sender.tick()
        // The ledger keeps the states of the items still in the outbox only (LAB-PROTOCOL 2.2.6).
        let store = self.store
        await Self.onStorage {
            let outbox = OutboxStore(store: store)
            LabLedger(outbox: outbox).prune(keeping: Set(outbox.rows.map(\.id)))
        }
        await reloadNow()
        await logChanges(from: before, to: rows)
        await lab.reloadNow()
        // F07: coming back to the app may find rows waiting for the network.
        if lab.isOn, let queue = offlineQueue { _ = await queue.flushIfDue() }
    }

    // MARK: Share in place's background sessions (F04)

    /// Before a tick: which share-in-place attempts still have live upload tasks in the sessions this app holds (a
    /// `sending` row of one is not stale, so the app never re-sends what the OS is still uploading, F07.3). The app takes
    /// over the session of a share that is 15 minutes old (`BackgroundPublisher.adoptable`; iPhone and Mac alike: by then
    /// the share extension that started it has ended): its answers come here from then on, and its live tasks count. The
    /// iPhone app is also connected to a session when the OS wakes it for one (`handleBackgroundEvents`).
    private func followBackgroundUploads(_ sender: ShareSender) async {
        #if canImport(ObjectiveC)
        let store = self.store
        guard store.isShared else { return }
        let current = rows
        let adopted = BackgroundUploadSession.adopt(BackgroundPublisher.adoptable(current, now: Date()), store: store,
                                                    notices: notices, daylightName: { store.pairing?.displayName })
        let live = await BackgroundUploadSession.liveAttempts(waiting: BackgroundPublisher.waiting(current))
        // A session taken over just now reports its tasks a moment later: its rows are not stale on this tick.
        sender.liveBackgroundAttempts = live.union(adopted)
        #endif
    }

    #if canImport(ObjectiveC)
    /// iPhone's `application(_:handleEventsForBackgroundURLSession:completionHandler:)`: a share in place's session
    /// ("com.daylight.share.bg.<attempt>") whose share extension has gone. The app reconnects to it (the only time it
    /// does), the answers update the history and post the failure notice (`notices`), and `completion` is called once
    /// they are handled. Returns false for an identifier that is not one of these (call `completion` yourself).
    @discardableResult
    public func handleBackgroundEvents(identifier: String, completion: @escaping () -> Void) -> Bool {
        let store = self.store
        return BackgroundUploadSession.handleEvents(identifier: identifier, store: store, notices: notices,
                                                    daylightName: { store.pairing?.displayName },
                                                    completion: { [weak self] in
                                                        completion()
                                                        Task { @MainActor in self?.reload() }
                                                    })
    }
    #endif

    /// Checks for the Daylight's ack again ~30 s after a send, while the app runs.
    private func followUp(_ sender: ShareSender) {
        Task { [weak self] in
            _ = try? await sender.checkAcks()
            await self?.reloadNow()
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            _ = try? await sender.checkAcks()
            await self?.reloadNow()
        }
    }

    /// While the app runs: every `interval` seconds, if anything waits for an ack or a re-send, run a pass; and every
    /// `Lab.fastCheckMs` (30 s) the faster checks of 2.5 (`fastCheck`).
    public func startAutoRefresh(interval: TimeInterval = 60) {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.rows.contains(where: \.isPending) else { return }
                await self.refresh()
            }
        }
        fastTimer?.invalidate()
        fastTimer = Timer.scheduledTimer(withTimeInterval: Double(Lab.fastCheckMs) / 1000, repeats: true) { [weak self] _ in
            Task { @MainActor in _ = await self?.fastCheck() }
        }
    }

    public func stopAutoRefresh() {
        timer?.invalidate()
        timer = nil
        fastTimer?.invalidate()
        fastTimer = nil
    }

    /// Faster checks while something is in flight (2.5, F01.1): while the app shows (`isVisible`), Lab is on and a row
    /// delivered in the last 10 minutes has no settled state (`LabRowText.wantsFastChecks`), the ack topic is read now,
    /// so the Inbox's item states ("In your Reader ✓") reach the ledger, the rows and the announcement within one
    /// check. `startAutoRefresh` runs it every 30 s. Returns whether it read the ack topic.
    @discardableResult
    public func fastCheck(now: Date = Date()) async -> Bool {
        guard isVisible, lab.isOn, !holdsSampleHistory, !fastChecking,
              LabRowText.wantsFastChecks(rows, now: now, ledger: lab.ledger) else { return false }
        fastChecking = true
        defer { fastChecking = false }
        guard let sender = await sender() else { return false }
        let before = rows
        _ = try? await sender.checkAcks()
        await reloadNow()
        await logChanges(from: before, to: rows)
        await lab.reloadNow()
        return true
    }

    // MARK: Status dump (CI smoke tests and debugging)

    /// When the model was created (about when the app launched).
    private let createdAt = Date()
    private var firstRender: Date?
    private var heartbeat: Timer?
    /// Where `-DLSStatusDump` writes, or nil when it is off.
    public private(set) var statusFile: URL?
    private nonisolated static let statusQueue = DispatchQueue(label: "com.daylight.share.status", qos: .utility)

    /// Call from the root view's `onAppear`. With the launch argument `-DLSStatusDump`, the app then writes its state
    /// to `debug-status.json` in its own Application Support folder (sandboxed Mac app:
    /// ~/Library/Containers/<bundle id>/Data/Library/Application Support/DaylightShare/), on its first render, after
    /// every change, and once a second as a heartbeat that stops when the main thread is blocked. The file is written
    /// on a background queue.
    public func noteRendered(arguments: [String] = ProcessInfo.processInfo.arguments) {
        guard firstRender == nil else { return }
        firstRender = Date()
        guard arguments.contains("-DLSStatusDump") else { return }
        statusFile = SharedStore.privateDirectory().appendingPathComponent("debug-status.json")
        writeStatus()
        heartbeat = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.writeStatus() }
        }
    }

    /// The state the status dump holds: storage, pairing, each history row with the label the history shows, and the
    /// storage accesses made on the main thread (there must be none).
    public func statusSnapshot() -> [String: Any] {
        func ms(_ d: Date?) -> Any { d.map { Int(($0.timeIntervalSince1970 * 1000).rounded()) as Any } ?? NSNull() }
        let now = Date()
        return [
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "app": DaylightShare.appIdentifier,
            "modelCreatedAt": ms(createdAt),
            "firstRenderAt": ms(firstRender),
            "heartbeatAt": ms(now),
            "storage": storage.description,
            "storageReady": isStorageReady,
            "loaded": isLoaded,
            "appGroup": store.appGroup.map { $0 as Any } ?? NSNull(),
            "paired": isPaired,
            "daylight": pairing.map { $0.displayName as Any } ?? NSNull(),
            "pendingPairing": pendingPairing?.confirmation.title.map { $0 as Any } ?? NSNull(),
            "comfort": comfort,
            // LAB-PLAN 1.7: the Lab switch, the Inbox's capabilities and each item's state from the ledger.
            "lab": lab.isOn,
            "caps": lab.ledger.caps,
            "labStates": lab.ledger.states.mapValues { ["s": $0.s, "t": $0.t] as [String: Any] },
            "mainThreadStorage": StorageAudit.mainThreadAccesses,
            "rows": rows.map { row -> [String: Any] in
                let text = RowText(row: row, now: now)
                return ["id": row.id, "title": row.displayTitle, "url": row.url, "status": row.status.rawValue,
                        "errorCode": row.errorCode, "label": text.label, "sentence": text.sentence.map { $0 as Any } ?? NSNull(),
                        "error": row.error]
            },
        ]
    }

    private func writeStatus() {
        guard let statusFile else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: statusSnapshot(), options: [.sortedKeys]) else { return }
        Self.statusQueue.async {
            try? FileManager.default.createDirectory(at: statusFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: statusFile, options: .atomic)
        }
    }
}

/// Which ledger changes are news for F01's "In your Reader ✓" announcement and F04's quiet notice: the ledger the Lab
/// model first reads from storage is the baseline, never its empty starting one, whichever of it and the history loads
/// first, so a row already in the Reader at launch is not said again; after that, each change against the one before.
struct LedgerBaseline {
    private(set) var last: LabLedger.Snapshot?

    /// The ledger the Lab model holds now (`loaded`: its first read from storage is done). Returns the ledger to compare
    /// `ledger` with when it is news, else nil (not loaded yet, the baseline, or no change).
    mutating func next(_ ledger: LabLedger.Snapshot, loaded: Bool) -> LabLedger.Snapshot? {
        guard loaded else { return nil }
        defer { last = ledger }
        guard let old = last, old != ledger else { return nil }
        return old
    }
}
