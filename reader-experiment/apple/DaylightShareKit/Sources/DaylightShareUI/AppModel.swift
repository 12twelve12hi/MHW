import DaylightShareKit
import Foundation
import SwiftUI

/// The state behind the iPhone and Mac apps: pairing, history, sending, and the maintenance timer.
@MainActor
public final class AppModel: ObservableObject {
    public static let shared = AppModel()

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
    public var daylightName: String { pairing?.displayName ?? "your Daylight" }
    public var defaultDeviceName: String { DaylightShare.defaultDeviceName }

    public func reload() {
        let p = store.pairing
        if p != pairing { pairing = p }
        let r = OutboxStore(store: store).rows
        if r != rows { rows = r }
        let n = store.deviceName
        if n != deviceName { deviceName = n }
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
    @discardableResult
    public func pair(_ input: String) -> String? {
        do {
            let p = try Pairing.parse(input)
            store.pair(p)
            reload()
            show("Paired with \(p.displayName).")
            Task { await refresh() }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    public func unpair() {
        store.unpair()
        reload()
    }

    public func setDeviceName(_ name: String) {
        store.deviceName = name
        reload()
    }

    /// Changes the relay of the current pairing (it must match the Daylight's). Returns an error message or nil.
    public func setRelay(_ relay: String) -> String? {
        guard var p = pairing else { return "Not paired." }
        do {
            p.relay = try ShareText.normalizeRelay(relay)
            store.pair(p)
            reload()
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
        guard let sender = sender() else { return }
        sendingCount += 1
        defer { sendingCount -= 1 }
        let r = await sender.retry(row.id)
        reload()
        if let r, r.status == .failed { show("Still couldn’t send it: \(r.error)", error: true) }
        if let r, r.status == .sent { followUp(sender) }
    }

    public func delete(_ row: OutboxRow) {
        OutboxStore(store: store).remove(row.id)
        reload()
    }

    public func clearFinished() {
        OutboxStore(store: store).clearFinished()
        reload()
    }

    // MARK: Maintenance (PROTOCOL 3.3)

    /// Reads acks and re-sends what is due.
    public func refresh() async {
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
}
