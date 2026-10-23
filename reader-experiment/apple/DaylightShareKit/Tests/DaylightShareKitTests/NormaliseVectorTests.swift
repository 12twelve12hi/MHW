import Foundation
import XCTest
@testable import DaylightShareKit

/// Smart intake (LAB-PLAN F16, F11's link-or-excerpt rule; LAB-PROTOCOL 2.9.1, 2.9.2) against the JavaScript reference's
/// vectors: share/vectors/normalise.json (`cases`, `xOrigFrames`, `appleNews`) and lab-vectors.json › labExcerpt ›
/// classify. F16.1: every case passes, the real "headline + link" shares among them, which stay links with the
/// headline as the title.
final class NormaliseVectorTests: XCTestCase {
    static let vectors = LabVectorTests.load("share/vectors/normalise.json")

    func list(_ key: String) -> [[String: Any]] {
        let l = Self.vectors[key] as? [[String: Any]] ?? []
        XCTAssertFalse(l.isEmpty, "\(key) is empty")
        return l
    }

    func testEverySectionIsKnown() {
        XCTAssertEqual(Set(Self.vectors.keys), ["protocol", "generatedBy", "notes", "cases", "xOrigFrames", "appleNews"])
    }

    func testNormaliseShare() {
        let cases = list("cases")
        XCTAssertGreaterThanOrEqual(cases.count, 50, "F16.1 asks for at least 50")
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let i = c["input"] as! [String: Any]
            let e = c["expect"] as! [String: Any]
            let r = ShareNormaliser.normalise(text: i["text"] as? String ?? "", url: i["url"] as? String ?? "",
                                              subject: i["subject"] as? String ?? "", source: i["source"] as? String ?? "",
                                              clean: (i["clean"] as? Bool) != false)
            XCTAssertEqual(r.kind.rawValue, e["kind"] as? String, name)
            XCTAssertEqual(r.url, e["url"] as? String, "\(name): url")
            XCTAssertEqual(r.title, e["title"] as? String, "\(name): title")
            XCTAssertEqual(r.excerpt, e["excerpt"] as? String, "\(name): excerpt")
            XCTAssertEqual(r.orig, e["orig"] as? String, "\(name): orig")
            XCTAssertEqual(r.extras, (e["orig"] as? String).map { ["x-orig": $0] } ?? [:], name)
        }
    }

    /// F16.3: a URL whose only change is removed tracking parameters is otherwise byte for byte the same.
    func testOnlyTrackingIsRemoved() {
        XCTAssertEqual(ShareNormaliser.cleanShareURL("https://Example.com/A/B?x=1&utm_source=n&Y=%41#Frag"),
                       "https://Example.com/A/B?x=1&Y=%41#Frag")
        XCTAssertEqual(ShareNormaliser.cleanShareURL("https://example.com/a?utm_medium=x"), "https://example.com/a")
        XCTAssertEqual(ShareNormaliser.cleanShareURL("https://example.com/a?b=1&&c=2"), "https://example.com/a?b=1&&c=2",
                       "nothing to remove: unchanged")
        XCTAssertNil(ShareNormaliser.cleanShareURL("javascript:alert(1)"))
    }

    /// The x-orig rules of 2.9.2, built with this kit's item builder: part 0 carries exactly `expect.fields`, and is a
    /// small frame when `expect.small`.
    func testXOrigFrames() throws {
        let pairing = try Pairing(secret: Data(repeating: 1, count: 16))
        for c in list("xOrigFrames") {
            let name = c["name"] as? String ?? "?"
            let item = c["item"] as! [String: Any]
            let kind = try XCTUnwrap(ItemKind(rawValue: item["kind"] as? String ?? ""), name)
            var content: Data?
            if let hex = item["contentHex"] as? String { content = Hex.decode(hex) }
            if let text = item["contentText"] as? String { content = Data(text.utf8) }
            let input = ItemInput(kind: kind, id: "0123456789abcdef0123456789abcdef", url: item["url"] as? String,
                                  title: item["title"] as? String, name: item["name"] as? String, mime: item["mime"] as? String,
                                  content: content, sent: "2026-10-20T08:00:00.000Z",
                                  extras: c["extras"] as? [String: String] ?? [:])
            let prepared = try ItemBuilder.prepare(input, compress: false)
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(prepared.header.extras, e["fields"] as? [String: String], name)
            let frame = try prepared.frame(part: 0, keys: pairing.keys)
            let opened = try Frame.open(keys: pairing.keys, purpose: .inbox, frame: frame)
            let xFields = opened.header.filter { $0.key.hasPrefix("x-") }.mapValues { $0 as? String ?? "?" }
            XCTAssertEqual(xFields, e["fields"] as? [String: String], "\(name): on the wire")
            if e["small"] as? Bool == true { XCTAssertTrue(Frame.isSmall(frame.count), "\(name): small") }
            XCTAssertEqual(Frame.isSmall(frame.count), prepared.isSmallPart(0), "\(name): the length it was measured at")
        }
        // Without extras the frames are exactly v1.1's: no x- field at all.
        let plain = try ItemBuilder.prepare(.link("https://example.com/a"))
        XCTAssertEqual(plain.header.extras, [:])
        XCTAssertFalse(plain.header.json.serialized.contains("x-"))
    }

    func testAppleNewsTarget() {
        for c in list("appleNews") {
            XCTAssertEqual(ShareNormaliser.extractAppleNewsTarget(c["html"] as? String), c["expect"] as? String,
                           c["name"] as? String ?? "?")
        }
        XCTAssertTrue(ShareNormaliser.isAppleNewsURL("https://apple.news/AJk2abc"))
        XCTAssertTrue(ShareNormaliser.isAppleNewsURL("https://www.apple.news/AJk2abc"))
        XCTAssertFalse(ShareNormaliser.isAppleNewsURL("https://notapple.news/AJk2abc"))
        XCTAssertFalse(ShareNormaliser.isAppleNewsURL("Apple News"))
    }

    func testClassifyShare() {
        let cases = (LabVectorTests.vectors["labExcerpt"] as! [String: Any])["classify"] as! [[String: Any]]
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let i = c["input"] as! [String: Any]
            let e = c["expect"] as! [String: Any]
            let r = ShareNormaliser.classify(text: i["text"] as? String ?? "", url: i["url"] as? String ?? "",
                                             title: i["title"] as? String ?? "", source: i["source"] as? String ?? "")
            XCTAssertEqual(r.kind.rawValue, e["kind"] as? String, name)
            XCTAssertEqual(r.url, e["url"] as? String, "\(name): url")
            XCTAssertEqual(r.text, e["text"] as? String, "\(name): text")
        }
    }

    /// F16 step 5: an Apple News link is fetched once (ephemeral, 3 s) and replaced by the article it points to, cleaned;
    /// the apple.news link goes as x-orig. A failed fetch, or F16's Use switch off, keeps the apple.news link.
    func testAppleNewsIsFetchedOnce() async {
        let page = #"<html><head><script>redirectToUrlAfterTimeout("https:\/\/www.example.com\/story?utm_source=news", 0);</script></head></html>"#
        let fetched = Counter()
        let fetch: ShareNormaliser.PageFetch = { url in
            await fetched.add(url.absoluteString)
            return page
        }
        let r = await ShareNormaliser.normaliseFetchingAppleNews(text: "A headline https://apple.news/AJk2abc", fetch: fetch)
        XCTAssertEqual(r.kind, .link)
        XCTAssertEqual(r.url, "https://www.example.com/story")
        XCTAssertEqual(r.title, "A headline")
        XCTAssertEqual(r.orig, "https://apple.news/AJk2abc")
        let asked = await fetched.values
        XCTAssertEqual(asked, ["https://apple.news/AJk2abc"])

        let failed = await ShareNormaliser.normaliseFetchingAppleNews(text: "A headline https://apple.news/AJk2abc") { _ in nil }
        XCTAssertEqual(failed.url, "https://apple.news/AJk2abc")
        XCTAssertNil(failed.orig)

        let off = await ShareNormaliser.normaliseFetchingAppleNews(text: "https://apple.news/AJk2abc", clean: false, fetch: fetch)
        XCTAssertEqual(off.url, "https://apple.news/AJk2abc")
        let after = await fetched.values
        XCTAssertEqual(after.count, 1, "F16's Use switch off never fetches")

        let other = await ShareNormaliser.normaliseFetchingAppleNews(text: "https://example.org/x?fbclid=1", fetch: fetch)
        XCTAssertEqual(other.url, "https://example.org/x")
        let still = await fetched.values
        XCTAssertEqual(still.count, 1, "only Apple News links are fetched")
    }
}

/// Collects values from @Sendable closures in tests.
actor Counter {
    private(set) var values: [String] = []
    func add(_ v: String) { values.append(v) }
}
