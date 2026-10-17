import Foundation

/// Where the app and its extensions keep the pairing, settings and outbox.
///
/// Normally the App Group `group.com.daylight.share` (so pairing once in the app also pairs the Share and Safari
/// extensions). When the group container is not available (unsigned or ad-hoc builds, or a re-signer that renamed the
/// group) it falls back to the process's own UserDefaults and Application Support: each target then pairs on its own.
public final class SharedStore {
    public static let defaultAppGroup = "group.com.daylight.share"
    public static let shared = SharedStore()

    public let defaults: UserDefaults
    /// Directory for the outbox (created on first use).
    public let directory: URL
    /// The App Group in use, or nil when this process uses its own storage.
    public let appGroup: String?

    public var isShared: Bool { appGroup != nil }

    /// Resolves storage once per process.
    public convenience init() {
        let (group, container) = SharedStore.resolveAppGroup()
        if let group, let container {
            let defaults = UserDefaults(suiteName: group) ?? .standard
            self.init(defaults: defaults, directory: container.appendingPathComponent("Library/Application Support/DaylightShare",
                                                                                      isDirectory: true), appGroup: group)
        } else {
            let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true))
                ?? FileManager.default.temporaryDirectory
            self.init(defaults: .standard, directory: base.appendingPathComponent("DaylightShare", isDirectory: true),
                      appGroup: nil)
        }
    }

    /// For tests: any defaults and directory.
    public init(defaults: UserDefaults, directory: URL, appGroup: String? = nil) {
        self.defaults = defaults
        self.directory = directory
        self.appGroup = appGroup
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    // MARK: Pairing and settings

    private enum Key {
        static let pairing = "dls.pairing"
        static let deviceName = "dls.deviceName"
    }

    public var pairing: Pairing? {
        get {
            guard let data = defaults.data(forKey: Key.pairing) else { return nil }
            return try? JSONDecoder().decode(Pairing.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: Key.pairing)
            } else {
                defaults.removeObject(forKey: Key.pairing)
            }
            SharedStore.postChange()
        }
    }

    /// The name this device sends as `from` ("" = the default for the platform).
    public var deviceName: String {
        get { defaults.string(forKey: Key.deviceName) ?? "" }
        set {
            defaults.set(ShareText.cleanName(newValue), forKey: Key.deviceName)
            SharedStore.postChange()
        }
    }

    // MARK: Change notifications between the app and its extensions

    /// Darwin notification posted after the pairing, settings or outbox change in any process.
    public static let changeNotification = "com.daylight.share.changed"

    public static func postChange() {
        #if canImport(ObjectiveC)
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                                             CFNotificationName(changeNotification as CFString), nil, nil, true)
        #endif
        NotificationCenter.default.post(name: .daylightShareChanged, object: nil)
    }

    #if canImport(ObjectiveC)
    private static var observing = false

    /// Re-posts Darwin change notifications from other processes as `.daylightShareChanged` in this one.
    public static func observeOtherProcesses() {
        guard !observing else { return }
        observing = true
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            DispatchQueue.main.async { NotificationCenter.default.post(name: .daylightShareChanged, object: nil) }
        }, changeNotification as CFString, nil, .deliverImmediately)
    }
    #endif

    // MARK: App Group resolution

    /// Candidates in order: the Info.plist key `DaylightAppGroup`, `group.com.daylight.share`, then the App Groups
    /// in the bundle's embedded provisioning profile (sideloading tools such as AltStore re-sign with a renamed
    /// group). The first container that exists and is writable wins.
    static func resolveAppGroup() -> (String?, URL?) {
        var candidates: [String] = []
        if let g = Bundle.main.object(forInfoDictionaryKey: "DaylightAppGroup") as? String, !g.isEmpty, !g.contains("$(") {
            candidates.append(g)
        }
        candidates.append(defaultAppGroup)
        candidates.append(contentsOf: provisionedAppGroups().filter { $0.lowercased().contains("daylight") })
        candidates.append(contentsOf: provisionedAppGroups())
        var seen = Set<String>()
        for g in candidates where seen.insert(g).inserted {
            #if canImport(ObjectiveC)
            guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) else { continue }
            if isWritable(url) { return (g, url) }
            #endif
        }
        return (nil, nil)
    }

    static func isWritable(_ dir: URL) -> Bool {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let probe = dir.appendingPathComponent(".dls-probe-\(ProcessInfo.processInfo.processIdentifier)")
            try Data("ok".utf8).write(to: probe)
            try? fm.removeItem(at: probe)
            return true
        } catch {
            return false
        }
    }

    /// App Groups listed in `embedded.mobileprovision` (iOS) of this bundle or, from an extension, of its app.
    static func provisionedAppGroups() -> [String] {
        var urls = [Bundle.main.bundleURL.appendingPathComponent("embedded.mobileprovision")]
        // An extension lives in <App>.app/PlugIns/<Ext>.appex.
        let parent = Bundle.main.bundleURL.deletingLastPathComponent()
        if parent.lastPathComponent == "PlugIns" {
            urls.append(parent.deletingLastPathComponent().appendingPathComponent("embedded.mobileprovision"))
        }
        for url in urls {
            guard let data = try? Data(contentsOf: url), let groups = appGroups(inProvisioningProfile: data), !groups.isEmpty
            else { continue }
            return groups
        }
        return []
    }

    /// Reads the plist inside a CMS-signed provisioning profile without verifying it (only used to find a name).
    static func appGroups(inProvisioningProfile data: Data) -> [String]? {
        guard let start = data.range(of: Data("<?xml".utf8)), let end = data.range(of: Data("</plist>".utf8)),
              start.lowerBound < end.upperBound else { return nil }
        let xml = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let plist = try? PropertyListSerialization.propertyList(from: xml, format: nil) as? [String: Any],
              let ent = plist["Entitlements"] as? [String: Any],
              let groups = ent["com.apple.security.application-groups"] as? [String] else { return nil }
        return groups.filter { !$0.contains("*") }
    }
}

extension Notification.Name {
    /// Posted (on the main thread) when the pairing, settings or outbox changed in this or another process.
    public static let daylightShareChanged = Notification.Name("DaylightShareChanged")
}
