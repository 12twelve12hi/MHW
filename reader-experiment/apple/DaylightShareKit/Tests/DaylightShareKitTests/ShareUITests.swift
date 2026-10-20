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
        let copy = try XCTUnwrap(SharePayloadReader.copyToTemporary(src, suggestedName: "Annual report.pdf"))
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
