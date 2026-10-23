import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// The Lab vectors from the JavaScript reference: reader-experiment/share/vectors/lab-vectors.json (LAB-PLAN 2.8), every
/// W0 section. The W1 sections are A3's, each in its own suite: labExcerpt in `ExcerptVectorTests` (its `classify` in
/// `NormaliseVectorTests`, with share/vectors/normalise.json), diagnostics, testArticle and labText's kindLines and
/// cleanedFrom in `SetupCheckVectorTests`. `testEverySectionIsKnown` fails when a section appears that no port has
/// looked at.
final class LabVectorTests: XCTestCase {
    static func load(_ relative: String) -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath) // …/apple/DaylightShareKit/Tests/DaylightShareKitTests/LabVectorTests.swift
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(relative)
        guard let data = try? Data(contentsOf: url), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            fatalError("cannot read \(url.path)")
        }
        return obj
    }

    static let vectors = load("share/vectors/lab-vectors.json")
    static let protocolVectors = load("share/vectors/test-vectors.json")

    static let w0Sections: Set<String> = ["protocol", "generatedBy", "notes", "constants", "labTopics", "labFrames", "labParse",
                                          "labLedger", "labGate", "labHeaderExtras", "labRowText", "labText", "v1Safety"]
    /// W1 (L1), ported by A3: smart intake's excerpts, Setup check's diagnostics and test article (their own suites).
    static let w1Sections: Set<String> = ["labExcerpt", "diagnostics", "testArticle"]

    func list(_ key: String, in obj: [String: Any] = LabVectorTests.vectors) -> [[String: Any]] {
        let l = obj[key] as? [[String: Any]] ?? []
        XCTAssertFalse(l.isEmpty, "\(key) is empty")
        return l
    }

    func hex(_ s: Any?) -> Data { Hex.decode(s as? String ?? "")! }
    func int64(_ v: Any?) -> Int64? { (v as? NSNumber).map { $0.int64Value } }
    func json(_ v: Any?) -> JSONValue? { v == nil ? nil : JSONValue(foundation: v) }

    var secret1: Data { hex((Self.protocolVectors["pairing"] as! [[String: Any]])[0]["secretHex"]) }
    var keys1: ShareKeys { ShareKeys(secret: secret1) }

    // MARK: Coverage

    func testEverySectionIsKnown() {
        let keys = Set(Self.vectors.keys)
        XCTAssertEqual(keys.subtracting(Self.w0Sections).subtracting(Self.w1Sections), [],
                       "a lab-vectors section no Swift port has looked at")
        XCTAssertTrue(Self.w0Sections.isSubset(of: keys), "a W0 section is missing")
        let labText = Self.vectors["labText"] as? [String: Any] ?? [:]
        XCTAssertEqual(Set(labText.keys).subtracting(["strings", "messages", "checkedIn", "inboxHeader", "serverRow", "serverFeature",
                                                      "serverSection", "features", "use", "useFeatures", "kindLines", "cleanedFrom"]), [],
                       "a labText part no Swift port has looked at")
    }

    // MARK: constants

    func testConstants() {
        let c = Self.vectors["constants"] as! [String: Any]
        XCTAssertEqual(int64(c["LAB_LEVEL"]), Int64(Lab.level))
        XCTAssertEqual(int64(c["MAX_ST_PER_FRAME"]), Int64(Lab.maxStatesPerFrame))
        XCTAssertEqual(int64(c["MAX_ST_READ"]), Int64(Lab.maxStatesRead))
        XCTAssertEqual(int64(c["MAX_CAPS"]), Int64(Lab.maxCaps))
        XCTAssertEqual(int64(c["APP_MAX"]), Int64(Lab.appMax))
        XCTAssertEqual(int64(c["T_MAX"]), Lab.tMax)
        XCTAssertEqual(int64(c["HELLO_EVERY_MS"]), Lab.helloEveryMs)
        XCTAssertEqual(int64(c["STATE_DIGEST_WINDOW_MS"]), Lab.stateDigestWindowMs)
        XCTAssertEqual(int64(c["STATE_DIGEST_MAX"]), Int64(Lab.stateDigestMax))
        XCTAssertEqual(int64(c["INBOX_STALE_MS"]), Lab.inboxStaleMs)
        XCTAssertEqual(int64(c["PENDING_MAX"]), Int64(Lab.pendingMax))
        XCTAssertEqual(int64(c["LEDGER_STATES_MAX"]), Int64(Lab.ledgerStatesMax))
        XCTAssertEqual(int64(c["LAB_FRAME_GAP_MS"]), Lab.frameGapMs)
        XCTAssertEqual(int64(c["LAB_FRAMES_PER_DAY"]), Int64(Lab.framesPerDay))
        XCTAssertEqual(int64(c["LAB_YIELD_MS"]), Lab.yieldMs)
        XCTAssertEqual(int64(c["LAB_OFF_REPEAT_MS"]), Lab.offRepeatMs)
        XCTAssertEqual(int64(c["LAB_OFF_REPEATS"]), Int64(Lab.offRepeats))
        XCTAssertEqual(int64(c["LAB_FLUSH_DELAY_MS"]), Lab.flushDelayMs)
        XCTAssertEqual(int64(c["GATE_DEADLINE_MS"]), Lab.gateDeadlineMs)
        XCTAssertEqual(int64(c["FAST_CHECK_MS"]), Lab.fastCheckMs)
        XCTAssertEqual(int64(c["FAST_CHECK_WINDOW_MS"]), Lab.fastCheckWindowMs)
        XCTAssertEqual((c["STATE_RANK"] as? [String: Int]) ?? [:], Lab.stateRank)
        XCTAssertEqual(c["LAB_STATES"] as? [String], Lab.states)
        XCTAssertEqual(Set((c["CAPS"] as? [String: String] ?? [:]).values), Set(Lab.Caps.all))
        XCTAssertEqual(c["FEATURE_CAPS"] as? [String: String], Lab.featureCaps)
        XCTAssertEqual(c["SERVER_FEATURES"] as? [String: String], Lab.serverFeatures)
        XCTAssertEqual(c["SERVER_KEYS"] as? [String: String], Lab.serverKeys)
        XCTAssertEqual(c["USE_FEATURES"] as? [String], Lab.useFeatures)
    }

    // MARK: labTopics (2.4)

    func testLabTopicsAndTheReturnFrame() throws {
        let t = Self.vectors["labTopics"] as! [String: Any]
        let aads = t["aads"] as! [String: String]
        for (purpose, aad) in aads {
            XCTAssertEqual(FramePurpose(rawValue: purpose)?.aadLabel, aad, purpose)
        }
        XCTAssertEqual(Set(FramePurpose.allCases.map(\.rawValue)), Set(aads.keys), "the AAD map is explicit and complete")
        XCTAssertNil(FramePurpose(rawValue: "lab-unknown"), "an unknown purpose has no AAD")
        for topic in list("topics", in: t) {
            let label = topic["label"] as? String ?? "?"
            let derived = try LabTopics.derive(secret: hex(topic["secretHex"]))
            XCTAssertEqual(derived.returnTopic, topic["returnTopic"] as? String, label)
            XCTAssertEqual(derived.returnAckTopic, topic["returnAckTopic"] as? String, label)
            XCTAssertEqual(derived.controlTopic, topic["controlTopic"] as? String, label)
            XCTAssertEqual(derived.controlAckTopic, topic["controlAckTopic"] as? String, label)
        }
        XCTAssertThrowsError(try LabTopics.derive(secret: Data(count: 15)))

        let r = t["returnFrame"] as! [String: Any]
        let keys = ShareKeys(secret: hex(r["secretHex"]))
        let purpose = try XCTUnwrap(FramePurpose(rawValue: r["purpose"] as? String ?? ""))
        let frame = try Frame.seal(keys: keys, purpose: purpose, headerJSON: Data((r["headerJson"] as! String).utf8),
                                   nonce: hex(r["nonceHex"]))
        XCTAssertEqual(frame.hexString, r["frameHex"] as? String)
        XCTAssertEqual(Base64.encode(frame), r["frameBase64"] as? String)
        let opened = try Frame.open(keys: keys, purpose: purpose, frame: frame)
        XCTAssertEqual(String(decoding: opened.headerJSON, as: UTF8.self), r["headerJson"] as? String)
        for refused in r["refusedPurposes"] as? [String] ?? [] {
            let p = try XCTUnwrap(FramePurpose(rawValue: refused), refused)
            XCTAssertThrowsError(try Frame.open(keys: keys, purpose: p, frame: frame), refused) { e in
                XCTAssertEqual((e as? ShareError)?.code, "frame", refused)
            }
        }
    }

    // MARK: labFrames (2.2.1)

    func expectedAck(_ v: Any?) -> LabAck {
        let o = v as? [String: Any] ?? [:]
        var inbox: LabInboxInfo?
        if let i = o["inbox"] as? [String: Any] {
            inbox = LabInboxInfo(lab: (i["lab"] as? NSNumber)?.intValue ?? -99, app: i["app"] as? String ?? "?",
                                 caps: i["caps"] as? [String] ?? ["?"], poll: int64(i["poll"]),
                                 live: (i["live"] as? NSNumber)?.boolValue ?? false)
        }
        let states = (o["states"] as? [[String: Any]] ?? []).map {
            LabState(i: $0["id"] as? String ?? "?", s: $0["s"] as? String ?? "?", t: int64($0["t"]) ?? -1)
        }
        return LabAck(inbox: inbox, states: states)
    }

    func testLabFramesSealOpenParseAndBuild() throws {
        for f in list("labFrames") {
            let name = f["name"] as? String ?? "?"
            let headerJSON = Data((f["headerJson"] as! String).utf8)
            XCTAssertEqual(headerJSON.count, (f["headerBytes"] as? NSNumber)?.intValue, name)
            let frame = try Frame.seal(keys: keys1, purpose: .ack, headerJSON: headerJSON, nonce: hex(f["nonceHex"]))
            XCTAssertEqual(Base64.encode(frame), f["frameBase64"] as? String, name)
            XCTAssertEqual(frame.count, (f["frameLength"] as? NSNumber)?.intValue, name)
            XCTAssertEqual(Base64.encodedLength(frame.count), (f["base64Length"] as? NSNumber)?.intValue, name)
            XCTAssertEqual(Frame.isSmall(frame.count), f["small"] as? Bool, name)
            let opened = try Frame.open(keys: keys1, purpose: .ack, frame: frame)
            let expected = expectedAck(f["parse"])
            XCTAssertEqual(LabFrame.parse(json: opened.headerJSON), expected, name)
            // A v1.1 reader sees an ack without ids.
            XCTAssertEqual(AckHeader.ids(in: opened.header), [], name)

            // LabFrame.build makes the same bytes from the same fields (Swift strings cannot hold the lone surrogates
            // of the worst case's `from`, so those two cases are not rebuilt).
            if f["loneSurrogates"] as? Bool == true { continue }
            let header = try XCTUnwrap(JSONValue.parse(headerJSON)?.object, name)
            let inbox = try XCTUnwrap(expected.inbox, name)
            let built = try LabFrame.build(keys: keys1, inbox: inbox, states: expected.states,
                                           from: header["from"]?.string ?? "", sent: header["sent"]?.string ?? "",
                                           nonce: hex(f["nonceHex"]))
            XCTAssertEqual(Base64.encode(built), f["frameBase64"] as? String, "\(name): LabFrame.build")
        }
    }

    func testTheBuilderRefusesWhatTheReferenceRefuses() throws {
        let info = LabInboxInfo(lab: 1, app: "android/1.5.0", caps: ["st"], poll: nil, live: false)
        let id = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
        let many = (0..<25).map { _ in LabState(i: id, s: "reader", t: 1) }
        XCTAssertThrowsError(try LabFrame.build(keys: keys1, inbox: info, states: many)) { e in
            XCTAssertEqual((e as? ShareError)?.reason, "too-many")
        }
        XCTAssertThrowsError(try LabFrame.build(keys: keys1, inbox: info, states: [LabState(i: "XYZ", s: "reader", t: 1)])) { e in
            XCTAssertEqual((e as? ShareError)?.reason, "entry")
        }
        XCTAssertThrowsError(try LabFrame.build(keys: keys1, inbox: info, states: [LabState(i: id, s: "done", t: 1)])) { e in
            XCTAssertEqual((e as? ShareError)?.reason, "entry")
        }
        XCTAssertThrowsError(try LabFrame.build(keys: keys1, inbox: info, states: [LabState(i: id, s: "reader", t: Lab.tMax + 1)])) { e in
            XCTAssertEqual((e as? ShareError)?.reason, "entry")
        }
        XCTAssertThrowsError(try LabFrame.build(keys: keys1, inbox: LabInboxInfo(lab: 100))) { e in
            XCTAssertEqual((e as? ShareError)?.reason, "lab")
        }
        // 24 states with the longest fields still make a small frame.
        let full = (0..<24).map { k -> LabState in
            let h = String(k, radix: 16)
            return LabState(i: String(repeating: "0", count: 32 - h.count) + h, s: "waiting", t: 4_102_444_800)
        }
        let big = LabInboxInfo(lab: 99, app: String(repeating: "a", count: 80), caps: (0..<20).map { String(repeating: "c", count: 15) + "\($0 % 10)" },
                               poll: 1_792_483_198_000, live: true)
        let frame = try LabFrame.build(keys: keys1, inbox: big, states: full, from: String(repeating: "😀", count: 60))
        XCTAssertTrue(Frame.isSmall(frame.count))
        let parsed = LabFrame.parse(json: try Frame.open(keys: keys1, purpose: .ack, frame: frame).headerJSON)
        XCTAssertNil(parsed.inbox, "level 99 is above this reader's level")
        XCTAssertEqual(try big.clamped().app.count, 60)
        XCTAssertEqual(try big.clamped().caps.count, 10, "16 elements read, repeats dropped")
    }

    // MARK: labParse (2.2.5)

    func testLabParse() {
        let cases = list("labParse")
        XCTAssertGreaterThanOrEqual(cases.count, 45)
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let got = LabFrame.parse(json: Data((c["headerJson"] as! String).utf8))
            XCTAssertEqual(got, expectedAck(c["expect"]), name)
        }
    }

    func testRuleD() {
        XCTAssertEqual(Lab.parseTime("2026-10-20T07:59:58.000Z"), 1_792_483_198_000)
        XCTAssertEqual(Lab.parseTime("2028-02-29T00:00:00Z").map { Lab.isoTime($0) }, "2028-02-29T00:00:00.000Z")
        XCTAssertNil(Lab.parseTime("2026-02-29T00:00:00Z"))
        XCTAssertNil(Lab.parseTime("2026-10-20T24:00:00Z"))
        XCTAssertEqual(Lab.parseTime("1970-01-01T00:00:00.5Z"), 500)
        XCTAssertEqual(Lab.parseTime("1969-12-31T23:59:59.999Z"), -1)
        XCTAssertEqual(Lab.isoTime(-1), "1969-12-31T23:59:59.999Z")
        XCTAssertEqual(Lab.isoTime(Lab.maxISOms), "9999-12-31T23:59:59.999Z")
        XCTAssertEqual(Lab.isoTime(0), "1970-01-01T00:00:00.000Z")
    }

    // MARK: labLedger (2.2.6)

    func testLabLedger() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-ledger-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        for (k, c) in list("labLedger").enumerated() {
            let name = c["name"] as? String ?? "?"
            let now = int64(c["now"]) ?? 0
            let ledger = LabLedger(file: dir.appendingPathComponent("lab-\(k).json"), now: { now })
            for step in c["steps"] as? [[String: Any]] ?? [] {
                ledger.record(headerJSON: Data((step["headerJson"] as! String).utf8), time: (step["time"] as? NSNumber)?.intValue)
            }
            let snap = ledger.snapshot()
            let expect = c["expect"] as! [String: Any]
            let states = (expect["states"] as? [String: [String: Any]] ?? [:]).mapValues {
                LabLedger.Entry(s: $0["s"] as? String ?? "?", t: int64($0["t"]) ?? -1)
            }
            XCTAssertEqual(snap.states, states, name)
            XCTAssertEqual(snap.inboxLab, expect["inboxLab"] as? Bool, name)
            XCTAssertEqual(snap.caps, expect["caps"] as? [String], name)
            for (token, has) in expect["hasCap"] as? [String: Bool] ?? [:] {
                XCTAssertEqual(snap.hasCap(token), has, "\(name): hasCap \(token)")
                XCTAssertEqual(ledger.hasCap(token), has, "\(name): hasCap \(token)")
            }
            XCTAssertEqual(snap.checkedIn, int64(expect["checkedIn"]), name)
            let pubs = expect["publishers"] as? [String: [String: Any]] ?? [:]
            XCTAssertEqual(Set(snap.publishers.map { $0.name }), Set(pubs.keys), name)
            for (pub, p) in pubs {
                let got = snap.publisher(pub)
                XCTAssertEqual(got?.lab, (p["lab"] as? NSNumber)?.intValue, "\(name): \(pub).lab")
                XCTAssertEqual(got?.app, p["app"] as? String, "\(name): \(pub).app")
                XCTAssertEqual(got?.caps, p["caps"] as? [String], "\(name): \(pub).caps")
                XCTAssertEqual(got?.poll, int64(p["poll"]), "\(name): \(pub).poll")
                XCTAssertEqual(got?.live, p["live"] as? Bool, "\(name): \(pub).live")
                XCTAssertEqual(got?.at, int64(p["at"]), "\(name): \(pub).at")
            }
        }
    }

    // MARK: labGate (1.5, 2.7.2)

    final class KeyBox: @unchecked Sendable {
        private let lock = NSLock()
        private var value: String?
        var key: String? {
            lock.lock()
            defer { lock.unlock() }
            return value
        }

        func set(_ k: String) {
            lock.lock()
            value = k
            lock.unlock()
        }
    }

    func testLabGate() async throws {
        for c in list("labGate") {
            let name = c["name"] as? String ?? "?"
            let feature = c["feature"] as! String
            let ctx = c["ctx"] as! [String: Any]
            let expect = c["expect"] as! [String: Any]
            let box = KeyBox()
            let caps = ctx["caps"] as? [String] ?? []
            let local = ctx["local"] as? String
            let serverMessages = ctx["serverMessages"] as? [String: String]
            let built = ctx["built"] as? Bool ?? true
            var server: (@Sendable (String) async throws -> ServerState)?
            var deadline = Lab.gateDeadlineMs
            switch ctx["server"] {
            case let s as [String: Any]:
                let state = ServerState(s["state"] as? String ?? "?", s["message"] as? String)
                server = { key in
                    box.set(key)
                    return state
                }
            case let s as String where s == "never":
                deadline = 300
                server = { key in
                    box.set(key)
                    try await Task.sleep(nanoseconds: 60_000_000_000)
                    return ServerState("ready", nil)
                }
            case let s as String where s == "throws-offline":
                server = { key in
                    box.set(key)
                    throw ServerError("OFFLINE")
                }
            default:
                server = nil
            }
            let serverMessage: ((String) -> String?)? = serverMessages.map { m in { (s: String) -> String? in m[s] } }
            let started = Date()
            let r = await LabGate.run(feature, LabGate.Context(
                lab: ctx["lab"] as? Bool ?? false, paired: ctx["paired"] as? Bool ?? false, hasCap: { caps.contains($0) },
                local: { _ in local }, server: server, serverMessage: serverMessage,
                built: { _ in built }, platform: ctx["platform"] as? String, deadlineMs: deadline))
            XCTAssertLessThan(Date().timeIntervalSince(started), 5, "\(name): the gate answers within its deadline")
            XCTAssertEqual(r.ready, expect["ready"] as? Bool, name)
            XCTAssertEqual(r.state, expect["state"] as? String, name)
            XCTAssertEqual(r.message, expect["message"] as? String, name)
            XCTAssertEqual(r.short, expect["short"] as? String, name)
            XCTAssertEqual(r.button, expect["button"] as? String, name)
            XCTAssertEqual(box.key, expect["serverKey"] as? String, "\(name): serverKey")
        }
    }

    // MARK: labHeaderExtras (2.3)

    func testLabHeaderExtras() throws {
        for c in list("labHeaderExtras") {
            let name = c["name"] as? String ?? "?"
            let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data((c["headerJson"] as! String).utf8)) as? [String: Any], name)
            let h = try ItemHeader.validated(raw)
            XCTAssertEqual(h.extras, c["expect"] as? [String: String] ?? ["?": "?"], name)
        }
        // The extras go on part 0 only, after the v1.1 fields, and a stored header without them still reads.
        let h = ItemHeader(id: "8eba42cf25e576782e55041c0ed07543", kind: .url, url: "https://example.com/a", sent: "2026-10-20T08:00:00.000Z",
                           extras: ItemHeader.labHeaderFields(cap: "clean", orig: " https://t.co/x "))
        XCTAssertEqual(h.json.serialized,
                       #"{"v":1,"id":"8eba42cf25e576782e55041c0ed07543","kind":"url","url":"https://example.com/a","sent":"2026-10-20T08:00:00.000Z","x-cap":"clean","x-orig":"https://t.co/x"}"#)
        XCTAssertFalse(h.forPart(1, of: 2).json.serialized.contains("x-cap"))
        XCTAssertTrue(h.forPart(0, of: 2).json.serialized.contains("x-cap"))
        XCTAssertEqual(ItemHeader.labHeaderFields(cap: "summary", orig: "https://e.com/" + String(repeating: "a", count: 1020)), [:])
        let old = #"{"id":"8eba42cf25e576782e55041c0ed07543","kind":"url","url":"https://example.com/a","sent":""}"#
        XCTAssertEqual(try JSONDecoder().decode(ItemHeader.self, from: Data(old.utf8)).extras, [:])
    }

    // MARK: labRowText (2.5)

    func testLabRowText() throws {
        for c in list("labRowText") {
            let name = c["name"] as? String ?? "?"
            let r = c["row"] as! [String: Any]
            let kind = try XCTUnwrap(ItemKind(rawValue: r["kind"] as? String ?? ""), name)
            let created = Date(timeIntervalSince1970: Double(int64(r["created"]) ?? 0) / 1000)
            let row = OutboxRow(id: r["id"] as! String, kind: kind, title: r["title"] as? String ?? "", size: (r["size"] as? NSNumber)?.intValue ?? 0,
                                header: ItemHeader(id: r["id"] as! String, kind: kind, sent: ""), created: created,
                                status: try XCTUnwrap(OutboxRow.Status(rawValue: r["status"] as? String ?? ""), name),
                                errorCode: r["errorCode"] as? String ?? "")
            let ctx = c["ctx"] as! [String: Any]
            var state: String?
            if let s = ctx["state"] as? String { state = s } else if let s = ctx["state"] as? [String: Any] { state = s["s"] as? String }
            let context = LabRowText.Context(lab: ctx["lab"] as? Bool ?? false, inboxLab: ctx["inboxLab"] as? Bool ?? false,
                                             caps: ctx["hasCap"] as? [String], state: state, online: ctx["online"] as? Bool)
            let now = Date(timeIntervalSince1970: Double(int64(c["now"]) ?? 0) / 1000)
            let t = LabRowText(row: row, now: now, ctx: context)
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(t.label, e["label"] as? String, name)
            XCTAssertEqual(t.sentence, e["sentence"] as? String, name)
            XCTAssertEqual(t.action?.rawValue, e["action"] as? String, name)
            XCTAssertEqual(t.stepLine, e["stepLine"] as? String, name)
            XCTAssertEqual(t.isFinal, e["final"] as? Bool, name)
            XCTAssertEqual(t.a11yLabel, e["a11y"] as? String, name)
            if context.lab == false {
                XCTAssertEqual(RowText(row: row, now: now).label, t.label, "\(name): Lab off is v1.1")
            }
        }
    }

    // MARK: labText (1.4, 1.6, 2.5, 2.6)

    var labText: [String: Any] { Self.vectors["labText"] as! [String: Any] }

    func testEveryStringIsLabTexts() {
        let strings = labText["strings"] as! [String: String]
        XCTAssertEqual(Set(LabText.all.keys), Set(strings.keys), "LabStrings.swift is not LAB_TEXT: run node scripts/lab-strings.mjs")
        for (id, text) in strings {
            XCTAssertEqual(LabText[id], text, id)
        }
        let steps = (labText["serverSection"] as! [String: Any])["steps"] as? [String]
        XCTAssertEqual(LabText.serverSteps, steps)
        XCTAssertEqual(LabText.serverSteps.count, 5)
        XCTAssertEqual(LabText.serverSteps[1], ServerMessages.rerunHelp, "step 2 is the module's RERUN_HELP")
        XCTAssertEqual(LabText.lab, "Lab")
        XCTAssertEqual(LabText.switchFooter, strings["switchFooter"])
    }

    func testNeedsMessages() {
        for m in labText["messages"] as! [[String: Any]] {
            let state = m["state"] as! String
            let got = LabText.needsMessage(state, platform: m["platform"] as? String, feature: m["feature"] as? String,
                                           short: m["short"] as? Bool ?? false, heading: m["heading"] as? Bool ?? false,
                                           message: m["message"] as? String)
            XCTAssertEqual(got, m["expect"] as? String, "\(state) \(m["platform"] ?? "") \(m["feature"] ?? "")")
        }
    }

    func testCheckInAndTheHeaderLine() {
        for c in labText["checkedIn"] as! [[String: Any]] {
            XCTAssertEqual(LabText.checkedInText(int64(c["ms"]), now: int64(c["now"]) ?? 0), c["expect"] as? String, "\(c)")
        }
        for c in labText["inboxHeader"] as! [[String: Any]] {
            XCTAssertEqual(LabText.inboxLabText(inboxLab: c["inboxLab"] as? Bool ?? false, checkedIn: int64(c["checkedIn"]),
                                                now: int64(c["now"]) ?? 0), c["expect"] as? String, "\(c)")
        }
    }

    func testTheServerRowAndGroup() {
        for c in labText["serverRow"] as! [[String: Any]] {
            let state = c["state"] as! String
            XCTAssertEqual(LabText.serverHeadingShort(state), c["heading"] as? String, state)
            XCTAssertEqual(LabText.serverRowSubtitle(state), c["subtitle"] as? String, state)
        }
        for c in labText["serverFeature"] as! [[String: Any]] {
            XCTAssertEqual(LabText.serverFeatureShort(c["state"] as! String, heading: c["headingState"] as! String),
                           c["expect"] as? String, "\(c)")
        }
    }

    func testTheServerSectionLines() {
        let s = labText["serverSection"] as! [String: Any]
        for c in s["moved"] as! [[String: Any]] {
            XCTAssertEqual(LabText.serverMovedText(c["moved"] as? String), c["expect"] as? String)
        }
        for c in s["labInboxSeen"] as! [[String: Any]] {
            XCTAssertEqual(LabText.labInboxSeenText(json(c["lastSeen"]), now: int64(c["now"]) ?? 0), c["expect"] as? String, "\(c)")
        }
        for c in s["aiToday"] as! [[String: Any]] {
            XCTAssertEqual(LabText.aiTodayText(used: json(c["used"]), cap: json(c["cap"])), c["expect"] as? String, "\(c)")
        }
        for c in s["setupConfirm"] as! [[String: Any]] {
            XCTAssertEqual(LabText.setupConfirmText(c["server"] as? String), c["expect"] as? String)
        }
        for c in s["hostLine"] as! [[String: Any]] {
            XCTAssertEqual(LabText.hostLineText(c["host"] as? String, c["fingerprint"] as? String), c["expect"] as? String, "\(c)")
        }
    }

    func testFeaturesAndUseSwitches() {
        let features = labText["features"] as! [[String: Any]]
        XCTAssertEqual(features.map { $0["id"] as? String ?? "" }, LabText.featureOrder + LabText.serverFeatureOrder)
        for f in features {
            let id = f["id"] as! String
            XCTAssertEqual(LabText.featureName(id), f["name"] as? String, id)
            XCTAssertEqual(LabText.featureSentence(id), f["sentence"] as? String, id)
        }
        XCTAssertEqual(LabText.featureName("ai"), "Summaries with Claude")
        XCTAssertEqual(LabText.featureName("pdf"), "Summaries with Claude")
        for c in labText["use"] as! [[String: Any]] {
            let settings = c["settings"] as? [String: Any]
            let lab = (settings?["lab"] as? Bool) != false
            let uses = settings?["labUse"] as? [String: Bool] ?? [:]
            XCTAssertEqual(LabText.useOn(lab: lab, uses: uses, feature: c["feature"] as! String), c["expect"] as? Bool, "\(c)")
        }
        for f in labText["useFeatures"] as! [[String: Any]] {
            let id = f["id"] as! String
            XCTAssertTrue(Lab.useFeatures.contains(id), id)
            XCTAssertEqual(LabText.useFooter(id), f["footer"] as? String, id)
            XCTAssertEqual(LabText.useA11y(id), f["a11y"] as? String, id)
        }
    }

    // MARK: v1Safety (2.1 rule 4)

    func testAV11ReaderSeesLabFramesAsAcksWithoutIds() throws {
        for c in list("v1Safety") {
            let name = c["name"] as? String ?? "?"
            let frame = try XCTUnwrap(Base64.decode(c["frameBase64"] as? String ?? ""), name)
            let opened = try Frame.open(keys: keys1, purpose: .ack, frame: frame)
            XCTAssertEqual(opened.header["kind"] as? String, c["kind"] as? String, name)
            XCTAssertEqual(AckHeader.ids(in: opened.header), c["ackIds"] as? [String], name)
            XCTAssertEqual(AckHeader.ids(in: opened.header), [], name)
        }
    }

    /// A v1.1 sender (no ledger) and a Lab sender read the vectors' Lab frames on their ack topic: nothing becomes
    /// delivered, nothing throws; only an ack does that.
    func testLabFramesDeliverNothing() async throws {
        FakeRelay.reset()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-v1safety-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let pairing = try Pairing(secret: secret1, relay: "https://relay.test")
        for (k, lab) in [false, true].enumerated() {
            let outbox = OutboxStore(directory: dir.appendingPathComponent("\(k)"))
            let ledger = LabLedger(outbox: outbox)
            let sender = try ShareSender(pairing: pairing, outbox: outbox, session: FakeRelay.session,
                                         onAckHeader: lab ? ledger.hook() : nil)
            sender.relay.sleep = { _ in }
            let row = try await sender.send(.link("https://example.com/story", title: "A story"))
            for (n, c) in list("v1Safety").enumerated() {
                FakeRelay.inject(topic: pairing.keys.ackTopic, frame: Base64.decode(c["frameBase64"] as! String)!,
                                 time: 1_792_483_198 + n, attachment: false)
            }
            let delivered = try await sender.checkAcks()
            XCTAssertEqual(delivered, 0)
            XCTAssertEqual(sender.outbox.row(row.id)?.status, .sent, "a Lab frame never delivers a row")
            if lab {
                XCTAssertNotNil(ledger.snapshot().checkedIn, "the Lab sender heard them")
            } else {
                XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("0/lab.json").path))
            }
            FakeRelay.reset()
        }
    }
}
