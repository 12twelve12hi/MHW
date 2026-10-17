import Foundation

/// App-level conveniences shared by the apps and extensions.
public enum DaylightShare {
    /// "ios/1.0.0" or "macos/1.0.0" (the `app` header field).
    public static var appIdentifier: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        #if os(macOS)
        return "macos/\(version)"
        #else
        return "ios/\(version)"
        #endif
    }

    /// The `from` name when the user has not set one: "iPhone", "iPad" or the Mac's name.
    public static var defaultDeviceName: String {
        #if os(macOS)
        return ShareText.cleanName(Host.current().localizedName ?? "Mac").isEmpty ? "Mac"
            : ShareText.cleanName(Host.current().localizedName ?? "Mac")
        #elseif os(iOS)
        var info = utsname()
        uname(&info)
        let machine = withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
        return model.hasPrefix("iPad") ? "iPad" : "iPhone"
        #else
        return "Device"
        #endif
    }

    /// The device name to send: the user's setting, else the default.
    public static func deviceName(store: SharedStore = .shared) -> String {
        let n = store.deviceName
        return n.isEmpty ? defaultDeviceName : n
    }

    /// A sender for the stored pairing, or ShareError.notPaired.
    public static func sender(store: SharedStore = .shared) throws -> ShareSender {
        guard let pairing = store.pairing else { throw ShareError.notPaired }
        return try ShareSender(pairing: pairing, outbox: OutboxStore(store: store), from: deviceName(store: store),
                               app: appIdentifier)
    }

    /// Normalises what a user typed into "Send a link": a URL, text containing one, or a bare domain.
    public static func linkFromUserText(_ text: String) -> String? {
        let t = ShareText.jsTrim(text)
        if let u = ShareText.webURL(t) { return u }
        if let u = ShareText.findURL(t) { return u }
        if !t.isEmpty, !t.contains(" "), t.contains("."), !t.contains("://") { return ShareText.webURL("https://" + t) }
        return nil
    }
}
