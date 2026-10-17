#if os(macOS)
import Foundation
import XCTest

/// The share extensions' NSExtensionActivationRule (in iOS/ and macOS/ ShareExtension/Info.plist): it must parse,
/// and match web pages, links and documents but not, say, photos.
final class ActivationRuleTests: XCTestCase {
    static let apple = URL(fileURLWithPath: #filePath) // …/apple/DaylightShareKit/Tests/DaylightShareKitTests/<file>
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    func rule(_ platform: String) throws -> String {
        let url = Self.apple.appendingPathComponent("\(platform)/ShareExtension/Info.plist")
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        let ext = try XCTUnwrap(plist["NSExtension"] as? [String: Any])
        XCTAssertEqual(ext["NSExtensionPointIdentifier"] as? String, "com.apple.share-services")
        XCTAssertEqual(ext["NSExtensionPrincipalClass"] as? String, "$(PRODUCT_MODULE_NAME).ShareViewController")
        let attrs = try XCTUnwrap(ext["NSExtensionAttributes"] as? [String: Any])
        XCTAssertEqual(attrs["NSExtensionJavaScriptPreprocessingFile"] as? String, "GetPage")
        return try XCTUnwrap(attrs["NSExtensionActivationRule"] as? String)
    }

    func share(_ types: [[String]]) -> [String: Any] {
        ["extensionItems": [["attachments": types.map { ["registeredTypeIdentifiers": $0] }]]]
    }

    func testTheRuleMatchesPagesLinksAndDocuments() throws {
        let ios = try rule("iOS")
        XCTAssertEqual(ios, try rule("macOS"))
        let predicate = NSPredicate(format: ios)
        let yes: [[[String]]] = [
            [["public.url"]],                                     // a link
            [["com.apple.property-list"]],                        // Safari with GetPage.js
            [["public.url", "public.plain-text"]],                // Safari without it
            [["com.adobe.pdf"]],
            [["org.idpf.epub-container"]],
            [["org.openxmlformats.wordprocessingml.document"]],
            [["net.daringfireball.markdown"]],
            [["public.html"]],
            [["public.plain-text"]],
            [["public.file-url", "com.adobe.pdf"]],              // Finder
            [["public.jpeg"], ["com.adobe.pdf"]],                 // a photo and a PDF
        ]
        for types in yes { XCTAssertTrue(predicate.evaluate(with: share(types)), "\(types)") }
        let no: [[[String]]] = [[["public.jpeg"]], [["public.movie"]], [["public.zip-archive"]], []]
        for types in no { XCTAssertFalse(predicate.evaluate(with: share(types)), "\(types)") }
    }
}
#endif
