import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The sender side of PROTOCOL 3.3, exactly the pseudo-code of CHANGES-v1.1 2.4: publish, read acks, re-send, expire.
/// Mirrors the JS reference's `Sender`.
///
/// Every public method runs under a lock shared by every `ShareSender` on the same outbox directory in this process
/// (`OutboxStore.whileLocked`), so a share, a maintenance pass, a tap on "Retry now", "Remove", "Clear" and a pairing
/// change take turns. Across processes (the app and its share extension) the outbox file is coordinated row by row: a
/// `sending` row is only taken over once it is stale, and an attempt only updates rows the outbox still holds, so a
/// row removed meanwhile never comes back (only `send` adds rows).
public final class ShareSender {
    public let pairing: Pairing
    public let keys: ShareKeys
    public let outbox: OutboxStore
    public let relay: RelayClient
    public var from: String
    public var app: String
    public var chunkSize = DLS.chunk
    /// The clock (tests move it).
    public var now: () -> Date = Date.init

    public init(pairing: Pairing, outbox: OutboxStore, from: String = "", app: String = "", session: URLSession? = nil) throws {
        self.pairing = pairing
        keys = pairing.keys
        self.outbox = outbox
        self.from = from
        self.app = app
        relay = try RelayClient(relay: pairing.relay, session: session)
    }

    // MARK: Share

    /// Shares one item now and returns its outbox row. Throws ShareError for bad input, with nothing stored: not a web
    /// address, over 9 MB ("Too big to send. Files can be up to 9 MB; …"), or no room to keep its copy ("This device
    /// is out of space, …"). Relay failures do not throw: they leave the row `failed` with its `errorCode`.
    @discardableResult
    public func send(_ item: ItemInput, compress: Bool? = nil) async throws -> OutboxRow {
        try await locked { try await self.sendUnlocked(item, compress: compress) }
    }

    private func sendUnlocked(_ item: ItemInput, compress: Bool?) async throws -> OutboxRow {
        var input = item
        if input.from == nil { input.from = from }
        if input.app == nil { input.app = app }
        let prepared = try ItemBuilder.prepare(input, compress: compress)
        let h = prepared.header
        let t = now()
        let row = OutboxRow(id: h.id, kind: h.kind, title: h.title ?? "", url: h.url ?? "", name: h.name ?? "",
                            mime: h.mime ?? "", size: h.size ?? 0, header: h, created: t, status: .sending,
                            attachment: prepared.hasAttachment(chunkSize: chunkSize), hasBody: h.kind != .url,
                            attemptStarted: t)
        if row.hasBody {
            do {
                try outbox.writeBody(row.id, prepared.encoded)
            } catch {
                throw ShareError.outOfSpace
            }
        }
        outbox.save(row)
        return await attempt(row, prepared).row
    }

    // MARK: One attempt

    /// Publishes the frames in part order and records the outcome (CHANGES-v1.1 2.4 `attempt`). Stops without
    /// publishing more when the row was removed meanwhile (by another process: in this one, removing waits for the
    /// lock) or delivered meanwhile; the removed row is not saved again.
    private func attempt(_ start: OutboxRow, _ prepared: PreparedItem) async -> (row: OutboxRow, error: ShareError?) {
        var row = start
        row.status = .sending
        row.attemptStarted = now()
        guard let begun = persist(row) else { return (row, nil) }
        row = begun
        if row.status == .delivered { return (row, nil) }
        var failure: ShareError?
        do {
            let n = prepared.partCount(chunkSize: chunkSize)
            for i in 0..<n {
                let frame = try prepared.frame(part: i, keys: keys, chunkSize: chunkSize)
                try await relay.publish(topic: keys.inboxTopic, frame: frame)
                row.attemptStarted = now() // progress: `sending` is stale 15 minutes after this
                guard let saved = persist(row) else { return (row, nil) }
                row = saved
                if row.status == .delivered { return (row, nil) }
            }
        } catch let e as ShareError {
            failure = e
        } catch {
            failure = ShareError("network", error.localizedDescription)
        }
        if let failure {
            let code = ["network", "full", "refused"].contains(failure.code) ? failure.code : "network"
            row.status = .failed
            row.errorCode = code
            row.attempts += 1
            row.slowFails = (code == "full" || code == "refused") ? row.slowFails + 1 : 0
            if row.slowFails >= DLS.slowFailLimit { row.status = .expired }
            row.error = failure.message
        } else {
            row.status = .sent
            row.errorCode = ""
            row.attempts = 0
            row.slowFails = 0
            row.error = ""
        }
        row.lastPublish = now()
        return (persist(row) ?? row, failure)
    }

    /// Updates a row the outbox still holds; only `send` adds one. A row removed meanwhile ("Remove", "Clear", a
    /// pairing with another secret, perhaps in another process) is not brought back: nil. A row delivered meanwhile
    /// (an ack read by another process) wins: the stored one is returned.
    private func persist(_ row: OutboxRow) -> OutboxRow? {
        outbox.update { state -> OutboxRow? in
            guard let i = state.rows.firstIndex(where: { $0.id == row.id }) else { return nil }
            if state.rows[i].status == .delivered { return state.rows[i] }
            state.rows[i] = row
            return row
        }
    }

    /// Ends a row without publishing: `expired` with `errorCode`, optionally dropping its stored content.
    private func end(_ start: OutboxRow, _ errorCode: String, dropContent: Bool) -> OutboxRow {
        var row = start
        row.status = .expired
        row.errorCode = errorCode
        if dropContent { row.hasBody = false }
        row = persist(row) ?? row
        if dropContent { outbox.removeBodyFile(row.id) }
        return row
    }

    /// Re-sends a row from its stored content, or ends it (no content: `gone`; over 9 MB, a row saved by 1.0:
    /// `too-large`, and its content is dropped).
    private func attemptStored(_ start: OutboxRow) async -> (row: OutboxRow, error: ShareError?, attempted: Bool) {
        var row = start
        var encoded = Data()
        if row.kind != .url {
            guard row.hasBody, let body = outbox.readBody(row.id) else { return (end(row, "gone", dropContent: false), nil, false) }
            encoded = body
        }
        if row.size > DLS.maxItem { return (end(row, "too-large", dropContent: true), nil, false) }
        let prepared = PreparedItem(header: row.header, encoded: encoded)
        row.attachment = prepared.hasAttachment(chunkSize: chunkSize)
        let r = await attempt(row, prepared)
        return (r.row, r.error, true)
    }

    /// Whether a row's next try is due at `t` (CHANGES-v1.1 2.4 "due when"). Every wait counts from `lastPublish`.
    func isDue(_ row: OutboxRow, at t: Date) -> Bool {
        switch row.status {
        case .sending:
            return t.timeIntervalSince(row.attemptStarted ?? row.lastPublish ?? row.created) >= DLS.sendingStale
        case .sent:
            guard let last = row.lastPublish else { return true }
            if !row.attachment { return t.timeIntervalSince(last) >= DLS.resendMessage }
            let fast = last.timeIntervalSince(row.created) < DLS.resendFastWindow
            return t.timeIntervalSince(last) >= (fast ? DLS.attachmentWait : DLS.resendSlow)
        case .failed:
            guard let last = row.lastPublish else { return true }
            if row.errorCode == "full" || row.errorCode == "refused" {
                return t.timeIntervalSince(last) >= DLS.attachmentWait
            }
            return t.timeIntervalSince(last) >= 60 * min(60, pow(2, Double(min(row.attempts, 30))))
        case .delivered, .expired:
            return false
        }
    }

    // MARK: Acks

    /// Reads the ack topic and marks acknowledged rows delivered (their content is dropped). Returns how many rows
    /// became delivered. Throws when the poll fails.
    @discardableResult
    public func checkAcks() async throws -> Int {
        try await locked { try await self.checkAcksUnlocked() }
    }

    private func checkAcksUnlocked() async throws -> Int {
        let state = outbox.load()
        let previous = state.ackTopic == keys.ackTopic ? state.ackSince : nil
        let entries = try await relay.poll(topic: keys.ackTopic, since: previous.map { String($0) } ?? "all")
        var acked = Set<String>()
        var newest = 0
        var held = Int.max
        for m in entries {
            newest = max(newest, m.time)
            if m.outcome == .retry { held = min(held, m.time) }
            guard m.outcome == .frame, let frame = m.frame, let opened = try? Frame.open(keys: keys, purpose: .ack, frame: frame),
                  let ids = AckHeader.ids(in: opened.header) else { continue }
            acked.formUnion(ids)
        }
        let when = now()
        let delivered: [String] = outbox.update { state in
            if !entries.isEmpty {
                // PROTOCOL 3.2: 30 minutes before the newest time, or before the earliest download to retry; a cursor
                // never moves backwards when nothing is held.
                let c = max(0, min(newest, held) - DLS.cursorOverlap)
                if held == Int.max, let previous, previous > c {
                    state.ackSince = previous
                } else {
                    state.ackSince = c
                }
                state.ackTopic = keys.ackTopic
            }
            var ids: [String] = []
            for i in state.rows.indices where state.rows[i].status != .delivered && acked.contains(state.rows[i].id) {
                state.rows[i].status = .delivered
                state.rows[i].delivered = when
                state.rows[i].errorCode = ""
                state.rows[i].error = ""
                state.rows[i].hasBody = false
                ids.append(state.rows[i].id)
            }
            return ids
        }
        delivered.forEach(outbox.removeBodyFile)
        return delivered.count
    }

    // MARK: Re-sends

    /// One re-send pass, oldest row first (PROTOCOL 3.3 steps 3-4): expires week-old rows, drops expired rows' content
    /// 14 days after the share, re-sends rows that are due. After a 429 it publishes nothing more; after a 413 no
    /// item with an attachment frame. Returns the rows it attempted.
    @discardableResult
    public func resendDue() async -> [OutboxRow] {
        await locked { await self.resendDueUnlocked() }
    }

    private func resendDueUnlocked() async -> [OutboxRow] {
        var stopAll = false
        var stopAttachments = false
        var out: [OutboxRow] = []
        let ids = outbox.load().rows.sorted { $0.created < $1.created }.map(\.id)
        for id in ids {
            guard var row = outbox.row(id) else { continue }
            let t = now()
            switch row.status {
            case .delivered:
                continue
            case .expired:
                if row.hasBody && t.timeIntervalSince(row.created) > DLS.contentKeep {
                    row.hasBody = false
                    _ = persist(row)
                    outbox.removeBodyFile(row.id)
                }
                continue
            default:
                break
            }
            if t.timeIntervalSince(row.created) > DLS.outboxExpiry {
                row.status = .expired
                row.errorCode = ""
                _ = persist(row)
                continue
            }
            if !isDue(row, at: t) { continue }
            if stopAll || (stopAttachments && row.attachment) { continue }
            let r = await attemptStored(row)
            if r.attempted { out.append(r.row) }
            if r.error?.status == 429 {
                stopAll = true
            } else if r.error?.code == "full" {
                stopAttachments = true
            }
        }
        return out
    }

    /// "Retry now" (a failed row) and "Try again" (an expired row with errorCode "", "full" or "refused"): publishes
    /// it again with the same id and header (`sent` included); "Try again" starts its 7 days over. Any other row is
    /// left as it is (a sending, sent or delivered row is never uploaded again by a tap). Returns the row, or nil.
    @discardableResult
    public func retry(_ id: String) async -> OutboxRow? {
        await locked { await self.retryUnlocked(id) }
    }

    private func retryUnlocked(_ id: String) async -> OutboxRow? {
        guard var row = outbox.row(id) else { return nil }
        if row.status == .failed { return await attemptStored(row).row }
        if row.status == .expired && ["", "full", "refused"].contains(row.errorCode) {
            row.created = now()
            row.attempts = 0
            row.slowFails = 0
            row.errorCode = ""
            return await attemptStored(row).row
        }
        return row
    }

    /// One maintenance pass: acks (errors ignored: offline still re-sends), then re-sends. Call on launch, after a
    /// share, from timers and background refresh.
    @discardableResult
    public func tick() async -> (delivered: Int, resent: Int) {
        await locked {
            let delivered = (try? await self.checkAcksUnlocked()) ?? 0
            let resent = await self.resendDueUnlocked()
            return (delivered, resent.count)
        }
    }

    /// Whether any row still waits for publishing or an ack (worth polling for). Reads the outbox.
    public var hasPending: Bool { outbox.load().rows.contains(where: \.isPending) }

    // MARK: Lock

    private func locked<T>(_ body: () async throws -> T) async rethrows -> T {
        try await outbox.whileLocked(body)
    }
}

/// One async lock per outbox directory in this process (CHANGES-v1.1 note a: the library serialises). Senders,
/// "Remove", "Clear" and pairing changes take it (`OutboxStore.whileLocked`); waiters get it in the order they asked.
actor OutboxLock {
    private static let registry = NSLock()
    private static var locks: [String: OutboxLock] = [:]

    static func lock(for directory: URL) -> OutboxLock {
        registry.lock()
        defer { registry.unlock() }
        let key = directory.standardizedFileURL.path
        if let l = locks[key] { return l }
        let l = OutboxLock()
        locks[key] = l
        return l
    }

    private var held = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        if !held {
            held = true
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        if waiters.isEmpty {
            held = false
        } else {
            waiters.removeFirst().resume()
        }
    }
}
