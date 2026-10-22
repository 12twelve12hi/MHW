import Foundation
import XCTest
@testable import DaylightShareKit

/// The Daylight server vectors (reader-experiment/server/vectors/server-vectors.json), the W0 subset of LAB-PLAN 2.6:
/// derived, serverCodeParsing, frames (config), negative (config), serverState and setupLinks. (publicUrl, hosted and
/// the item and ack frames are Wave S.)
final class ServerVectorTests: XCTestCase {
    static let vectors = LabVectorTests.load("server/vectors/server-vectors.json")

    func hex(_ s: Any?) -> Data { Hex.decode(s as? String ?? "")! }
    func json(_ v: Any?) -> JSONValue { JSONValue(foundation: v) ?? .null }
    var secret: Data { hex(Self.vectors["secretHex"]) }

    func values() throws -> ServerValues { try ServerCode.derive(seed: ServerCode.deriveSeed(secret: secret)) }

    // MARK: derived

    func testDerivedValues() throws {
        let d = Self.vectors["derived"] as! [String: Any]
        let seed = try ServerCode.deriveSeed(secret: secret)
        XCTAssertEqual(seed.hexString, d["seedHex"] as? String)
        XCTAssertEqual(try ServerCode.format(seed: seed), d["serverCode"] as? String)
        XCTAssertEqual(try ServerCode.format(seed: seed, relay: "https://relay.example.org", token: "tk_live_123"), d["serverCodeLink"] as? String)
        let v = try ServerCode.derive(seed: seed)
        XCTAssertEqual(v.authToken, d["authToken"] as? String)
        XCTAssertEqual(v.configTopic, d["configTopic"] as? String)
        XCTAssertEqual(v.itemTopic, d["itemTopic"] as? String)
        XCTAssertEqual(v.ackTopic, d["ackTopic"] as? String)
        XCTAssertEqual(v.emailToken, d["emailToken"] as? String)
        XCTAssertEqual(v.fingerprint, d["fingerprint"] as? String)
        XCTAssertEqual(v.workerName, d["workerName"] as? String)
        XCTAssertEqual(v.boxKey.count, 32)
        let salted = d["emailTokenWithSalt"] as! [String: Any]
        XCTAssertEqual(try ServerCode.derive(seed: seed, emailSalt: salted["salt"] as! String).emailToken, salted["emailToken"] as? String)
        for i in d["serverItemIds"] as? [[String: Any]] ?? [] {
            XCTAssertEqual(ServerCode.serverItemId(seed: seed, origin: i["origin"] as! String), i["id"] as? String)
        }
        XCTAssertEqual(ServerCode.showFingerprint("3f9a1c2e"), "3f9a-1c2e")
        // The Server code of the vectors' pairing, as the section shows it.
        let server = try DaylightServer(pairing: Pairing(secret: secret), store: MemoryServerStore(), fetch: { _ in throw URLError(.notConnectedToInternet) })
        XCTAssertEqual(server.serverCode(), d["serverCode"] as? String)
    }

    func testServerCodeParsing() throws {
        for c in Self.vectors["serverCodeParsing"] as! [[String: Any]] {
            let input = c["input"] as! String
            if let reason = c["error"] as? String {
                XCTAssertThrowsError(try ServerCode.parse(input), input) { e in
                    XCTAssertEqual((e as? ShareError)?.code, "server-code", input)
                    XCTAssertEqual((e as? ShareError)?.reason, reason, input)
                }
            } else {
                let p = try ServerCode.parse(input)
                XCTAssertEqual(p.seed.hexString, c["seedHex"] as? String, input)
                XCTAssertEqual(p.relay, c["relay"] as? String ?? DLS.defaultRelay, input)
                XCTAssertEqual(p.token, c["token"] as? String ?? "", input)
            }
        }
    }

    // MARK: frames (config) and negative (config)

    func testTheConfigFrame() throws {
        let f = (Self.vectors["frames"] as! [String: Any])["config"] as! [String: Any]
        XCTAssertEqual(f["aad"] as? String, "dlshare/v1/server-config")
        let h = f["header"] as! [String: Any]
        let v = try values()
        // Sealed with the reference's key order (buildConfigFrame: v, kind, id, sent, server, api, fingerprint, delivery).
        let header = JSONOut.object([("v", .int(1)), ("kind", .string("config")), ("id", .string(h["id"] as! String)),
                                     ("sent", .string(h["sent"] as! String)), ("server", .string(h["server"] as! String)),
                                     ("api", .int((h["api"] as! NSNumber).intValue)), ("fingerprint", .string(h["fingerprint"] as! String)),
                                     ("delivery", .string(h["delivery"] as! String))])
        let frame = try ServerBox.seal(values: v, aad: ServerBox.config, header: header, nonce: hex(f["nonceHex"]))
        XCTAssertEqual(Base64.encode(frame), f["frameBase64"] as? String)
        let opened = try ServerBox.open(values: v, aad: ServerBox.config, frame: try XCTUnwrap(Base64.decode(f["frameBase64"] as! String)))
        XCTAssertEqual(opened.header, json(h))
        let sent = try XCTUnwrap(Lab.parseTime(h["sent"] as! String))
        let config = try XCTUnwrap(ServerConfig.check(opened.header, now: sent))
        XCTAssertEqual(config.server, h["server"] as? String)
        XCTAssertEqual(config.api, (h["api"] as! NSNumber).intValue)
        XCTAssertEqual(config.fingerprint, h["fingerprint"] as? String)
        XCTAssertEqual(config.delivery, h["delivery"] as? String)
        XCTAssertEqual(config.sent, h["sent"] as? String)
        XCTAssertEqual(config.id, h["id"] as? String)
        // More than 5 minutes ahead of this device's clock: refused.
        XCTAssertNil(ServerConfig.check(opened.header, now: sent - ServerCode.configMaxAheadMs - 1))
        XCTAssertNotNil(ServerConfig.check(opened.header, now: sent - ServerCode.configMaxAheadMs))
    }

    func testNegativeFrames() throws {
        let frames = Self.vectors["frames"] as! [String: Any]
        let configFrame = try XCTUnwrap(Base64.decode((frames["config"] as! [String: Any])["frameBase64"] as! String))
        let v = try values()
        var ran = 0
        for c in Self.vectors["negative"] as! [[String: Any]] {
            let which = c["frame"] as! String
            let openWith = c["openWith"] as! String
            let frame: Data
            if which == "config" {
                frame = configFrame
            } else if let b = c["frameBase64"] as? String {
                frame = try XCTUnwrap(Base64.decode(b))
            } else {
                continue // an item frame the vectors build: Wave S
            }
            ran += 1
            let parts = openWith.split(separator: ":").map(String.init)
            let keys = ShareKeys(secret: secret)
            func openIt() throws {
                if parts[0] == "box" {
                    _ = try ServerBox.open(values: v, aad: parts[1], frame: frame)
                } else {
                    _ = try Frame.open(keys: keys, purpose: FramePurpose(rawValue: parts[1])!, frame: frame)
                }
            }
            XCTAssertThrowsError(try openIt(), "\(which) with \(openWith)") { e in
                XCTAssertEqual((e as? ShareError)?.code, c["expect"] as? String, "\(which) with \(openWith)")
            }
        }
        XCTAssertGreaterThanOrEqual(ran, 5)
    }

    // MARK: serverState (2.6)

    var serverState: [String: Any] { Self.vectors["serverState"] as! [String: Any] }

    func testTheStatesAreAClosedSet() {
        XCTAssertEqual(serverState["states"] as? [String], ServerMessages.serverStates)
    }

    func testStateFromStatus() {
        for c in serverState["fromStatus"] as! [[String: Any]] {
            let name = c["name"] as? String ?? "?"
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(ServerMessages.stateFromStatus(json(c["status"]), feature: c["feature"] as! String),
                           ServerState(e["state"] as! String, e["message"] as? String), name)
        }
    }

    /// The error a case describes: the server's answer through `ServerError.from` (as `request` reads it), a network
    /// failure or a gate's deadline (OFFLINE), or a state the app decides before any request.
    func error(of c: [String: Any]) throws -> ServerError {
        if let r = c["response"] as? [String: Any] {
            return try XCTUnwrap(ServerError.from(status: (r["status"] as! NSNumber).intValue, body: Data((r["body"] as! String).utf8)))
        }
        if let local = c["local"] as? String { return ServerError(local, message: ServerMessages.localMessage(local)) }
        return ServerError("OFFLINE")
    }

    func testStateFromErrorAndNoteError() throws {
        let now = (serverState["now"] as! NSNumber).int64Value
        let fresh = json((serverState["fromStatus"] as! [[String: Any]])[0]["status"])
        for c in serverState["fromError"] as! [[String: Any]] {
            let name = c["name"] as? String ?? "?"
            let feature = c["feature"] as! String
            let err = try error(of: c)
            let want = c["error"] as! [String: Any]
            XCTAssertEqual(err.code, want["code"] as? String, name)
            XCTAssertEqual(err.status, (want["status"] as? NSNumber)?.intValue ?? 0, name)
            var kept = want
            kept["code"] = nil
            kept["status"] = nil
            XCTAssertEqual(err.extra, kept.mapValues { json($0) }, "\(name): the fields the error keeps")
            let e = c["expect"] as! [String: Any]
            let expect = ServerState(e["state"] as! String, e["message"] as? String)
            XCTAssertEqual(ServerMessages.stateFromError(err), expect, name)

            // noteError on a fresh cached status in which every feature is ready.
            let store = MemoryServerStore()
            store.set(ServerKeys.status, fresh)
            store.set(ServerKeys.statusAt, .number(Double(now - 60_000)))
            store.set(ServerKeys.configAt, .number(Double(now - 60_000)))
            for (k, v) in c["before"] as? [String: Any] ?? [:] { store.set(k, json(v)) }
            let server = try DaylightServer(pairing: Pairing(secret: secret), store: store,
                                            fetch: { _ in throw URLError(.notConnectedToInternet) }, now: { now })
            XCTAssertEqual(server.noteError(feature, err), expect, "\(name): noteError")
            let note = c["noteError"] as! [String: Any]
            switch note["cache"] as? String {
            case "kept":
                XCTAssertEqual(store.get(ServerKeys.status), fresh, "\(name): kept")
                XCTAssertNotNil(store.get(ServerKeys.statusAt), "\(name): kept")
            case "updated":
                let f = note["feature"] as! String
                var features = fresh["features"]?.object ?? [:]
                features[f] = .object(["state": .string(expect.state), "message": expect.message.map { JSONValue.string($0) } ?? .null])
                XCTAssertEqual(store.get(ServerKeys.status)?["features"], .object(features), "\(name): updated")
                XCTAssertNil(store.get(ServerKeys.statusAt), "\(name): marked for refresh")
            case "dropped":
                XCTAssertNil(store.get(ServerKeys.status), "\(name): dropped")
                XCTAssertNil(store.get(ServerKeys.statusAt), "\(name): dropped")
                XCTAssertEqual(store.get(ServerKeys.badAuthAt)?.safeInteger, (note["badAuthAt"] as? NSNumber)?.int64Value, "\(name): badAuthAt")
                if note["configRefresh"] as? Bool == true {
                    XCTAssertNil(store.get(ServerKeys.configAt), "\(name): the config is read again")
                } else {
                    XCTAssertNotNil(store.get(ServerKeys.configAt), "\(name): the config stays")
                }
            default:
                XCTFail("\(name): unknown cache outcome")
            }
        }
    }

    // MARK: setupLinks (3.5)

    func testSetupLinks() throws {
        let s = Self.vectors["setupLinks"] as! [String: Any]
        let secret = hex(s["secretHex"])
        XCTAssertEqual(try ServerCode.deriveSetupToken(secret: secret), s["setupToken"] as? String)
        let parsed = try ServerCode.parseSetupLink(s["link"] as? String)
        XCTAssertEqual(parsed.server, s["server"] as? String)
        XCTAssertEqual(parsed.secret, secret)
        XCTAssertTrue(ServerCode.isSetupHost("daylight-0123456789ab.example.workers.dev"))
        for c in s["parsing"] as! [[String: Any]] {
            let input = c["input"] as! String
            if let reason = c["error"] as? String {
                XCTAssertThrowsError(try ServerCode.parseSetupLink(input), input) { e in
                    XCTAssertEqual((e as? ShareError)?.code, "setup-link", input)
                    XCTAssertEqual((e as? ShareError)?.reason, reason, input)
                }
            } else {
                let p = try ServerCode.parseSetupLink(input)
                XCTAssertEqual(p.server, c["server"] as? String, input)
                XCTAssertEqual(p.secret.hexString, c["secretHex"] as? String, input)
            }
        }
        // The confirmation names the link's address (2.6 step 3).
        XCTAssertEqual(LabCenter.checkSetupLink(s["link"] as! String).confirm,
                       "daylight-0123456789ab.example.workers.dev will get this pairing’s Server code. Continue only if this address is on your own Cloudflare account.")
        XCTAssertEqual(LabCenter.checkSetupLink("hello").error, ServerCode.setupFormatText)
        // A default :443 is the same origin; a pasted link with a line break in it still reads.
        XCTAssertEqual(try ServerCode.parseSetupLink("https://daylight-0123456789ab.example.workers.dev:443/setup#SETUP-JRTK-XSYV-FBNR-BSJP-AGJI-ZIDS-SD2A").server,
                       s["server"] as? String)
    }

    func testMessages() {
        XCTAssertEqual(ServerMessages.errorMessage("TOO_LARGE", ["limit": .number(12_713_984)]), "That’s larger than the Daylight server takes (12.7 MB).")
        XCTAssertEqual(ServerMessages.errorMessage("FEED_LIMIT"), "You follow the most feeds the server allows (100). Remove one to add another.")
        XCTAssertEqual(ServerMessages.errorMessage("AI_TOO_LARGE", ["tokens": .number(250_000)]),
                       "This is too long for one AI request (about 250,000 tokens; the limit is 200,000).")
        XCTAssertEqual(ServerMessages.errorMessage("AI_DAILY_LIMIT", ["needUsd": .number(0.125), "ceilingUsd": .number(10)]),
                       "This request could cost up to US$0.13 with Claude, more than today’s AI limit. Raise the limit in Lab settings (up to US$10).")
        XCTAssertEqual(ServerMessages.errorMessage("AI_DAILY_LIMIT", ["resetAt": .string("2026-10-21T00:00:00.000Z")]),
                       "Today’s AI limit is used up. It resets at 00:00 UTC, or raise it in Lab settings (up to US$10).")
        XCTAssertEqual(ServerMessages.errorMessage("WHAT"), "Something went wrong on the Daylight server (WHAT). Try again later.")
        XCTAssertEqual(ServerMessages.noticeText("pdf", delivery: "v1"),
                       "Not end-to-end encrypted: to use AI, the text or file goes to your Daylight server and to Claude (Anthropic) in readable form.")
        XCTAssertTrue(ServerMessages.isServerCode("NEEDS_KEY"))
        XCTAssertFalse(ServerMessages.isServerCode("OFFLINE"))
        XCTAssertFalse(ServerMessages.isServerCode("needs-server"))
        for code in ServerMessages.errorCodes {
            XCTAssertFalse(ServerMessages.errorMessage(code).isEmpty, code)
        }
    }
}
