import Foundation

/// Setup check's activity log (LAB-PLAN F26): the last 200 events, `{time, type, id8, kind, status, http}` and nothing
/// else (no title, name, URL or `from`), in `lab-activity.json` beside the outbox, written with Lab on only. It belongs
/// to the pairing, as the JS keeps it under `lab/`: a pairing with another secret removes it with the outbox
/// (`OutboxStore.removeAll`). Every call touches storage: off the main thread.
public final class ActivityLog {
    public static let fileName = "lab-activity.json"

    let file: CoordinatedFile
    /// The clock (ms since 1970); tests move it.
    public var now: () -> Int64

    public init(file url: URL, now: @escaping () -> Int64 = LabLedger.systemNow) {
        file = CoordinatedFile(url: url, what: "lab activity")
        self.now = now
    }

    public convenience init(outbox: OutboxStore, now: @escaping () -> Int64 = LabLedger.systemNow) {
        self.init(file: outbox.directory.appendingPathComponent(Self.fileName), now: now)
    }

    public convenience init(store: SharedStore = .shared) {
        self.init(outbox: OutboxStore(store: store))
    }

    struct Stored: Codable {
        var events: [SetupCheck.ActivityEvent]
    }

    /// The events, oldest first.
    public var events: [SetupCheck.ActivityEvent] {
        guard let data = file.read(), let s = try? JSONDecoder().decode(Stored.self, from: data) else { return [] }
        return s.events
    }

    /// The log as Setup check shows it: one line per event, oldest first (`ActivityEvent.line`).
    public var lines: [String] { events.map(\.line) }

    /// Appends an event, keeping the last 200.
    public func add(_ event: SetupCheck.ActivityEvent) {
        file.update { data -> (write: Data?, result: Void) in
            let old = data.flatMap { try? JSONDecoder().decode(Stored.self, from: $0) }?.events ?? []
            let log = SetupCheck.appendActivity(old, event)
            return (try? JSONEncoder().encode(Stored(events: log)), ())
        }
    }

    /// Appends an event about something other than a row ("poll-error", "flush"): its type, status and HTTP status.
    public func add(type: String, id: String = "", kind: String = "", status: String = "", http: Int = 0) {
        add(SetupCheck.ActivityEvent(time: now(), type: type, id: id, kind: kind, status: status, http: http))
    }

    /// Appends an event about an outbox row: its kind, its status ("failed/full") and its `http`, so the log shows why a
    /// send failed and not only that it did.
    public func add(type: String, row: OutboxRow) {
        add(SetupCheck.ActivityEvent(time: now(), type: type, row: row))
    }

    /// Appends one event per row (a pass's rows: "resend", "flush").
    public func add(type: String, rows: [OutboxRow]) {
        guard !rows.isEmpty else { return }
        let t = now()
        file.update { data -> (write: Data?, result: Void) in
            var log = data.flatMap { try? JSONDecoder().decode(Stored.self, from: $0) }?.events ?? []
            for r in rows { log = SetupCheck.appendActivity(log, SetupCheck.ActivityEvent(time: t, type: type, row: r)) }
            return (try? JSONEncoder().encode(Stored(events: log)), ())
        }
    }

    public func clear() {
        file.remove()
    }
}
