import Foundation

extension SharedStore {
    /// Saves a pairing (PROTOCOL 3.3 step 6). The same secret (a new relay or name) keeps the outbox, so pending items
    /// go through the new relay; another secret deletes every row, its stored content and the ack cursor (and Lab's
    /// ledger and re-pairing follow-up with them). Pairing again with the same code keeps the known Daylight name when
    /// the new one has none. Returns whether the outbox was deleted. Whether to ask first is `PairingConfirmation`'s
    /// decision, made before this is called.
    ///
    /// Runs under the outbox lock (as the JS `applyPairingChange`), after any attempt in flight in this process, so an
    /// item meant for one Daylight never comes back to be sealed for another. Share in place's uploads still on their way
    /// for the old pairing are cancelled and their frame files deleted (`BackgroundPublisher.cancel`), so none of them
    /// reaches the old Daylight afterwards. Touches storage: call it off the main thread. The apps and extensions pair
    /// through `LabCenter.pair`, which locks the old pairing's Daylight server first (LAB-PLAN 2.6) and then calls this.
    @discardableResult
    public func pair(_ newPairing: Pairing) async -> Bool {
        await ready()
        let outbox = OutboxStore(store: self)
        let changed = await outbox.whileLocked { () -> (other: Bool, removed: [OutboxRow]) in
            var p = newPairing
            let old = pairing
            if let old, old.secret == p.secret, p.name.isEmpty { p.name = old.name }
            let anotherSecret = old?.secret != p.secret
            var removed: [OutboxRow] = []
            if anotherSecret {
                removed = outbox.removeAllUnlocked()
                if labRepairedAt != nil { labRepairedAt = nil }
            }
            pairing = p
            return (anotherSecret, removed)
        }
        await BackgroundPublisher.cancel(BackgroundPublisher.gone(changed.removed, all: true), store: self)
        return changed.other
    }

    /// Forgets the pairing and the outbox (under the outbox lock, like `pair`), and cancels share in place's uploads still
    /// on their way. The apps unpair through `LabCenter.unpair`, which forgets a typed Server address first.
    public func unpair() async {
        await ready()
        let outbox = OutboxStore(store: self)
        let removed = await outbox.whileLocked { () -> [OutboxRow] in
            let rows = outbox.removeAllUnlocked()
            if labRepairedAt != nil { labRepairedAt = nil }
            pairing = nil
            return rows
        }
        await BackgroundPublisher.cancel(BackgroundPublisher.gone(removed, all: true), store: self)
    }
}

/// Messages from the Safari Web Extension's JavaScript (`browser.runtime.sendNativeMessage`) to its native handler.
///
///   {type: "getPairing"}                      -> {ok: true, paired: true, pairing: {code, link, relay, name}, from}
///                                                or {ok: true, paired: false, shared}
///   {type: "setPairing", code|link, relay?, name?, confirm?} -> {ok: true, notice?, serverLocked?} (the app and Share
///                                                extension then use it too, when they share an App Group); when it
///                                                would replace a pairing with another secret and `confirm` is not true:
///                                                {ok: false, error, needsConfirm: {title, lines, button, current, next}}.
///                                                Another secret locks the old pairing's Daylight server first
///                                                (`LabCenter.pair`, LAB-PLAN 2.6); `serverLocked: true` when a server
///                                                was known, so the app shows the re-pairing follow-up
///   {type: "ping"}                            -> {ok: true, app, shared, storage}
///
/// Without an App Group (ad-hoc and unsigned Mac builds) the handler only sees its own storage, so `getPairing`
/// answers `paired: false` and the extension pairs in its own popup.
public enum SafariNativeMessaging {
    /// Answers once storage is settled (off the calling thread while the App Group is being resolved, and within
    /// `SharedStore.resolutionTimeout`): the native handler never touches the App Group container on its own thread.
    public static func answerWhenReady(_ message: Any?, store: SharedStore = .shared,
                                       reply: @escaping ([String: Any]) -> Void) {
        store.whenReady {
            Task { reply(await answer(message, store: store)) }
        }
    }

    /// The answer to one message. Touches storage (a pairing change waits for the outbox lock) and, for a pairing with
    /// another secret, the old pairing's Daylight server (`fetch`): off the main thread.
    public static func answer(_ message: Any?, store: SharedStore = .shared,
                              fetch: @escaping DaylightServer.Fetch = DaylightServer.urlSessionFetch) async -> [String: Any] {
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
                // Typed or pasted in the extension's own pairing field: ask only when it replaces another Daylight.
                let current = store.pairing
                let c = PairingConfirmation(current: current, next: p, source: .app)
                if c.ask && (m["confirm"] as? Bool) != true {
                    let needsConfirm: [String: Any] = ["title": c.title ?? "", "lines": c.lines, "button": c.button ?? "Switch",
                                                       "current": current?.displayName ?? "", "next": p.displayName]
                    return ["ok": false, "error": ([c.title ?? ""] + c.lines).joined(separator: " "),
                            "needsConfirm": needsConfirm]
                }
                // Another Daylight: a Daylight server that knows the old pairing is locked first (LAB-PLAN 2.6).
                let lock = await LabCenter(store: store, fetch: fetch).pair(p)
                var answer: [String: Any] = ["ok": true]
                if let notice = c.notice { answer["notice"] = notice }
                if lock.known { answer["serverLocked"] = true }
                return answer
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
