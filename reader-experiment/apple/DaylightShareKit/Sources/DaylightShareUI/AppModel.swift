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
    /// A short status line ("Sent · waiting for your Daylight", an error, …), cleared after a few seconds.
    @Published public var banner: Banner?
    /// A pairing that waits for the user's confirmation (PROTOCOL 1.3): a link from outside the app, or a code that
    /// would replace a Daylight with another secret. The views show `PairingConfirmationView` for it; setting it to
    /// nil cancels.
    @Published public var pendingPairing: PendingPairing?
    /// The sheet the window shows (Settings, the file picker, the QR scanner), or nil. Every sheet, and the pairing
    /// question, is presented from one place (`View.appSheets`): SwiftUI shows one sheet at a time, so a pairing link
    /// that arrives while one is open closes it and asks instead (`presented`).
    @Published public var sheet: Sheet?

    public enum Sheet: String, Identifiable {
        case settings
        /// "Send a file…" (iPhone).
        case files
        /// "Scan the QR code" (iPhone).
        case scanner
        public var id: String { rawValue }
    }

    /// What the window presents (`presented`): the pairing question when one waits (it takes the place of any other
    /// sheet), else `sheet`.
    public enum Presented: Identifiable, Equatable {
        case pairing(PendingPairing)
        case sheet(Sheet)

        public var id: String {
            switch self {
            case let .pairing(p): return "pairing-\(p.id)"
            case let .sheet(s): return s.rawValue
            }
        }
    }

    /// Setting it to nil (SwiftUI does when a sheet is dismissed) closes `sheet`; the pairing question is answered
    /// only with its buttons (`confirmPairing`, `cancelPairing`).
    public var presented: Presented? {
        get {
            if let pendingPairing { return .pairing(pendingPairing) }
            return sheet.map { .sheet($0) }
        }
        set {
            if newValue == nil { sheet = nil }
        }
    }

    public struct Banner: Equatable, Identifiable {
        public let id = UUID()
        public let text: String
        public let isError: Bool
    }

    public struct PendingPairing: Equatable, Identifiable {
        public let id = UUID()
        public let pairing: Pairing
        public let confirmation: PairingConfirmation
    }

    public let store: SharedStore
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    private var bannerTask: Task<Void, Never>?
    private var reloadSeq = 0
    /// Comfort writes on their way to storage: until they land, a read does not put the old value back.
    private var comfortWrites = 0

    public init(store: SharedStore = .shared, arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.store = store
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

    /// Shows a banner (and says it to VoiceOver, F27).
    public func show(_ text: String, error: Bool = false) {
        banner = Banner(text: text, isError: error)
        Announcer.announce(text)
        bannerTask?.cancel()
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
        await change { _ = await $0.pair(p) }
        show(notice ?? "Paired with \(p.displayName).")
        await refresh()
    }

    /// Unpairs (the outbox goes too) and closes Settings, where Unpair is: there is nothing left to set.
    public func unpair() {
        sheet = nil
        Task { await change { await $0.unpair() } }
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
                await change { _ = await $0.pair(changed) }
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
        await store.ready()
        return await Self.onStorage { try? DaylightShare.sender(store: store) }
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
            let row = try await sender.send(input)
            await reloadNow()
            show(RowText(row: row).message, error: RowText.isTrouble(row.status))
            if row.status == .sent { followUp(sender) }
            return row
        } catch {
            show((error as? ShareError)?.message ?? error.localizedDescription, error: true)
            await reloadNow()
            return nil
        }
    }

    /// "Send a link": a URL, text containing one, or a bare domain. Returns whether it was sent.
    @discardableResult
    public func sendLink(_ text: String, title: String? = nil) async -> Bool {
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
    }

    nonisolated static func readFile(_ url: URL) -> FileInput {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        if let link = linkInShortcutFile(url) { return .link(link, title: url.deletingPathExtension().lastPathComponent) }
        do {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
            if values.isDirectory == true { return .refused("“\(name)” is a folder. Send a file instead.") }
            if let size = values.fileSize, size > DLS.maxItem { return .refused(ShareText.tooBigMessage(size)) }
            let data = try Data(contentsOf: url, options: .alwaysMapped)
            if data.count > DLS.maxItem { return .refused(ShareText.tooBigMessage(data.count)) }
            return .item(.file(data, name: name))
        } catch {
            return .refused("Couldn’t read “\(name)”: \(error.localizedDescription)")
        }
    }

    public func sendFile(_ url: URL) async {
        switch await Self.onStorage({ Self.readFile(url) }) {
        case let .link(link, title):
            await send(.link(link, title: title))
        case let .item(input):
            await send(input)
        case let .refused(message):
            show(message, error: true)
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
                await send(.link(link))
            }
        }
    }

    /// "Retry now" or "Try again" on a row (not on the UI tests' sample history, which stays as it is).
    public func retry(_ row: OutboxRow) async {
        guard !holdsSampleHistory, let sender = await sender() else { return }
        sendingCount += 1
        defer { sendingCount -= 1 }
        let r = await sender.retry(row.id)
        await reloadNow()
        if let r {
            if RowText.isTrouble(r.status) { show(RowText(row: r).message, error: true) }
            if r.status == .sent { followUp(sender) }
        }
    }

    /// "Remove": waits for an attempt in flight, so the row does not come back.
    public func delete(_ row: OutboxRow) {
        let id = row.id
        Task { await change { _ = await OutboxStore(store: $0).remove(id) } }
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
    /// `-DLSTestStorage`) puts `HistorySample.rows` in the history once the pairing is in place, and holds them there
    /// (`holdsSampleHistory`).
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
                await change { _ = await $0.pair(p) }
            } catch {
                show((error as? ShareError)?.message ?? error.localizedDescription, error: true)
            }
        }
        if sampleHistory {
            // After the pairing, which empties the outbox when it is a new one.
            let now = Date()
            await write { store in
                OutboxStore(store: store).update { $0.rows = HistorySample.rows(now: now) }
            }
        }
        if let url = value("-DLSSendLink") { await sendLink(url) }
    }

    // MARK: Maintenance (PROTOCOL 3.3)

    /// Reads acks and re-sends what is due (not while the history holds the UI tests' sample rows).
    public func refresh() async {
        await reloadNow()
        // Checked once the sender is known: there is one only after the launch's pairing, which comes after
        // `holdsSampleHistory` is set.
        guard let sender = await sender(), !holdsSampleHistory else { return }
        _ = await sender.tick()
        await reloadNow()
    }

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

    /// While the app runs: every `interval` seconds, if anything waits for an ack or a re-send, run a pass.
    public func startAutoRefresh(interval: TimeInterval = 60) {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.rows.contains(where: \.isPending) else { return }
                await self.refresh()
            }
        }
    }

    public func stopAutoRefresh() {
        timer?.invalidate()
        timer = nil
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
