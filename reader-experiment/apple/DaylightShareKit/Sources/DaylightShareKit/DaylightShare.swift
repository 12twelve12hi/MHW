import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

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

    /// A sender for the stored pairing, or ShareError.notPaired. Its ack reads feed the Lab ledger (`lab.json` next to the
    /// outbox; LAB-PROTOCOL 2.2.6), whether Lab is on or off, so turning Lab on shows the Inbox's states at once; with Lab
    /// off nothing shows them. `session`: the URL session for the relay (tests give a stand-in's; nil: the default).
    public static func sender(store: SharedStore = .shared, session: URLSession? = nil) throws -> ShareSender {
        guard let pairing = store.pairing else { throw ShareError.notPaired }
        let outbox = OutboxStore(store: store)
        return try ShareSender(pairing: pairing, outbox: outbox, from: deviceName(store: store), app: appIdentifier,
                               session: session, onAckHeader: LabLedger(outbox: outbox).hook())
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
