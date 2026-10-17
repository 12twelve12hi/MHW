import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The sender side of PROTOCOL 3.3: publish, read acks, re-send, expire. Mirrors the JS reference's `Sender`.
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

    /// Shares one item now and returns its outbox row. Throws ShareError for bad input (not a web address, too
    /// large, …); relay failures do not throw: they leave the row `failed`, to be retried.
    @discardableResult
    public func send(_ item: ItemInput, compress: Bool? = nil) async throws -> OutboxRow {
        var input = item
        if input.from == nil { input.from = from }
        if input.app == nil { input.app = app }
        let prepared = try ItemBuilder.prepare(input, compress: compress)
        let h = prepared.header
        let row = OutboxRow(id: h.id, kind: h.kind, title: h.title ?? "", url: h.url ?? "", name: h.name ?? "",
                            mime: h.mime ?? "", size: h.size ?? 0, header: h, created: now(), status: .sending,
                            lastPublish: nil, attachment: false, attempts: 0, error: "", delivered: nil,
                            hasBody: !prepared.encoded.isEmpty, attemptStarted: now())
        if row.hasBody { try outbox.writeBody(row.id, prepared.encoded) }
        outbox.save(row)
        return await publish(row, prepared)
    }

    /// Publishes every part of a prepared item (sealing one part at a time) and records the outcome.
    private func publish(_ start: OutboxRow, _ prepared: PreparedItem) async -> OutboxRow {
        var attachment = false
        var failure: String?
        do {
            let n = prepared.partCount(chunkSize: chunkSize)
            for i in 0..<n {
                let frame = try prepared.frame(part: i, keys: keys, chunkSize: chunkSize)
                if try await relay.publish(topic: keys.inboxTopic, frame: frame) { attachment = true }
            }
        } catch {
            failure = (error as? ShareError)?.message ?? error.localizedDescription
        }
        let when = now()
        return outbox.update { state -> OutboxRow in
            var row = state.rows.first { $0.id == start.id } ?? start
            if row.status == .delivered { return row } // acked meanwhile (another process)
            row.status = failure == nil ? .sent : .failed
            row.error = failure ?? ""
            row.attachment = attachment || (failure != nil && row.attachment)
            row.lastPublish = when
            row.attempts += 1
            state.rows.removeAll { $0.id == row.id }
            state.rows.append(row)
            return row
        }
    }

    /// Reads the ack topic and marks acknowledged rows delivered. Returns how many rows became delivered.
    @discardableResult
    public func checkAcks() async throws -> Int {
        let state = outbox.load()
        let since = state.ackTopic == keys.ackTopic ? (state.ackSince.map { String($0) } ?? "all") : "all"
        let messages = try await relay.poll(topic: keys.ackTopic, since: since, maxAttachment: 1024 * 1024)
        var acked = Set<String>()
        var maxTime = 0
        for m in messages {
            maxTime = max(maxTime, m.time)
            guard let frame = m.frame, let opened = try? Frame.open(keys: keys, purpose: .ack, frame: frame),
                  let ids = AckHeader.ids(in: opened.header) else { continue }
            acked.formUnion(ids)
        }
        let when = now()
        let delivered: [String] = outbox.update { state in
            if maxTime > 0 {
                state.ackSince = max(0, maxTime - 5)
                state.ackTopic = keys.ackTopic
            }
            var ids: [String] = []
            for i in state.rows.indices where state.rows[i].status != .delivered && acked.contains(state.rows[i].id) {
                state.rows[i].status = .delivered
                state.rows[i].delivered = when
                state.rows[i].error = ""
                state.rows[i].hasBody = false
                ids.append(state.rows[i].id)
            }
            return ids
        }
        delivered.forEach(outbox.removeBodyFile)
        return delivered.count
    }

    /// Re-sends undelivered items whose relay copy is about to expire (or whose publish failed, with backoff) and
    /// expires week-old ones. Returns the rows it published again.
    @discardableResult
    public func resendDue() async -> [OutboxRow] {
        let t = now()
        var due: [String] = []
        var expired: [String] = []
        var purge: [String] = []
        for row in outbox.load().rows {
            if row.status == .expired && row.hasBody && t.timeIntervalSince(row.created) > 30 * 24 * 3600 {
                purge.append(row.id)
            }
            guard row.status != .delivered && row.status != .expired else { continue }
            if t.timeIntervalSince(row.created) > DLS.outboxExpiry {
                expired.append(row.id)
                continue
            }
            let isDue: Bool
            switch row.status {
            case .sending:
                // Another process may be publishing it right now; take over only when that looks abandoned.
                isDue = t.timeIntervalSince(row.attemptStarted ?? row.lastPublish ?? .distantPast) >= 15 * 60
            case .failed:
                isDue = t.timeIntervalSince(row.lastPublish ?? .distantPast) >= 60 * min(60, pow(2, Double(row.attempts)))
            default:
                isDue = t.timeIntervalSince(row.lastPublish ?? .distantPast)
                    >= (row.attachment ? DLS.resendAttachment : DLS.resendMessage)
            }
            if isDue { due.append(row.id) }
        }
        if !expired.isEmpty || !purge.isEmpty {
            outbox.update { state in
                for i in state.rows.indices {
                    if expired.contains(state.rows[i].id) { state.rows[i].status = .expired }
                    if purge.contains(state.rows[i].id) { state.rows[i].hasBody = false }
                }
            }
            purge.forEach(outbox.removeBodyFile)
        }
        var out: [OutboxRow] = []
        for id in due {
            if let r = await retry(id) { out.append(r) }
        }
        return out
    }

    /// Publishes an outbox item again: same id and header, fresh nonces. "Try again" on an expired item restarts
    /// its 7 days (bodies of expired items are kept for 30 days, so a file can still go).
    @discardableResult
    public func retry(_ id: String) async -> OutboxRow? {
        guard var row = outbox.row(id) else { return nil }
        var encoded = Data()
        if row.kind != .url {
            guard let body = outbox.readBody(id) else {
                row.status = .expired
                row.error = "The content is no longer stored; share it again."
                outbox.save(row)
                return row
            }
            encoded = body
        }
        if row.status == .expired { row.created = now() }
        row.status = .sending
        row.attemptStarted = now()
        outbox.save(row)
        return await publish(row, PreparedItem(header: row.header, encoded: encoded))
    }

    /// One maintenance pass: acks, then re-sends. Call on launch, after a share, from timers and background refresh.
    @discardableResult
    public func tick() async -> (delivered: Int, resent: Int) {
        let delivered = (try? await checkAcks()) ?? 0
        let resent = await resendDue()
        return (delivered, resent.count)
    }

    /// Whether any row still waits for publishing or an ack (worth polling for).
    public var hasPending: Bool {
        outbox.load().rows.contains { $0.status == .sending || $0.status == .sent || $0.status == .failed }
    }
}
