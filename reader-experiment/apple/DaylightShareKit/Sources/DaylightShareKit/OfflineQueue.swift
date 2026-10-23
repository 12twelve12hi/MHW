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

    /// This device's connection now, for a process without the offline queue (a share extension sending a Lab share
    /// itself, F07): true online, false offline, nil when the monitor said nothing within `timeout` seconds.
    public static func current(timeout: TimeInterval = 0.5) async -> Bool? {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool?, Never>) in
            let monitor = NWPathMonitor()
            let queue = DispatchQueue(label: "com.daylight.share.path.once", qos: .userInitiated)
            var answered = false // read and written on `queue` only
            func answer(_ value: Bool?) {
                guard !answered else { return }
                answered = true
                monitor.pathUpdateHandler = nil
                monitor.cancel()
                cont.resume(returning: value)
            }
            monitor.pathUpdateHandler = { path in answer(path.status == .satisfied) }
            monitor.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) { answer(nil) }
        }
    }
}
#endif

/// The offline-first outbox (LAB-PLAN F07; LAB-PROTOCOL 2.7.1): while this device is offline a share is stored, not
/// published (`ShareSender.send(_:defer:)`: it reads "Waiting for connection"); coming back online sends what waits
/// (`ShareSender.flushNetwork`), oldest first, at most 30 frames and 18 MB of attachments a pass, with passes at least
/// 3 minutes apart (ntfy.sh's request bucket refills by 36 meanwhile).
///
/// A pass runs only for this device's connection, never against v1.1's back-off (F07: coming back online, app launch
/// and background refresh call it):
/// - coming back online after the path source said offline: a pass now (or when the 3 minutes are up);
/// - app launch, a refresh, background refresh (`flushIfDue`): a pass when the oldest waiting row was shared offline and
///   never tried (`attempts` 0), or v1.1's back-off says it is due; a row the relay refused (429, 5xx) keeps its
///   back-off of 1 to 60 minutes, as the extension's and Windows' queues do;
/// - after a pass that stopped at a cap with nothing failed, the next one 3 minutes later, until nothing waits.
///
/// iPhone: first attempts ride background `URLSession`s (F04), which wait for connectivity by themselves; app launch and
/// `BGAppRefreshTask` call `flushIfDue()` (through `AppModel.refresh`). Mac: the path monitor while the app runs. With
/// Lab off the apps send as v1.1 does and the queue sends nothing (items already waiting go out on v1.1's back-off, 1.3).
public actor OfflineQueue {
    /// What the queue sends with: a sender for the current pairing, or nil (not paired, or Lab off).
    public typealias SenderSource = @Sendable () async -> ShareSender?

    let senderSource: SenderSource
    let path: NetworkPathSource
    let now: @Sendable () -> Date
    let spacing: TimeInterval
    /// Called with each pass's rows (the app reloads its history and logs them).
    let onPass: @Sendable ([OutboxRow]) async -> Void
    /// Called with every report of the path source (the app's rows read "Waiting for connection" while offline, 2.5).
    let onPath: @Sendable (Bool) async -> Void

    /// What the path source last said: true, false, or nil before it said anything.
    public private(set) var isOnline: Bool?
    /// When the last pass ran.
    public private(set) var lastPass: Date?
    /// This device came back online after being offline, and no pass has run since.
    public private(set) var reconnected = false
    /// The last pass stopped at a cap with nothing failed: the next one follows when the spacing is up.
    public private(set) var followUp = false
    private var scheduled: Task<Void, Never>?
    private var started = false

    public init(sender: @escaping SenderSource, path: NetworkPathSource, spacing: TimeInterval = Lab.flushSpacing,
                now: @escaping @Sendable () -> Date = Date.init,
                onPass: @escaping @Sendable ([OutboxRow]) async -> Void = { _ in },
                onPath: @escaping @Sendable (Bool) async -> Void = { _ in }) {
        senderSource = sender
        self.path = path
        self.spacing = spacing
        self.now = now
        self.onPass = onPass
        self.onPath = onPath
    }

    /// Starts listening to the path source; coming back online flushes.
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
        await onPath(online)
        guard online, was != true else { return }
        // Back from offline: a pass whatever the rows' back-off. The first report (launch) is an ordinary check.
        if was == false { reconnected = true }
        await flushIfDue()
    }

    /// Shares one item: deferred while offline (F07), published at once otherwise. Throws as `ShareSender.send`.
    public func send(_ item: ItemInput, with sender: ShareSender) async throws -> OutboxRow {
        try await sender.send(item, defer: isOnline == false)
    }

    /// Whether to defer a share now (this device reported offline).
    public var shouldDefer: Bool { isOnline == false }

    /// Whether a scheduled pass waits (tests).
    var hasScheduledPass: Bool { scheduled != nil }

    /// The rows a pass would try, oldest first: failed for the network, within the outbox's 7 days.
    static func waiting(_ rows: [OutboxRow], at t: Date) -> [OutboxRow] {
        rows.filter { $0.status == .failed && $0.errorCode == "network" && t.timeIntervalSince($0.created) <= DLS.outboxExpiry }
            .sorted { $0.created < $1.created }
    }

    /// Whether a pass is due for the connection's sake (not after a reconnect or a capped pass): the oldest waiting row
    /// was shared offline and never tried, or v1.1's back-off says it is due.
    static func headIsDue(_ rows: [OutboxRow], sender: ShareSender, at t: Date) -> Bool {
        guard let head = waiting(rows, at: t).first else { return false }
        return head.attempts == 0 || sender.isDue(head, at: t)
    }

    /// Runs a pass when one is due (see the type's rules) and online, at least `spacing` after the last one; after a
    /// reconnect or a capped pass that comes too soon, schedules it for when the spacing is up. Returns the rows this call
    /// attempted.
    @discardableResult
    public func flushIfDue() async -> [OutboxRow] {
        guard isOnline != false else { return [] }
        let t = now()
        if let last = lastPass, t.timeIntervalSince(last) < spacing {
            if reconnected || followUp { schedule(after: spacing - t.timeIntervalSince(last)) }
            return []
        }
        guard let sender = await senderSource() else { return [] }
        let rows = sender.outbox.rows
        let waiting = Self.waiting(rows, at: t)
        guard !waiting.isEmpty else {
            reconnected = false
            followUp = false
            return []
        }
        guard reconnected || followUp || Self.headIsDue(rows, sender: sender, at: t) else { return [] }
        lastPass = t
        reconnected = false
        let attempted = await sender.flushNetwork()
        await onPass(attempted)
        // Stopped at a cap, and everything it tried went: the next pass follows. A failure (429, a 413, the network
        // again) leaves the rest to the rows' back-off and the next reconnect.
        let left = !Self.waiting(sender.outbox.rows, at: now()).isEmpty
        followUp = left && !attempted.isEmpty && attempted.allSatisfy { $0.status != .failed && $0.status != .expired }
        if followUp { schedule(after: spacing) }
        return attempted
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
