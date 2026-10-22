import Foundation
#if os(macOS)
import Security
#endif

/// Where the app and its extensions keep the pairing, settings and outbox.
///
/// With an App Group, the app and its extensions share them, so pairing once in the app also pairs the Share and
/// Safari extensions. Without one, each process keeps its own in its sandbox: the Share extension then asks for the
/// code once, and the Safari extension's native handler answers `getPairing` with `paired: false`.
///
/// Which App Group (if any) is decided at build time (`DaylightAppGroup` in Info.plist, see Config/Base.xcconfig):
/// iPhone builds use `group.com.daylight.share`; Mac builds use `<TEAMID>.com.daylight.share` when signed with a
/// team, and no App Group at all when ad-hoc signed or unsigned.
///
/// Finding the group's container touches the file system, and that can block: on macOS 15 an app whose signature does
/// not authorise its group gets a "would like to access data from other apps" prompt, and the access waits for the
/// answer. So resolution never runs on the caller's thread. A new store answers at once from this process's own
/// storage, resolves the group on a background queue, and switches to it only if it proves usable within
/// `resolutionTimeout`. Code that writes (pairing, sending) waits for `ready()` first.
public final class SharedStore: @unchecked Sendable {
    public static let defaultAppGroup = "group.com.daylight.share"
    /// How long resolution may take before the process settles on its own storage for this launch.
    public static let resolutionTimeout: TimeInterval = 2
    /// The store the apps and extensions use. A process started with `-DLSTestStorage` (UI tests) gets a fresh,
    /// empty store of its own instead (`testStore`), so tests never see or touch anyone's pairing or history.
    public static let shared: SharedStore = testStore() ?? SharedStore(resolver: .system)

    public enum State: Equatable, CustomStringConvertible {
        /// Looking for the App Group in the background; reads come from this process's own storage meanwhile.
        case resolving
        /// Using the App Group's container (shared with the app and its extensions).
        case shared(group: String)
        /// Using this process's own storage (no App Group in this build, or it was not usable in time).
        case appPrivate(reason: String)

        public var description: String {
            switch self {
            case .resolving: return "resolving"
            case let .shared(group): return "shared (\(group))"
            case let .appPrivate(reason): return "private (\(reason))"
            }
        }
    }

    struct Storage {
        let defaults: UserDefaults
        let directory: URL
        let appGroup: String?
    }

    private let lock = NSLock()
    private var current: Storage
    private var currentState: State
    /// Set once a resolution (or the timeout) has won; later answers are ignored.
    private var settling = false
    private var waiters: [() -> Void] = []
    private let privateStorage: Storage

    /// The defaults in use (the App Group's once resolved, else this process's own).
    public var defaults: UserDefaults { locked { current.defaults } }
    /// Directory for the outbox (created on first use).
    public var directory: URL { locked { current.directory } }
    /// The App Group in use, or nil when this process uses its own storage.
    public var appGroup: String? { locked { current.appGroup } }
    public var isShared: Bool { appGroup != nil }
    public var state: State { locked { currentState } }
    public var isReady: Bool { state != .resolving }

    /// Starts on this process's own storage and resolves the App Group in the background. Never blocks: when the
    /// build declares no App Group it is settled at once, otherwise within `timeout`.
    public init(resolver: AppGroupResolver, timeout: TimeInterval = SharedStore.resolutionTimeout,
                privateDefaults: UserDefaults = .standard, privateDirectory: URL = SharedStore.privateDirectory()) {
        let own = Storage(defaults: privateDefaults, directory: privateDirectory, appGroup: nil)
        privateStorage = own
        current = own
        // Nothing here touches storage (the outbox makes its directory on its first write, off the main thread).
        let declared = resolver.declaredGroups()
        guard !declared.isEmpty else {
            currentState = .appPrivate(reason: "this build has no App Group")
            return
        }
        currentState = .resolving
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            finish(Self.resolve(declared, resolver))
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.finish(.unavailable("the App Group did not answer within \(Self.seconds(timeout))"))
        }
    }

    /// For tests: any defaults and directory, settled at once.
    public init(defaults: UserDefaults, directory: URL, appGroup: String? = nil) {
        let storage = Storage(defaults: defaults, directory: directory, appGroup: appGroup)
        privateStorage = storage
        current = storage
        currentState = appGroup.map { .shared(group: $0) } ?? .appPrivate(reason: "set up by the caller")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// The UI tests' store (`-DLSTestStorage` among the launch arguments, which only whoever starts the app can pass):
    /// its own defaults suite and directory, emptied at launch, no App Group. nil without the argument.
    static func testStore(arguments: [String] = ProcessInfo.processInfo.arguments) -> SharedStore? {
        guard arguments.contains("-DLSTestStorage") else { return nil }
        let suite = "com.daylight.share.uitest"
        let directory = privateDirectory().deletingLastPathComponent()
            .appendingPathComponent("DaylightShare-UITest", isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
        guard let defaults = UserDefaults(suiteName: suite) else { return nil }
        defaults.removePersistentDomain(forName: suite)
        return SharedStore(defaults: defaults, directory: directory)
    }

    /// This process's own storage directory: Application Support/DaylightShare (inside the sandbox container). Only
    /// computes the path: it is created on the first write.
    public static func privateDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("DaylightShare", isDirectory: true)
    }

    // MARK: Waiting for resolution

    /// Runs `body` once storage is settled: right away (on this thread) if it already is, else on a background queue.
    public func whenReady(_ body: @escaping () -> Void) {
        lock.lock()
        if currentState != .resolving {
            lock.unlock()
            body()
            return
        }
        waiters.append(body)
        lock.unlock()
    }

    /// Returns once storage is settled (at most `resolutionTimeout` after the store was created).
    public func ready() async {
        if isReady { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            whenReady { cont.resume() }
        }
    }

    enum Resolution {
        case found(group: String, container: URL, defaults: UserDefaults)
        case unavailable(String)
    }

    /// Runs on a background queue.
    static func resolve(_ declared: [String], _ resolver: AppGroupResolver) -> Resolution {
        var seen = Set<String>()
        var tried: [String] = []
        for group in declared + resolver.extraGroups() where seen.insert(group).inserted {
            tried.append(group)
            guard resolver.isAllowed(group), let url = resolver.containerURL(group), resolver.isWritable(url),
                  let defaults = resolver.defaults(group) else { continue }
            return .found(group: group, container: url, defaults: defaults)
        }
        return .unavailable("no usable App Group (tried \(tried.joined(separator: ", ")))")
    }

    private func finish(_ resolution: Resolution) {
        lock.lock()
        guard currentState == .resolving, !settling else {
            lock.unlock()
            return
        }
        settling = true
        lock.unlock()

        var next = privateStorage
        let state: State
        switch resolution {
        case let .found(group, container, defaults):
            next = Storage(defaults: defaults,
                           directory: container.appendingPathComponent("Library/Application Support/DaylightShare",
                                                                       isDirectory: true),
                           appGroup: group)
            try? FileManager.default.createDirectory(at: next.directory, withIntermediateDirectories: true)
            Self.migrate(from: privateStorage, to: next)
            state = .shared(group: group)
        case let .unavailable(reason):
            state = .appPrivate(reason: reason)
        }

        lock.lock()
        current = next
        currentState = state
        let pending = waiters
        waiters = []
        lock.unlock()
        pending.forEach { $0() }
        DispatchQueue.main.async { NotificationCenter.default.post(name: .daylightShareChanged, object: nil) }
    }

    /// This device's settings that move into the App Group when the group has none of its own (an update keeps them,
    /// LAB-PLAN 1.2, 1.3): Comfort, the Lab switch and the one-time Lab note.
    static let deviceSettingKeys = [Key.comfort, Key.lab, Key.labNoteShown]
    /// The files beside the outbox that belong to its pairing: the outbox and its bodies, Lab's ledger (`lab.json`, whose
    /// item states go with the outbox's ack cursor) and the Daylight server's pin, config and notices (`server.json`).
    static let pairingFiles = ["outbox.json", "outbox", LabLedger.fileName, FileServerStore.fileName]

    /// What this process kept without the App Group (an earlier ad-hoc build, say: the ad-hoc Mac app updated to the
    /// Developer ID one) moves into the group. This device's settings (`deviceSettingKeys`) move when the group has no
    /// value of its own. A pairing moves when the group has none, with everything that belongs to it: the device name,
    /// the re-pairing follow-up and `pairingFiles`. Moved, not copied: unpairing in the group later must not bring it
    /// back.
    static func migrate(from old: Storage, to new: Storage) {
        for key in deviceSettingKeys {
            guard new.defaults.object(forKey: key) == nil, let value = old.defaults.object(forKey: key) else { continue }
            new.defaults.set(value, forKey: key)
            old.defaults.removeObject(forKey: key)
        }
        guard new.defaults.data(forKey: Key.pairing) == nil, let pairing = old.defaults.data(forKey: Key.pairing) else {
            return
        }
        new.defaults.set(pairing, forKey: Key.pairing)
        for key in [Key.deviceName, Key.labRepaired] {
            if let value = old.defaults.object(forKey: key), new.defaults.object(forKey: key) == nil {
                new.defaults.set(value, forKey: key)
            }
        }
        let fm = FileManager.default
        for name in pairingFiles {
            let source = old.directory.appendingPathComponent(name)
            guard fm.fileExists(atPath: source.path) else { continue }
            let target = new.directory.appendingPathComponent(name)
            try? fm.removeItem(at: target)
            try? fm.moveItem(at: source, to: target)
        }
        old.defaults.removeObject(forKey: Key.pairing)
        old.defaults.removeObject(forKey: Key.deviceName)
        old.defaults.removeObject(forKey: Key.labRepaired)
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    static func seconds(_ t: TimeInterval) -> String {
        t == t.rounded() ? "\(Int(t)) s" : String(format: "%.1f s", t)
    }

    // MARK: Pairing and settings

    enum Key {
        static let pairing = "dls.pairing"
        static let deviceName = "dls.deviceName"
        /// The accessibility baseline's Comfort switch (LAB-PLAN F27, 1.2): not a Lab key, and Lab never reads it.
        static let comfort = "dls.comfort"
        /// The Lab switch (LAB-PLAN 1.2): a missing key means on.
        static let lab = "dls.lab"
        /// Whether the one-time Lab note was dismissed (LAB-PLAN 1.2, 1.6; shown only in builds with F01 or F04).
        static let labNoteShown = "dls.labNoteShown"
        /// When this device re-paired while it knew a Daylight server (ms): the re-pairing follow-up (LAB-PLAN 2.6).
        static let labRepaired = "dls.labRepaired"
    }

    /// The stored pairing. Reads and writes UserDefaults: off the main thread (see `StorageAudit`).
    public var pairing: Pairing? {
        get {
            StorageAudit.note("pairing read")
            guard let data = defaults.data(forKey: Key.pairing) else { return nil }
            return try? JSONDecoder().decode(Pairing.self, from: data)
        }
        set {
            StorageAudit.note("pairing write")
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
        get {
            StorageAudit.note("device name read")
            return defaults.string(forKey: Key.deviceName) ?? ""
        }
        set {
            StorageAudit.note("device name write")
            defaults.set(ShareText.cleanName(newValue), forKey: Key.deviceName)
            SharedStore.postChange()
        }
    }

    /// Comfort (LAB-PLAN F27): larger text and buttons, more contrast, no motion. Off when never set. The app and its
    /// extensions share it when they share storage.
    public var comfort: Bool {
        get {
            StorageAudit.note("comfort read")
            return defaults.bool(forKey: Key.comfort)
        }
        set {
            StorageAudit.note("comfort write")
            defaults.set(newValue, forKey: Key.comfort)
            SharedStore.postChange()
        }
    }

    /// The Lab switch (LAB-PLAN 1.2): on when never set, so a fresh install and an upgrade both start with Lab on. It
    /// belongs to this device: never synced, never in a pairing link, and kept by pairing, unpairing and updates. Read
    /// it through `LabSettings.isOn(store:)`, which also answers while storage is still resolving.
    public var lab: Bool {
        get {
            StorageAudit.note("lab read")
            return defaults.object(forKey: Key.lab) as? Bool ?? true
        }
        set {
            StorageAudit.note("lab write")
            defaults.set(newValue, forKey: Key.lab)
            SharedStore.postChange()
        }
    }

    /// Whether the Lab switch was ever stored (the first start of a build with Lab writes it: `LabSettings.ensureDefault`).
    public var labIsStored: Bool {
        StorageAudit.note("lab read")
        return defaults.object(forKey: Key.lab) != nil
    }

    /// Whether the one-time Lab note was dismissed (LAB-PLAN 1.2).
    public var labNoteShown: Bool {
        get {
            StorageAudit.note("lab note read")
            return defaults.bool(forKey: Key.labNoteShown)
        }
        set {
            StorageAudit.note("lab note write")
            defaults.set(newValue, forKey: Key.labNoteShown)
            SharedStore.postChange()
        }
    }

    /// When this device re-paired with another Daylight while it knew a Daylight server, which it locked first
    /// (LAB-PLAN 2.6, DESIGN 12.7): the time (ms), kept until OK on the follow-up or a ready server
    /// (`LabCenter.repaired()`); nil otherwise. A pairing with another secret, and Unpair, remove it.
    public var labRepairedAt: Int64? {
        get {
            StorageAudit.note("lab repaired read")
            let ms = defaults.double(forKey: Key.labRepaired)
            return ms > 0 ? Int64(ms) : nil
        }
        set {
            StorageAudit.note("lab repaired write")
            if let newValue, newValue > 0 {
                defaults.set(Double(newValue), forKey: Key.labRepaired)
            } else {
                defaults.removeObject(forKey: Key.labRepaired)
            }
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

    // MARK: App Group discovery

    /// The App Groups the build declares, from Info.plist alone (no file access, safe on any thread).
    ///
    /// `DaylightAppGroup` comes from the build settings: `$(DAYLIGHT_APP_GROUP)` on iPhone, `$(DAYLIGHT_MAC_APP_GROUP)`
    /// on the Mac, which is empty for ad-hoc and unsigned builds. iPhone builds also try `group.com.daylight.share`
    /// (sideloading tools keep or rename it); Mac builds never try a group the build did not declare.
    static func declaredGroups(info: [String: Any]?) -> [String] {
        var out: [String] = []
        if let g = (info?["DaylightAppGroup"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !g.isEmpty, !g.contains("$(") {
            out.append(g)
        }
        #if !os(macOS)
        if !out.contains(defaultAppGroup) { out.append(defaultAppGroup) }
        #endif
        return out
    }

    /// Creates the directory if needed and writes a probe file. Can block (see the type's comment): background only.
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

    #if os(macOS)
    /// Whether this process may open `group`'s container without macOS asking the user: the group is in this
    /// process's own entitlements and its signature authorises it (a Team-ID-prefixed group of the signing team, or
    /// an iOS-style `group.` id with an embedded provisioning profile). Ad-hoc signed code has no team: never.
    static func signatureAuthorises(_ group: String) -> Bool {
        guard entitledAppGroups().contains(group) else { return false }
        if let team = signingTeam(), group.hasPrefix(team + ".") { return true }
        let profile = Bundle.main.bundleURL.appendingPathComponent("Contents/embedded.provisionprofile")
        return group.hasPrefix("group.") && FileManager.default.fileExists(atPath: profile.path)
    }

    /// The App Groups in this process's entitlements.
    static func entitledAppGroups() -> [String] {
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil)
        else { return [] }
        return (value as? [String]) ?? []
    }

    /// The Team ID this process is signed with; nil for ad-hoc signed or unsigned code.
    static func signingTeam() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: UInt32(kSecCSSigningInformation)), &info)
                == errSecSuccess,
              let dict = info as? [String: Any],
              let team = dict[kSecCodeInfoTeamIdentifier as String] as? String, !team.isEmpty else { return nil }
        return team
    }
    #endif
}

/// How a `SharedStore` finds its App Group. Only `declaredGroups` runs on the caller's thread (it must not touch the
/// file system); everything else runs on a background queue. Tests swap in slow or failing steps.
public struct AppGroupResolver {
    /// The groups the build declares (Info.plist). Empty = no App Group: the store settles at once on its own storage.
    public var declaredGroups: () -> [String]
    /// More candidates found on disk (the provisioning profile of a re-signed iPhone app).
    public var extraGroups: () -> [String]
    /// Whether the group may be opened without the system asking the user (macOS 15 checks the signature).
    public var isAllowed: (String) -> Bool
    public var containerURL: (String) -> URL?
    /// Whether the container can be written. On macOS 15 this is where an unauthorised group would wait for the user.
    public var isWritable: (URL) -> Bool
    public var defaults: (String) -> UserDefaults?

    public init(declaredGroups: @escaping () -> [String], extraGroups: @escaping () -> [String] = { [] },
                isAllowed: @escaping (String) -> Bool = { _ in true }, containerURL: @escaping (String) -> URL?,
                isWritable: @escaping (URL) -> Bool, defaults: @escaping (String) -> UserDefaults? = { UserDefaults(suiteName: $0) }) {
        self.declaredGroups = declaredGroups
        self.extraGroups = extraGroups
        self.isAllowed = isAllowed
        self.containerURL = containerURL
        self.isWritable = isWritable
        self.defaults = defaults
    }

    /// The real thing, for the apps and extensions.
    public static var system: AppGroupResolver {
        AppGroupResolver(
            declaredGroups: { SharedStore.declaredGroups(info: Bundle.main.infoDictionary) },
            extraGroups: {
                #if os(macOS)
                return []
                #else
                let provisioned = SharedStore.provisionedAppGroups()
                return provisioned.filter { $0.lowercased().contains("daylight") } + provisioned
                #endif
            },
            isAllowed: { group in
                #if os(macOS)
                return SharedStore.signatureAuthorises(group)
                #else
                return true
                #endif
            },
            containerURL: { group in
                #if canImport(ObjectiveC)
                return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
                #else
                return nil
                #endif
            },
            isWritable: SharedStore.isWritable)
    }
}

extension Notification.Name {
    /// Posted (on the main thread) when the pairing, settings or outbox changed in this or another process, or when
    /// this process's storage was resolved.
    public static let daylightShareChanged = Notification.Name("DaylightShareChanged")
}
