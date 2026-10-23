import Foundation
import XCTest
@testable import DaylightShareKit

/// Excerpts (LAB-PLAN F11; LAB-PROTOCOL 2.9.3) against lab-vectors.json › labExcerpt: the items, the sanitiser, plain text
/// as HTML, text fragments, dates, file names and the 50,000-character limits (F11.3). `classify` is in
/// `NormaliseVectorTests`.
final class ExcerptVectorTests: XCTestCase {
    var section: [String: Any] { LabVectorTests.vectors["labExcerpt"] as! [String: Any] }

    func list(_ key: String) -> [[String: Any]] {
        let l = section[key] as? [[String: Any]] ?? []
        XCTAssertFalse(l.isEmpty, "\(key) is empty")
        return l
    }

    /// The vectors' dates are strings; a number or a Date would be read in the device's time zone.
    let utc = TimeZone(identifier: "UTC")!

    func testEveryPartIsKnown() {
        XCTAssertEqual(Set(section.keys), ["items", "sanitize", "textHtml", "fragments", "dates", "fileNames", "classify", "limits"])
    }

    func testItems() {
        for c in list("items") {
            let name = c["name"] as? String ?? "?"
            let i = c["input"] as! [String: Any]
            let item = Excerpt.item(text: i["text"] as? String ?? "", html: i["html"] as? String ?? "", url: i["url"] as? String ?? "",
                                    pageTitle: i["pageTitle"] as? String ?? "", site: i["site"] as? String ?? "",
                                    app: i["app"] as? String ?? "", date: i["date"], timeZone: utc)
            guard let e = c["expect"] as? [String: Any] else {
                XCTAssertNil(item, "\(name): no item")
                continue
            }
            guard let item else {
                XCTFail("\(name): no item")
                continue
            }
            XCTAssertEqual(e["kind"] as? String, "file", name)
            XCTAssertEqual(item.mime, e["mime"] as? String, "\(name): mime")
            XCTAssertEqual(item.name, e["name"] as? String, "\(name): name")
            XCTAssertEqual(item.url, e["url"] as? String, "\(name): url")
            XCTAssertEqual(item.title, e["title"] as? String, "\(name): title")
            XCTAssertEqual(item.content, e["content"] as? String, "\(name): content")
            XCTAssertEqual(item.extras, e["extras"] as? [String: String], "\(name): extras")
            // What the sender gets: a file with the excerpt's bytes and x-cap.
            let input = item.input
            XCTAssertEqual(input.kind, .file)
            XCTAssertEqual(input.content, Data(item.content.utf8))
            XCTAssertEqual(input.extras, ["x-cap": "excerpt"])
            XCTAssertEqual(input.url, item.url)
        }
    }

    func testSanitize() {
        for c in list("sanitize") {
            let r = Excerpt.sanitize(c["html"] as? String, maxChars: (c["maxChars"] as? NSNumber)?.intValue ?? Excerpt.maxChars)
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(r.html, e["html"] as? String, c["name"] as? String ?? "?")
            XCTAssertEqual(r.trimmed, e["trimmed"] as? Bool, c["name"] as? String ?? "?")
        }
        // Linear on hostile runs (the reference's own patterns were chosen for that).
        let hostile = String(repeating: "<script ", count: 20_000) + String(repeating: "<a", count: 20_000)
        let started = Date()
        _ = Excerpt.sanitize(hostile)
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testTextHTML() {
        for c in list("textHtml") {
            let r = Excerpt.textHTML(c["text"] as? String, maxChars: (c["maxChars"] as? NSNumber)?.intValue ?? Excerpt.maxChars)
            let e = c["expect"] as! [String: Any]
            XCTAssertEqual(r.html, e["html"] as? String, c["name"] as? String ?? "?")
            XCTAssertEqual(r.trimmed, e["trimmed"] as? Bool, c["name"] as? String ?? "?")
        }
    }

    func testFragmentsDatesAndNames() {
        for c in list("fragments") {
            XCTAssertEqual(Excerpt.textFragment(c["url"] as? String, text: c["text"] as? String), c["expect"] as? String,
                           c["name"] as? String ?? "?")
        }
        for c in list("dates") {
            XCTAssertEqual(Excerpt.date(c["date"] is NSNull ? nil : c["date"], timeZone: utc), c["expect"] as? String, "\(c)")
        }
        for c in list("fileNames") {
            XCTAssertEqual(Excerpt.fileName(c["text"] as? String, note: c["note"] as? Bool ?? false), c["expect"] as? String,
                           c["name"] as? String ?? "?")
        }
        // A Date (or ms) is read in the given time zone: 23:30 UTC on 21 October is the 22nd in Tokyo.
        let late = Date(timeIntervalSince1970: 1_792_625_400) // 2026-10-21T23:30:00Z
        XCTAssertEqual(Excerpt.date(late, timeZone: utc), "21 October 2026")
        XCTAssertEqual(Excerpt.date(late, timeZone: TimeZone(identifier: "Asia/Tokyo")!), "22 October 2026")
        XCTAssertEqual(Excerpt.date(NSNumber(value: 1_792_625_400_000.0), timeZone: utc), "21 October 2026")
        XCTAssertEqual(Excerpt.date(true, timeZone: utc), "", "a boolean is not a date")
    }

    /// F11.3: 50,000 characters, then the trimmed note, for the text and HTML forms and the Markdown note.
    func testLimits() throws {
        let l = section["limits"] as! [String: Any]
        let i = l["input"] as! [String: Any]
        var text = String(repeating: i["textRepeat"] as! String, count: (i["times"] as! NSNumber).intValue)
        if i["trim"] as? Bool == true { text = text.trimmingCharacters(in: .whitespaces) }
        let url = i["url"] as? String, page = i["pageTitle"] as? String, date = i["date"], app = i["app"] as? String
        func check(_ content: String?, _ key: String) throws {
            let e = l[key] as! [String: Any]
            let c = try XCTUnwrap(content, key)
            XCTAssertEqual(c.utf16.count, (e["length"] as! NSNumber).intValue, "\(key): length")
            XCTAssertEqual(DLSCrypto.sha256Hex(Data(c.utf8)), e["sha256"] as? String, "\(key): sha256")
            XCTAssertTrue(c.hasSuffix(e["tail"] as! String), "\(key): tail")
        }
        try check(Excerpt.item(text: text, url: url, pageTitle: page, date: date, timeZone: utc)?.content, "textItem")
        try check(Excerpt.item(text: text, html: "<p>" + text + "</p>", url: url, pageTitle: page, date: date, timeZone: utc)?.content,
                  "htmlItem")
        try check(Excerpt.markdown(text: text, app: app, date: date, timeZone: utc), "note")
    }
}
