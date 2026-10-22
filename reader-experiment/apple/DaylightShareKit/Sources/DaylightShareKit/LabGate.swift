import Foundation

/// A feature's gate (LAB-PLAN 1.5, 2.6, 2.7.2; the JS `labGate`; vectors > labGate): whether a Lab feature may run now,
/// or the one sentence that says what is missing and where to add it. The UI shows that sentence under the tapped
/// control (`LabNote` in DaylightShareUI); the control itself never looks disabled.
public enum LabGate {
    /// What the gate checks against.
    public struct Context {
        /// This app's Lab switch.
        public var lab: Bool
        public var paired: Bool
        /// The ledger's capabilities (`LabLedger.Snapshot.hasCap`); a missing capability gives needs-inbox.
        public var hasCap: (String) -> Bool
        /// The app's own checks for a feature (an OS permission, a setting): "needs-notifications", … or nil when they
        /// pass.
        public var local: (String) async -> String?
        /// The server's state for a server feature key (`DaylightServer.state`), raced against `deadlineMs`; nil when
        /// there is no server object (needs-server).
        public var server: (@Sendable (String) async throws -> ServerState)?
        /// The server module's text for a state, for an OFFLINE the deadline decided (`ServerMessages.localMessage`).
        public var serverMessage: ((String) -> String?)?
        /// false gives `later` once everything else is ready: the feature is not in this build yet.
        public var built: (String) -> Bool
        /// For the texts (`LabText.needsMessage`): the app's name and the platform ("iphone", "mac", …).
        public var app: String?
        public var platform: String?
        public var deadlineMs: Int64

        public init(lab: Bool, paired: Bool, hasCap: @escaping (String) -> Bool = { _ in false },
                    local: @escaping (String) async -> String? = { _ in nil },
                    server: (@Sendable (String) async throws -> ServerState)? = nil,
                    serverMessage: ((String) -> String?)? = { ServerMessages.localMessage($0) },
                    built: @escaping (String) -> Bool = { _ in true }, app: String? = nil, platform: String? = nil,
                    deadlineMs: Int64 = Lab.gateDeadlineMs) {
            self.lab = lab
            self.paired = paired
            self.hasCap = hasCap
            self.local = local
            self.server = server
            self.serverMessage = serverMessage
            self.built = built
            self.app = app
            self.platform = platform
            self.deadlineMs = deadlineMs
        }
    }

    /// `ready`: the feature may run. Otherwise `state` and the one sentence to show under the control (`message`), the
    /// `short` state (What's in Lab), and the one `button` the note may carry ("Open Settings", "Open setting", "Allow",
    /// "Copy Server code"). `state` is "lab-off" when Lab is off (its message is "Turn on Lab in {app} to use this.").
    public struct Result: Equatable, Sendable {
        public let ready: Bool
        public let state: String
        public let message: String?
        public let short: String?
        public let button: String?

        public init(ready: Bool, state: String, message: String?, short: String?, button: String?) {
            self.ready = ready
            self.state = state
            self.message = message
            self.short = short
            self.button = button
        }
    }

    /// Checks, in order: Lab on; paired; the Inbox capability (`Lab.featureCaps`); `local`; the server state (for server
    /// features, within `deadlineMs`: a server that has not answered by then is OFFLINE); `built`. `feature`: a Lab
    /// feature id (F01…) or a server feature key ("files", "ai", "pdf", "email", "feeds", "deliver"). When a later
    /// server call fails with a ServerError, call `DaylightServer.noteError(key, err)` (2.6).
    public static func run(_ feature: String, _ ctx: Context) async -> Result {
        func result(_ state: String, _ message: String?) -> Result {
            Result(ready: state == "ready", state: state, message: state == "ready" ? nil : message,
                   short: LabText.needsMessage(state, short: true), button: LabText.button(state))
        }
        func not(_ state: String, _ message: String? = nil) -> Result {
            result(state, message ?? LabText.needsMessage(state, app: ctx.app, platform: ctx.platform, feature: feature))
        }
        guard ctx.lab else {
            return Result(ready: false, state: "lab-off", message: LabText.labOff(app: ctx.app, platform: ctx.platform),
                          short: nil, button: nil)
        }
        guard ctx.paired else { return not("needs-pairing") }
        if let cap = Lab.featureCaps[feature], !ctx.hasCap(cap) { return not("needs-inbox") }
        if let local = await ctx.local(feature), local != "ready" { return not(local) }
        if let key = Lab.serverKey(feature) {
            guard let server = ctx.server else { return not("needs-server") }
            let r: ServerState
            do {
                r = try await Deadline.run(ms: ctx.deadlineMs, onTimeout: { ServerState("OFFLINE", nil) }) { try await server(key) }
            } catch let e as ServerError {
                r = e.code == "OFFLINE" ? ServerState("OFFLINE", e.message) : ServerState("error", e.message)
            } catch let e as ShareError {
                r = e.code == "OFFLINE" ? ServerState("OFFLINE", e.message) : ServerState("error", e.message)
            } catch {
                r = ServerState("error", nil)
            }
            if r.state != "ready" {
                if r.state == "needs-server" || r.state == "needs-lab-inbox" { return not(r.state) }
                let message = r.message ?? ctx.serverMessage?(r.state)
                return result(LabText.short(r.state) != nil ? r.state : "error", message)
            }
        }
        if !ctx.built(feature) { return not("later") }
        return result("ready", nil)
    }
}
