#if os(macOS) && canImport(WebKit) && canImport(DaylightShareUI)
import DaylightShareKit
@testable import DaylightShareUI
import WebKit
import XCTest

/// GetPage.js, the share extension's JavaScript preprocessing file (`apple/Shared/ShareExtension`; LAB-PLAN F03, F10,
/// F11; F03.5), run in WebKit as Safari runs it: `html` is v1.1's byte for byte and the live page is left as it was;
/// the `lab` object holds the clean copy (no scripts but JSON-LD, no on* attributes, no form contents: F03.2), Clean
/// article (only up to 2 MiB) and the selection. With Lab off the share extension sends `html` (`input(for:)`).
final class GetPageScriptTests: XCTestCase {
    static let script: String = {
        let apple = URL(fileURLWithPath: #filePath) // …/apple/DaylightShareKit/Tests/DaylightShareKitTests/<this file>
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let url = apple.appendingPathComponent("Shared/ShareExtension/GetPage.js")
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }()

    static let paragraph = "The North Sea keeps a clock of its own. Twice a day the water leaves the flats and comes back, "
        + "and the people who live along the coast have learned to read it the way others read a timetable, planning "
        + "walks, harvests and crossings around the hours when the mud is firm and the channels are shallow enough to wade."

    static func article(extra: String = "") -> String {
        let paragraphs = (1...8).map { "<p onclick=\"steal(\($0))\">\(paragraph) (\($0))</p>" }.joined(separator: "\n")
        return """
        <!DOCTYPE html>
        <html lang="en"><head><meta charset="utf-8"><title>Tides of the North Sea</title>
        <script>window.tracked = true;</script>
        <script type="application/ld+json">{"@type":"NewsArticle","headline":"Tides of the North Sea"}</script>
        </head>
        <body onload="void 0">
        <header><nav><a href="/">Home</a> <a href="/news">News</a> <a href="/sport">Sport</a></nav></header>
        <main><article><h1>Tides of the North Sea</h1><p class="byline">By A. Writer</p>
        \(paragraphs)
        <blockquote id="quote">The sea keeps its own clock.</blockquote>
        </article></main>
        <form action="/search"><input name="q" value="secret search"><input type="hidden" name="csrf" value="token123">
        <input type="password" name="pw" value="hunter2"><textarea name="t">draft words</textarea></form>
        \(extra)
        </body></html>
        """
    }

    /// Waits for a page to load.
    final class Loader: NSObject, WKNavigationDelegate {
        var done: CheckedContinuation<Void, Error>?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            done?.resume()
            done = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            done?.resume(throwing: error)
            done = nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            done?.resume(throwing: error)
            done = nil
        }
    }

    @MainActor
    func load(_ html: String, url: String = "https://news.example.com/2026/tides") async throws -> WKWebView {
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768))
        let loader = Loader()
        web.navigationDelegate = loader
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            loader.done = c
            web.loadHTMLString(html, baseURL: URL(string: url))
        }
        web.navigationDelegate = nil
        return web
    }

    @MainActor
    func js(_ web: WKWebView, _ script: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Any?, Error>) in
            web.evaluateJavaScript(script) { result, error in
                if let error { c.resume(throwing: error) } else { c.resume(returning: result) }
            }
        }
    }

    /// v1.1's `html`, as v1.1's GetPage.js made it.
    static let v11HTML = "(document.doctype ? '<!doctype ' + document.doctype.name + '>\\n' : '') + document.documentElement.outerHTML"

    /// Runs GetPage.js as Safari does and returns what it hands the extension.
    @MainActor
    func run(_ web: WKWebView) async throws -> [String: Any] {
        _ = try await js(web, Self.script + "\n;true")
        let out = try await js(web, """
        (function () { var out = null; ExtensionPreprocessingJS.run({ completionFunction: function (r) { out = r; } }); return out; })()
        """)
        return try XCTUnwrap(out as? [String: Any])
    }

    @MainActor
    func testHTMLIsV11sAndTheLabPartsAreClean() async throws {
        XCTAssertFalse(Self.script.isEmpty, "GetPage.js was not found")
        let web = try await load(Self.article())
        let b = try await js(web, Self.v11HTML)
        let before = try XCTUnwrap(b as? String)
        let r = try await run(web)
        let a = try await js(web, Self.v11HTML)
        let after = try XCTUnwrap(a as? String)

        // v1.1's html, byte for byte, and the live page as it was.
        XCTAssertEqual(r["html"] as? String, before)
        XCTAssertEqual(after, before, "GetPage.js changed the live page")
        XCTAssertEqual(r["url"] as? String, "https://news.example.com/2026/tides")
        XCTAssertEqual(r["title"] as? String, "Tides of the North Sea")
        XCTAssertTrue(before.contains("window.tracked"))
        XCTAssertTrue(before.contains("onclick"))

        // F03.2: the clean copy has no scripts but JSON-LD, no on* attributes and no form contents.
        let lab = try XCTUnwrap(r["lab"] as? [String: Any])
        let clean = try XCTUnwrap(lab["cleanHtml"] as? String)
        XCTAssertTrue(clean.hasPrefix("<!doctype html>"), String(clean.prefix(40)))
        XCTAssertFalse(clean.contains("window.tracked"))
        XCTAssertTrue(clean.contains("application/ld+json"))
        for gone in ["onclick", "onload", "secret search", "token123", "hunter2", "draft words"] {
            XCTAssertFalse(clean.contains(gone), "\(gone) is in the clean copy")
        }
        XCTAssertTrue(clean.contains("The North Sea keeps a clock of its own."))

        // F10: Clean article, as the page that is sent.
        let capture = try XCTUnwrap(PageCapture.read(lab))
        XCTAssertGreaterThan(capture.words, 300)
        let article = try XCTUnwrap(capture.article, "Readability found no article")
        XCTAssertTrue(article.html.contains("<meta name=\"dl:capture\" content=\"clean\">"))
        XCTAssertTrue(article.html.contains("The North Sea keeps a clock of its own."))
        XCTAssertFalse(article.html.contains("<script"))
        XCTAssertFalse(article.html.contains("onclick"))
        XCTAssertFalse(article.html.contains("secret search"))
        XCTAssertGreaterThan(article.words, 300)
        XCTAssertFalse(capture.hasSelection)

        // With Lab off the share extension sends `html` as v1.1 did, whatever `lab` holds.
        let page = SharePayload.page(html: before, url: "https://news.example.com/2026/tides", title: "Tides of the North Sea",
                                     lab: capture)
        let input = try ShareExtensionModel.input(for: page)
        XCTAssertEqual(input.kind, .page)
        XCTAssertEqual(input.content, Data(before.utf8))
        XCTAssertTrue(input.extras.isEmpty)
    }

    /// F11: a selection in Safari comes as text and markup (an explicit selection).
    @MainActor
    func testTheSelectionIsCaptured() async throws {
        let web = try await load(Self.article())
        _ = try await js(web, """
        (function () { var r = document.createRange(); r.selectNodeContents(document.getElementById('quote'));
          var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); })()
        """)
        let r = try await run(web)
        let capture = try XCTUnwrap(PageCapture.read(r["lab"]))
        XCTAssertEqual(capture.selectionText, "The sea keeps its own clock.")
        XCTAssertTrue(capture.selectionHTML.contains("The sea keeps its own clock."), capture.selectionHTML)
        XCTAssertTrue(capture.hasSelection)
    }

    /// Over 2 MiB there is no Clean article (F04.2's memory budget); the clean copy is still made up to 8 MiB.
    @MainActor
    func testAPageOverTwoMegabytesHasNoCleanArticle() async throws {
        let filler = String(repeating: "<p>" + Self.paragraph + "</p>\n", count: 2_300_000 / Self.paragraph.utf8.count + 1)
        let web = try await load(Self.article(extra: "<section>\(filler)</section>"))
        let r = try await run(web)
        let html = try XCTUnwrap(r["html"] as? String)
        XCTAssertGreaterThan(html.utf8.count, 2 * 1024 * 1024)
        let capture = try XCTUnwrap(PageCapture.read(r["lab"]))
        XCTAssertNotNil(capture.cleanHTML)
        XCTAssertNil(capture.article)
    }
}
#endif
