import Foundation

/// One shared item in the outbox / history (PROTOCOL 3.3; the row fields of CHANGES-v1.1 2.4).
public struct OutboxRow: Codable, Identifiable, Equatable {
    public enum Status: String, Codable {
        /// Being published (or the app was stopped while publishing: taken over 15 minutes after its last progress).
        case sending
        /// The relay has it; waiting for the Daylight's ack.
        case sent
        /// The Daylight acknowledged it.
        case delivered
        /// The last attempt failed (`errorCode` says how); it is tried again by itself.
        case failed
        /// Not delivered within 7 days, or given up (`errorCode`); "Try again" starts over where `RowText` offers it.
        case expired
    }

    public var id: String
    public var kind: ItemKind
    public var title: String
    public var url: String
    public var name: String
    public var mime: String
    public var size: Int
    /// The full header (part 0, without part/parts), so a re-send repeats it exactly.
    public var header: ItemHeader
    /// When it was first shared (or "Try again" pressed); expiry counts from here.
    public var created: Date
    public var status: Status
    /// When the last attempt ended; every wait counts from here.
    public var lastPublish: Date?
    /// Whether a frame goes as an attachment (re-sent on the attachment schedule; skipped in a pass after a 413).
    public var attachment: Bool
    /// Failed attempts since the last success (the network backoff).
    public var attempts: Int
    /// Technical detail for logs ("HTTP 503"); never shown. Show `RowText` instead.
    public var error: String
    public var delivered: Date?
    /// The encoded body is kept in the outbox directory until delivered, removed, evicted, or 14 days after `created`.
    public var hasBody: Bool
    /// When the current attempt started or last made progress (a frame accepted).
    public var attemptStarted: Date?
    /// For `failed` and `expired`: "" | "network" | "full" | "refused" | "too-large" | "gone".
    public var errorCode: String
    /// `full`/`refused` failures in a row; the third ends the row as `expired`.
    public var slowFails: Int
    /// The HTTP status of the row's last failed publish (Lab, F26's activity log; LAB-PROTOCOL 2.7.1): 413, 429, another
    /// 4xx, or 408 and 5xx after the in-call retries; 0 when that failure had no HTTP answer, and 0 again once a publish
    /// of the row goes or it is delivered. Rows stored without it (1.0, 1.1) read as 0.
    public var http: Int
    /// Share in place (F04, `BackgroundPublisher`): the background attempt this `sending` row waits for (a UUID), the
    /// number of its frames, the parts the relay took so far and when the first of them was taken. nil / 0 / [] for
    /// every other row; any attempt the app makes itself clears them, so a late answer of the old one is ignored.
    public var bgAttempt: String?
    public var bgParts: Int
    public var bgDone: [Int]
    public var bgFirstDone: Date?

    public init(id: String, kind: ItemKind, title: String = "", url: String = "", name: String = "", mime: String = "",
                size: Int = 0, header: ItemHeader, created: Date, status: Status, lastPublish: Date? = nil,
                attachment: Bool = false, attempts: Int = 0, error: String = "", delivered: Date? = nil,
                hasBody: Bool = false, attemptStarted: Date? = nil, errorCode: String = "", slowFails: Int = 0,
                http: Int = 0) {
        self.id = id
        self.kind = kind
        self.title = title
        self.url = url
        self.name = name
        self.mime = mime
        self.size = size
        self.header = header
        self.created = created
        self.status = status
        self.lastPublish = lastPublish
        self.attachment = attachment
        self.attempts = attempts
        self.error = error
        self.delivered = delivered
        self.hasBody = hasBody
        self.attemptStarted = attemptStarted
        self.errorCode = errorCode
        self.slowFails = slowFails
        self.http = http
        bgAttempt = nil
        bgParts = 0
        bgDone = []
        bgFirstDone = nil
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, title, url, name, mime, size, header, created, status, lastPublish, attachment, attempts, error,
             delivered, hasBody, attemptStarted, errorCode, slowFails, http, bgAttempt, bgParts, bgDone, bgFirstDone
    }

    /// Rows saved by 1.0 have no `errorCode` or `slowFails`: they read as "" and 0.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(ItemKind.self, forKey: .kind)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        mime = try c.decodeIfPresent(String.self, forKey: .mime) ?? ""
        size = try c.decodeIfPresent(Int.self, forKey: .size) ?? 0
        header = try c.decode(ItemHeader.self, forKey: .header)
        created = try c.decode(Date.self, forKey: .created)
        status = try c.decode(Status.self, forKey: .status)
        lastPublish = try c.decodeIfPresent(Date.self, forKey: .lastPublish)
        attachment = try c.decodeIfPresent(Bool.self, forKey: .attachment) ?? false
        attempts = try c.decodeIfPresent(Int.self, forKey: .attempts) ?? 0
        error = try c.decodeIfPresent(String.self, forKey: .error) ?? ""
        delivered = try c.decodeIfPresent(Date.self, forKey: .delivered)
        hasBody = try c.decodeIfPresent(Bool.self, forKey: .hasBody) ?? false
        attemptStarted = try c.decodeIfPresent(Date.self, forKey: .attemptStarted)
        errorCode = try c.decodeIfPresent(String.self, forKey: .errorCode) ?? ""
        slowFails = try c.decodeIfPresent(Int.self, forKey: .slowFails) ?? 0
        http = try c.decodeIfPresent(Int.self, forKey: .http) ?? 0
        bgAttempt = try c.decodeIfPresent(String.self, forKey: .bgAttempt)
        bgParts = try c.decodeIfPresent(Int.self, forKey: .bgParts) ?? 0
        bgDone = try c.decodeIfPresent([Int].self, forKey: .bgDone) ?? []
        bgFirstDone = try c.decodeIfPresent(Date.self, forKey: .bgFirstDone)
    }

    /// `sending`, `sent` or `failed`: the outbox keeps it whatever its age, and the app polls for it.
    public var isPending: Bool { status == .sending || status == .sent || status == .failed }

    /// What the history shows.
    public var displayTitle: String {
        if !title.isEmpty { return title }
        if !name.isEmpty { return name }
        if let host = URL(string: url)?.host { return host }
        return url.isEmpty ? "Item" : url
    }

    public var displaySubtitle: String {
        switch kind {
        case .url: return url
        case .page: return url.isEmpty ? "Web page" : url
        case .file: return [name, ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)]
            .filter { !$0.isEmpty }.joined(separator: " · ")
        }
    }
}

/// The outbox file (`outbox.json`), bodies (`outbox/<id>.bin`) and share in place's frame files (`bg/<id>-<part>.body`,
/// `BackgroundPublisher`) in the shared directory. A row that goes takes its body and frame files with it. Every change is a
/// coordinated read-modify-write, so the app and its extensions can use it at the same time. Every method touches
/// storage: call them off the main thread (the apps do; `StorageAudit` records any call made on it).
public final class OutboxStore {
    public struct State: Codable {
        public var rows: [OutboxRow] = []
        /// Ack topic cursor: Unix seconds (PROTOCOL 3.2: 30 minutes before the newest or the earliest held time);
        /// nil = "all".
        public var ackSince: Int?
        /// The ack topic the cursor belongs to (a new pairing starts from "all").
        public var ackTopic: String?
    }

    /// Finished rows kept (pending rows are never dropped).
    public static let maxRows = DLS.outboxMaxRows

    public let directory: URL
    let fileURL: URL
    let bodiesURL: URL
    /// Share in place's frame files (F04: `BackgroundPublisher`, `FrameFileBuilder`).
    public let framesURL: URL
    private let lock = NSLock()

    /// Creates nothing yet: the directories are made on the first write, so creating a store never touches storage.
    public init(directory: URL) {
        self.directory = directory
        fileURL = directory.appendingPathComponent("outbox.json")
        bodiesURL = directory.appendingPathComponent("outbox", isDirectory: true)
        framesURL = directory.appendingPathComponent(BackgroundPublisher.folder, isDirectory: true)
    }

    public convenience init(store: SharedStore = .shared) {
        self.init(directory: store.directory)
    }

    // MARK: State

    public func load() -> State {
        StorageAudit.note("outbox read")
        lock.lock()
        defer { lock.unlock() }
        var state = State()
        coordinate(write: false) { url in state = Self.read(url) }
        return state
    }

    public var rows: [OutboxRow] { load().rows }

    public func row(_ id: String) -> OutboxRow? { load().rows.first { $0.id == id } }

    /// Read-modify-write under a file coordinator (across processes) and a lock (within this one). Every write keeps
    /// every `sending`, `sent` and `failed` row, fills the room up to 200 with the newest `delivered` and `expired`
    /// rows, and drops the stored body (and any frame files) of every row left out (CHANGES-v1.1 2.4, finding 16).
    @discardableResult
    public func update<T>(_ change: (inout State) -> T) -> T {
        StorageAudit.note("outbox write")
        lock.lock()
        var result: T?
        coordinate(write: true) { url in
            var state = Self.read(url)
            result = change(&state)
            state.rows.sort { $0.created > $1.created }
            var room = max(0, Self.maxRows - state.rows.filter(\.isPending).count)
            var kept: [OutboxRow] = []
            for row in state.rows {
                if row.isPending {
                    kept.append(row)
                } else if room > 0 {
                    kept.append(row)
                    room -= 1
                } else {
                    removeItemFiles(row.id)
                }
            }
            state.rows = kept
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if let data = try? JSONEncoder.outbox.encode(state) { try? data.write(to: url, options: .atomic) }
        }
        lock.unlock()
        SharedStore.postChange()
        return result!
    }

    /// Inserts or replaces a row.
    public func save(_ row: OutboxRow) {
        update { state in
            state.rows.removeAll { $0.id == row.id }
            state.rows.append(row)
        }
    }

    // MARK: Removing (under the outbox lock)
    //
    // Removing waits for an attempt in flight in this process (`whileLocked`), as the JS reference's `Sender.remove()`
    // and `applyPairingChange()` do, so an attempt never writes a removed row back. An attempt in another process (the
    // share extension) cannot write it back either: `ShareSender` only updates rows the outbox still holds.

    /// "Remove": the row, its stored body and its frame files. Returns whether there was such a row. A row in a share
    /// in place's background upload also needs its tasks cancelled: `removeRow` returns it for that
    /// (`BackgroundPublisher.cancel`; the apps' `AppModel.delete` does both).
    @discardableResult
    public func remove(_ id: String) async -> Bool {
        await removeRow(id) != nil
    }

    /// "Remove", returning the row that went (nil when there was none).
    public func removeRow(_ id: String) async -> OutboxRow? {
        await whileLocked { removeUnlocked(id) }
    }

    /// "Clear delivered and expired": those rows and any bodies they still have.
    public func clearFinished() async {
        await whileLocked { clearFinishedUnlocked() }
    }

    /// Every row, every stored body and frame file, the ack cursor and the Lab ledger (unpairing, or pairing with another
    /// secret: LAB-PROTOCOL 2.2.6, the JS `applyPairingChange` removing every `lab/*` key). Returns the rows that went
    /// (their background uploads are cancelled by `SharedStore.pair` and `unpair`).
    @discardableResult
    public func removeAll() async -> [OutboxRow] {
        await whileLocked { removeAllUnlocked() }
    }

    @discardableResult
    func removeUnlocked(_ id: String) -> OutboxRow? {
        let found: OutboxRow? = update { state in
            let had = state.rows.first { $0.id == id }
            state.rows.removeAll { $0.id == id }
            return had
        }
        removeItemFiles(id)
        return found
    }

    func clearFinishedUnlocked() {
        let gone: [String] = update { state in
            let ids = state.rows.filter { $0.status == .delivered || $0.status == .expired }.map(\.id)
            state.rows.removeAll { $0.status == .delivered || $0.status == .expired }
            return ids
        }
        gone.forEach(removeItemFiles)
    }

    @discardableResult
    func removeAllUnlocked() -> [OutboxRow] {
        let gone: [OutboxRow] = update { state in
            let rows = state.rows
            state = State()
            return rows
        }
        let fm = FileManager.default
        try? fm.removeItem(at: bodiesURL)
        try? fm.createDirectory(at: bodiesURL, withIntermediateDirectories: true)
        // Share in place's frame files: the old pairing's sealed frames never go out from here again.
        try? fm.removeItem(at: framesURL)
        LabLedger(outbox: self).clear()
        ActivityLog(outbox: self).clear()
        return gone
    }

    /// Runs `body` under the lock every `ShareSender` on this outbox directory holds while it works (in this process):
    /// it waits for an attempt in flight, and no attempt starts until `body` returns. Not reentrant: `body` must not
    /// call a locked method on the same outbox (use the `…Unlocked` ones).
    public func whileLocked<T>(_ body: () async throws -> T) async rethrows -> T {
        let lock = OutboxLock.lock(for: directory)
        await lock.acquire()
        do {
            let value = try await body()
            await lock.release()
            return value
        } catch {
            await lock.release()
            throw error
        }
    }

    // MARK: Bodies

    func bodyURL(_ id: String) -> URL { bodiesURL.appendingPathComponent("\(id).bin") }

    public func writeBody(_ id: String, _ data: Data) throws {
        StorageAudit.note("outbox body write")
        try FileManager.default.createDirectory(at: bodiesURL, withIntermediateDirectories: true)
        try data.write(to: bodyURL(id), options: .atomic)
    }

    /// The stored encoded body (memory-mapped when that is safe), or nil when there is none.
    public func readBody(_ id: String) -> Data? {
        StorageAudit.note("outbox body read")
        return try? Data(contentsOf: bodyURL(id), options: .mappedIfSafe)
    }

    public func removeBodyFile(_ id: String) {
        try? FileManager.default.removeItem(at: bodyURL(id))
    }

    /// A row that goes: its stored body and its frame files (share in place's `bg/<id>-<part>.body`).
    func removeItemFiles(_ id: String) {
        removeBodyFile(id)
        for f in FrameFileBuilder.frameFiles(id: id, in: framesURL) { try? FileManager.default.removeItem(at: f) }
    }

    // MARK: Files

    private static func read(_ url: URL) -> State {
        guard let data = try? Data(contentsOf: url), let s = try? JSONDecoder.outbox.decode(State.self, from: data)
        else { return State() }
        return s
    }

    private func coordinate(write: Bool, _ body: (URL) -> Void) {
        #if canImport(ObjectiveC)
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var error: NSError?
        var ran = false
        if write {
            coordinator.coordinate(writingItemAt: fileURL, options: [], error: &error) { url in
                ran = true
                body(url)
            }
        } else {
            coordinator.coordinate(readingItemAt: fileURL, options: [], error: &error) { url in
                ran = true
                body(url)
            }
        }
        if !ran { body(fileURL) }
        #else
        body(fileURL)
        #endif
    }
}

extension JSONEncoder {
    static var outbox: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }
}

extension JSONDecoder {
    static var outbox: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }
}
