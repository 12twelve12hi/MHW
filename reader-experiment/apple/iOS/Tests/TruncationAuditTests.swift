@testable import SendToDaylight
import XCTest

/// LAB-PLAN F27.4: with Comfort on, at the narrowest width (an iPad's one-third split, 320 pt) and text at
/// accessibility3, no text on the iPhone app's main screens (Settings with its Lab section), its Lab screens (What's in
/// Lab, the Daylight server section, the needs-setup notes) or on the share sheet's card (each of its states) is
/// truncated or clipped (`AuditScreens`, which hosts each screen in the app). Screenshots go to $DLS_SHOTS when it is
/// set (CI uploads them).
final class TruncationAuditTests: XCTestCase {
    static var shots: URL? {
        guard let dir = ProcessInfo.processInfo.environment["DLS_SHOTS"], !dir.isEmpty else { return nil }
        return URL(fileURLWithPath: dir, isDirectory: true)
    }

    /// The audit catches a cut text, and passes the same text left to wrap.
    @MainActor
    func testTheAuditSeesACutText() async throws {
        let check = await AuditScreens.selfCheck()
        XCTAssertEqual(check.cut.measured, 1)
        XCTAssertEqual(check.cut.problems.count, 1, "a text squeezed into 30 pt was not reported")
        XCTAssertEqual(check.wrapped.measured, 1)
        XCTAssertEqual(check.wrapped.problems, [])
    }

    /// Dynamic Type (F27.2's audit, checked here independently): every text on the main screens and the share card
    /// grows with the text size, Home's empty history included. The accessibility audit says the opposite about the
    /// few texts it loses at the largest size (they scroll off), and AccessibilityAuditTests allows those reports only
    /// for the texts `DynamicTypeWaivers` names, each of which must be measured growing here.
    @MainActor
    func testEveryTextGrowsWithTheTextSize() async throws {
        let screens = await AuditScreens.scaling()
        XCTAssertEqual(screens.map(\.screen), ["home", "home-empty", "settings", "pair"] + AuditScreens.labScreenNames
                       + AuditScreens.shareCardNames)
        var grown = Set<String>()
        for screen in screens {
            print("Dynamic Type iOS \(screen.screen): \(screen.measured.count) texts compared, \(screen.problems.count) did not grow")
            XCTAssertGreaterThanOrEqual(screen.measured.count, screen.screen.hasPrefix("share-") ? 2 : 5,
                                        "\(screen.screen): too few texts compared")
            for problem in screen.problems {
                XCTFail("\(screen.screen): \(problem)")
            }
            grown.formUnion(screen.grown)
        }
        for (screen, texts) in DynamicTypeWaivers.texts {
            for text in texts {
                XCTAssertTrue(grown.contains(text), "the audit's allowance for “\(text)” (\(screen)) is not measured growing here")
            }
        }
    }

    @MainActor
    func testNoTextIsCutWithComfortAtTheNarrowestWidth() async throws {
        let reports = await AuditScreens.reports(shots: Self.shots)
        XCTAssertEqual(reports.map(\.screen), ["home", "settings", "pair"] + AuditScreens.labScreenNames
                       + AuditScreens.shareCardNames)
        for report in reports {
            print("TruncationAudit iOS \(report.screen): \(report.measured) texts measured, \(report.problems.count) cut")
            XCTAssertGreaterThanOrEqual(report.measured, report.screen.hasPrefix("share-") ? 2 : 5,
                                        "\(report.screen): too few texts reported their size")
            for problem in report.problems {
                XCTFail("\(report.screen): \(problem)")
            }
        }
    }
}
