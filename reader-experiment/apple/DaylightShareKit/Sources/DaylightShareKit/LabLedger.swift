import Foundation

/// What a sender learns from the ack topic (LAB-PROTOCOL 2.2.6), per publisher: the Inbox's Lab hellos (its level, caps,
/// last poll), when the Daylight was last heard from, and each item's state. It records every ack-topic message that
/// decrypts, whether Lab is on or off (wire it into the sender with `ShareSender(…, onAckHeader: ledger.hook())`), so
/// turning Lab on shows correct states at once.
///
/// Stored in `lab.json` next to the outbox (`OutboxStore.directory`), coordinated like the outbox, as
///   inbox  {android?, reader-lab?, other?: {lab, app, caps, poll (ms, clamped to `at`) | null, live, at (ms)}}
///   heard  the latest relay time (ms) of any ack-topic message that decrypted
///   states {id: {s, t}}
/// A pairing with another secret removes it with the outbox (`SharedStore.pair`, `OutboxStore.removeAll`). Every method
/// touches storage: call them off the main thread.
public final class LabLedger {
    /// The file name next to the outbox.
    public static let fileName = "lab.json"

    /// One publisher's last hello (2.2.6). `poll` is clamped to `at`, the relay time (ms) of its message.
    public struct Publisher: Codable, Equatable, Sendable {
        public var lab: Int
        public var app: String
        public var caps: [String]
        public var poll: Int64?
        public var live: Bool
        public var at: Int64

        public init(lab: Int, app: String, caps: [String], poll: Int64?, live: Bool, at: Int64) {
            self.lab = lab
            self.app = app
            self.caps = caps
            self.poll = poll
            self.live = live
            self.at = at
        }

        /// "android", "reader-lab" or "other".
        public var publisher: String { Lab.publisher(of: app) }
    }

    /// An item's state as the ledger keeps it: token `s` and `t` in Unix seconds.
    public struct Entry: Codable, Equatable, Sendable {
        public var s: String
        public var t: Int64

        public init(s: String, t: Int64) {
            self.s = s
            self.t = t
        }
    }

    /// Everything a screen needs in one read (the JS `snapshot()`).
    public struct Snapshot: Equatable, Sendable {
        /// The publishers heard, in `Lab.publishers` order, by name.
        public let publishers: [(name: String, info: Publisher)]
        /// Some fresh publisher (heard within 36 h) has lab >= 1.
        public let inboxLab: Bool
        /// The union of the caps of those publishers, sorted.
        public let caps: [String]
        /// The later of `heard` and the newest clamped `poll` (ms), or nil.
        public let checkedIn: Int64?
        /// Every item's state; show one only on a row whose status is delivered (`LabRowText` does).
        public let states: [String: Entry]

        public static let empty = Snapshot(publishers: [], inboxLab: false, caps: [], checkedIn: nil, states: [:])

        public func hasCap(_ token: String) -> Bool { caps.contains(token) }
        public func state(_ id: String) -> Entry? { states[id] }
        public func publisher(_ name: String) -> Publisher? { publishers.first { $0.name == name }?.info }

        public static func == (a: Snapshot, b: Snapshot) -> Bool {
            a.publishers.map { $0.name } == b.publishers.map { $0.name } && a.publishers.map { $0.info } == b.publishers.map { $0.info }
                && a.inboxLab == b.inboxLab && a.caps == b.caps && a.checkedIn == b.checkedIn && a.states == b.states
        }
    }

    struct Stored: Codable {
        var inbox: [String: Publisher] = [:]
        var heard: Int64 = 0
        var states: [String: Entry] = [:]
    }

    private let file: CoordinatedFile
    /// The clock, in ms since 1970 (tests set it).
    public var now: () -> Int64

    public init(file url: URL, now: @escaping () -> Int64 = LabLedger.systemNow) {
        file = CoordinatedFile(url: url, what: "lab ledger")
        self.now = now
    }

    /// The ledger of an outbox: `lab.json` in its directory.
    public convenience init(outbox: OutboxStore, now: @escaping () -> Int64 = LabLedger.systemNow) {
        self.init(file: outbox.directory.appendingPathComponent(Self.fileName), now: now)
    }

    public static let systemNow: @Sendable () -> Int64 = { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

    // MARK: Recording

    /// Records one ack-topic header that decrypted, from its exact JSON bytes. `time`: the message's relay time in Unix
    /// seconds (nil: now). A header whose kind is not "ack" is ignored. Never throws on the header's content.
    public func record(headerJSON: Data, time: Int?) {
        record(header: JSONValue.parse(headerJSON), time: time)
    }

    /// Records one parsed ack-topic header (see `record(headerJSON:time:)`).
    public func record(header: JSONValue?, time: Int?) {
        guard let h = header?.object, h["kind"]?.string == "ack" else { return }
        let at = time.map { Int64($0) * 1000 } ?? now()
        let parsed = LabFrame.parse(header)
        file.update { data -> (write: Data?, result: Void) in
            var st = Self.decode(data)
            var changed = false
            if at > st.heard {
                st.heard = at
                changed = true
            }
            if let inbox = parsed.inbox {
                let pub = inbox.publisher
                if st.inbox[pub].map({ at >= $0.at }) ?? true {
                    st.inbox[pub] = Publisher(lab: inbox.lab, app: inbox.app, caps: inbox.caps,
                                              poll: inbox.poll.map { min($0, at) }, live: inbox.live, at: at)
                    changed = true
                }
            }
            var statesChanged = false
            for e in parsed.states {
                let cur = st.states[e.i].map { LabState(i: e.i, s: $0.s, t: $0.t) }
                if Lab.beats(e, cur) {
                    st.states[e.i] = Entry(s: e.s, t: e.t)
                    statesChanged = true
                }
            }
            if statesChanged {
                st.states = Self.bound(st.states, Lab.ledgerStatesHardMax)
                changed = true
            }
            return (changed ? Self.encode(st) : nil, ())
        }
    }

    /// The sender's `onAckHeader` for this ledger (the JS `labHook`).
    public func hook() -> ShareSender.AckHeaderHook {
        { [self] _, meta in record(headerJSON: meta.headerJSON, time: meta.time) }
    }

    // MARK: Reading

    /// -> the ledger as a screen needs it, at `now()`.
    public func snapshot() -> Snapshot {
        Self.snapshot(of: Self.decode(file.read()), now: now())
    }

    static func snapshot(of st: Stored, now: Int64) -> Snapshot {
        let pubs = Lab.publishers.compactMap { name in st.inbox[name].map { (name: name, info: $0) } }
        let fresh = pubs.filter { now - $0.info.at <= Lab.inboxStaleMs && $0.info.lab >= 1 }
        let caps = Array(Set(fresh.flatMap { $0.info.caps })).sorted()
        var checked: Int64? = st.heard > 0 ? st.heard : nil
        for p in pubs {
            if let poll = p.info.poll, checked.map({ poll > $0 }) ?? true { checked = poll }
        }
        return Snapshot(publishers: pubs, inboxLab: !fresh.isEmpty, caps: caps, checkedIn: checked, states: st.states)
    }

    public func publishers() -> [(name: String, info: Publisher)] { snapshot().publishers }
    public func inboxLab() -> Bool { snapshot().inboxLab }
    public func caps() -> [String] { snapshot().caps }
    public func hasCap(_ token: String) -> Bool { caps().contains(token) }
    public func checkedIn() -> Int64? { snapshot().checkedIn }

    /// -> the state of item `id`, or nil. Show it only on rows whose status is delivered.
    public func state(_ id: String) -> Entry? { Self.decode(file.read()).states[id] }

    // MARK: Pruning

    /// Keeps the states of `ids` only (the outbox's ids and the hosted outbox's), at most 200, the latest first.
    public func prune(keeping ids: Set<String>) {
        file.update { data -> (write: Data?, result: Void) in
            guard data != nil else { return (nil, ()) } // nothing recorded yet: nothing to prune
            var st = Self.decode(data)
            let kept = Self.bound(st.states.filter { ids.contains($0.key) }, Lab.ledgerStatesMax)
            guard kept != st.states else { return (nil, ()) }
            st.states = kept
            return (Self.encode(st), ())
        }
    }

    /// Forgets everything (a pairing with another secret removes the file with the outbox anyway).
    public func clear() { file.remove() }

    // MARK: Storage

    static func decode(_ data: Data?) -> Stored {
        guard let data, let st = try? JSONDecoder().decode(Stored.self, from: data) else { return Stored() }
        return st
    }

    static func encode(_ st: Stored) -> Data? {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return try? e.encode(st)
    }

    /// Keeps at most `max` entries, the latest `t` first (ties: the smaller id first).
    static func bound(_ map: [String: Entry], _ max: Int) -> [String: Entry] {
        guard map.count > max else { return map }
        let keep = map.sorted { a, b in a.value.t != b.value.t ? a.value.t > b.value.t : a.key < b.key }.prefix(max)
        return Dictionary(uniqueKeysWithValues: keep.map { ($0.key, $0.value) })
    }
}
