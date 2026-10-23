import Foundation

/// Lab W1's settings on this device, next to the Lab switch in `SharedStore`'s defaults (the App Group's when the app
/// has one, so the app and its share extension agree): the Use switches (6.5 Q5, LAB-PROTOCOL 2.9.6) and each
/// feature's own settings. They belong to this device, like `dls.lab`: never synced, kept by pairing changes and
/// updates (`SharedStore.migrate` moves them into the App Group), kept when Lab or a Use switch is turned off (1.3).
/// Every accessor touches storage: off the main thread.
public struct LabPreferences {
    public let store: SharedStore

    public init(store: SharedStore = .shared) {
        self.store = store
    }

    enum Key {
        /// `dls.labUse.<feature>`: a Use switch (missing = on).
        static func use(_ feature: String) -> String { "dls.labUse.\(feature)" }
        /// F04: "Always show Options before sending" (off by default).
        static let alwaysOptions = "dls.lab.alwaysOptions"
        /// F04: "Tell me when a send fails" (on by default: stored only when turned off or on again).
        static let tellFails = "dls.lab.tellFails"
        /// F04: "Tell me when it’s in my Reader" (off by default).
        static let tellReader = "dls.lab.tellReader"
        /// F09: "Allow quick sends from other apps" (off by default).
        static let quickSends = "dls.lab.quickSends"
        /// F10: "Review before sending" (off by default).
        static let reviewFirst = "dls.lab.reviewFirst"
        /// F03: the "Only the link came through" line was shown on this device (it shows once).
        static let linkOnlyShown = "dls.lab.linkOnlyShown"
        /// F11: "Excerpts wait for a tap on your Daylight for now." was shown on this device (once).
        static let excerptNoteShown = "dls.lab.excerptNoteShown"
        /// F04: a share in place went from the share extension (the app then asks for notification permission once).
        static let shareInPlaceUsed = "dls.lab.shareInPlaceUsed"
        /// F26: the share item sent something with Lab on (Setup check's "Daylight in the share sheet").
        static let shareSheetUsed = "dls.lab.shareSheetUsed"
        /// F26: the id of the last test article, which Setup check follows.
        static let testArticle = "dls.lab.testArticle"
        /// F04: the app has asked for notification permission.
        static let notificationsAsked = "dls.lab.notificationsAsked"
        /// F10: the Send as mode last used per site, newest first: [[host, mode]], at most 500.
        static let sendAs = "dls.lab.sendAs"

        /// Every key, for the move into the App Group (`SharedStore.deviceSettingKeys`).
        static var all: [String] {
            Lab.useFeatures.map(use) + [alwaysOptions, tellFails, tellReader, quickSends, reviewFirst, linkOnlyShown,
                                        excerptNoteShown, shareInPlaceUsed, shareSheetUsed, testArticle, notificationsAsked, sendAs]
        }
    }

    /// The most sites whose Send as mode is remembered (F10: `lab/sendAs/<host>`, the 500 most recent hosts).
    public static let sendAsSites = 500

    private var defaults: UserDefaults { store.defaults }

    private func bool(_ key: String, default value: Bool) -> Bool {
        StorageAudit.note("lab settings read")
        return defaults.object(forKey: key) as? Bool ?? value
    }

    private func set(_ key: String, _ value: Bool) {
        StorageAudit.note("lab settings write")
        defaults.set(value, forKey: key)
        SharedStore.postChange()
    }

    // MARK: Use switches (6.5 Q5)

    /// Every Use switch that is stored (a missing one is on), by feature id.
    public var uses: [String: Bool] {
        StorageAudit.note("lab settings read")
        var out: [String: Bool] = [:]
        for f in Lab.useFeatures { if let v = defaults.object(forKey: Key.use(f)) as? Bool { out[f] = v } }
        return out
    }

    /// A feature's Use switch (on when never set; features without one: true).
    public func use(_ feature: String) -> Bool { bool(Key.use(feature), default: true) }

    public func setUse(_ feature: String, _ on: Bool) {
        guard Lab.useFeatures.contains(feature) else { return }
        set(Key.use(feature), on)
    }

    /// Whether a feature is in use now: Lab on (`LabSettings.isOn`) and its Use switch not off (the JS `labUseOn`).
    public func inUse(_ feature: String) -> Bool {
        LabText.useOn(lab: LabSettings.isOn(store: store), uses: uses, feature: feature)
    }

    // MARK: Feature settings

    /// F04: "Always show Options before sending".
    public var alwaysShowOptions: Bool {
        get { bool(Key.alwaysOptions, default: false) }
        nonmutating set { set(Key.alwaysOptions, newValue) }
    }

    /// F04: "Tell me when a send fails" (on by default).
    public var tellWhenSendFails: Bool {
        get { bool(Key.tellFails, default: true) }
        nonmutating set { set(Key.tellFails, newValue) }
    }

    /// F04: "Tell me when it’s in my Reader" (off by default).
    public var tellWhenInReader: Bool {
        get { bool(Key.tellReader, default: false) }
        nonmutating set { set(Key.tellReader, newValue) }
    }

    /// F09: "Allow quick sends from other apps" (off by default).
    public var allowQuickSends: Bool {
        get { bool(Key.quickSends, default: false) }
        nonmutating set { set(Key.quickSends, newValue) }
    }

    /// F10: "Review before sending" (off by default).
    public var reviewBeforeSending: Bool {
        get { bool(Key.reviewFirst, default: false) }
        nonmutating set { set(Key.reviewFirst, newValue) }
    }

    // MARK: Lines shown once, and what happened once

    /// F03: "Only the link came through …" was shown on this device (Setup check lists it from then on).
    public var linkOnlyShown: Bool {
        get { bool(Key.linkOnlyShown, default: false) }
        nonmutating set { set(Key.linkOnlyShown, newValue) }
    }

    /// F11: the excerpt line was shown on this device.
    public var excerptNoteShown: Bool {
        get { bool(Key.excerptNoteShown, default: false) }
        nonmutating set { set(Key.excerptNoteShown, newValue) }
    }

    /// F04: a share in place went (set by the share extension; the app asks for notifications once after it).
    public var shareInPlaceUsed: Bool {
        get { bool(Key.shareInPlaceUsed, default: false) }
        nonmutating set { set(Key.shareInPlaceUsed, newValue) }
    }

    /// F26: the share item sent something with Lab on (iPhone Setup check: "Daylight in the share sheet", else the steps
    /// to add it from More). Set by the share extension.
    public var shareSheetUsed: Bool {
        get { bool(Key.shareSheetUsed, default: false) }
        nonmutating set { set(Key.shareSheetUsed, newValue) }
    }

    /// F26: the id of the last test article (Setup check follows it to Delivered and In your Reader), or nil.
    public var testArticleID: String? {
        get {
            StorageAudit.note("lab settings read")
            return defaults.string(forKey: Key.testArticle)
        }
        nonmutating set {
            StorageAudit.note("lab settings write")
            defaults.set(newValue, forKey: Key.testArticle)
            SharedStore.postChange()
        }
    }

    /// F04: the app asked for notification permission already.
    public var notificationsAsked: Bool {
        get { bool(Key.notificationsAsked, default: false) }
        nonmutating set { set(Key.notificationsAsked, newValue) }
    }

    /// Whether the app should ask for notification permission now (F04): a share in place went from the share sheet,
    /// it has not asked before, and Lab and Share in place are in use. The app asks, never the extension.
    public var shouldAskForNotifications: Bool { shareInPlaceUsed && !notificationsAsked && inUse("F04") }

    // MARK: Send as, per site (F10)

    /// The Send as mode last used on `host` (lowercased), or nil.
    public func sendAs(host: String) -> String? {
        StorageAudit.note("lab settings read")
        let h = host.lowercased()
        let list = defaults.array(forKey: Key.sendAs) as? [[String]] ?? []
        return list.first { $0.count == 2 && $0[0] == h }?[1]
    }

    /// Remembers `mode` for `host`, as the newest; the 500 most recent sites are kept.
    public func setSendAs(_ mode: String, host: String) {
        StorageAudit.note("lab settings write")
        let h = host.lowercased()
        guard !h.isEmpty else { return }
        var list = (defaults.array(forKey: Key.sendAs) as? [[String]] ?? []).filter { $0.count == 2 && $0[0] != h }
        list.insert([h, mode], at: 0)
        defaults.set(Array(list.prefix(Self.sendAsSites)), forKey: Key.sendAs)
        SharedStore.postChange()
    }
}
