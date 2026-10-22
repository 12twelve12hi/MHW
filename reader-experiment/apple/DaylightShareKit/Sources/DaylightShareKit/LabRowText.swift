import Foundation

/// A history row as the Lab timeline shows it (LAB-PLAN 2.5; the JS `describeLabRow`; vectors > labRowText). With Lab
/// off, or for a row the Inbox has said nothing about, it is exactly v1.1's `RowText`.
///
/// What a row shows: every row its title and `label`; the `sentence` and `stepLine` on the newest row and on every row
/// that is not `isFinal`; elsewhere in the row's details. The accessibility label is `a11yLabel` ("{label}. {sentence}")
/// whether the sentence shows or not; the step line is hidden from screen readers.
public struct LabRowText: Equatable, Sendable {
    public let label: String
    public let sentence: String?
    public let action: RowText.Action?
    /// "Sent ✓ · On your Daylight ✓ · In the Reader …"; nil for v1.1 rows (rules 1 and 4).
    public let stepLine: String?
    /// True for `reader`, `queued` and `handed`: the row needs nothing more.
    public let isFinal: Bool

    /// What the row's state is read against.
    public struct Context {
        /// This app's Lab switch.
        public var lab: Bool
        /// The ledger's `inboxLab`.
        public var inboxLab: Bool
        /// The ledger's capabilities (nil: `inboxLab` alone decides).
        public var caps: [String]?
        /// The ledger's state token for this row (`LabLedger.Entry.s`), or nil.
        public var state: String?
        /// false when this device is offline; nil when not known.
        public var online: Bool?

        public init(lab: Bool, inboxLab: Bool = false, caps: [String]? = nil, state: String? = nil, online: Bool? = nil) {
            self.lab = lab
            self.inboxLab = inboxLab
            self.caps = caps
            self.state = state
            self.online = online
        }

        /// From a ledger snapshot, for one row.
        public init(lab: Bool, ledger: LabLedger.Snapshot, rowID: String, online: Bool? = nil) {
            self.init(lab: lab, inboxLab: ledger.inboxLab, caps: ledger.caps, state: ledger.state(rowID)?.s, online: online)
        }
    }

    public init(label: String, sentence: String?, action: RowText.Action?, stepLine: String?, isFinal: Bool) {
        self.label = label
        self.sentence = sentence
        self.action = action
        self.stepLine = stepLine
        self.isFinal = isFinal
    }

    public init(row: OutboxRow, now: Date = Date(), ctx: Context) {
        self = Self.describe(status: row.status, errorCode: row.errorCode, kind: row.kind, size: row.size, created: row.created,
                             now: now, ctx: ctx)
    }

    /// The accessibility label (2.5): "{label}. {sentence}", or the label alone; never the step line.
    public var a11yLabel: String {
        guard let sentence else { return label }
        return "\(label). \(sentence)"
    }

    /// The button's words: "Retry now", "Try again", or nil.
    public var buttonTitle: String? { RowText(label: label, sentence: sentence, action: action).buttonTitle }

    // MARK: The rules (2.5), in order

    static func step(_ name: String, _ mark: String?) -> String {
        guard let mark else { return name }
        return "\(name) \(LabText["marks.\(mark)"])"
    }

    /// The step line: marks are "done" ✓, "going" …, "stopped" !, or nil (not reached yet).
    static func stepLine(_ sent: String?, _ daylight: String?, _ reader: String?, readerName: String? = nil) -> String {
        [step(LabText["steps.sent"], sent), step(LabText["steps.daylight"], daylight),
         step(readerName ?? LabText["steps.reader"], reader)].joined(separator: LabText["stepJoin"])
    }

    static func row(_ key: String, _ line: String, final: Bool = false) -> LabRowText {
        LabRowText(label: LabText["rows.\(key).label"], sentence: LabText["rows.\(key).sentence"], action: nil, stepLine: line,
                   isFinal: final)
    }

    public static func describe(status: OutboxRow.Status, errorCode: String, kind: ItemKind, size: Int, created: Date,
                                now: Date, ctx: Context) -> LabRowText {
        let v11 = RowText(status: status, errorCode: errorCode, size: size, created: created, now: now)
        func plain(_ line: String?) -> LabRowText {
            LabRowText(label: v11.label, sentence: v11.sentence, action: v11.action, stepLine: line, isFinal: false)
        }
        // 1. Lab off: v1.1, no steps.
        guard ctx.lab else { return plain(nil) }
        // 2. Offline, and sending or failed for the network: waiting for connection.
        if ctx.online == false && (status == .sending || (status == .failed && errorCode == "network")) {
            return row("offline", stepLine("going", nil, nil))
        }
        // 3. Not delivered: v1.1, with steps.
        switch status {
        case .sending: return plain(stepLine("going", nil, nil))
        case .failed, .expired: return plain(stepLine("stopped", nil, nil))
        case .sent: return plain(stepLine("done", "going", nil))
        case .delivered: break
        }
        // 4. Delivered, and the Inbox is not Lab (or does not send states): v1.1 exactly.
        guard ctx.inboxLab, ctx.caps.map({ $0.contains(Lab.Caps.st) }) ?? true else { return plain(nil) }
        // 5. Delivered by a Lab Inbox: the state's row.
        switch ctx.state ?? "" {
        case "waiting": return row("waiting", stepLine("done", "done", "going"))
        case "held": return row("held", stepLine("done", "done", "going"))
        case "inbox": return row("inbox", stepLine("done", "done", "stopped"))
        case "failed": return row("failed", stepLine("done", "done", "stopped"))
        case "handed":
            return row(kind == .file ? "handedFile" : "handedLink",
                       stepLine("done", "done", nil, readerName: LabText["steps.handed"]), final: true)
        case "queued": return row("queued", stepLine("done", "done", "done"), final: true)
        case "reader": return row("reader", stepLine("done", "done", "done"), final: true)
        default: return row("delivered", stepLine("done", "done", "going"))
        }
    }

    /// Faster checks (2.5): true while a delivered row from the last 10 minutes has no settled state, so a visible app
    /// reads the ack topic every `Lab.fastCheckMs`.
    public static func wantsFastChecks(_ rows: [OutboxRow], now: Date = Date(), ledger: LabLedger.Snapshot) -> Bool {
        rows.contains { r in
            guard r.status == .delivered, let d = r.delivered else { return false }
            return now.timeIntervalSince(d) * 1000 <= Double(Lab.fastCheckWindowMs)
                && !Lab.settledStates.contains(ledger.state(r.id)?.s ?? "")
        }
    }
}

/// The Lab switch (LAB-PLAN 1.2): one reading for the UI and background code, on by default.
public enum LabSettings {
    /// The switch as this process reads it: the stored value once storage is settled; while `SharedStore` is still
    /// resolving, true (views update once storage settles, on `.daylightShareChanged`). Touches storage once settled:
    /// off the main thread.
    public static func isOn(store: SharedStore = .shared) -> Bool {
        store.isReady ? store.lab : true
    }

    /// Turns Lab on or off (posts the change, so the app and its extensions agree). Touches storage.
    public static func setOn(_ on: Bool, store: SharedStore = .shared) {
        store.lab = on
    }

    /// The first start of a build with Lab writes lab = true when the key is missing (1.2); a stored value stays.
    /// Touches storage.
    public static func ensureDefault(store: SharedStore = .shared) {
        if !store.labIsStored { store.lab = true }
    }

    /// The test hook `-DLSLab 0|1` (LAB-PLAN 1.7): true or false when it is given, else nil.
    public static func launchValue(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool? {
        guard let i = arguments.firstIndex(of: "-DLSLab"), i + 1 < arguments.count else { return nil }
        switch arguments[i + 1].lowercased() {
        case "1", "yes", "true", "on": return true
        case "0", "no", "false", "off": return false
        default: return nil
        }
    }
}
