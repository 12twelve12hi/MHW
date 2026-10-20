import Foundation

/// Records storage access (the pairing and settings in UserDefaults, the outbox files) made on the main thread.
///
/// The apps never touch storage on the main thread: on macOS 15 an App Group container can block until someone
/// answers a privacy prompt (the 1.0 Mac app hung at launch that way), and any disk read can be slow. The app model
/// does every read and write on a background queue; this records anything that slips through, so tests
/// (`StorageResolutionTests`) and the Mac app's CI smoke test (through `-DLSStatusDump`) can require none.
public enum StorageAudit {
    private static let lock = NSLock()
    private static var accesses: [String] = []

    /// Called by every storage read and write in the kit.
    static func note(_ what: String) {
        guard Thread.isMainThread else { return }
        lock.lock()
        defer { lock.unlock() }
        if accesses.count < 100 { accesses.append(what) }
    }

    /// The storage accesses made on the main thread so far in this process (at most 100), oldest first.
    public static var mainThreadAccesses: [String] {
        lock.lock()
        defer { lock.unlock() }
        return accesses
    }

    /// Forgets what was recorded (tests).
    public static func reset() {
        lock.lock()
        defer { lock.unlock() }
        accesses = []
    }
}
