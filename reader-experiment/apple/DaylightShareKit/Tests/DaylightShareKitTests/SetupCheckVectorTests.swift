import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

/// Setup check (LAB-PLAN F26; LAB-PROTOCOL 2.9.4) against lab-vectors.json › testArticle and › diagnostics (redact,
/// activity, reports, and rowHttp: the Swift sender's rows against scripted relay answers), and the Inbox's lines of
/// labText (kindLines, cleanedFrom). F26.2: copied diagnostics carry no URL, title, pairing code, topic or Server code.
final class SetupCheckVectorTests: XCTestCase {
    var diagnostics: [String: Any] { LabVectorTests.vectors["diagnostics"] as! [String: Any] }

    func list(_ obj: [String: Any], _ key: String) -> [[String: Any]] {
        let l = obj[key] as? [[String: Any]] ?? []
        XCTAssertFalse(l.isEmpty, "\(key) is empty")
        return l
    }

    func int64(_ v: Any?) -> Int64? { (v as? NSNumber).map { $0.int64Value } }

    func testEveryPartIsKnown() {
        XCTAssertEqual(Set(diagnostics.keys), ["redact", "activity", "reports", "rowHttp"])
    }

    func testTestArticle() throws {
        let cases = LabVectorTests.vectors["testArticle"] as? [[String: Any]] ?? []
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let i = c["input"] as! [String: Any]
            let e = c["expect"] as! [String: Any]
            let a = try SetupCheck.testArticle(id: i["id"] as! String, device: i["device"] as? String)
            XCTAssertEqual(a.id, e["id"] as? String)
            XCTAssertEqual(e["kind"] as? String, "page")
            XCTAssertEqual(a.url, e["url"] as? String)
            XCTAssertEqual(a.title, e["title"] as? String)
            XCTAssertEqual(a.content, e["content"] as? String)
            XCTAssertEqual(a.extras, e["extras"] as? [String: String])
            let input = a.input
            XCTAssertEqual(input.kind, .page)
            XCTAssertEqual(input.id, a.id)
            XCTAssertEqual(input.extras, ["x-cap": "test"])
            // It reads as a page of about 400 words, which the Reader keeps as a page of its own.
            let words = JSText.words(a.content.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression))
            XCTAssertGreaterThan(words.count, 300)
        }
        XCTAssertThrowsError(try SetupCheck.testArticle(id: "NOT-AN-ID"))
        XCTAssertTrue(try SetupCheck.testArticle().url.hasPrefix(SetupCheck.testURLPrefix))
    }

    func testRedact() {
        for c in list(diagnostics, "redact") {
            XCTAssertEqual(SetupCheck.redact(c["text"] as? String), c["expect"] as? String, c["text"] as? String ?? "?")
        }
        // Linear on long runs (a scheme starting at every word boundary would be quadratic).
        let runs = String(repeating: "AAAA-", count: 20_000) + String(repeating: "www", count: 20_000)
        let started = Date()
        _ = SetupCheck.redact(runs)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testActivityLines() {
        for c in list(diagnostics, "activity") {
            let e = c["event"] as! [String: Any]
            let event = SetupCheck.ActivityEvent(time: int64(e["time"]) ?? 0, type: e["type"] as? String ?? "",
                                                 id: e["id8"] as? String ?? "", kind: e["kind"] as? String ?? "",
                                                 status: e["status"] as? String ?? "", http: (e["http"] as? NSNumber)?.intValue ?? 0)
            XCTAssertEqual(event.line, c["line"] as? String)
            // Stored and read back, it is the same event.
            let data = try! JSONEncoder().encode(event)
            XCTAssertEqual(try? JSONDecoder().decode(SetupCheck.ActivityEvent.self, from: data), event)
        }
        // Only the id's first 8 characters go in, and the log keeps the last 200.
        XCTAssertEqual(SetupCheck.ActivityEvent(time: 0, type: "send", id: "0123456789abcdef0123456789abcdef").id8, "01234567")
        var log: [SetupCheck.ActivityEvent] = []
        for k in 0..<250 { log = SetupCheck.appendActivity(log, SetupCheck.ActivityEvent(time: Int64(k), type: "t")) }
        XCTAssertEqual(log.count, 200)
        XCTAssertEqual(log.first?.time, 50)
    }

    func testReports() {
        for c in list(diagnostics, "reports") {
            let i = c["input"] as! [String: Any]
            let rows = (i["rows"] as? [[String: Any]] ?? []).compactMap { OutboxRow.Status(rawValue: $0["status"] as? String ?? "") }
            let log = (i["log"] as? [[String: Any]] ?? []).map { e in
                SetupCheck.ActivityEvent(time: int64(e["time"]) ?? 0, type: e["type"] as? String ?? "", id: e["id8"] as? String ?? "",
                                         kind: e["kind"] as? String ?? "", status: e["status"] as? String ?? "",
                                         http: (e["http"] as? NSNumber)?.intValue ?? 0)
            }
            let text = SetupCheck.diagnosticsReport(app: i["app"] as? String ?? "", version: i["version"] as? String ?? "",
                                                    platform: i["platform"] as? String ?? "", lab: i["lab"] as? Bool ?? true,
                                                    caps: i["caps"] as? [String] ?? [], checkedIn: int64(i["checkedIn"]),
                                                    rows: rows, relay: i["relay"] as? String ?? "", log: log,
                                                    now: int64(i["now"]) ?? 0)
            XCTAssertEqual(text, c["expect"] as? String)
        }
    }

    func testInboxLines() {
        let labText = LabVectorTests.vectors["labText"] as! [String: Any]
        for c in list(labText, "kindLines") {
            let i = c["input"] as! [String: Any]
            let kind = ItemKind(rawValue: i["kind"] as? String ?? "") ?? .file
            XCTAssertEqual(LabText.inboxKindLine(kind: kind, extras: i["extras"] as? [String: String] ?? [:],
                                                 size: (i["size"] as? NSNumber)?.intValue ?? 0, from: i["from"] as? String ?? ""),
                           c["expect"] as? String, "\(i)")
        }
        for c in list(labText, "cleanedFrom") {
            XCTAssertEqual(LabText.cleanedFromText(c["orig"] as? String), c["expect"] as? String, "\(c)")
        }
    }

    // MARK: rowHttp: a row's `http` after each step, and its activity line

    func testRowHTTP() async throws {
        let spec = diagnostics["rowHttp"] as! [String: Any]
        let relay = spec["relay"] as! String
        let items = spec["items"] as! [String: [String: Any]]
        let secret = Hex.decode((LabVectorTests.protocolVectors["pairing"] as! [[String: Any]])[0]["secretHex"] as! String)!
        let pairing = try Pairing(secret: secret, relay: relay)
        func input(_ key: String) throws -> ItemInput {
            let i = try XCTUnwrap(items[key], key)
            let kind = try XCTUnwrap(ItemKind(rawValue: i["kind"] as? String ?? ""), key)
            var content: Data?
            if let n = i["bytes"] as? NSNumber { content = Data((0..<n.intValue).map { UInt8($0 % 251) }) }
            return ItemInput(kind: kind, id: i["id"] as? String, url: i["url"] as? String, title: i["title"] as? String,
                             name: i["name"] as? String, mime: i["mime"] as? String, content: content)
        }
        let keyOf = Dictionary(uniqueKeysWithValues: items.map { ($0.value["id"] as! String, $0.key) })
        for c in spec["cases"] as! [[String: Any]] {
            let name = c["name"] as? String ?? "?"
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-rowhttp-\(UUID().uuidString)")
            defer { try? FileManager.default.removeItem(at: dir) }
            let sender = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir), session: ScriptedRelay.session)
            sender.relay.sleep = { _ in }
            sender.relay.retryDelays = (spec["retryDelaysMs"] as? [NSNumber] ?? []).map { $0.doubleValue / 1000 }
            for step in c["steps"] as! [[String: Any]] {
                let op = step["op"] as! String
                let at = int64(step["at"]) ?? 0
                sender.now = { Date(timeIntervalSince1970: Double(at) / 1000) }
                ScriptedRelay.script(step["answers"] as? [Any] ?? [], time: Int(at / 1000))
                var returned: [OutboxRow] = []
                switch op {
                case "send": returned = [try await sender.send(input(step["item"] as! String))]
                case "defer": returned = [try await sender.send(input(step["item"] as! String), defer: true)]
                case "retry":
                    let id = items[step["item"] as! String]!["id"] as! String
                    returned = [await sender.retry(id)].compactMap { $0 }
                case "flushNetwork": returned = await sender.flushNetwork()
                case "resendDue": returned = await sender.resendDue()
                default: XCTFail("\(name): unknown op \(op)")
                }
                XCTAssertEqual(ScriptedRelay.left, 0, "\(name) \(op): every answer is asked for")
                let e = step["expect"] as! [String: Any]
                XCTAssertEqual(returned.map { keyOf[$0.id] ?? $0.id }, e["returned"] as? [String], "\(name) \(op): returned")
                var rows: [String: [String: Any]] = [:]
                for r in sender.outbox.load().rows {
                    rows[keyOf[r.id] ?? r.id] = ["status": r.status.rawValue, "errorCode": r.errorCode, "http": r.http]
                }
                let expected = e["rows"] as! [String: [String: Any]]
                XCTAssertEqual(Set(rows.keys), Set(expected.keys), "\(name) \(op): rows")
                for (k, want) in expected {
                    XCTAssertEqual(rows[k]?["status"] as? String, want["status"] as? String, "\(name) \(op) \(k): status")
                    XCTAssertEqual(rows[k]?["errorCode"] as? String, want["errorCode"] as? String, "\(name) \(op) \(k): errorCode")
                    XCTAssertEqual(rows[k]?["http"] as? Int, (want["http"] as? NSNumber)?.intValue, "\(name) \(op) \(k): http")
                }
                let lines = returned.map { SetupCheck.ActivityEvent(time: at, type: op, row: $0).line }
                XCTAssertEqual(lines, e["lines"] as? [String], "\(name) \(op): lines")
            }
        }
    }
}

/// A relay at https://relay.example.org that answers each publish from a script: an HTTP status (2xx with ntfy's
/// `{"id","time"}`), or "network" for no answer at all.
final class ScriptedRelay: URLProtocol {
    private static let lock = NSLock()
    private static var answers: [Any] = []
    private static var time = 0

    static func script(_ list: [Any], time t: Int) {
        lock.lock()
        defer { lock.unlock() }
        answers = list
        time = t
    }

    static var left: Int {
        lock.lock()
        defer { lock.unlock() }
        return answers.count
    }

    static var session: URLSession {
        let c = URLSessionConfiguration.ephemeral
        c.protocolClasses = [ScriptedRelay.self]
        return URLSession(configuration: c)
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "relay.example.org" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        Self.lock.lock()
        let next: Any? = Self.answers.isEmpty ? nil : Self.answers.removeFirst()
        let t = Self.time
        Self.lock.unlock()
        guard let next, let status = (next as? NSNumber)?.intValue else {
            // "network", or more publishes than answers: no answer at all.
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let body = (200..<300).contains(status) ? Data("{\"id\":\"msg\",\"time\":\(t)}".utf8) : Data("{}".utf8)
        let r = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: r, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
}
