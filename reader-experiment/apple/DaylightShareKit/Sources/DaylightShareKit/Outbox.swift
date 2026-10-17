import Foundation

/// One shared item in the outbox / history (PROTOCOL 3.3).
public struct OutboxRow: Codable, Identifiable, Equatable {
    public enum Status: String, Codable {
        /// Being published (or the app was stopped while publishing; it is published again).
        case sending
        /// The relay has it; waiting for the Daylight's ack.
        case sent
        /// The Daylight acknowledged it.
        case delivered
        /// Publishing failed; retried with backoff.
        case failed
        /// Not delivered within 7 days; "Try again" publishes it once more.
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
    public var lastPublish: Date?
    /// Whether any frame went as an attachment (re-send after 150 min rather than 11 h).
    public var attachment: Bool
    public var attempts: Int
    public var error: String
    public var delivered: Date?
    /// The encoded body is kept in the outbox directory until delivered (or 30 days after an expiry).
    public var hasBody: Bool
    /// When the current publish attempt started (a row stays `sending` if the process was stopped mid-way).
    public var attemptStarted: Date?

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

    /// Whether "Retry" / "Try again" makes sense.
    public var canRetry: Bool { status == .failed || status == .expired }
}

/// The outbox file (`outbox.json`) and bodies (`outbox/<id>.bin`) in the shared directory. Every change is a
/// coordinated read-modify-write, so the app and its extensions can use it at the same time.
public final class OutboxStore {
    public struct State: Codable {
        public var rows: [OutboxRow] = []
        /// Ack topic cursor: Unix seconds (newest ack message time minus 5); nil = "all".
        public var ackSince: Int?
        /// The ack topic the cursor belongs to (a new pairing starts from "all").
        public var ackTopic: String?
    }

    public static let maxRows = 200

    public let directory: URL
    let fileURL: URL
    let bodiesURL: URL
    private let lock = NSLock()

    public init(directory: URL) {
        self.directory = directory
        fileURL = directory.appendingPathComponent("outbox.json")
        bodiesURL = directory.appendingPathComponent("outbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: bodiesURL, withIntermediateDirectories: true)
    }

    public convenience init(store: SharedStore = .shared) {
        self.init(directory: store.directory)
    }

    // MARK: State

    public func load() -> State {
        lock.lock()
        defer { lock.unlock() }
        var state = State()
        coordinate(write: false) { url in state = Self.read(url) }
        return state
    }

    public var rows: [OutboxRow] { load().rows }

    public func row(_ id: String) -> OutboxRow? { load().rows.first { $0.id == id } }

    /// Read-modify-write under a file coordinator (across processes) and a lock (within this one).
    @discardableResult
    public func update<T>(_ change: (inout State) -> T) -> T {
        lock.lock()
        var result: T?
        coordinate(write: true) { url in
            var state = Self.read(url)
            result = change(&state)
            state.rows.sort { $0.created > $1.created }
            if state.rows.count > Self.maxRows {
                for r in state.rows[Self.maxRows...] { removeBodyFile(r.id) }
                state.rows.removeLast(state.rows.count - Self.maxRows)
            }
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

    public func remove(_ id: String) {
        update { state in state.rows.removeAll { $0.id == id } }
        removeBodyFile(id)
    }

    /// Removes delivered and expired rows (and any bodies they still have).
    public func clearFinished() {
        let gone: [String] = update { state in
            let ids = state.rows.filter { $0.status == .delivered || $0.status == .expired }.map(\.id)
            state.rows.removeAll { $0.status == .delivered || $0.status == .expired }
            return ids
        }
        gone.forEach(removeBodyFile)
    }

    /// Removes everything (unpairing).
    public func removeAll() {
        update { state in state = State() }
        try? FileManager.default.removeItem(at: bodiesURL)
        try? FileManager.default.createDirectory(at: bodiesURL, withIntermediateDirectories: true)
    }

    // MARK: Bodies

    func bodyURL(_ id: String) -> URL { bodiesURL.appendingPathComponent("\(id).bin") }

    public func writeBody(_ id: String, _ data: Data) throws {
        try FileManager.default.createDirectory(at: bodiesURL, withIntermediateDirectories: true)
        try data.write(to: bodyURL(id), options: .atomic)
    }

    /// The stored encoded body, memory-mapped.
    public func readBody(_ id: String) -> Data? {
        try? Data(contentsOf: bodyURL(id), options: .alwaysMapped)
    }

    public func removeBodyFile(_ id: String) {
        try? FileManager.default.removeItem(at: bodyURL(id))
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
