import Foundation
import XCTest
@testable import DaylightShareKit

/// How a Lab share becomes an item (LAB-PLAN F03, F10, F11, F16, F33; `LabShare`, `PageCapture`): the Safari page's
/// modes, links cleaned with `x-orig`, text with no link as a note, the copied link with its host.
final class LabShareTests: XCTestCase {
    let page = "<html><head><script>track()</script></head><body><p>Hello</p></body></html>"
    let clean = "<html><head></head><body><p>Hello</p></body></html>"

    func capture(article words: Int? = nil, selection: String = "") -> PageCapture {
        PageCapture(cleanHTML: clean, words: 420,
                    article: words.map { PageCapture.Article(html: "<article><p>Hello</p></article>", words: $0, title: "Readable") },
                    selectionText: selection, selectionHTML: selection.isEmpty ? "" : "<p>\(selection)</p>")
    }

    /// GetPage.js's `lab` object as the share sheet hands it over (numbers as NSNumber).
    func testTheCaptureIsReadFromGetPage() {
        let d: [String: Any] = [
            "cleanHtml": clean, "words": NSNumber(value: 420),
            "article": ["html": "<article>x</article>", "words": NSNumber(value: 300), "title": "T", "byline": "B", "site": "S"],
            "selectionText": "  ", "selectionHtml": "",
        ]
        let c = PageCapture.read(d)
        XCTAssertEqual(c?.cleanHTML, clean)
        XCTAssertEqual(c?.words, 420)
        XCTAssertEqual(c?.article, PageCapture.Article(html: "<article>x</article>", words: 300, title: "T", byline: "B", site: "S"))
        XCTAssertEqual(c?.hasSelection, false, "white space is no selection")
        XCTAssertNil(PageCapture.read(nil))
        XCTAssertNil(PageCapture.read("html"))
        XCTAssertNil(PageCapture.read(["cleanHtml": ""])?.cleanHTML, "an empty clean copy is none")
    }

    /// F03: Page as you see it is the clean copy with x-cap "seen"; F10's other modes; a page too big to clean goes as
    /// its link with v1.1's line.
    func testThePageModes() throws {
        let url = "https://example.com/story"
        let seen = LabShare.pageInput(html: page, url: url, title: "Story", capture: capture())
        XCTAssertEqual(seen.input.kind, .page)
        XCTAssertEqual(seen.input.content, Data(clean.utf8))
        XCTAssertEqual(seen.input.extras, ["x-cap": "seen"])
        XCTAssertNil(seen.note)

        let article = LabShare.pageInput(html: page, url: url, title: nil, capture: capture(article: 300), mode: .clean)
        XCTAssertEqual(article.input.extras, ["x-cap": "clean"])
        XCTAssertEqual(article.input.title, "Readable", "Readability's title when the page has none")
        XCTAssertEqual(article.input.content, Data("<article><p>Hello</p></article>".utf8))

        let noArticle = LabShare.pageInput(html: page, url: url, title: "Story", capture: capture(), mode: .clean)
        XCTAssertEqual(noArticle.input.extras, ["x-cap": "seen"], "Clean article without an article sends the page")

        let link = LabShare.pageInput(html: page, url: url, title: "Story", capture: capture(), mode: .link)
        XCTAssertEqual(link.input.kind, .url)
        XCTAssertEqual(link.input.url, url)
        XCTAssertTrue(link.input.extras.isEmpty)

        let selection = LabShare.pageInput(html: page, url: url, title: "Story", capture: capture(selection: "A quoted line."),
                                           mode: .selection, date: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertEqual(selection.input.kind, .file)
        XCTAssertEqual(selection.input.extras["x-cap"], "excerpt")

        let big = LabShare.pageInput(html: page, url: url, title: "Story", capture: PageCapture(cleanHTML: nil))
        XCTAssertEqual(big.input.kind, .url)
        XCTAssertEqual(big.note, ShareText.pageSentAsLinkMessage)
    }

    /// F10's default: a selection, then the site's last mode (never Selection), then Page as you see it.
    func testTheDefaultMode() {
        XCTAssertEqual(LabShare.defaultMode(capture: capture(selection: "x"), remembered: "clean"), .selection)
        XCTAssertEqual(LabShare.defaultMode(capture: capture(), remembered: "clean"), .clean)
        XCTAssertEqual(LabShare.defaultMode(capture: capture(), remembered: "selection"), .page)
        XCTAssertEqual(LabShare.defaultMode(capture: nil, remembered: nil), .page)
        XCTAssertEqual(LabShare.defaultMode(capture: capture(), remembered: "bogus"), .page)
    }

    func testTheThinAndReviewLines() {
        XCTAssertEqual(LabShare.thinText(words: 90), "This page looks thin (90 words). Send the full page instead?")
        let stats = LabShare.reviewStats(words: 1200, html: String(repeating: "<p>Some words here.</p>", count: 400))
        XCTAssertTrue(stats.hasPrefix("1200 words · about "), stats)
        XCTAssertTrue(stats.hasSuffix(" MB"), stats)
        XCTAssertEqual(LabShare.SendAs.clean.menuTitle, "Clean article")
        XCTAssertEqual(LabText.fill(LabText["sendAs.line"], ["mode": LabShare.SendAs.page.shortTitle]), "Send as: Page ▾")
    }

    /// F16: links go cleaned, with `x-orig` holding the link as shared; with F16's Use switch off they go as shared.
    func testLinksAreCleanedWithTheirOriginal() async {
        let shared = "https://example.com/a?id=2&utm_source=news&fbclid=abc"
        let cleaned = await LabShare.linkInput(url: shared, title: "A", clean: true, fetch: { _ in nil })
        XCTAssertEqual(cleaned.url, "https://example.com/a?id=2")
        XCTAssertEqual(cleaned.extras["x-orig"], shared)
        XCTAssertEqual(cleaned.title, "A")
        let asShared = await LabShare.linkInput(url: shared, title: "A", clean: false, fetch: { _ in nil })
        XCTAssertEqual(asShared.url, shared)
        XCTAssertTrue(asShared.extras.isEmpty)
    }

    /// F16 and F11 rule 3: text holding a link is that link (its headline the title); text with no link is a note.
    func testTextIsALinkOrANote() async throws {
        let shared = await LabShare.textInput("Great piece https://example.com/b?utm_medium=social", clean: true,
                                              fetch: { _ in nil })
        let link = try XCTUnwrap(shared)
        XCTAssertEqual(link.kind, .url)
        XCTAssertEqual(link.url, "https://example.com/b")
        XCTAssertEqual(link.extras["x-orig"], "https://example.com/b?utm_medium=social")

        let text = await LabShare.textInput("Remember to read about tides on Sunday.", clean: true,
                                            date: Date(timeIntervalSince1970: 1_800_000_000), fetch: { _ in nil })
        let note = try XCTUnwrap(text)
        XCTAssertEqual(note.kind, .file)
        XCTAssertEqual(note.extras["x-cap"], "excerpt")
        XCTAssertTrue(note.name?.hasPrefix("Note") == true, note.name ?? "")
        XCTAssertTrue(note.name?.hasSuffix(".md") == true, note.name ?? "")

        let none = await LabShare.textInput("   ", clean: true, fetch: { _ in nil })
        XCTAssertNil(none)
    }

    /// F33: the copied link with its host for "Send {host} to {name}?", cleaned; nothing for text that is not a link.
    func testTheCopiedLink() throws {
        let c = try XCTUnwrap(LabShare.copiedLink("https://www.example.org/x?fbclid=1", clean: true))
        XCTAssertEqual(c.host, "www.example.org")
        XCTAssertEqual(c.input.url, "https://www.example.org/x")
        XCTAssertEqual(c.input.extras["x-orig"], "https://www.example.org/x?fbclid=1")
        XCTAssertNil(LabShare.copiedLink("not a link at all", clean: true))
        XCTAssertNil(LabShare.copiedLink("", clean: true))
        XCTAssertEqual(LabShare.copiedLink("https://www.example.org/x?fbclid=1", clean: false)?.input.extras, [:])
    }
}
