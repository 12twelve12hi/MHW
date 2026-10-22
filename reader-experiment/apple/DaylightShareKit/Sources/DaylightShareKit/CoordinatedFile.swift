import Foundation

/// A small JSON file that the app and its extensions may read and write at the same time (the Lab ledger's `lab.json`,
/// the Daylight server's `server.json`, next to the outbox): every change is a read-modify-write under a file
/// coordinator (across processes) and a lock per file (within this one), written atomically, as `OutboxStore` does.
/// Every call touches storage: make them off the main thread (`StorageAudit` records any made on it).
final class CoordinatedFile {
    let url: URL
    private let lock: NSLock
    private let what: String

    private static let registry = NSLock()
    private static var locks: [String: NSLock] = [:]

    /// One lock per file path in this process, shared by every object on that file.
    static func lock(for url: URL) -> NSLock {
        registry.lock()
        defer { registry.unlock() }
        let key = url.standardizedFileURL.path
        if let l = locks[key] { return l }
        let l = NSLock()
        locks[key] = l
        return l
    }

    init(url: URL, what: String) {
        self.url = url
        self.what = what
        lock = Self.lock(for: url)
    }

    /// The file's bytes, or nil when there is none.
    func read() -> Data? {
        StorageAudit.note("\(what) read")
        lock.lock()
        defer { lock.unlock() }
        var data: Data?
        coordinate(write: false) { data = try? Data(contentsOf: $0) }
        return data
    }

    /// Reads the file, lets `change` decide what to write (nil: leave the file as it is), and writes that atomically.
    /// Returns `change`'s result.
    @discardableResult
    func update<T>(_ change: (Data?) -> (write: Data?, result: T)) -> T {
        StorageAudit.note("\(what) write")
        lock.lock()
        defer { lock.unlock() }
        var result: T?
        coordinate(write: true) { u in
            let r = change(try? Data(contentsOf: u))
            if let data = r.write {
                try? FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: u, options: .atomic)
            }
            result = r.result
        }
        return result!
    }

    /// Deletes the file.
    func remove() {
        StorageAudit.note("\(what) write")
        lock.lock()
        defer { lock.unlock() }
        coordinate(write: true) { try? FileManager.default.removeItem(at: $0) }
    }

    private func coordinate(write: Bool, _ body: (URL) -> Void) {
        #if canImport(ObjectiveC)
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var error: NSError?
        var ran = false
        if write {
            coordinator.coordinate(writingItemAt: url, options: [], error: &error) { u in
                ran = true
                body(u)
            }
        } else {
            coordinator.coordinate(readingItemAt: url, options: [], error: &error) { u in
                ran = true
                body(u)
            }
        }
        if !ran { body(url) }
        #else
        body(url)
        #endif
    }
}
