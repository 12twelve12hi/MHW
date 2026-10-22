import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Where the server client keeps its state (DESIGN 13.1): one JSON value per key (`ServerKeys`). `FileServerStore` keeps
/// them in `server.json` next to the outbox; `MemoryServerStore` serves tests.
public protocol ServerStore: AnyObject {
    func get(_ key: String) -> JSONValue?
    func set(_ key: String, _ value: JSONValue)
    func remove(_ key: String)
}

/// The storage keys of DESIGN 13.1, `server/pendingMove` included.
public enum ServerKeys {
    public static let config = "server/config"
    public static let configAt = "server/configAt"
    public static let pin = "server/pin"
    public static let pendingMove = "server/pendingMove"
    public static let status = "server/status"
    public static let statusAt = "server/statusAt"
    public static let badAuthAt = "server/badAuthAt"
    public static let manualUrl = "server/manualUrl"
    public static let hosted = "server/hosted"
    public static let hostedAckCursor = "server/hostedAckCursor"
    public static let emailAddress = "server/emailAddress"
    public static let notices = "server/notices"
    public static let all = [config, configAt, pin, pendingMove, status, statusAt, badAuthAt, manualUrl, hosted,
                             hostedAckCursor, emailAddress, notices]
}

/// A `ServerStore` in `server.json` (next to the outbox), coordinated like the outbox. A pairing change keeps it: the
/// pin is how an earlier pairing's server is told apart (pairing-mismatch). Every call touches storage: off the main
/// thread.
public final class FileServerStore: ServerStore, @unchecked Sendable {
    public static let fileName = "server.json"
    private let file: CoordinatedFile

    public init(directory: URL) {
        file = CoordinatedFile(url: directory.appendingPathComponent(Self.fileName), what: "server")
    }

    public convenience init(store: SharedStore) {
        self.init(directory: store.directory)
    }

    private static func members(_ data: Data?) -> [String: JSONValue] {
        data.flatMap { JSONValue.parse($0)?.object } ?? [:]
    }

    public func get(_ key: String) -> JSONValue? { Self.members(file.read())[key] }

    public func set(_ key: String, _ value: JSONValue) {
        file.update { data -> (write: Data?, result: Void) in
            var m = Self.members(data)
            m[key] = value
            return (JSONValue.object(m).data, ())
        }
    }

    public func remove(_ key: String) {
        file.update { data -> (write: Data?, result: Void) in
            var m = Self.members(data)
            guard m.removeValue(forKey: key) != nil else { return (nil, ()) }
            return (JSONValue.object(m).data, ())
        }
    }
}

/// A `ServerStore` in memory (tests).
public final class MemoryServerStore: ServerStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: JSONValue] = [:]

    public init(_ values: [String: JSONValue] = [:]) {
        self.values = values
    }

    public func get(_ key: String) -> JSONValue? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    public func set(_ key: String, _ value: JSONValue) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = value
    }

    public func remove(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = nil
    }

    public var keys: Set<String> {
        lock.lock()
        defer { lock.unlock() }
        return Set(values.keys)
    }
}

/// Runs async work against a deadline (the gate's 5 s, the status request's 5 s): its result, or `onTimeout`'s when it
/// has not finished in time (it is then cancelled and its result, whenever it comes, ignored). It returns at the deadline
/// whether or not the work honours cancellation, as JavaScript's `Promise.race` does.
public enum Deadline {
    public static func run<T: Sendable>(ms: Int64, onTimeout: @escaping @Sendable () throws -> T,
                                        _ work: @escaping @Sendable () async throws -> T) async throws -> T {
        let once = Once<T>()
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<T, Error>) in
            once.set(cont)
            let task = Task {
                do {
                    once.finish(.success(try await work()))
                } catch {
                    once.finish(.failure(error))
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(max(0, ms)) * 1_000_000)
                let r: Result<T, Error>
                do { r = .success(try onTimeout()) } catch { r = .failure(error) }
                if once.finish(r) { task.cancel() }
            }
        }
    }

    /// Resumes a continuation once: the first `finish` wins.
    private final class Once<T>: @unchecked Sendable {
        private let lock = NSLock()
        private var cont: CheckedContinuation<T, Error>?
        private var early: Result<T, Error>?

        func set(_ c: CheckedContinuation<T, Error>) {
            lock.lock()
            if let early {
                lock.unlock()
                c.resume(with: early)
                return
            }
            cont = c
            lock.unlock()
        }

        @discardableResult
        func finish(_ r: Result<T, Error>) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if let c = cont {
                cont = nil
                early = r // so a later finish sees it done
                c.resume(with: r)
                return true
            }
            if early == nil {
                early = r
                return true
            }
            return false
        }
    }
}

/// The app side of the Daylight server (DESIGN 13; LAB-PLAN 2.6's W0 subset), ported from
/// `server/client/daylight-server.js` under the same names: discovery (with TOFU pinning and moves), the setup link, the
/// manual address, the status and each feature's state, requests with the error mapping, `noteError`, the re-pairing
/// lock and the first-use notices. Discovery runs only with Lab on (DESIGN 4.3): the app decides when to call it. Every
/// method touches storage: call them off the main thread.
public final class DaylightServer: @unchecked Sendable {
    /// One HTTP exchange: the request -> the answer's body and response. Throws when there is no answer.
    public typealias Fetch = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    public static let urlSessionFetch: Fetch = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    public let pairing: Pairing
    public let store: ServerStore
    let fetch: Fetch
    /// The clock, ms since 1970.
    public let now: @Sendable () -> Int64
    let relay: String
    public let seed: Data
    public let values: ServerValues

    public init(pairing: Pairing, store: ServerStore, fetch: @escaping Fetch = DaylightServer.urlSessionFetch,
                now: @escaping @Sendable () -> Int64 = { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }) throws {
        self.pairing = pairing
        self.store = store
        self.fetch = fetch
        self.now = now
        relay = try ShareText.storedRelay(pairing.relay)
        seed = try ServerCode.deriveSeed(secret: pairing.secret)
        values = try ServerCode.derive(seed: seed)
    }

    /// The Server code to show in Lab settings, with Copy (`token`: the relay's access token, if any).
    public func serverCode(token: String? = nil) -> String {
        (try? ServerCode.format(seed: seed, relay: relay, token: token)) ?? ""
    }

    // MARK: Discovery (4.3)

    /// What `discover` found: the config to use, where it came from ("relay", "manual" or "cache"), and the new origin
    /// when the server moved (the old pin is used until `confirmMove`).
    public struct Discovery: Equatable {
        public let config: ServerConfig
        public let source: String
        public let moved: String?
    }

    /// -> the config, or nil when no server announced itself. Applies TOFU (4.3). Throws ServerError OFFLINE when the
    /// relay cannot be read and nothing is cached.
    public func discover(force: Bool = false) async throws -> Discovery? {
        if let manual = store.get(ServerKeys.manualUrl)?.string, !manual.isEmpty {
            return Discovery(config: ServerConfig(server: manual, api: ServerCode.serverAPI, fingerprint: values.fingerprint,
                                                  delivery: "lab"), source: "manual", moved: nil)
        }
        var cached = ServerConfig(json: store.get(ServerKeys.config))
        if cached?.fingerprint != values.fingerprint { cached = nil }
        let at = store.get(ServerKeys.configAt)?.safeInteger ?? 0
        if !force, let cached, now() - at < ServerCode.configRefreshMs { return applyPin(cached, source: "cache") }
        var found: ServerConfig?
        do {
            for e in try await Self.pollServerTopic(fetch: fetch, relay: relay, topic: values.configTopic, maxMessages: 50) {
                guard let frame = e.frame, let opened = try? ServerBox.open(values: values, aad: ServerBox.config, frame: frame),
                      let c = ServerConfig.check(opened.header, now: now()), c.fingerprint == values.fingerprint else { continue }
                if found.map({ c.sent > $0.sent }) ?? true { found = c }
            }
        } catch {
            if let cached { return applyPin(cached, source: "cache") }
            throw (error as? ServerError) ?? ServerError("OFFLINE")
        }
        guard let fresh = found else { return cached.map { applyPin($0, source: "cache") } }
        store.set(ServerKeys.config, fresh.json)
        store.set(ServerKeys.configAt, .number(Double(now())))
        return applyPin(fresh, source: "relay")
    }

    private func applyPin(_ config: ServerConfig, source: String) -> Discovery {
        guard let pin = store.get(ServerKeys.pin), pin["fingerprint"]?.string == config.fingerprint else {
            store.set(ServerKeys.pin, .object(["origin": .string(config.server), "fingerprint": .string(config.fingerprint)]))
            return Discovery(config: config, source: source, moved: nil)
        }
        let origin = pin["origin"]?.string
        if origin != config.server {
            store.set(ServerKeys.pendingMove, .object(["origin": .string(config.server), "fingerprint": .string(config.fingerprint)]))
            var old = config
            old.server = origin ?? config.server
            return Discovery(config: old, source: source, moved: config.server)
        }
        return Discovery(config: config, source: source, moved: nil)
    }

    /// Accepts a changed server origin after the user said yes to "Your Daylight server moved to {host}. Use it?".
    @discardableResult
    public func confirmMove() -> Bool {
        guard let p = store.get(ServerKeys.pendingMove) else { return false }
        store.set(ServerKeys.pin, p)
        store.remove(ServerKeys.pendingMove)
        store.remove(ServerKeys.status)
        return true
    }

    /// The origin discovery found for this pairing when the server moved and the user has not answered yet (a typed
    /// Server address wins over discovery, so then none). -> the new origin, or nil.
    public func pendingMove() -> String? {
        guard store.get(ServerKeys.manualUrl)?.string?.isEmpty ?? true,
              let move = store.get(ServerKeys.pendingMove), let origin = move["origin"]?.string,
              move["fingerprint"]?.string == values.fingerprint,
              let pin = store.get(ServerKeys.pin), pin["fingerprint"]?.string == values.fingerprint, pin["origin"]?.string != origin,
              let config = ServerConfig(json: store.get(ServerKeys.config)), config.server == origin,
              config.fingerprint == values.fingerprint else { return nil }
        return origin
    }

    // MARK: The setup link (3.5)

    /// What `setup` answers: the server's origin, its fingerprint and its delivery mode.
    public struct SetupResult: Equatable {
        public let server: String
        public let fingerprint: String
        public let delivery: String
    }

    /// Lab settings › Daylight server › Set up with a link (3.5): sends this pairing's Server code to a newly deployed
    /// server with the deploy's one-time setup link, then pins the server's origin (the user gave it) and caches its
    /// config. Throws ServerError: BAD_REQUEST (not a setup link; `message` says why, `reason` is the parse reason),
    /// SETUP_INVALID (an old or wrong link), SETUP_USED (used for another pairing), OFFLINE, or the server's own error.
    @discardableResult
    public func setup(link: String, token: String? = nil) async throws -> SetupResult {
        let parsed: ServerCode.SetupLink
        do {
            parsed = try ServerCode.parseSetupLink(link)
        } catch let e as ShareError {
            throw ServerError("BAD_REQUEST", message: e.message, fields: ["reason": .string(e.reason)])
        }
        guard let url = URL(string: parsed.server + "/v1/setup") else { throw ServerError("BAD_REQUEST", message: ServerCode.setupFormatText) }
        let bearer = try ServerCode.deriveSetupToken(secret: parsed.secret)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = JSONOut.object([("code", .string(serverCode(token: token)))]).data
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await fetch(req)
        } catch {
            throw ServerError("OFFLINE")
        }
        let text = String(decoding: data, as: UTF8.self)
        let answer = ShareText.jsTrim(text).isEmpty ? nil : JSONValue.parse(text)
        let err = answer?["error"]
        let ok = (200..<300).contains(response.statusCode)
        if !ok || Self.jsTruthy(err) {
            // 401 (a wrong or replaced link) and 404 (no server, or no setup pending there): not the current link.
            if response.statusCode == 401 || response.statusCode == 404 { throw ServerError("SETUP_INVALID", status: response.statusCode) }
            if let eo = err?.object, let code = eo["code"]?.string, ServerMessages.isServerCode(code) {
                var fields = eo
                fields["code"] = nil
                if fields["message"]?.string == nil { fields["message"] = nil }
                throw ServerError(code, status: response.statusCode, fields: fields)
            }
            throw ServerError("SERVER_ERROR", status: response.statusCode)
        }
        var header: [String: JSONValue] = ["v": .number(1), "kind": .string("config"), "id": .string(""),
                                           "sent": .string(Lab.isoTime(now()))]
        for (k, v) in answer?.object ?? [:] { header[k] = v }
        guard let config = ServerConfig.check(.object(header), now: now()), config.server == parsed.server,
              config.fingerprint == values.fingerprint else {
            throw ServerError("SERVER_ERROR", message: "The Daylight server answered for another pairing. Run the deploy with “New setup link” and try again.",
                              status: response.statusCode)
        }
        if config.api < ServerCode.serverAPIMin { throw ServerError("server-outdated", message: ServerMessages.localMessage("server-outdated")) }
        if config.api > ServerCode.serverAPI { throw ServerError("app-outdated", message: ServerMessages.localMessage("app-outdated")) }
        store.set(ServerKeys.config, config.json)
        store.set(ServerKeys.configAt, .number(Double(now())))
        store.set(ServerKeys.pin, .object(["origin": .string(config.server), "fingerprint": .string(config.fingerprint)]))
        for k in [ServerKeys.pendingMove, ServerKeys.status, ServerKeys.statusAt, ServerKeys.badAuthAt, ServerKeys.manualUrl] {
            store.remove(k)
        }
        return SetupResult(server: config.server, fingerprint: config.fingerprint, delivery: config.delivery)
    }

    // MARK: The Server address field

    /// Lab settings › Daylight server › Server address: validates `url` with GET /v1/hello, then /v1/status. -> the
    /// origin. Throws ServerError BAD_REQUEST (not an https address), OFFLINE, NOT_FOUND (no Daylight server there) or
    /// the status request's error.
    @discardableResult
    public func setManualUrl(_ url: String) async throws -> String {
        guard let origin = Self.manualOrigin(url), let hello = URL(string: origin + "/v1/hello") else {
            throw ServerError("BAD_REQUEST", message: "That isn’t a server address (https://…).")
        }
        var answer: JSONValue?
        do {
            var req = URLRequest(url: hello)
            req.httpMethod = "GET"
            let (data, _) = try await fetch(req)
            answer = JSONValue.parse(data)
        } catch {
            throw ServerError("OFFLINE")
        }
        guard let answer else { throw ServerError("OFFLINE") }
        guard answer["service"]?.string == "daylight-server" else {
            throw ServerError("NOT_FOUND", message: "No Daylight server answers at that address.")
        }
        store.set(ServerKeys.manualUrl, .string(origin))
        store.remove(ServerKeys.status)
        do {
            _ = try await status(force: true)
        } catch {
            store.remove(ServerKeys.manualUrl)
            throw error
        }
        return origin
    }

    public func clearManualUrl() {
        store.remove(ServerKeys.manualUrl)
        store.remove(ServerKeys.status)
    }

    /// The typed Server address, or "".
    public var manualUrl: String { store.get(ServerKeys.manualUrl)?.string ?? "" }

    /// The manual address's origin: https, or http on localhost / 127.0.0.1 (tests); nil for anything else, and for a
    /// host a URL parser would write differently.
    static func manualOrigin(_ url: String) -> String? {
        let s = ShareText.jsTrim(url)
        let lower = s.lowercased()
        let scheme: String
        if lower.hasPrefix("https://") {
            scheme = "https"
        } else if lower.hasPrefix("http://") {
            scheme = "http"
        } else {
            return nil
        }
        let rest = s.dropFirst(scheme.count + 3)
        let authority = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        guard !authority.isEmpty, !authority.contains("@"), !authority.contains(where: { $0.isWhitespace }) else { return nil }
        let a = authority.lowercased()
        var host = a
        var portText = ""
        if a.hasPrefix("[") {
            guard let close = a.firstIndex(of: "]") else { return nil }
            host = String(a[...close])
            let after = a[a.index(after: close)...]
            if !after.isEmpty {
                guard after.hasPrefix(":") else { return nil }
                portText = String(after.dropFirst())
            }
        } else if let colon = a.firstIndex(of: ":") {
            host = String(a[..<colon])
            portText = String(a[a.index(after: colon)...])
        }
        let hostOK: Bool
        if host.hasPrefix("[") {
            hostOK = host.dropFirst().dropLast().unicodeScalars.allSatisfy({ WebHost.isLowerHex($0) || $0 == ":" || $0 == "." })
        } else {
            hostOK = host.unicodeScalars.allSatisfy({ WebHost.isHostChar($0) })
        }
        guard !host.isEmpty, hostOK else { return nil }
        if scheme == "http" && host != "localhost" && host != "127.0.0.1" { return nil }
        guard WebHost.isCanonical(host) else { return nil }
        var port: Int?
        if !portText.isEmpty {
            guard portText.count <= 5, portText.unicodeScalars.allSatisfy(ShareText.isDigit), let p = Int(portText), p <= 65535
            else { return nil }
            port = p
        }
        if let port, port != (scheme == "https" ? 443 : 80) { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    // MARK: Requests

    /// The origin to call: throws ServerError needs-server, pairing-mismatch, server-outdated or app-outdated.
    public func origin() async throws -> String {
        guard let d = try await discover() else {
            let pin = store.get(ServerKeys.pin)
            let state = pin != nil && pin?["fingerprint"]?.string != values.fingerprint ? "pairing-mismatch" : "needs-server"
            throw ServerError(state, message: ServerMessages.localMessage(state))
        }
        if d.config.api < ServerCode.serverAPIMin {
            throw ServerError("server-outdated", message: ServerMessages.localMessage("server-outdated"))
        }
        // Additive changes keep the major version; a higher major means this app is too old for the server.
        if d.config.api > ServerCode.serverAPI {
            throw ServerError("app-outdated", message: ServerMessages.localMessage("app-outdated"))
        }
        return d.config.server
    }

    /// A Bearer request to the server. `json` is sent as JSON, else `body`. -> the parsed JSON answer ({} for an empty
    /// one). An error object whose code is a server code throws that ServerError; any other answer that is not 2xx
    /// throws BAD_AUTH (401) or SERVER_ERROR; no answer throws OFFLINE.
    @discardableResult
    public func request(_ method: String, _ path: String, json: JSONOut? = nil, body: Data? = nil,
                        query: [(String, String)] = [], headers: [String: String] = [:]) async throws -> JSONValue {
        let origin = try await origin()
        let q = query.isEmpty ? "" : "?" + query.map { ServerCode.formEncode($0.0) + "=" + ServerCode.formEncode($0.1) }.joined(separator: "&")
        guard let url = URL(string: origin + path + q) else { throw ServerError("BAD_REQUEST") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(values.authToken)", forHTTPHeaderField: "Authorization")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if let json {
            req.httpBody = json.data
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if let body {
            req.httpBody = body
        }
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await fetch(req)
        } catch {
            throw ServerError("OFFLINE")
        }
        if let e = ServerError.from(status: response.statusCode, body: data) { throw e }
        let text = String(decoding: data, as: UTF8.self)
        return (ShareText.jsTrim(text).isEmpty ? nil : JSONValue.parse(text)) ?? .object([:])
    }

    /// GET /v1/status, cached for 10 minutes; the request waits at most `waitMs`. Offline, a cached status is returned.
    @discardableResult
    public func status(force: Bool = false, waitMs: Int64 = 5_000) async throws -> JSONValue {
        let cached = store.get(ServerKeys.status)
        let at = store.get(ServerKeys.statusAt)?.safeInteger ?? 0
        if !force, let cached, now() - at < ServerCode.statusRefreshMs { return cached }
        do {
            let s = try await Deadline.run(ms: waitMs, onTimeout: { throw ServerError("OFFLINE") }) { [self] in
                try await request("GET", "/v1/status")
            }
            store.set(ServerKeys.status, s)
            store.set(ServerKeys.statusAt, .number(Double(now())))
            store.remove(ServerKeys.badAuthAt) // the server knows this device again: a later BAD_AUTH re-reads the config
            return s
        } catch let e as ServerError where e.code == "OFFLINE" {
            if let cached { return cached }
            throw e
        }
    }

    /// A feature's state from the cached config and status (DESIGN 14.1): ready, needs-server, pairing-mismatch,
    /// server-outdated, app-outdated, locked, needs-key, needs-domain, needs-r2, needs-lab-inbox, needs-paid, error or
    /// OFFLINE. Refreshes a status older than 10 minutes. Discovery and its relay poll have no deadline of their own, so
    /// the Lab gate races this against its own 5 s. An error goes through `noteError`. Never throws.
    public func state(_ feature: String) async -> ServerState {
        let s: JSONValue
        do {
            _ = try await origin()
            s = try await status()
        } catch {
            return noteError(feature, error)
        }
        return ServerMessages.stateFromStatus(s, feature: feature)
    }

    /// After a server call for `feature` failed with `err` (LAB-PLAN 2.6, DESIGN 10.4): updates the cached status and
    /// returns the state to show now (`ServerMessages.stateFromError`). Only this class writes `server/status`.
    /// - NEEDS_KEY, NEEDS_LAB_INBOX, and NOT_CONFIGURED for the email domain or R2: the feature the error names (else
    ///   `feature`) takes that state in the cached status, which is marked for refresh.
    /// - LOCKED, BAD_AUTH and NOT_CONFIGURED for DAYLIGHT_SERVER_CODE concern the whole server: the cached status is
    ///   dropped. The first BAD_AUTH of an episode also sets `server/badAuthAt` and removes `server/configAt`, so the next
    ///   discovery re-reads the config topic once.
    /// - Anything else (OFFLINE, RATE_LIMITED, AI_BUSY, …) leaves the cache as it is.
    @discardableResult
    public func noteError(_ feature: String, _ err: Error) -> ServerState {
        let out = ServerMessages.stateFromError(err)
        let e = err as? ServerError
        let code = e?.code ?? ""
        if code == "LOCKED" || code == "BAD_AUTH" || (code == "NOT_CONFIGURED" && out.state == "needs-server") {
            store.remove(ServerKeys.status)
            store.remove(ServerKeys.statusAt)
            if code == "BAD_AUTH" && store.get(ServerKeys.badAuthAt) == nil {
                store.set(ServerKeys.badAuthAt, .number(Double(now())))
                store.remove(ServerKeys.configAt)
            }
        } else if code == "NEEDS_KEY" || code == "NEEDS_LAB_INBOX" || code == "NOT_CONFIGURED" {
            var key: String?
            if let named = e?.feature, ServerCode.features.contains(named) {
                key = named
            } else if ServerCode.features.contains(feature) {
                key = feature
            }
            if let key, let cached = store.get(ServerKeys.status), var top = cached.object {
                var features = top["features"]?.object ?? [:]
                let message: JSONValue = out.message.map { JSONValue.string($0) } ?? JSONValue.null
                features[key] = .object(["state": .string(out.state), "message": message])
                top["features"] = .object(features)
                store.set(ServerKeys.status, .object(top))
                store.remove(ServerKeys.statusAt)
            }
        }
        return out
    }

    // MARK: Notices and re-pairing

    /// The first-use notice for a feature (14.3), or nil once shown. Call `markNoticeShown` after Continue.
    public func notice(_ feature: String) -> String? {
        let shown = store.get(ServerKeys.notices)?.object ?? [:]
        if shown[feature == "pdf" ? "ai" : feature]?.bool == true { return nil }
        let delivery = store.get(ServerKeys.config)?["delivery"]?.string ?? "lab"
        return ServerMessages.noticeText(feature, delivery: delivery)
    }

    public func markNoticeShown(_ feature: String) {
        var shown = store.get(ServerKeys.notices)?.object ?? [:]
        shown[feature == "pdf" ? "ai" : feature] = .bool(true)
        store.set(ServerKeys.notices, .object(shown))
    }

    /// Before re-pairing: POST /v1/admin/lock with the old token (DESIGN 3.4), whether Lab is on or off. Never throws.
    @discardableResult
    public func lockBeforeRepair() async -> Bool {
        store.remove(ServerKeys.status)
        store.remove(ServerKeys.badAuthAt)
        do {
            _ = try await request("POST", "/v1/admin/lock", json: .object([]))
            return true
        } catch {
            return false
        }
    }

    /// JavaScript truthiness of a JSON value (nil = undefined).
    static func jsTruthy(_ v: JSONValue?) -> Bool {
        switch v {
        case nil, .null?: return false
        case let .bool(b)?: return b
        case let .number(d)?: return d != 0 && !d.isNaN
        case let .string(s)?: return !s.isEmpty
        default: return true
        }
    }

    // MARK: The config topic

    /// One message of a server topic: its ntfy id, relay time (s) and frame (nil for attachments and junk).
    public struct TopicMessage {
        public let id: String
        public let time: Int
        public let frame: Data?
    }

    /// Polls a server topic the hardened way (DESIGN 4.3, 5.4): at most `maxBytes` of the answer (a line the cap cuts
    /// is dropped) and `maxMessages` messages; attachments are never downloaded. Throws ServerError OFFLINE when the
    /// relay does not answer 2xx or cannot be reached.
    public static func pollServerTopic(fetch: Fetch, relay: String, topic: String, since: String = "all",
                                       maxBytes: Int = 262_144, maxMessages: Int = 200, token: String = "") async throws -> [TopicMessage] {
        let base = (try? ShareText.normalizeRelay(relay)) ?? relay
        var q = "poll=1&since=" + ServerCode.formEncode(since)
        if !token.isEmpty { q += "&auth=" + ServerCode.formEncode(token) }
        guard let url = URL(string: "\(base)/\(topic)/json?\(q)") else { throw ServerError("OFFLINE") }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await fetch(req)
        } catch {
            throw ServerError("OFFLINE")
        }
        guard (200..<300).contains(response.statusCode) else { throw ServerError("OFFLINE", status: response.statusCode) }
        let capped = data.prefix(maxBytes)
        var lines = capped.split(separator: 0x0A, omittingEmptySubsequences: false)
        if capped.last != 0x0A { lines.removeLast() } // a line cut by the byte cap
        var out: [TopicMessage] = []
        for line in lines {
            if out.count >= maxMessages { break }
            guard let m = JSONValue.parse(Data(line))?.object, m["event"]?.string == "message", let id = m["id"]?.string else { continue }
            let time = m["time"]?.safeInteger.map { Int($0) } ?? 0
            var frame: Data?
            if !jsTruthy(m["attachment"]), let text = m["message"]?.string { frame = Base64.decode(text) }
            out.append(TopicMessage(id: id, time: time, frame: frame))
        }
        return out
    }
}
