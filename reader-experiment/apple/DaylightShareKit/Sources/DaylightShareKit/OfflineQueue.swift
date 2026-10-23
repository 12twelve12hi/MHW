import Foundation
#if canImport(Network)
import Network
#endif

/// Whether this device can reach the network: a source of "online" and "offline" (F07). The apps use
/// `SystemPathSource` (`NWPathMonitor`); tests give their own.
public protocol NetworkPathSource: AnyObject {
    /// Starts reporting; `update` gets true (online) or false (offline) now and at every change, on any thread.
    func start(_ update: @escaping @Sendable (Bool) -> Void)
    func stop()
}

#if canImport(Network)
/// `NWPathMonitor`: online when the path is satisfied.
public final class SystemPathSource: NetworkPathSource {
    private var monitor: NWPathMonitor?
    private let queue = DispatchQueue(label: "com.daylight.share.path", qos: .utility)

    public init() {}

    public func start(_ update: @escaping @Sendable (Bool) -> Void) {
        stop()
        let m = NWPathMonitor()
        m.pathUpdateHandler = { path in update(path.status == .satisfied) }
        m.start(queue: queue)
        monitor = m
    }

    public func stop() {
        monitor?.cancel()
        monitor = nil
    }
}
#endif

/// The offline-first outbox (LAB-PLAN F07; LAB-PROTOCOL 2.7.1): while this device is offline a share is stored, not
/// published (`ShareSender.send(_:defer:)`: it reads "Waiting for connection"); coming back online sends what waits
/// (`ShareSender.flushNetwork`), oldest first, at most 30 frames and 18 MB of attachments a pass, with passes at least
/// 3 minutes apart (ntfy.sh's request bucket refills by 36 meanwhile) until nothing waits.
///
/// iPhone: first attempts ride background `URLSession`s (F04), which wait for connectivity by themselves; app launch and
/// `BGAppRefreshTask` call `flushIfDue()`. Mac: the path monitor while the app runs. With Lab off the apps send as
/// v1.1 does and never make one (items already waiting go out on v1.1's back-off, 1.3).
public actor OfflineQueue {
    /// What the queue sends with: a sender for the current pairing, or nil (not paired).
    public typealias SenderSource = @Sendable () async -> ShareSender?

    let senderSource: SenderSource
    let path: NetworkPathSource
    let now: @Sendable () -> Date
    let spacing: TimeInterval
    /// Called with each pass's rows (the app reloads its history and logs them).
    let onPass: @Sendable ([OutboxRow]) async -> Void

    /// What the path source last said: true, false, or nil before it said anything.
    public private(set) var isOnline: Bool?
    /// When the last pass ran.
    public private(set) var lastPass: Date?
    private var scheduled: Task<Void, Never>?
    private var started = false

    public init(sender: @escaping SenderSource, path: NetworkPathSource, spacing: TimeInterval = Lab.flushSpacing,
                now: @escaping @Sendable () -> Date = Date.init,
                onPass: @escaping @Sendable ([OutboxRow]) async -> Void = { _ in }) {
        senderSource = sender
        self.path = path
        self.spacing = spacing
        self.now = now
        self.onPass = onPass
    }

    /// Starts listening to the path source; a change to online flushes (`flushIfDue`).
    public func start() {
        guard !started else { return }
        started = true
        path.start { [weak self] online in
            guard let self else { return }
            Task { await self.pathChanged(online) }
        }
    }

    public func stop() {
        started = false
        path.stop()
        scheduled?.cancel()
        scheduled = nil
    }

    func pathChanged(_ online: Bool) async {
        let was = isOnline
        isOnline = online
        if online && was != true { await flushIfDue() }
    }

    /// Shares one item: deferred while offline (F07), published at once otherwise. Throws as `ShareSender.send`.
    public func send(_ item: ItemInput, with sender: ShareSender) async throws -> OutboxRow {
        try await sender.send(item, defer: isOnline == false)
    }

    /// Whether to defer a share now (this device reported offline).
    public var shouldDefer: Bool { isOnline == false }

    /// Runs a pass when online and at least `spacing` after the last one; else schedules one for when the spacing is up.
    /// Passes go on, spaced, while rows still wait for the network. Returns the rows this call attempted.
    @discardableResult
    public func flushIfDue() async -> [OutboxRow] {
        guard isOnline != false else { return [] }
        let t = now()
        if let last = lastPass, t.timeIntervalSince(last) < spacing {
            schedule(after: spacing - t.timeIntervalSince(last))
            return []
        }
        guard let sender = await senderSource() else { return [] }
        lastPass = t
        let rows = await sender.flushNetwork()
        await onPass(rows)
        if sender.outbox.rows.contains(where: { $0.status == .failed && $0.errorCode == "network" }) {
            schedule(after: spacing)
        }
        return rows
    }

    private func schedule(after seconds: TimeInterval) {
        guard scheduled == nil else { return }
        scheduled = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.runScheduled()
        }
    }

    private func runScheduled() async {
        scheduled = nil
        await flushIfDue()
    }
}
