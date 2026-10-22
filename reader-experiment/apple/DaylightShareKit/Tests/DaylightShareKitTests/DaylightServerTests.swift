import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// A stand-in for the relay's config topic and a Daylight server, as `DaylightServer.Fetch` sees them.
final class StubNet: @unchecked Sendable {
    typealias Answer = (status: Int, body: Data)
    private let lock = NSLock()
    private var routes: [(method: String, prefix: String, answer: @Sendable (URLRequest) -> Answer)] = []
    private var seen: [URLRequest] = []
    /// When set, no request is answered (a server that never answers).
    var hang = false

    func route(_ method: String, _ prefix: String, _ answer: @escaping @Sendable (URLRequest) -> Answer) {
        lock.lock()
        routes.insert((method, prefix, answer), at: 0)
        lock.unlock()
    }

    func json(_ method: String, _ prefix: String, status: Int = 200, _ object: Any) {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
        route(method, prefix) { _ in (status, data) }
    }

    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }

    /// Notes the request and finds its route (and whether to hang).
    private func take(_ req: URLRequest) -> (hang: Bool, answer: (@Sendable (URLRequest) -> Answer)?) {
        lock.lock()
        defer { lock.unlock() }
        seen.append(req)
        let match = routes.first { req.httpMethod == $0.method && (req.url?.absoluteString ?? "").hasPrefix($0.prefix) }
        return (hang, match?.answer)
    }

    var fetch: DaylightServer.Fetch {
        { [self] req in
            let (hang, match) = take(req)
            if hang {
                try await Task.sleep(nanoseconds: 60_000_000_000)
            }
            guard let match else { throw URLError(.cannotConnectToHost) }
            let a = match(req)
            return (a.body, HTTPURLResponse(url: req.url!, statusCode: a.status, httpVersion: "HTTP/1.1", headerFields: nil)!)
        }
    }
}

/// The server client's flows (LAB-PLAN 2.6) through `LabCenter`, as the Lab screens use them: no server yet, a server
/// found on its config topic, a move, an earlier pairing's pin, the setup link, the manual address and the gate's 5 s.
final class DaylightServerTests: XCTestCase {
    var root: URL!
    var suite = ""
    let origin = "https://daylight-0123456789ab.example.workers.dev"
    let now: Int64 = 1_792_486_800_000

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dls-server-\(UUID().uuidString)")
        suite = "dls-server-tests-\(UUID().uuidString)"
    }

    override func tearDown() {
        UserDefaults.standard.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    func paired() async throws -> (SharedStore, Pairing) {
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: root.appendingPathComponent("store"))
        let pairing = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        await store.pair(pairing)
        return (store, pairing)
    }

    func center(_ store: SharedStore, _ net: StubNet) -> LabCenter {
        let t = now
        return LabCenter(store: store, platform: "iphone", fetch: net.fetch, now: { t })
    }

    func values(_ pairing: Pairing) throws -> ServerValues {
        try ServerCode.derive(seed: ServerCode.deriveSeed(secret: pairing.secret))
    }

    /// Announces a server on the pairing's config topic.
    func announce(_ net: StubNet, _ pairing: Pairing, server: String, delivery: String = "lab", fingerprint: String? = nil) throws {
        let v = try values(pairing)
        let header = JSONOut.object([("v", .int(1)), ("kind", .string("config")), ("id", .string("c1")),
                                     ("sent", .string(Lab.isoTime(now - 60_000))), ("server", .string(server)), ("api", .int(1)),
                                     ("fingerprint", .string(fingerprint ?? v.fingerprint)), ("delivery", .string(delivery))])
        let frame = try ServerBox.seal(values: v, aad: ServerBox.config, header: header)
        let line = try JSONSerialization.data(withJSONObject: ["id": "m1", "time": Int(now / 1000) - 60, "event": "message",
                                                                "topic": v.configTopic, "message": Base64.encode(frame)])
        let body = line + Data([0x0A])
        net.route("GET", "https://relay.test/\(v.configTopic)/json") { _ in (200, body) }
    }

    func status(features: [String: String] = [:]) -> [String: Any] {
        var f: [String: Any] = [:]
        for key in ServerCode.features { f[key] = ["state": features[key] ?? "ready"] }
        return ["server": origin, "api": 1, "delivery": "lab", "features": f,
                "inbox": ["lab": true, "lastSeen": "2026-10-20T08:56:00.000Z"], "usage": ["ai": ["usd": 0.227, "limitUsd": 3]]]
    }

    // MARK: No server

    func testNoServerYetIsNeedsServerWithTheSetupSteps() async throws {
        let (store, pairing) = try await paired()
        let net = StubNet()
        net.route("GET", "https://relay.test/") { _ in (200, Data()) }
        let c = center(store, net)
        let gate = await c.gate("F37")
        XCTAssertEqual(gate.state, "needs-server")
        XCTAssertEqual(gate.message, "Needs your Daylight server. Add the Cloudflare secrets to turn this on (Lab › Daylight server shows how).")
        XCTAssertEqual(gate.button, "Copy Server code")
        XCTAssertEqual(gate.short, "Needs your Daylight server")

        let o = await c.overview(refresh: true, deadlineMs: 1_000)
        XCTAssertTrue(o.lab)
        XCTAssertEqual(o.header, "Needs Lab on your Daylight")
        XCTAssertEqual(o.serverState, "needs-server")
        XCTAssertEqual(o.serverShort, "Not set up")
        XCTAssertEqual(o.serverRows.map(\.id), ["F02", "F37", "F19", "F36"])
        XCTAssertEqual(o.serverRows.map(\.short), [nil, nil, nil, nil], "a row's own short state shows only when it differs")
        XCTAssertEqual(o.features, [], "a W0 build lists the server features only")

        let vAnswer = await c.serverView(deadlineMs: 1_000)
        let v = try XCTUnwrap(vAnswer)
        XCTAssertEqual(v.state, "needs-server")
        XCTAssertEqual(v.message, ServerMessages.stateMessages["needs-server"])
        XCTAssertTrue(v.showSteps)
        XCTAssertTrue(v.setupFirst)
        XCTAssertNil(v.delivery)
        XCTAssertEqual(v.serverCode, try ServerCode.format(seed: ServerCode.deriveSeed(secret: pairing.secret)))
        XCTAssertEqual(v.hostLine, ServerCode.showFingerprint(try values(pairing).fingerprint))
        let rowState = await c.serverRowState()
        XCTAssertEqual(LabText.serverRowSubtitle(rowState ?? ""), "Optional · Not set up")
    }

    func testAnEarlierPairingsPinIsPairingMismatch() async throws {
        let (store, _) = try await paired()
        FileServerStore(store: store).set(ServerKeys.pin, .object(["origin": .string(origin), "fingerprint": .string("00000000")]))
        let net = StubNet()
        net.route("GET", "https://relay.test/") { _ in (200, Data()) }
        let vAnswer = await center(store, net).serverView(deadlineMs: 1_000)
        let v = try XCTUnwrap(vAnswer)
        XCTAssertEqual(v.state, "pairing-mismatch")
        XCTAssertTrue(v.setupFirst)
        XCTAssertFalse(v.showSteps)
    }

    // MARK: A server

    func testAServerOnItsConfigTopicIsPinnedAndAskedForItsStatus() async throws {
        let (store, pairing) = try await paired()
        let net = StubNet()
        try announce(net, pairing, server: origin)
        net.json("GET", "\(origin)/v1/status", status(features: ["ai": "needs-key", "pdf": "needs-key"]))
        let c = center(store, net)
        let ai = await c.gate("F37")
        XCTAssertEqual(ai.state, "needs-key")
        XCTAssertEqual(ai.message, ServerMessages.stateMessages["needs-key"])
        XCTAssertEqual(ai.short, "Needs a Claude key")
        let files = await c.gate("F02")
        XCTAssertEqual(files.state, "later", "the server is ready; this app does not build F02 yet (Wave S)")
        XCTAssertEqual(files.message, "Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.")
        let auth = net.requests.first { $0.url?.path == "/v1/status" }?.value(forHTTPHeaderField: "Authorization")
        XCTAssertEqual(auth, "Bearer \(try values(pairing).authToken)")
        XCTAssertEqual(FileServerStore(store: store).get(ServerKeys.pin)?["origin"]?.string, origin)

        let o = await c.overview(refresh: false)
        XCTAssertEqual(o.serverState, "ready")
        XCTAssertEqual(o.serverShort, "Ready")
        XCTAssertEqual(o.serverRows.map(\.short), ["In a later update", "Needs a Claude key", "In a later update", "In a later update"])

        let vAnswer = await c.serverView(deadlineMs: 1_000)
        let v = try XCTUnwrap(vAnswer)
        XCTAssertEqual(v.message, "Ready")
        XCTAssertEqual(v.hostLine, "daylight-0123456789ab.example.workers.dev · \(ServerCode.showFingerprint(try values(pairing).fingerprint))")
        XCTAssertEqual(v.delivery, "lab")
        XCTAssertNil(v.v1Notice)
        XCTAssertEqual(v.labInbox, "Lab Inbox last seen 4 min ago")
        XCTAssertEqual(v.aiToday, "AI today: US$0.23 of US$3")
        XCTAssertFalse(v.setupFirst)
        XCTAssertFalse(v.showSteps)
        XCTAssertNil(v.moved)
    }

    func testAMovedServerIsUsedOnlyAfterTheUserSaysYes() async throws {
        let (store, pairing) = try await paired()
        let fp = try values(pairing).fingerprint
        let moved = "https://daylight-ffffffffffff.example.workers.dev"
        FileServerStore(store: store).set(ServerKeys.pin, .object(["origin": .string(origin), "fingerprint": .string(fp)]))
        let net = StubNet()
        try announce(net, pairing, server: moved)
        net.json("GET", "\(origin)/v1/status", status())
        net.json("GET", "\(moved)/v1/status", status())
        let c = center(store, net)
        let vAnswer = await c.serverView(deadlineMs: 1_000)
        let v = try XCTUnwrap(vAnswer)
        XCTAssertEqual(v.state, "ready")
        XCTAssertEqual(v.moved, "Your Daylight server moved to daylight-ffffffffffff.example.workers.dev. Use it?")
        XCTAssertTrue(v.hostLine.hasPrefix("daylight-0123456789ab."), "the old pin until the user says yes")
        XCTAssertTrue(c.confirmMove())
        XCTAssertEqual(FileServerStore(store: store).get(ServerKeys.pin)?["origin"]?.string, moved)
        let afterAnswer = await c.serverView(deadlineMs: 1_000)
        let after = try XCTUnwrap(afterAnswer)
        XCTAssertNil(after.moved)
        XCTAssertTrue(after.hostLine.hasPrefix("daylight-ffffffffffff."))
    }

    func testV1DeliveryShowsItsNotice() async throws {
        let (store, pairing) = try await paired()
        let net = StubNet()
        try announce(net, pairing, server: origin, delivery: "v1")
        net.json("GET", "\(origin)/v1/status", status())
        let vAnswer = await center(store, net).serverView(deadlineMs: 1_000)
        let v = try XCTUnwrap(vAnswer)
        XCTAssertEqual(v.delivery, "v1")
        XCTAssertEqual(v.v1Notice, ServerMessages.noticeText("v1"))
    }

    // MARK: The setup link and the manual address

    func testSetUpWithALink() async throws {
        let (store, pairing) = try await paired()
        let net = StubNet()
        net.route("GET", "https://relay.test/") { _ in (200, Data()) }
        let link = "https://daylight-0123456789ab.example.workers.dev/setup#SETUP-JRTK-XSYV-FBNR-BSJP-AGJI-ZIDS-SD2A"
        let token = try ServerCode.deriveSetupToken(secret: ServerCode.parseSetupLink(link).secret)
        let fp = try values(pairing).fingerprint
        let code = try ServerCode.format(seed: ServerCode.deriveSeed(secret: pairing.secret))
        net.route("POST", "\(origin)/v1/setup") { req in
            guard req.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)",
                  let body = req.httpBody, let j = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  j["code"] as? String == code else { return (401, Data()) }
            let answer: [String: Any] = ["server": "https://daylight-0123456789ab.example.workers.dev", "api": 1, "fingerprint": fp, "delivery": "lab"]
            return (200, try! JSONSerialization.data(withJSONObject: answer))
        }
        let c = center(store, net)
        let error = await c.setup(link: link)
        XCTAssertNil(error)
        let s = FileServerStore(store: store)
        XCTAssertEqual(s.get(ServerKeys.pin)?["origin"]?.string, origin)
        XCTAssertEqual(s.get(ServerKeys.config)?["fingerprint"]?.string, fp)

        net.json("POST", "\(origin)/v1/setup", status: 401, ["error": ["code": "BAD_AUTH"]])
        let refused = await c.setup(link: link)
        XCTAssertEqual(refused, ServerMessages.errorMessage("SETUP_INVALID"))
        net.json("POST", "\(origin)/v1/setup", status: 409, ["error": ["code": "SETUP_USED", "message": 5]])
        let used = await c.setup(link: link)
        XCTAssertEqual(used, ServerMessages.errorMessage("SETUP_USED"))
        let bad = await c.setup(link: "https://example.com/setup#SETUP-JRTK-XSYV-FBNR-BSJP-AGJI-ZIDS-SD2A")
        XCTAssertEqual(bad, ServerCode.setupHostText)
        XCTAssertEqual(net.requests.filter { $0.url?.host == "example.com" }.count, 0, "a refused link sends nothing")
    }

    func testTheServerAddress() async throws {
        let (store, _) = try await paired()
        let net = StubNet()
        let mine = "https://my.server.example"
        net.json("GET", "\(mine)/v1/hello", ["service": "daylight-server"])
        net.json("GET", "\(mine)/v1/status", status())
        let c = center(store, net)
        let none = await c.saveServerAddress("ftp://my.server.example")
        XCTAssertEqual(none, "That isn’t a server address (https://…).")
        let ok = await c.saveServerAddress(" https://My.Server.example:443/path ")
        XCTAssertNil(ok)
        XCTAssertEqual(FileServerStore(store: store).get(ServerKeys.manualUrl)?.string, mine)
        let vAnswer = await c.serverView(deadlineMs: 1_000)
        let v = try XCTUnwrap(vAnswer)
        XCTAssertEqual(v.manualUrl, mine)
        XCTAssertEqual(v.state, "ready")
        let cleared = await c.saveServerAddress("")
        XCTAssertNil(cleared)
        XCTAssertNil(FileServerStore(store: store).get(ServerKeys.manualUrl))

        XCTAssertEqual(DaylightServer.manualOrigin("http://localhost:8787/x"), "http://localhost:8787")
        XCTAssertNil(DaylightServer.manualOrigin("http://example.com"))
        XCTAssertNil(DaylightServer.manualOrigin("https://0x7f.1"), "a host a URL parser would rewrite")
        XCTAssertEqual(DaylightServer.manualOrigin("https://[::1]:8443"), "https://[::1]:8443")
        XCTAssertNil(DaylightServer.manualOrigin("https://[0:0::1]"))
    }

    // MARK: The gate's 5 s (1.5, 2.6)

    func testAServerThatNeverAnswersIsOfflineAtTheGatesDeadline() async throws {
        let (store, _) = try await paired()
        let net = StubNet()
        net.hang = true
        let c = center(store, net)
        let started = Date()
        let r = await c.gate("F37", deadlineMs: 300)
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
        XCTAssertEqual(r.state, "OFFLINE")
        XCTAssertEqual(r.message, ServerMessages.stateMessages["OFFLINE"])
        XCTAssertEqual(r.short, "Can’t reach the server")
        let p = await c.probeInTime(deadlineMs: 300)
        XCTAssertEqual(p.state, "OFFLINE")
    }

    func testLockBeforeRepair() async throws {
        let (store, pairing) = try await paired()
        let net = StubNet()
        try announce(net, pairing, server: origin)
        net.json("POST", "\(origin)/v1/admin/lock", ["ok": true])
        let c = center(store, net)
        let none = await c.lockBeforeRepair()
        XCTAssertFalse(none, "no pin: nothing to lock")
        _ = await c.probe(force: true)
        let locked = await c.lockBeforeRepair()
        XCTAssertTrue(locked)
        XCTAssertTrue(net.requests.contains { $0.url?.path == "/v1/admin/lock" && $0.httpMethod == "POST" })
    }
}
