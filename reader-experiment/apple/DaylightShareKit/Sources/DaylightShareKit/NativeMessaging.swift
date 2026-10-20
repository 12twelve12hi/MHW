import Foundation

extension SharedStore {
    /// Saves a pairing. As in the JS extension, items queued for another Daylight (a different code or relay) are
    /// dropped, and pairing again with the same code keeps the known Daylight name when the new one has none.
    public func pair(_ newPairing: Pairing) {
        var p = newPairing
        let old = pairing
        if let old, old.secret == p.secret, p.name.isEmpty { p.name = old.name }
        if let old, old.secret != p.secret || old.relay != p.relay { OutboxStore(store: self).removeAll() }
        pairing = p
    }

    /// Forgets the pairing and the outbox.
    public func unpair() {
        OutboxStore(store: self).removeAll()
        pairing = nil
    }
}

/// Messages from the Safari Web Extension's JavaScript (`browser.runtime.sendNativeMessage`) to its native handler.
///
///   {type: "getPairing"}                      -> {ok: true, paired: true, pairing: {code, link, relay, name}, from}
///                                                or {ok: true, paired: false, shared}
///   {type: "setPairing", code|link, relay?, name?} -> {ok: true} (the app and Share extension then use it too, when
///                                                they share an App Group)
///   {type: "ping"}                            -> {ok: true, app, shared, storage}
///
/// Without an App Group (ad-hoc and unsigned Mac builds) the handler only sees its own storage, so `getPairing`
/// answers `paired: false` and the extension pairs in its own popup.
public enum SafariNativeMessaging {
    /// Answers once storage is settled (off the calling thread while the App Group is being resolved, and within
    /// `SharedStore.resolutionTimeout`): the native handler never touches the App Group container on its own thread.
    public static func answerWhenReady(_ message: Any?, store: SharedStore = .shared,
                                       reply: @escaping ([String: Any]) -> Void) {
        store.whenReady { reply(answer(message, store: store)) }
    }

    public static func answer(_ message: Any?, store: SharedStore = .shared) -> [String: Any] {
        let m = message as? [String: Any] ?? [:]
        let type = (m["type"] as? String) ?? (m["action"] as? String) ?? (message as? String) ?? ""
        switch type {
        case "getPairing":
            guard let p = store.pairing else { return ["ok": true, "paired": false, "shared": store.isShared] }
            return ["ok": true, "paired": true,
                    "pairing": ["code": p.code, "link": p.link, "relay": p.relay, "name": p.name],
                    "from": DaylightShare.deviceName(store: store)]
        case "setPairing":
            let input = (m["link"] as? String) ?? (m["code"] as? String) ?? ""
            do {
                var p = try Pairing.parse(input)
                if let r = m["relay"] as? String, !r.isEmpty { p.relay = try ShareText.normalizeRelay(r) }
                if let n = m["name"] as? String, !n.isEmpty { p.name = ShareText.cleanName(n) }
                store.pair(p)
                return ["ok": true]
            } catch {
                return ["ok": false, "error": (error as? ShareError)?.message ?? "\(error)"]
            }
        case "ping":
            return ["ok": true, "app": DaylightShare.appIdentifier, "shared": store.isShared,
                    "storage": store.state.description]
        default:
            return ["ok": false, "error": "unknown message type \(type)"]
        }
    }
}
