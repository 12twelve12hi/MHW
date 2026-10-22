@testable import SendToDaylight
import XCTest

/// LAB-PLAN F27.4: with Comfort on, at the narrowest width (an iPad's one-third split, 320 pt) and text at
/// accessibility3, no text on the iPhone app's main screens is truncated or clipped (`AuditScreens`, which hosts each
/// screen in the app). Screenshots go to $DLS_SHOTS when it is set (CI uploads them).
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

    @MainActor
    func testNoTextIsCutWithComfortAtTheNarrowestWidth() async throws {
        let reports = await AuditScreens.reports(shots: Self.shots)
        XCTAssertEqual(reports.map(\.screen), ["home", "settings", "pair"])
        for report in reports {
            print("TruncationAudit iOS \(report.screen): \(report.measured) texts measured, \(report.problems.count) cut")
            XCTAssertGreaterThanOrEqual(report.measured, 5, "\(report.screen): too few texts reported their size")
            for problem in report.problems {
                XCTFail("\(report.screen): \(problem)")
            }
        }
    }
}
