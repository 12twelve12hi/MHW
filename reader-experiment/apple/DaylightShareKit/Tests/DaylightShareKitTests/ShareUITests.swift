#if canImport(DaylightShareUI)
import DaylightShareKit
@testable import DaylightShareUI
import Foundation
import XCTest

/// The share extensions' decisions: what to send for what the share sheet hands over.
final class ShareUITests: XCTestCase {
    func testTextWithALinkIsTheLink() {
        XCTAssertEqual(SharePayloadReader.textPayload("Great read https://example.com/a?b=1", title: nil),
                       .link(url: "https://example.com/a?b=1", title: "Great read"))
        XCTAssertEqual(SharePayloadReader.textPayload("https://example.com/x", title: "T"), .link(url: "https://example.com/x", title: "T"))
        let essay = String(repeating: "A long note without much in it. ", count: 40) + "https://example.com"
        XCTAssertEqual(SharePayloadReader.textPayload(essay, title: nil), .text(essay.trimmingCharacters(in: .whitespacesAndNewlines)))
        XCTAssertNil(SharePayloadReader.textPayload("   ", title: nil))
    }

    func testThePageWinsThenFilesThenLinks() {
        let page = SharePayload.page(html: "<p>x</p>", url: "https://e.com", title: nil)
        let link = SharePayload.link(url: "https://e.com", title: nil)
        let file = SharePayload.file(url: URL(fileURLWithPath: "/tmp/a.pdf"), name: "a.pdf")
        XCTAssertEqual(SharePayloadReader.best([link, page, .text("x")]), [page])
        XCTAssertEqual(SharePayloadReader.best([link, file, file]), [file, file])
        XCTAssertEqual(SharePayloadReader.best([.text("x"), link]), [link])
        XCTAssertEqual(SharePayloadReader.best([.text("x")]), [.text("x")])
        XCTAssertEqual(SharePayloadReader.best([]), [])
    }

    @MainActor
    func testWhatEachPayloadSends() throws {
        let big = String(repeating: "x", count: DLS.maxPageHTML + 1)
        XCTAssertEqual(try ShareExtensionModel.input(for: .page(html: big, url: "https://e.com/p", title: "P")).kind, .url)
        let page = try ShareExtensionModel.input(for: .page(html: "<p>hi</p>", url: "https://e.com/p", title: "P"))
        XCTAssertEqual(page.kind, .page)
        XCTAssertEqual(page.content, Data("<p>hi</p>".utf8))
        let text = try ShareExtensionModel.input(for: .text("Shopping list\nmilk"))
        XCTAssertEqual(text.kind, .file)
        XCTAssertEqual(text.name, "Shopping list.txt")
        XCTAssertEqual(text.mime, "text/plain")

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-ui-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let webloc = dir.appendingPathComponent("Article.webloc")
        try PropertyListSerialization.data(fromPropertyList: ["URL": "https://example.com/article"], format: .xml, options: 0)
            .write(to: webloc)
        let w = try ShareExtensionModel.input(for: .file(url: webloc, name: "Article.webloc"))
        XCTAssertEqual(w.kind, .url)
        XCTAssertEqual(w.url, "https://example.com/article")
        let shortcut = dir.appendingPathComponent("Page.url")
        try Data("[InternetShortcut]\r\nURL=https://example.com/page\r\n".utf8).write(to: shortcut)
        XCTAssertEqual(AppModel.linkInShortcutFile(shortcut), "https://example.com/page")
        let pdf = dir.appendingPathComponent("paper.pdf")
        try Data("%PDF-1.7".utf8).write(to: pdf)
        let f = try ShareExtensionModel.input(for: .file(url: pdf, name: "paper.pdf"))
        XCTAssertEqual(f.kind, .file)
        XCTAssertEqual(f.mime, "application/pdf")
    }

    func testCopyToTemporaryKeepsAUsefulName() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-ui-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let src = dir.appendingPathComponent("tmp-1234.pdf")
        try Data("%PDF".utf8).write(to: src)
        let copy = try SharePayloadReader.copyToTemporary(src, suggestedName: "Annual report.pdf")
        XCTAssertEqual(copy.lastPathComponent, "Annual report.pdf")
        XCTAssertEqual(try Data(contentsOf: copy), Data("%PDF".utf8))
        try? FileManager.default.removeItem(at: copy.deletingLastPathComponent())
    }

    @MainActor
    func testPairingLinksAndBigFilesInTheShareSheet() throws {
        XCTAssertEqual(SharePayloadReader.textPayload("daylightshare://pair?c=E4AY56TMADQP5QSNMY7BCGPZUFRA", title: nil),
                       .pairing("daylightshare://pair?c=E4AY56TMADQP5QSNMY7BCGPZUFRA"))
        XCTAssertEqual(SharePayloadReader.best([.link(url: "https://e.com", title: nil), .pairing("daylightshare://pair?c=X")]),
                       [.pairing("daylightshare://pair?c=X")])
        // A file over 9 MB is refused from its size, before it is read or copied.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-ui-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let big = dir.appendingPathComponent("big.pdf")
        FileManager.default.createFile(atPath: big.path, contents: nil)
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: 9_000_001)
        try handle.close()
        XCTAssertEqual(SharePayloadReader.filePayload(big, suggestedName: nil), .tooLarge(name: "big.pdf", size: 9_000_001))
        XCTAssertThrowsError(try ShareExtensionModel.input(for: .tooLarge(name: "big.pdf", size: 9_000_001))) { e in
            XCTAssertEqual((e as? ShareError)?.message, "Too big to send. Files can be up to 9 MB; this one is 9.1 MB.")
        }
        XCTAssertThrowsError(try ShareExtensionModel.input(for: .file(url: big, name: "big.pdf"))) { e in
            XCTAssertEqual((e as? ShareError)?.code, "too-large")
        }
        guard case let .refused(message) = AppModel.readFile(big) else { return XCTFail("the app reads a 9 MB+ file") }
        XCTAssertEqual(message, "Too big to send. Files can be up to 9 MB; this one is 9.1 MB.")
        let small = dir.appendingPathComponent("small.pdf")
        try Data("%PDF".utf8).write(to: small)
        guard case .file = SharePayloadReader.filePayload(small, suggestedName: nil) else { return XCTFail("small file") }
    }

    /// A file the share sheet hands over that cannot be copied is reported, not dropped: with the shared sentence
    /// when the disk is full (CHANGES-v1.1 2.5).
    @MainActor
    func testAFileThatCannotBeCopiedIsReported() throws {
        let missing = URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)/paper.pdf")
        XCTAssertEqual(SharePayloadReader.filePayload(missing, suggestedName: nil),
                       .unreadable(name: "paper.pdf", message: "Couldn’t read “paper.pdf”."))
        XCTAssertEqual(SharePayloadReader.best([.link(url: "https://e.com", title: nil),
                                                .unreadable(name: "paper.pdf", message: "x")]),
                       [.unreadable(name: "paper.pdf", message: "x")], "it counts as the shared file")
        XCTAssertTrue(SharePayloadReader.isOutOfSpace(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)))
        XCTAssertTrue(SharePayloadReader.isOutOfSpace(NSError(domain: NSPOSIXErrorDomain, code: Int(ENOSPC))))
        XCTAssertTrue(SharePayloadReader.isOutOfSpace(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteUnknownError,
            userInfo: [NSUnderlyingErrorKey: NSError(domain: NSPOSIXErrorDomain, code: Int(ENOSPC))])))
        XCTAssertFalse(SharePayloadReader.isOutOfSpace(NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoSuchFileError)))
        XCTAssertThrowsError(try ShareExtensionModel.input(for: .unreadable(name: "a.pdf", message: ShareError.outOfSpace.message))) { e in
            XCTAssertEqual(e as? ShareError, ShareError.outOfSpace)
            XCTAssertEqual((e as? ShareError)?.message, "This device is out of space, so it can’t send this.")
        }
        XCTAssertEqual(ShareExtensionModel.describe([.unreadable(name: "a.pdf", message: "x")]), "a.pdf")
    }

    /// A file URL the extension cannot copy is not the end of it: the item's data is used when it has some, and only
    /// when nothing works is the file reported (not dropped).
    func testAnUnreadableFileURLFallsBackToTheItemsData() async throws {
        let missing = URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)/paper.pdf") as NSURL
        let onlyURL = NSItemProvider(item: missing, typeIdentifier: "public.file-url")
        let reported = await SharePayloadReader.read(onlyURL, itemTitle: nil)
        XCTAssertEqual(reported, .unreadable(name: "paper.pdf", message: "Couldn’t read “paper.pdf”."))

        let withData = NSItemProvider(item: missing, typeIdentifier: "public.file-url")
        withData.registerDataRepresentation(forTypeIdentifier: "com.adobe.pdf", visibility: .all) { done in
            done(Data("%PDF-1.4".utf8), nil)
            return nil
        }
        withData.suggestedName = "paper.pdf"
        let payload = await SharePayloadReader.read(withData, itemTitle: nil)
        guard case let .file(url, _)? = payload else { return XCTFail("the data was not used: \(String(describing: payload))") }
        XCTAssertEqual(try Data(contentsOf: url), Data("%PDF-1.4".utf8))
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    /// After a share the extension shows the row's own words: "Sent · waiting for your Daylight" (it reached the
    /// relay), never a "Sent ✓" that reads like "Delivered ✓". Needs the mock relay (CI sets DLS_E2E_RELAY).
    @MainActor
    func testTheShareSheetSaysWhatTheRowSays() async throws {
        guard let relay = ProcessInfo.processInfo.environment["DLS_E2E_RELAY"], !relay.isEmpty else {
            throw XCTSkip("DLS_E2E_RELAY is not set")
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-ui-\(UUID().uuidString)")
        let suite = "dls-tests-\(UUID().uuidString)"
        defer {
            UserDefaults.standard.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: dir)
        }
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: dir)
        await store.pair(try Pairing.generate(relay: relay, name: "CI Daylight"))
        let model = ShareExtensionModel(store: store)
        let finished = expectation(description: "finished")
        model.onFinish = { finished.fulfill() }
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(object: NSURL(string: "https://example.com/from-the-share-sheet")!)]
        model.start(inputItems: [item])
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if case .sent = model.phase { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        guard case let .sent(text) = model.phase else { return XCTFail("not sent: \(model.phase)") }
        XCTAssertEqual(text.label, "Sent · waiting for your Daylight")
        XCTAssertNil(text.sentence)
        XCTAssertEqual(OutboxStore(store: store).rows.first?.url, "https://example.com/from-the-share-sheet")
        await fulfillment(of: [finished], timeout: 10)
    }

    @MainActor
    func testTheHistoryUsesTheSharedCopy() {
        let h = ItemHeader(id: "00112233445566778899aabbccddeeff", kind: .url, url: "https://e.com", sent: "")
        let now = Date()
        var row = OutboxRow(id: h.id, kind: .url, url: "https://e.com", header: h, created: now, status: .failed,
                            errorCode: "network")
        XCTAssertEqual(StatusLabel.text(row), "Waiting to send")
        XCTAssertEqual(RowText(row: row, now: now).buttonTitle, "Retry now")
        XCTAssertEqual(RowText(row: row, now: now).message, "Waiting to send. Couldn’t send right now. It will try again by itself.")
        row.status = .delivered
        XCTAssertEqual(StatusLabel.text(row), "Delivered ✓")
        XCTAssertEqual(RowText(row: row, now: now).message, "Delivered ✓ Saved on your Daylight.")
        XCTAssertNil(RowText(row: row, now: now).buttonTitle)
        row.status = .sent
        XCTAssertEqual(RowText(row: row, now: now).message, "Sent · waiting for your Daylight")
    }
}
#endif
