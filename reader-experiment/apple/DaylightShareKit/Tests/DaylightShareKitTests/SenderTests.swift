import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import DaylightShareKit

final class SenderTests: XCTestCase {
    var dir: URL!
    var clock = Date(timeIntervalSince1970: 1_800_000_000)

    override func setUp() {
        super.setUp()
        FakeRelay.reset()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-tests-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    func makeSender(_ pairing: Pairing) throws -> ShareSender {
        let s = try ShareSender(pairing: pairing, outbox: OutboxStore(directory: dir), from: "Test iPhone", app: "ios/test",
                                session: FakeRelay.session)
        s.relay.sleep = { _ in }
        s.now = { [unowned self] in self.clock }
        return s
    }

    func receiver(_ pairing: Pairing) throws -> TestReceiver {
        let r = try RelayClient(relay: pairing.relay, session: FakeRelay.session)
        r.sleep = { _ in }
        return TestReceiver(keys: pairing.keys, relay: r)
    }

    func testLinkIsSentReceivedAndAcked() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let row = try await sender.send(.link("https://example.com/a?b=c", title: "  An\narticle  "))
        XCTAssertEqual(row.status, .sent)
        XCTAssertFalse(row.attachment)
        XCTAssertEqual(row.title, "An article")
        XCTAssertTrue(sender.hasPending)

        // Nothing acked yet.
        let none = try await sender.checkAcks()
        XCTAssertEqual(none, 0)

        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].header.url, "https://example.com/a?b=c")
        XCTAssertEqual(items[0].header.from, "Test iPhone")
        XCTAssertEqual(items[0].header.app, "ios/test")
        XCTAssertEqual(items[0].header.id, row.id)

        let acked = try await sender.checkAcks()
        XCTAssertEqual(acked, 1)
        XCTAssertEqual(sender.outbox.row(row.id)?.status, .delivered)
        XCTAssertFalse(sender.hasPending)
        // The cursor moved to the ack's time minus 5, for this ack topic.
        let state = sender.outbox.load()
        XCTAssertEqual(state.ackTopic, pairing.keys.ackTopic)
        XCTAssertNotNil(state.ackSince)
        // Publishes carry the ntfy headers.
        XCTAssertTrue(FakeRelay.with { $0.requests }.contains { $0.hasPrefix("POST /\(pairing.keys.inboxTopic)") })
    }

    func testPageIsDeflatedAndRoundTrips() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let html = "<html><body>" + String(repeating: "<p>Paywalled article text.</p>", count: 2000) + "</body></html>"
        let row = try await sender.send(.page(html: html, url: "https://news.example/story", title: "Story"))
        XCTAssertEqual(row.header.enc, "deflate-raw")
        XCTAssertEqual(row.header.size, html.utf8.count)
        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(String(data: items[0].content, encoding: .utf8), html)
        XCTAssertEqual(items[0].header.kind, .page)
        XCTAssertEqual(items[0].header.mime, "text/html")
    }

    func testLargeFileGoesInPartsAsAttachments() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        sender.chunkSize = 4000
        let pdf = DLSCrypto.randomBytes(16_500)
        let row = try await sender.send(.file(pdf, name: "../Paper: final?.pdf", title: "Paper"))
        XCTAssertEqual(row.status, .sent)
        XCTAssertTrue(row.attachment)
        XCTAssertEqual(row.name, "Paper final .pdf")
        XCTAssertEqual(row.mime, "application/pdf")
        XCTAssertNil(row.header.enc, "PDFs are not compressed")
        // 4 full 4000-byte chunks go as attachments; the last 500 bytes fit in a message (base64 <= 3800).
        XCTAssertEqual(FakeRelay.with { $0.topics[pairing.keys.inboxTopic]?.count }, 5)
        XCTAssertEqual(FakeRelay.with { $0.requests.filter { $0.hasPrefix("PUT ") }.count }, 4)
        XCTAssertEqual(FakeRelay.with { $0.requests.filter { $0.hasPrefix("POST ") }.count }, 1)
        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].content, pdf)
        let acked = try await sender.checkAcks()
        XCTAssertEqual(acked, 1)
        XCTAssertNil(sender.outbox.readBody(row.id), "body dropped once delivered")
    }

    func testResendAfterElevenHoursThenExpireAndTryAgain() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        let row = try await sender.send(.file(Data("# Notes\n".utf8), name: "notes.md"))
        XCTAssertEqual(row.mime, "text/markdown")

        clock += 10 * 3600
        let early = await sender.resendDue()
        XCTAssertEqual(early.count, 0)
        clock += 3600 + 1
        let resent = await sender.resendDue()
        XCTAssertEqual(resent.count, 1)
        XCTAssertEqual(resent.first?.attempts, 2)
        XCTAssertEqual(FakeRelay.with { $0.topics[pairing.keys.inboxTopic]?.count }, 2)

        // Same id and header in both copies; the receiver gets the item once.
        let items = try await receiver(pairing).pollAndAck()
        XCTAssertEqual(items.count, 1)

        // A second item that is never acked expires after 7 days and can be tried again.
        let lost = try await sender.send(.link("https://example.com/lost"))
        clock += 8 * 24 * 3600
        _ = await sender.resendDue()
        XCTAssertEqual(sender.outbox.row(lost.id)?.status, .expired)
        let again = await sender.retry(lost.id)
        XCTAssertEqual(again?.status, .sent)
        XCTAssertEqual(again?.created, clock)
    }

    func testFailedPublishBacksOffAndRecovers() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [500, 500, 500, 500] }
        let row = try await sender.send(.link("https://example.com/x"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertTrue(row.error.contains("500"), row.error)
        let early = await sender.resendDue()
        XCTAssertEqual(early.count, 0, "backoff: 2 minutes after the first failure")
        clock += 121
        let later = await sender.resendDue()
        XCTAssertEqual(later.first?.status, .sent)
    }

    func testRateLimitIsRetried() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [429] }
        let row = try await sender.send(.link("https://example.com/x"))
        XCTAssertEqual(row.status, .sent)
    }

    func testTooLargeIsReported() async throws {
        let pairing = try Pairing.generate(relay: "https://relay.test")
        let sender = try makeSender(pairing)
        FakeRelay.with { $0.failNext = [413] }
        let row = try await sender.send(.link("https://example.com/x"))
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.error, "The relay refused the file as too large.")
        XCTAssertEqual(FakeRelay.with { $0.requests.count }, 1, "413 is not retried")
    }

    func testBadInputThrows() async throws {
        let sender = try makeSender(try Pairing.generate(relay: "https://relay.test"))
        do {
            try await sender.send(.link("javascript:alert(1)"))
            XCTFail("should throw")
        } catch let e as ShareError {
            XCTAssertEqual(e.code, "url")
        }
        let big = Data(count: DLS.maxPageHTML + 1)
        do {
            try await sender.send(ItemInput(kind: .page, url: "https://example.com", content: big))
            XCTFail("should throw")
        } catch let e as ShareError {
            XCTAssertEqual(e.code, "too-large")
        }
        XCTAssertTrue(sender.outbox.rows.isEmpty)
    }

    func testUnpairingClearsTheOutbox() async throws {
        let sender = try makeSender(try Pairing.generate(relay: "https://relay.test"))
        try await sender.send(.file(Data("x".utf8), name: "a.txt"))
        XCTAssertEqual(sender.outbox.rows.count, 1)
        sender.outbox.removeAll()
        XCTAssertTrue(sender.outbox.rows.isEmpty)
    }

    func testStorePersistsPairing() throws {
        let suite = "dls-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = SharedStore(defaults: defaults, directory: dir)
        XCTAssertNil(store.pairing)
        let p = try Pairing.generate(relay: "https://relay.example.org/x/", name: "Daylight\n DC-1")
        store.pairing = p
        XCTAssertEqual(store.pairing, p)
        XCTAssertEqual(store.pairing?.relay, "https://relay.example.org/x")
        XCTAssertEqual(store.pairing?.name, "Daylight DC-1")
        store.deviceName = "  Mike’s   iPhone "
        XCTAssertEqual(store.deviceName, "Mike’s iPhone")
        store.pairing = nil
        XCTAssertNil(store.pairing)
    }

    func testSafariNativeMessagingAndPairingChanges() async throws {
        let suite = "dls-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = SharedStore(defaults: defaults, directory: dir)
        XCTAssertEqual(SafariNativeMessaging.answer(["type": "getPairing"], store: store)["paired"] as? Bool, false)

        let p = try Pairing.generate(relay: "https://relay.test", name: "Desk Daylight")
        XCTAssertEqual(SafariNativeMessaging.answer(["type": "setPairing", "link": p.link], store: store)["ok"] as? Bool, true)
        let a = SafariNativeMessaging.answer(["type": "getPairing"], store: store)
        let got = a["pairing"] as? [String: Any]
        XCTAssertEqual(got?["code"] as? String, p.code)
        XCTAssertEqual(got?["relay"] as? String, "https://relay.test")
        XCTAssertEqual(got?["name"] as? String, "Desk Daylight")
        XCTAssertEqual(try Pairing.parse(got?["link"] as? String ?? ""), p)
        XCTAssertEqual(SafariNativeMessaging.answer(["type": "setPairing", "code": "nope"], store: store)["ok"] as? Bool, false)

        // Re-pairing with the same code keeps the name and the outbox; another code drops queued items.
        let sender = try ShareSender(pairing: p, outbox: OutboxStore(store: store), session: FakeRelay.session)
        sender.relay.sleep = { _ in }
        try await sender.send(.link("https://example.com/q"))
        store.pair(try Pairing(secret: p.secret, relay: p.relay))
        XCTAssertEqual(store.pairing?.name, "Desk Daylight")
        XCTAssertEqual(OutboxStore(store: store).rows.count, 1)
        store.pair(try Pairing.generate(relay: "https://relay.test"))
        XCTAssertEqual(OutboxStore(store: store).rows.count, 0)
        store.unpair()
        XCTAssertNil(store.pairing)
    }

    func testProvisioningProfileAppGroups() {
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict><key>Entitlements</key><dict>
        <key>com.apple.security.application-groups</key><array><string>group.com.daylight.share.ABCDE12345</string></array>
        </dict></dict></plist>
        """
        var data = Data([0x30, 0x82, 0x01, 0x02])
        data.append(Data(plist.utf8))
        data.append(Data([0x00, 0xA0]))
        XCTAssertEqual(SharedStore.appGroups(inProvisioningProfile: data), ["group.com.daylight.share.ABCDE12345"])
    }

    func testTextHelpers() throws {
        XCTAssertEqual(ShareText.findURL("Read this: https://example.com/a(b). Thanks!"), "https://example.com/a(b")
        XCTAssertEqual(DaylightShare.linkFromUserText("example.com/page"), "https://example.com/page")
        XCTAssertEqual(DaylightShare.linkFromUserText("  https://a.example/x  "), "https://a.example/x")
        XCTAssertNil(DaylightShare.linkFromUserText("hello world"))
        XCTAssertNil(ShareText.webURL("file:///etc/passwd"))
        XCTAssertNil(ShareText.webURL("https://"))
        XCTAssertNil(ShareText.webURL("https://exa mple.com"))
        XCTAssertEqual(ShareText.webURL("HTTPS://Example.com:8443/x"), "HTTPS://Example.com:8443/x")
        XCTAssertEqual(try ShareText.normalizeRelay("ntfy.example.com:8443/"), "https://ntfy.example.com:8443")
        XCTAssertEqual(try ShareText.normalizeRelay("https://NTFY.sh:443/?x=1#y"), "https://ntfy.sh")
        XCTAssertEqual(try ShareText.normalizeRelay(""), "https://ntfy.sh")
        XCTAssertThrowsError(try ShareText.normalizeRelay("ftp://x.example"))
        XCTAssertEqual(ShareText.cleanTitle(String(repeating: "é", count: 400)).count, 300)
        XCTAssertEqual(ShareText.isoTimestamp(Date(timeIntervalSince1970: 1_792_274_400)), "2026-10-17T22:00:00.000Z")
        XCTAssertEqual(ShareText.mimeType(forFileName: "Book.EPUB"), "application/epub+zip")
        XCTAssertTrue(ShareText.isTextMime("text/markdown"))
        XCTAssertFalse(ShareText.isTextMime("application/pdf"))
        // Base32/base64 round trips at every length.
        for n in 0..<70 {
            let d = DLSCrypto.randomBytes(n)
            XCTAssertEqual(Base32.decode(Base32.encode(d)), d)
            XCTAssertEqual(Base64.decode(Base64.encode(d)), d)
            XCTAssertEqual(Hex.decode(d.hexString), d)
        }
        XCTAssertNil(Base64.decode("QQ=x"))
        XCTAssertEqual(Base64.decode("QQ"), Data("A".utf8))
    }
}
