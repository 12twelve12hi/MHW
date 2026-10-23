import Foundation
#if canImport(UserNotifications)
import UserNotifications
#endif

/// Where notices go: the system's notification center in the apps (`SystemNoticeCenter`), a fake one in tests.
public protocol NoticeCenter: AnyObject {
    /// Whether this app may post notices now.
    func isAuthorized() async -> Bool
    /// Asks the user once (the app does, never an extension); returns whether notices are allowed.
    func requestAuthorization() async -> Bool
    /// Posts a notice. `rowID` opens the app at that history row; `quiet` makes no sound.
    func post(id: String, title: String, body: String, rowID: String, quiet: Bool) async
}

#if canImport(UserNotifications)
/// `UNUserNotificationCenter`: alerts and sounds, asked for once.
public final class SystemNoticeCenter: NoticeCenter {
    public static let shared = SystemNoticeCenter()
    /// The notice's `userInfo` key that holds the row id (the app opens at that row when it is tapped).
    public static let rowKey = "dls.row"

    public init() {}

    public func isAuthorized() async -> Bool {
        let s = await UNUserNotificationCenter.current().notificationSettings()
        return s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
    }

    public func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }

    public func post(id: String, title: String, body: String, rowID: String, quiet: Bool) async {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.userInfo = [Self.rowKey: rowID]
        if !quiet { c.sound = .default }
        c.threadIdentifier = "dls.results"
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }
}
#endif

/// Share in place's notices (LAB-PLAN F04, "When it fails after the card has closed"): iPhone and Mac post one when a
/// share-in-place item ends `failed` or `expired`, except for a network failure, which waits for a connection instead
/// (F07). "Couldn’t send ‘{title}’ to {name}", "Open to try again."; tapping it opens the app at the row. With the Lab
/// setting "Tell me when it’s in my Reader" on, a quiet "In your Reader ✓: {title}" is posted when the ledger confirms
/// `reader` while the app runs or refreshes in the background. Without notification permission nothing is posted, and
/// F04's row in What's in Lab shows `needs-notifications` (`localCheck`). The apps ask for the permission in the app,
/// the first time it opens after a share in place (`askIfNeeded`), never from the extension.
public struct FailureNotices {
    public let center: NoticeCenter
    public let prefs: LabPreferences

    public init(center: NoticeCenter, prefs: LabPreferences) {
        self.center = center
        self.prefs = prefs
    }

    /// "Couldn’t send ‘{title}’ to {name}" (`{name}`: the Daylight's name, else "your Daylight").
    public static func failedTitle(title: String, daylightName: String?) -> String {
        let name = ShareText.cleanName(daylightName)
        return LabText.fill(LabText["shareInPlace.failedTitle"],
                            ["title": title, "name": name.isEmpty ? LabText["shareInPlace.yourDaylight"] : name])
    }

    /// Whether a row's end is worth a notice: failed or expired, but not a failure for the network (it waits, F07).
    public static func isNoticeable(_ row: OutboxRow) -> Bool {
        row.status == .expired || (row.status == .failed && row.errorCode != "network")
    }

    /// A share-in-place item ended `failed` or `expired` after its card closed: the notice, unless Lab, Share in place
    /// or "Tell me when a send fails" is off, the failure was the network's, or notices are not allowed. Returns whether
    /// one was posted. Touches storage: off the main thread.
    @discardableResult
    public func sendFailed(_ row: OutboxRow, daylightName: String?) async -> Bool {
        guard Self.isNoticeable(row), prefs.inUse("F04"), prefs.tellWhenSendFails, await center.isAuthorized() else {
            return false
        }
        await center.post(id: "failed-\(row.id)", title: Self.failedTitle(title: row.displayTitle, daylightName: daylightName),
                          body: LabText["shareInPlace.failedText"], rowID: row.id, quiet: false)
        return true
    }

    /// Rows the ledger has just confirmed in the Reader: one quiet "In your Reader ✓: {title}" each, when "Tell me when
    /// it’s in my Reader" is on (off by default) and Lab is on. Returns how many were posted.
    @discardableResult
    public func inReader(_ rows: [OutboxRow]) async -> Int {
        guard !rows.isEmpty, LabSettings.isOn(store: prefs.store), prefs.tellWhenInReader, await center.isAuthorized() else {
            return 0
        }
        for row in rows {
            await center.post(id: "reader-\(row.id)", title: LabText.fill(LabText["shareInPlace.inReader"], ["title": row.displayTitle]),
                              body: "", rowID: row.id, quiet: true)
        }
        return rows.count
    }

    /// The app opened: asks for notification permission once, the first time after a share in place (F04). Returns
    /// whether it asked.
    @discardableResult
    public func askIfNeeded() async -> Bool {
        guard prefs.shouldAskForNotifications else { return false }
        prefs.notificationsAsked = true
        _ = await center.requestAuthorization()
        return true
    }

    /// F04's local check for its gate and What's in Lab (1.5): `needs-notifications` while notices are not allowed and
    /// "Tell me when a send fails" is on, else nil.
    public func localCheck() async -> String? {
        guard prefs.tellWhenSendFails else { return nil }
        return await center.isAuthorized() ? nil : "needs-notifications"
    }
}
