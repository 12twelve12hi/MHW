import Foundation

/// What the Lab screens of an app show, worked out from storage, the ledger and the Daylight server (LAB-PLAN 1.4, 1.5,
/// 2.6): the Lab switch, each feature's gate and short state, What's in Lab's header and server group, and the Daylight
/// server section. The SwiftUI views (DaylightShareUI's `LabModel`) call it off the main thread; every method touches
/// storage, and the server ones the network.
///
/// Discovery and the server's status run only with Lab on (DESIGN 4.3). A server answer is cached for 10 minutes (1.5),
/// in this process.
public final class LabCenter: @unchecked Sendable {
    public let store: SharedStore
    /// "iphone", "ipad" or "mac" (the texts' {app} and {path}).
    public let platform: String
    /// The Lab features this app has in this build, in What's in Lab's order (W0: none; W1 adds F01, F04, …).
    public var appFeatures: [String]
    /// The server features this app lists (from Wave 0, all four: 1.4).
    public var serverFeatures: [String]
    /// The features whose gate may say ready: the rest end in `later` once everything else is ready.
    public var builtFeatures: Set<String>
    /// The app's own checks for a feature (an OS permission, a setting), or nil when they pass.
    public var local: (String) async -> String?
    let fetch: DaylightServer.Fetch
    let now: @Sendable () -> Int64

    private let lock = NSLock()
    private var serverCache: (key: String, server: DaylightServer)?
    private var lastProbe: (key: String, probe: Probe, at: Int64)?

    /// The server states that belong to the whole server, not to one feature: What's in Lab's server heading line.
    public static let serverWide = ["needs-pairing", "needs-server", "pairing-mismatch", "server-outdated", "app-outdated",
                                    "locked", "needs-site-access", "OFFLINE", "error"]
    /// The server states whose messages say to paste a new setup link: Set up with a link comes first then (2.6).
    public static let setupFirstStates = ["needs-server", "pairing-mismatch", "locked"]

    public init(store: SharedStore = .shared, platform: String = LabText.platform, appFeatures: [String] = [],
                serverFeatures: [String] = ["F02", "F37", "F19", "F36"], builtFeatures: Set<String> = [],
                local: @escaping (String) async -> String? = { _ in nil },
                fetch: @escaping DaylightServer.Fetch = DaylightServer.urlSessionFetch,
                now: @escaping @Sendable () -> Int64 = { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }) {
        self.store = store
        self.platform = platform
        self.appFeatures = appFeatures
        self.serverFeatures = serverFeatures
        self.builtFeatures = builtFeatures
        self.local = local
        self.fetch = fetch
        self.now = now
    }

    // MARK: The switch and the ledger

    /// The Lab switch (`LabSettings.isOn`).
    public func isOn() -> Bool { LabSettings.isOn(store: store) }

    /// The ledger next to the outbox.
    public func ledger() -> LabLedger { LabLedger(outbox: OutboxStore(store: store), now: { [now] in now() }) }

    /// The Daylight server client for the stored pairing (one per pairing and relay, so its derived values are made
    /// once), or nil when not paired.
    public func server() -> DaylightServer? {
        guard let pairing = store.pairing else { return nil }
        let key = "\(pairing.code)|\(pairing.relay)"
        lock.lock()
        defer { lock.unlock() }
        if let c = serverCache, c.key == key { return c.server }
        guard let s = try? DaylightServer(pairing: pairing, store: FileServerStore(store: store), fetch: fetch, now: now) else { return nil }
        serverCache = (key, s)
        return s
    }

    // MARK: The server as a whole

    /// The server as a whole (the JS extension's probe): discovery (the pin, the move, the API level), then GET
    /// /v1/status (cached 10 minutes). `state` is "ready" or one of `serverWide`; `config`, `status` and `moved` when
    /// known.
    public struct Probe: Equatable, Sendable {
        public var state: String
        public var message: String?
        public var config: ServerConfig?
        public var status: JSONValue?
        public var moved: String?

        public init(state: String, message: String? = nil, config: ServerConfig? = nil, status: JSONValue? = nil,
                    moved: String? = nil) {
            self.state = state
            self.message = message
            self.config = config
            self.status = status
            self.moved = moved
        }
    }

    /// Asks the server now. `force`: Lab settings opened (the section or What's in Lab), so the config topic is read now
    /// whatever the cached config's age (DESIGN 4.3 rule 1) and the status is asked now.
    public func probe(force: Bool = false) async -> Probe {
        guard let pairing = store.pairing, let server = self.server() else {
            return Probe(state: "needs-pairing", message: LabText.needsMessage("needs-pairing", platform: platform))
        }
        let p = await Self.probeNow(server, force: force)
        remember(p, key: "\(pairing.code)|\(pairing.relay)")
        return p
    }

    private func remember(_ p: Probe, key: String) {
        lock.lock()
        defer { lock.unlock() }
        lastProbe = (key, p, now())
    }

    static func probeNow(_ server: DaylightServer, force: Bool) async -> Probe {
        let d: DaylightServer.Discovery?
        do {
            d = try await server.discover(force: force)
        } catch {
            let out = server.noteError("", error)
            return Probe(state: out.state, message: out.message)
        }
        guard let d else {
            let pin = server.store.get(ServerKeys.pin)
            let state = pin != nil && pin?["fingerprint"]?.string != server.values.fingerprint ? "pairing-mismatch" : "needs-server"
            return Probe(state: state, message: ServerMessages.localMessage(state))
        }
        let config = d.config
        if config.api < ServerCode.serverAPIMin {
            return Probe(state: "server-outdated", message: ServerMessages.localMessage("server-outdated"), config: config, moved: d.moved)
        }
        if config.api > ServerCode.serverAPI {
            return Probe(state: "app-outdated", message: ServerMessages.localMessage("app-outdated"), config: config, moved: d.moved)
        }
        do {
            let status = try await server.status(force: force)
            return Probe(state: "ready", config: config, status: status, moved: d.moved)
        } catch {
            // The pinned server may be gone because it moved (a deploy with "New setup link" deletes the old Worker): a
            // config that came from the cache is read again from the config topic once, so the move is found now (after
            // a 401 only on the first BAD_AUTH of an episode, which removed server/configAt).
            let out = server.noteError("", error)
            var moved = d.moved
            let code = (error as? ServerError)?.code ?? ""
            if !force && d.source == "cache" && (code == "BAD_AUTH" || code == "OFFLINE" || code == "SERVER_ERROR") {
                if let again = try? await server.discover(force: code != "BAD_AUTH"), let m = again.moved { moved = m }
            }
            return Probe(state: out.state, message: out.message, config: config, moved: moved)
        }
    }

    /// A probe within the gate's 5 s (2.6): a server that has not answered by then is OFFLINE.
    public func probeInTime(force: Bool = false, deadlineMs: Int64 = Lab.gateDeadlineMs) async -> Probe {
        (try? await Deadline.run(ms: deadlineMs, onTimeout: { Probe(state: "OFFLINE", message: ServerMessages.localMessage("OFFLINE")) }) {
            [self] in await probe(force: force)
        }) ?? Probe(state: "OFFLINE", message: ServerMessages.localMessage("OFFLINE"))
    }

    /// The last answer, when it is 10 minutes old or less and belongs to the stored pairing (1.5: cached states answer
    /// at once); nil otherwise.
    public func cachedProbe() -> Probe? {
        guard let pairing = store.pairing else { return nil }
        lock.lock()
        defer { lock.unlock() }
        guard let last = lastProbe, last.key == "\(pairing.code)|\(pairing.relay)",
              now() - last.at <= ServerCode.statusRefreshMs else { return nil }
        return last.probe
    }

    /// A feature's server state from a probe: the server's state for a whole-server answer, else the feature's.
    public static func featureState(_ p: Probe, key: String) -> ServerState {
        if p.state != "ready" { return ServerState(p.state, p.message ?? ServerMessages.localMessage(p.state)) }
        return ServerMessages.stateFromStatus(p.status, feature: key)
    }

    // MARK: The gate

    /// A feature's gate as this app runs it (1.5, 2.7.2). `probe`: an answer to reuse (What's in Lab's states), else the
    /// server is asked (within the gate's 5 s).
    public func gate(_ feature: String, probe given: Probe? = nil, deadlineMs: Int64 = Lab.gateDeadlineMs) async -> LabGate.Result {
        let lab = isOn()
        let paired = store.pairing != nil
        let snap = ledger().snapshot()
        let built = builtFeatures
        let ctx = LabGate.Context(
            lab: lab, paired: paired, hasCap: { snap.hasCap($0) }, local: local,
            server: { [self] key in
                if let given { return Self.featureState(given, key: key) }
                return Self.featureState(await probe(), key: key)
            },
            serverMessage: { ServerMessages.localMessage($0) }, built: { built.contains($0) }, platform: platform,
            deadlineMs: deadlineMs)
        return await LabGate.run(feature, ctx)
    }

    // MARK: What's in Lab (1.4)

    /// One row of What's in Lab: the feature's name, sentence and short state (nil: not known yet).
    public struct Row: Equatable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let sentence: String
        public let short: String?

        public init(id: String, name: String, sentence: String, short: String?) {
            self.id = id
            self.name = name
            self.sentence = sentence
            self.short = short
        }
    }

    /// The list (1.4): the Inbox's Lab state as its header line, this app's features, then the server group with its
    /// heading's short state.
    public struct Overview: Equatable, Sendable {
        public var lab: Bool
        /// "Your Daylight: Lab on · checked in 4 min ago", or the needs-inbox short state.
        public var header: String
        /// Whether the short states come from an answer (false: nothing recent, the shorts are nil).
        public var fresh: Bool
        public var features: [Row]
        /// The server group: its state (nil while unknown), the heading's short state ("Not set up") and its rows (each
        /// with its own short state only when it differs from the heading's).
        public var serverState: String?
        public var serverShort: String?
        public var serverRows: [Row]

        public static let off = Overview(lab: false, header: "", fresh: false, features: [], serverState: nil, serverShort: nil, serverRows: [])
    }

    func row(_ id: String, _ short: String?) -> Row {
        Row(id: id, name: LabText.featureName(id), sentence: LabText.featureSentence(id), short: short)
    }

    /// What's in Lab. `refresh`: it opened, so read the ack topic (the header is then current) and ask the server now,
    /// both at once and each within the gate's 5 s. Without `refresh` nothing goes on the network: the cached states,
    /// or, with nothing recent, no short states yet.
    public func overview(refresh: Bool = true, deadlineMs: Int64 = Lab.gateDeadlineMs) async -> Overview {
        guard isOn() else { return .off }
        let paired = store.pairing != nil
        var asked: Probe?
        if paired && refresh {
            async let acks: Void = refreshAcks(deadlineMs: deadlineMs)
            async let answer = probeInTime(force: true, deadlineMs: deadlineMs)
            _ = await acks
            asked = await answer
        }
        let snap = ledger().snapshot()
        let header = LabText.inboxLabText(inboxLab: snap.inboxLab, checkedIn: snap.checkedIn, now: now())
        let p: Probe? = !paired ? Probe(state: "needs-pairing") : asked ?? cachedProbe()
        var features: [Row] = []
        for id in appFeatures {
            let g = await gate(id, probe: p ?? Probe(state: "ready"), deadlineMs: deadlineMs)
            features.append(row(id, g.short ?? LabText.ready))
        }
        guard let p else {
            return Overview(lab: true, header: header, fresh: false, features: features, serverState: nil, serverShort: nil,
                            serverRows: serverFeatures.map { row($0, nil) })
        }
        let heading = Self.serverWide.contains(p.state) ? p.state : "ready"
        var serverRows: [Row] = []
        for id in serverFeatures {
            let g = await gate(id, probe: p, deadlineMs: deadlineMs)
            serverRows.append(row(id, LabText.serverFeatureShort(g.state, heading: heading)))
        }
        return Overview(lab: true, header: header, fresh: true, features: features, serverState: heading,
                        serverShort: LabText.serverHeadingShort(heading), serverRows: serverRows)
    }

    /// Reads the ack topic now (What's in Lab opening), within the gate's deadline; errors are ignored.
    func refreshAcks(deadlineMs: Int64) async {
        let store = self.store
        _ = try? await Deadline.run(ms: deadlineMs, onTimeout: { 0 }) {
            guard let sender = try? DaylightShare.sender(store: store) else { return 0 }
            return (try? await sender.checkAcks()) ?? 0
        }
    }

    /// The "Daylight server ›" row's state (1.1): the last answer when recent, else asked within the gate's 5 s (or not,
    /// with `refresh` false: then nil while nothing is known). needs-pairing when not paired.
    public func serverRowState(refresh: Bool = true) async -> String? {
        guard isOn() else { return nil }
        guard store.pairing != nil else { return "needs-pairing" }
        if let p = cachedProbe() { return p.state }
        guard refresh else { return nil }
        return await probeInTime().state
    }

    // MARK: The Daylight server section (2.6)

    /// What the section shows, in its order: the state (`message`: "Ready" or the state's long message); Set up with a
    /// link (first while `setupFirst`); the steps (while the state is needs-server); the move question; the host line;
    /// the delivery line (with the v1 notice); the Server code; the Lab Inbox and AI lines; the Server address field;
    /// the re-run help.
    public struct ServerView: Equatable, Sendable {
        public var paired: Bool
        public var state: String
        public var message: String
        /// "Your server": `LabText.hostLineText(host, fingerprint)`.
        public var hostLine: String
        /// "lab", "v1" or nil (no server found: no Delivery line).
        public var delivery: String?
        public var v1Notice: String?
        /// "Your Daylight server moved to {host}. Use it?" while the server moved and the user has not answered.
        public var moved: String?
        public var serverCode: String
        public var labInbox: String?
        public var aiToday: String?
        public var manualUrl: String
        public var setupFirst: Bool
        public var showSteps: Bool
        public var rerun: String
    }

    /// The section's contents, asking the server now (within the gate's 5 s). nil with Lab off.
    public func serverView(deadlineMs: Int64 = Lab.gateDeadlineMs) async -> ServerView? {
        guard isOn() else { return nil }
        guard let server = self.server() else {
            return ServerView(paired: false, state: "needs-pairing",
                              message: LabText.needsMessage("needs-pairing", platform: platform) ?? "", hostLine: "",
                              delivery: nil, v1Notice: nil, moved: nil, serverCode: "", labInbox: nil, aiToday: nil,
                              manualUrl: "", setupFirst: false, showSteps: false, rerun: ServerMessages.rerunHelp)
        }
        let p = await probeInTime(force: true, deadlineMs: deadlineMs)
        let status = p.status
        let badAuth = server.store.get(ServerKeys.badAuthAt) != nil
        let movedTo = p.moved ?? server.pendingMove()
        let delivery = p.config?.delivery
        var aiToday: String?
        if let ai = status?["usage"]?["ai"], ai.object != nil {
            aiToday = LabText.aiTodayText(used: ai["usd"], cap: ai["limitUsd"])
        }
        return ServerView(
            paired: true, state: p.state,
            message: p.state == "ready" ? LabText.ready : p.message ?? ServerMessages.localMessage(p.state),
            hostLine: LabText.hostLineText(p.config?.server ?? "", ServerCode.showFingerprint(server.values.fingerprint)),
            delivery: delivery, v1Notice: delivery == "v1" ? ServerMessages.noticeText("v1") : nil,
            moved: movedTo.map { LabText.serverMovedText($0) }, serverCode: server.serverCode(),
            labInbox: status.map { LabText.labInboxSeenText($0["inbox"]?["lastSeen"], now: now()) },
            aiToday: aiToday, manualUrl: server.manualUrl,
            setupFirst: Self.setupFirstStates.contains(p.state) || (p.state == "error" && badAuth),
            showSteps: p.state == "needs-server", rerun: ServerMessages.rerunHelp)
    }

    /// "Your Daylight server moved to {host}. Use it?" answered Use it: pins the new origin. -> whether it moved.
    @discardableResult
    public func confirmMove() -> Bool {
        guard isOn(), let server = self.server() else { return false }
        forgetProbe()
        return server.confirmMove()
    }

    /// Set up with a link, step 2: the link read here, before anything is sent. -> the confirmation's body
    /// ("{host} will get this pairing’s Server code. …") or the module's message for a refused link.
    public static func checkSetupLink(_ link: String) -> (confirm: String?, error: String?) {
        do {
            let parsed = try ServerCode.parseSetupLink(link)
            return (LabText.setupConfirmText(parsed.server), nil)
        } catch {
            return (nil, (error as? ShareError)?.message ?? ServerCode.setupFormatText)
        }
    }

    /// Set up with a link, step 4 (after the user confirmed): `DaylightServer.setup`. -> nil when done (show
    /// LAB_TEXT.serverSection.setupDone), else the message to show.
    public func setup(link: String) async -> String? {
        guard isOn() else { return LabText.labOff(platform: platform) }
        guard let server = self.server() else { return LabText.needsMessage("needs-pairing", platform: platform) }
        forgetProbe()
        do {
            try await server.setup(link: link)
            return nil
        } catch let e as ServerError {
            return e.message
        } catch {
            return ServerMessages.localMessage("OFFLINE")
        }
    }

    /// The Server address field's Save: an address checks it and keeps it; an empty field clears it. -> nil when done,
    /// else the message to show.
    public func saveServerAddress(_ text: String) async -> String? {
        guard let server = self.server() else { return LabText.needsMessage("needs-pairing", platform: platform) }
        forgetProbe()
        if ShareText.jsTrim(text).isEmpty {
            server.clearManualUrl()
            return nil
        }
        do {
            try await server.setManualUrl(text)
            return nil
        } catch let e as ServerError {
            return e.message
        } catch {
            return ServerMessages.localMessage("OFFLINE")
        }
    }

    /// Before replacing a pairing while a server pin exists (2.6 "Re-pairing"), whether Lab is on or off: POST
    /// /v1/admin/lock with the old pairing's token. -> whether the server took it. Call it before `SharedStore.pair`
    /// with another secret; afterwards show the new Server code and the re-run help (DESIGN 12.7).
    @discardableResult
    public func lockBeforeRepair() async -> Bool {
        guard let server = self.server(), server.store.get(ServerKeys.pin) != nil else { return false }
        forgetProbe()
        return await server.lockBeforeRepair()
    }

    /// Forgets the cached answer (the pairing, the server or the address changed).
    public func forgetProbe() {
        lock.lock()
        lastProbe = nil
        lock.unlock()
    }
}
