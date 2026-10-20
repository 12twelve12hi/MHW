import DaylightShareKit
import Foundation
import SwiftUI

/// The state behind the iPhone and Mac apps: pairing, history, sending, and the maintenance timer.
///
/// Creating it never waits for storage: `SharedStore` resolves the App Group in the background, and until it is settled
/// (at most `SharedStore.resolutionTimeout`) the model reads this process's own storage. Writes (pairing, settings,
/// sending) are applied once storage is settled.
@MainActor
public final class AppModel: ObservableObject {
    public static let shared = AppModel()

    /// Where the pairing and history live: resolving, the shared App Group, or this app's own storage.
    @Published public private(set) var storage: SharedStore.State
    @Published public private(set) var pairing: Pairing?
    @Published public private(set) var rows: [OutboxRow] = []
    @Published public private(set) var deviceName: String = ""
    @Published public private(set) var sendingCount = 0
    /// A short status line ("Sent", an error, …), cleared after a few seconds.
    @Published public var banner: Banner?

    public struct Banner: Equatable, Identifiable {
        public let id = UUID()
        public let text: String
        public let isError: Bool
    }

    public let store: SharedStore
    private var timer: Timer?
    private var observer: NSObjectProtocol?
    private var bannerTask: Task<Void, Never>?

    public init(store: SharedStore = .shared) {
        self.store = store
        storage = store.state
        reload()
        observer = NotificationCenter.default.addObserver(forName: .daylightShareChanged, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        #if canImport(ObjectiveC)
        SharedStore.observeOtherProcesses()
        #endif
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

    public func reload() {
        let s = store.state
        if s != storage { storage = s }
        let p = store.pairing
        if p != pairing { pairing = p }
        let r = OutboxStore(store: store).rows
        if r != rows { rows = r }
        let n = store.deviceName
        if n != deviceName { deviceName = n }
        writeStatus()
    }

    /// Runs `body` now if storage is settled, else as soon as it is (on the main actor).
    private func whenStorageReady(_ body: @escaping @MainActor () -> Void) {
        if store.isReady {
            body()
            return
        }
        Task {
            await store.ready()
            body()
        }
    }

    public func show(_ text: String, error: Bool = false) {
        banner = Banner(text: text, isError: error)
        bannerTask?.cancel()
        bannerTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if !Task.isCancelled { self?.banner = nil }
        }
    }

    // MARK: Pairing and settings

    /// Pairs from a typed code or a `daylightshare://` link. Returns an error message, or nil on success.
    /// While storage is still resolving, the pairing is saved as soon as it is settled.
    @discardableResult
    public func pair(_ input: String) -> String? {
        do {
            let p = try Pairing.parse(input)
            whenStorageReady { [weak self] in
                guard let self else { return }
                self.store.pair(p)
                self.reload()
                self.show("Paired with \(p.displayName).")
                Task { await self.refresh() }
            }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    public func unpair() {
        whenStorageReady { [weak self] in
            self?.store.unpair()
            self?.reload()
        }
    }

    public func setDeviceName(_ name: String) {
        whenStorageReady { [weak self] in
            self?.store.deviceName = name
            self?.reload()
        }
    }

    /// Changes the relay of the current pairing (it must match the Daylight's). Returns an error message or nil.
    public func setRelay(_ relay: String) -> String? {
        guard var p = pairing else { return "Not paired." }
        do {
            p.relay = try ShareText.normalizeRelay(relay)
            let changed = p
            whenStorageReady { [weak self] in
                self?.store.pair(changed)
                self?.reload()
            }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    // MARK: Sending

    private func sender() -> ShareSender? {
        try? DaylightShare.sender(store: store)
    }

    /// Sends one item and reports the outcome in the banner. Returns the outbox row.
    @discardableResult
    public func send(_ input: ItemInput, label: String) async -> OutboxRow? {
        await store.ready()
        guard let sender = sender() else {
            show("Pair with your Daylight first.", error: true)
            return nil
        }
        sendingCount += 1
        defer { sendingCount -= 1 }
        do {
            let row = try await sender.send(input)
            reload()
            if row.status == .failed {
                show("Couldn’t send \(label) yet: \(row.error) It will be retried.", error: true)
            } else {
                show("Sent \(label) to \(daylightName).")
                followUp(sender)
            }
            return row
        } catch {
            show((error as? ShareError)?.message ?? error.localizedDescription, error: true)
            reload()
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
        return await send(.link(url, title: title), label: "the link") != nil
    }

    /// Sends files (from a picker, a drop, the Dock or "Open With"). `.webloc` and `.url` shortcuts send their link.
    public func sendFiles(_ urls: [URL]) async {
        for url in urls { await sendFile(url) }
    }

    public func sendFile(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        if let link = Self.linkInShortcutFile(url) {
            await send(.link(link, title: url.deletingPathExtension().lastPathComponent), label: "the link")
            return
        }
        do {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
            if values.isDirectory == true {
                show("“\(name)” is a folder. Send a file instead.", error: true)
                return
            }
            let data = try Data(contentsOf: url, options: .alwaysMapped)
            await send(.file(data, name: name), label: "“\(name)”")
        } catch {
            show("Couldn’t read “\(name)”: \(error.localizedDescription)", error: true)
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

    /// Handles URLs the app was opened with: `daylightshare://` pairs, files are sent, web links are sent.
    public func handleOpen(_ urls: [URL]) async {
        // A pairing link followed by a file must pair before the file is sent.
        await store.ready()
        for url in urls {
            if url.scheme?.lowercased() == "daylightshare" {
                if let error = pair(url.absoluteString) { show(error, error: true) }
            } else if url.isFileURL {
                await sendFile(url)
            } else if let link = ShareText.webURL(url.absoluteString) {
                await send(.link(link), label: "the link")
            }
        }
    }

    public func retry(_ row: OutboxRow) async {
        await store.ready()
        guard let sender = sender() else { return }
        sendingCount += 1
        defer { sendingCount -= 1 }
        let r = await sender.retry(row.id)
        reload()
        if let r, r.status == .failed { show("Still couldn’t send it: \(r.error)", error: true) }
        if let r, r.status == .sent { followUp(sender) }
    }

    public func delete(_ row: OutboxRow) {
        whenStorageReady { [weak self] in
            guard let self else { return }
            OutboxStore(store: self.store).remove(row.id)
            self.reload()
        }
    }

    public func clearFinished() {
        whenStorageReady { [weak self] in
            guard let self else { return }
            OutboxStore(store: self.store).clearFinished()
            self.reload()
        }
    }

    private var launchArgumentsHandled = false

    /// Hooks for the CI smoke tests (and handy for debugging): `-DLSPairLink <daylightshare://…>` pairs and
    /// `-DLSSendLink <url>` sends a link, once per launch. Only someone who starts the app can pass them.
    /// (`-DLSStatusDump` is read by `noteRendered()`.)
    public func handleLaunchArguments(_ args: [String] = ProcessInfo.processInfo.arguments) async {
        guard !launchArgumentsHandled else { return }
        launchArgumentsHandled = true
        // Pair and send in this order, both on settled storage.
        await store.ready()
        func value(_ flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        if let link = value("-DLSPairLink"), let error = pair(link) { show(error, error: true) }
        if let url = value("-DLSSendLink") { await sendLink(url) }
    }

    // MARK: Maintenance (PROTOCOL 3.3)

    /// Reads acks and re-sends what is due.
    public func refresh() async {
        await store.ready()
        reload()
        guard let sender = sender() else { return }
        _ = await sender.tick()
        reload()
    }

    /// Checks for the Daylight's ack again ~30 s after a send, while the app runs.
    private func followUp(_ sender: ShareSender) {
        Task { [weak self] in
            _ = try? await sender.checkAcks()
            self?.reload()
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            _ = try? await sender.checkAcks()
            self?.reload()
        }
    }

    /// While the app runs: every `interval` seconds, if anything waits for an ack or a re-send, run a pass.
    public func startAutoRefresh(interval: TimeInterval = 60) {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.rows.contains(where: { [.sending, .sent, .failed].contains($0.status) }) else { return }
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

    /// Call from the root view's `onAppear`. With the launch argument `-DLSStatusDump`, the app then writes its state
    /// to `debug-status.json` in its own Application Support folder (sandboxed Mac app:
    /// ~/Library/Containers/<bundle id>/Data/Library/Application Support/DaylightShare/), on its first render, after
    /// every change, and once a second as a heartbeat that stops when the main thread is blocked.
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

    /// The state the status dump holds: storage, pairing and each history row with the label the history shows.
    public func statusSnapshot() -> [String: Any] {
        func ms(_ d: Date?) -> Any { d.map { Int(($0.timeIntervalSince1970 * 1000).rounded()) as Any } ?? NSNull() }
        return [
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "app": DaylightShare.appIdentifier,
            "modelCreatedAt": ms(createdAt),
            "firstRenderAt": ms(firstRender),
            "heartbeatAt": ms(Date()),
            "storage": storage.description,
            "storageReady": isStorageReady,
            "appGroup": store.appGroup.map { $0 as Any } ?? NSNull(),
            "paired": isPaired,
            "daylight": pairing.map { $0.displayName as Any } ?? NSNull(),
            "rows": rows.map { row -> [String: Any] in
                ["id": row.id, "title": row.displayTitle, "url": row.url, "status": row.status.rawValue,
                 "label": StatusLabel.text(row), "error": row.error]
            },
        ]
    }

    private func writeStatus() {
        guard let statusFile else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: statusSnapshot(), options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: statusFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: statusFile, options: .atomic)
    }
}
