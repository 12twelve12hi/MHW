import Foundation
import XCTest
@testable import DaylightShareKit

/// The cross-platform vectors from the JavaScript reference: reader-experiment/share/vectors/test-vectors.json
/// (found by relative path, or at $DLS_VECTORS).
final class VectorTests: XCTestCase {
    static let vectors: [String: Any] = {
        let url: URL
        if let p = ProcessInfo.processInfo.environment["DLS_VECTORS"], !p.isEmpty {
            url = URL(fileURLWithPath: p)
        } else {
            url = URL(fileURLWithPath: #filePath) // …/apple/DaylightShareKit/Tests/DaylightShareKitTests/VectorTests.swift
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("share/vectors/test-vectors.json")
        }
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            fatalError("cannot read the test vectors at \(url.path)")
        }
        return obj
    }()

    func list(_ key: String) -> [[String: Any]] {
        let l = Self.vectors[key] as? [[String: Any]] ?? []
        XCTAssertFalse(l.isEmpty, "vectors.\(key) is empty")
        return l
    }

    func hex(_ s: Any?) -> Data { Hex.decode(s as? String ?? "")! }

    var keys1: ShareKeys { ShareKeys(secret: hex(list("pairing")[0]["secretHex"])) }

    func testPairing() throws {
        for p in list("pairing") {
            let label = p["label"] as? String ?? "?"
            let secret = hex(p["secretHex"])
            XCTAssertEqual(PairingCode.format(secret), p["code"] as? String, label)
            XCTAssertEqual(PairingCode.format(secret, dashes: false), p["codeCompact"] as? String, label)
            XCTAssertEqual(try Pairing(secret: secret).link, p["link"] as? String, label)
            let named = try Pairing(secret: secret, relay: "https://relay.example.org/ntfy/", name: "Anjan’s Daylight & co")
            XCTAssertEqual(named.link, p["linkWithRelayAndName"] as? String, label)
            let k = ShareKeys(secret: secret)
            XCTAssertEqual(k.key.hexString, p["keyHex"] as? String, label)
            XCTAssertEqual(k.inboxTopic, p["inboxTopic"] as? String, label)
            XCTAssertEqual(k.ackTopic, p["ackTopic"] as? String, label)
            XCTAssertEqual(try PairingCode.parse(p["code"] as? String ?? "").hexString, p["secretHex"] as? String, label)
            // Links parse back to the same pairing.
            XCTAssertEqual(try Pairing.parse(named.link), named, label)
        }
    }

    func testCodeParsing() throws {
        for c in list("codeParsing") {
            let name = c["name"] as? String ?? "?"
            let input = c["input"] as? String ?? ""
            if let expectedError = c["error"] as? String {
                XCTAssertThrowsError(try Pairing.parse(input), name) { error in
                    XCTAssertEqual((error as? ShareError)?.reason, expectedError, name)
                }
            } else {
                let p = try Pairing.parse(input)
                XCTAssertEqual(p.secret.hexString, c["secretHex"] as? String, name)
                if let relay = c["relay"] as? String { XCTAssertEqual(p.relay, relay, name) }
                if let n = c["nameExpected"] as? String { XCTAssertEqual(p.name, n, name) }
            }
        }
    }

    func testSealVectorsByteForByte() throws {
        for s in list("seal") {
            let name = s["name"] as? String ?? "?"
            let keys = ShareKeys(secret: hex(s["secretHex"]))
            let purpose = FramePurpose(rawValue: s["purpose"] as? String ?? "")!
            let headerJSON = Data((s["headerJson"] as? String ?? "").utf8)
            let body = hex(s["bodyHex"])
            let frame = try Frame.seal(keys: keys, purpose: purpose, headerJSON: headerJSON, body: body, nonce: hex(s["nonceHex"]))
            XCTAssertEqual(frame.hexString, s["frameHex"] as? String, name)
            XCTAssertEqual(Base64.encode(frame), s["frameBase64"] as? String, name)
            XCTAssertEqual(Base64.decode(s["frameBase64"] as? String ?? ""), frame, name)
            let opened = try Frame.open(keys: keys, purpose: purpose, frame: frame)
            XCTAssertEqual(opened.headerJSON, headerJSON, name)
            XCTAssertEqual(opened.body, body, name)
        }
    }

    /// Our own header serialisation reproduces the JS `JSON.stringify` bytes of the seal vectors.
    func testHeaderJSONMatchesJavaScript() throws {
        let seal = list("seal")
        let url = ItemHeader(id: "00112233445566778899aabbccddeeff", kind: .url, url: "https://example.com/articles/42?ref=share#top",
                             title: "An article — with “quotes” and ünïcödé", sent: "2026-10-17T22:00:00.000Z", from: "iPhone",
                             app: "ios/1.0.0")
        XCTAssertEqual(url.json.serialized, seal[0]["headerJson"] as? String)
        let ack = AckHeader(ids: ["00112233445566778899aabbccddeeff", "ffeeddccbbaa99887766554433221100"],
                            sent: "2026-10-17T22:01:00.000Z", from: "Daylight")
        XCTAssertEqual(ack.json.serialized, seal[1]["headerJson"] as? String)
        let md = Data("# Hello\n\nFrom the vectors.\n".utf8)
        let prepared = try ItemBuilder.prepare(ItemInput(kind: .file, id: "0123456789abcdef0123456789abcdef", name: "note.md",
                                                         mime: "text/markdown", content: md, sent: "2026-10-17T22:02:00.000Z",
                                                         from: "Mac"), compress: false)
        XCTAssertEqual(prepared.header.json.serialized, seal[2]["headerJson"] as? String)
        // Escapes like JSON.stringify.
        XCTAssertEqual(JSONOut.string("a\"b\\c\n\u{1}/é\u{2028}").serialized, "\"a\\\"b\\\\c\\n\\u0001/é\u{2028}\"")
    }

    func testItemsReassemble() throws {
        let keys = keys1
        for it in list("items") {
            let name = it["name"] as? String ?? "?"
            let r = Reassembler()
            var done: Reassembler.Item?
            for fh in it["framesHex"] as? [String] ?? [] {
                let opened = try Frame.open(keys: keys, purpose: .inbox, frame: Hex.decode(fh)!)
                if let item = try r.add(header: opened.header, body: opened.body) {
                    XCTAssertNil(done, "\(name): completes once")
                    done = item
                }
            }
            guard let done else { XCTFail("\(name): did not complete"); continue }
            let expect = it["expect"] as? [String: Any] ?? [:]
            let header = expect["header"] as? [String: Any] ?? [:]
            let got = done.header
            for (k, v) in header where k != "part" && k != "parts" {
                XCTAssertEqual(Self.field(got, k), "\(v)", "\(name): \(k)")
            }
            if header["enc"] == nil { XCTAssertEqual(got.enc, "identity", name) }
            XCTAssertNil(got.part)
            XCTAssertNil(got.parts)
            if let text = expect["contentUtf8"] as? String {
                XCTAssertEqual(String(data: done.content, encoding: .utf8), text, name)
            } else {
                XCTAssertEqual(done.content.hexString, expect["contentHex"] as? String, name)
            }
        }
    }

    static func field(_ h: ItemHeader, _ k: String) -> String {
        switch k {
        case "v": return "1"
        case "id": return h.id
        case "kind": return h.kind.rawValue
        case "url": return h.url ?? "nil"
        case "title": return h.title ?? "nil"
        case "name": return h.name ?? "nil"
        case "mime": return h.mime ?? "nil"
        case "size": return h.size.map { String($0) } ?? "nil"
        case "sha256": return h.sha256 ?? "nil"
        case "enc": return h.enc ?? "nil"
        case "sent": return h.sent
        case "from": return h.from ?? "nil"
        case "app": return h.app ?? "nil"
        default: return "unknown field \(k)"
        }
    }

    func testInvalidFramesAreRefused() {
        let keys = keys1
        for f in list("invalidFrames") {
            let name = f["name"] as? String ?? "?"
            let purpose = FramePurpose(rawValue: f["purpose"] as? String ?? "")!
            XCTAssertThrowsError(try Frame.open(keys: keys, purpose: purpose, frame: hex(f["frameHex"])), name) { e in
                XCTAssertEqual((e as? ShareError)?.code, "frame", name)
            }
        }
    }

    func testBadHeadersAreRefused() {
        for b in list("badHeaders") {
            let name = b["name"] as? String ?? "?"
            XCTAssertThrowsError(try ItemHeader.validated(b["header"] as? [String: Any] ?? [:]), name) { e in
                XCTAssertEqual((e as? ShareError)?.code, "header", name)
            }
        }
    }

    func testFileNames() {
        for f in list("fileNames") {
            XCTAssertEqual(ShareText.safeFileName(f["input"] as? String ?? ""), f["expect"] as? String, f["input"] as? String ?? "")
        }
    }

    /// Our builder's frames for the vector items decode to the same content (with the vectors' chunk sizes).
    func testBuilderRoundTripsVectorItems() throws {
        let keys = keys1
        let html = "<!doctype html><html><body>" + String(repeating: "<p>I went to the woods because I wished to live deliberately.</p>", count: 40) + "</body></html>"
        let pdf = Data((0..<1000).map { UInt8(truncatingIfNeeded: $0 * 37 + 11) })
        let inputs: [(ItemInput, Int)] = [
            (ItemInput.page(html: html, url: "https://example.com/walden", title: "Walden"), DLS.chunk),
            (ItemInput.file(pdf, name: "paper.pdf", title: "A paper"), 400),
            (ItemInput.file(Data(String(repeating: "plain text ", count: 500).utf8), name: "notes.txt"), 300),
            (ItemInput.link("https://www.newyorker.com/magazine/2026/10/19/example", title: "Example"), DLS.chunk),
        ]
        for (input, chunk) in inputs {
            let prepared = try ItemBuilder.prepare(input)
            let frames = try prepared.frames(keys: keys, chunkSize: chunk)
            let r = Reassembler()
            var done: Reassembler.Item?
            for f in frames.reversed() {
                let o = try Frame.open(keys: keys, purpose: .inbox, frame: f)
                if let item = try r.add(header: o.header, body: o.body) { done = item }
            }
            XCTAssertEqual(done?.content, input.content ?? Data())
            XCTAssertEqual(done?.header.id, prepared.id)
        }
    }

    // MARK: Revision 1.1 groups

    func testRelays() {
        for r in list("relays") {
            let input = r["input"] as? String ?? ""
            if let expected = r["expect"] as? String {
                XCTAssertEqual(try ShareText.normalizeRelay(input), expected, input)
            } else {
                XCTAssertThrowsError(try ShareText.normalizeRelay(input), input) { e in
                    XCTAssertEqual((e as? ShareError)?.code, r["error"] as? String, input)
                }
            }
        }
        XCTAssertEqual(try ShareText.relayHost("https://Relay.Example.org:8443/ntfy/"), "relay.example.org:8443")
        XCTAssertEqual(try ShareText.relayHost("http://[::1]:8080/"), "[::1]:8080")
        XCTAssertEqual(try ShareText.relayHost(""), "ntfy.sh")
    }

    func testSizing() throws {
        let sizing = try XCTUnwrap(Self.vectors["sizing"] as? [String: Any])
        XCTAssertEqual(JSONRead.integer(sizing["chunk"]), DLS.chunk)
        XCTAssertEqual(JSONRead.integer(sizing["maxItem"]), DLS.maxItem)
        XCTAssertEqual(JSONRead.integer(sizing["maxHeader"]), DLS.maxHeaderBytes)
        XCTAssertEqual(JSONRead.integer(sizing["largestFrame"]), DLS.chunk + DLS.maxHeaderBytes + 36)
        let cases = try XCTUnwrap(sizing["cases"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let size = try XCTUnwrap(JSONRead.integer(c["size"]))
            // Content that does not compress (a PDF is never compressed).
            let input = ItemInput.file(Data(count: size), name: "big.pdf", mime: "application/pdf")
            if let parts = JSONRead.integer(c["parts"]) {
                let prepared = try ItemBuilder.prepare(input)
                XCTAssertEqual(prepared.partCount(), parts, "size \(size)")
            } else {
                XCTAssertThrowsError(try ItemBuilder.prepare(input), "size \(size)") { e in
                    XCTAssertEqual((e as? ShareError)?.code, c["error"] as? String)
                    XCTAssertEqual((e as? ShareError)?.message, ShareText.tooBigMessage(size))
                }
            }
        }
    }

    func testURLs() {
        for u in list("urls") {
            let input = u["input"] as? String ?? ""
            XCTAssertEqual(ShareText.webURL(input), u["expect"] as? String, input.count > 80 ? "\(input.utf16.count)-unit URL" : input)
        }
    }

    func testInvalidItemsFailWithIntegrity() throws {
        let keys = keys1
        for it in list("invalidItems") {
            let name = it["name"] as? String ?? "?"
            let r = Reassembler()
            var thrown: Error?
            for fh in it["framesHex"] as? [String] ?? [] {
                let opened = try Frame.open(keys: keys, purpose: .inbox, frame: Hex.decode(fh)!)
                do {
                    _ = try r.add(header: opened.header, body: opened.body)
                } catch {
                    thrown = error
                }
            }
            XCTAssertEqual((thrown as? ShareError)?.code, it["error"] as? String, name)
        }
    }

    func testTheInflateBoundStopsEarly() throws {
        #if canImport(Compression)
        // 1 MiB of zeros, limited to 10 bytes: refused, without inflating it all.
        let bomb = try RawDeflate.compress(Data(count: 1 << 20))
        XCTAssertThrowsError(try RawDeflate.decompress(bomb, limit: 10)) { e in
            XCTAssertEqual((e as? ShareError)?.code, "integrity")
        }
        XCTAssertEqual(try RawDeflate.decompress(bomb, limit: 1 << 20).count, 1 << 20)
        #endif
    }

    func testHeaderSizeLimits() throws {
        let keys = keys1
        let pad = { (n: Int) -> Data in
            let base = "{\"v\":1,\"x-pad\":\"\"}"
            return Data(("{\"v\":1,\"x-pad\":\"" + String(repeating: "a", count: n - base.utf8.count) + "\"}").utf8)
        }
        XCTAssertEqual(pad(65_536).count, 65_536)
        let frame = try Frame.seal(keys: keys, purpose: .inbox, headerJSON: pad(65_536))
        XCTAssertEqual(try Frame.open(keys: keys, purpose: .inbox, frame: frame).headerJSON.count, 65_536)
        XCTAssertThrowsError(try Frame.seal(keys: keys, purpose: .inbox, headerJSON: pad(65_537))) { e in
            XCTAssertEqual((e as? ShareError)?.code, "header")
        }
    }

    func testAcks() throws {
        for a in list("acks") {
            let name = a["name"] as? String ?? "?"
            let labels = a["idLabels"] as? [String] ?? []
            let ids = labels.map { String(DLSCrypto.sha256(Data($0.utf8)).hexString.prefix(32)) }
            let sent = a["sent"] as? String ?? ""
            let from = a["from"] as? String ?? ""
            // The serialisation of exactly these ids (72 is more than a sender's AckHeader takes).
            let json = JSONOut.object([("v", .int(1)), ("kind", .string("ack")), ("ids", .array(ids.map { .string($0) })),
                                       ("sent", .string(sent)), ("from", .string(from))])
            XCTAssertEqual(json.serialized, a["headerJson"] as? String, name)
            let frameLength = json.data.count + 36
            XCTAssertEqual(frameLength, JSONRead.integer(a["frameLength"]), name)
            XCTAssertEqual(Frame.isSmall(frameLength), a["small"] as? Bool, name)
            let ack = AckHeader(ids: ids, sent: sent, from: from)
            XCTAssertEqual(ack.ids.count, min(ids.count, DLS.maxAckIDs), name)
            if ids.count <= DLS.maxAckIDs {
                XCTAssertEqual(ack.json.serialized, a["headerJson"] as? String, name)
                let sealed = try Frame.seal(keys: keys1, purpose: .ack, header: ack.json)
                XCTAssertEqual(sealed.count, frameLength, name)
                XCTAssertTrue(Frame.isSmall(sealed.count), "\(name): an ack of at most 70 ids is a message")
            }
        }
    }

    func testStatusText() throws {
        for t in list("statusText") {
            let name = t["name"] as? String ?? "?"
            let row = try XCTUnwrap(t["row"] as? [String: Any])
            let status = try XCTUnwrap(OutboxRow.Status(rawValue: row["status"] as? String ?? ""), name)
            let created = Date(timeIntervalSince1970: Double(JSONRead.integer(row["created"]) ?? 0) / 1000)
            let now = Date(timeIntervalSince1970: Double(JSONRead.integer(t["now"]) ?? 0) / 1000)
            let text = RowText(status: status, errorCode: row["errorCode"] as? String ?? "",
                               size: JSONRead.integer(row["size"]) ?? 0, created: created, now: now)
            XCTAssertEqual(text.label, t["label"] as? String, name)
            XCTAssertEqual(text.sentence, t["sentence"] as? String, name)
            XCTAssertEqual(text.action?.rawValue, t["action"] as? String, name)
            // The same through a stored row (a row saved by 1.0 has no errorCode).
            var json = row
            json["id"] = "00112233445566778899aabbccddeeff"
            let header: [String: Any] = ["id": "00112233445566778899aabbccddeeff", "kind": row["kind"] as? String ?? "url",
                                         "sent": "2026-10-17T22:00:00.000Z"]
            json["header"] = header
            let decoded = try JSONDecoder.outbox.decode(OutboxRow.self, from: JSONSerialization.data(withJSONObject: json))
            XCTAssertEqual(RowText(row: decoded, now: now), text, name)
        }
    }

    func testFormatMB() {
        for f in list("formatMB") {
            let bytes = JSONRead.integer(f["bytes"]) ?? -1
            XCTAssertEqual(ShareText.formatMB(bytes), f["expect"] as? String, "\(bytes)")
        }
        XCTAssertEqual(ShareText.tooBigMessage(14_200_000), "Too big to send. Files can be up to 9 MB; this one is 14.2 MB.")
    }

    func testPairingConfirmation() throws {
        func pairing(_ any: Any?) throws -> Pairing? {
            guard let p = any as? [String: Any] else { return nil }
            return try Pairing(secret: hex(p["secretHex"]), relay: p["relay"] as? String ?? "", name: p["name"] as? String ?? "")
        }
        for v in list("pairingConfirmation") {
            let name = v["name"] as? String ?? "?"
            let source = try XCTUnwrap(PairingConfirmation.Source(rawValue: v["source"] as? String ?? ""), name)
            let next = try XCTUnwrap(try pairing(v["next"]), name)
            let c = PairingConfirmation(current: try pairing(v["current"]), next: next, source: source)
            let e = try XCTUnwrap(v["expect"] as? [String: Any], name)
            XCTAssertEqual(c.ask, e["ask"] as? Bool, name)
            XCTAssertEqual(c.title, e["title"] as? String, name)
            XCTAssertEqual(c.lines, e["lines"] as? [String] ?? [], name)
            XCTAssertEqual(c.button, e["button"] as? String, name)
            XCTAssertEqual(c.notice, e["notice"] as? String, name)
        }
    }

    /// The largest item a sender makes: 5 frames, each within 1,966,116 bytes (under ntfy.sh's 2 MB).
    func testTheLargestItemFitsTheRelay() throws {
        let prepared = try ItemBuilder.prepare(.file(Data(count: DLS.maxItem), name: "big.pdf")) // PDFs are not compressed
        XCTAssertNil(prepared.header.enc)
        let frames = try prepared.frames(keys: keys1)
        XCTAssertEqual(frames.count, 5)
        for f in frames { XCTAssertLessThanOrEqual(f.count, DLS.chunk + DLS.maxHeaderBytes + 36) }
        XCTAssertTrue(prepared.hasAttachment())
        XCTAssertFalse(try ItemBuilder.prepare(.link("https://example.com/")).hasAttachment())
    }
}
