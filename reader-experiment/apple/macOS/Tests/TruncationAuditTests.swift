@testable import SendToDaylightMac
import XCTest

/// LAB-PLAN F27.4: with Comfort on, at the narrowest width (the window's minimum; the Settings sheet's width; the
/// Share menu card's 360 pt) and accessibility3, no text on the Mac app's main screens or on the Share menu's card
/// (each of its states) is truncated or clipped (`AuditScreens`, which hosts each
/// screen in the app). Screenshots go to $DLS_SHOTS when the (sandboxed) app may write there, else to its own
/// temporary folder; the log says where.
final class TruncationAuditTests: XCTestCase {
    static var shots: URL {
        let fm = FileManager.default
        if let dir = ProcessInfo.processInfo.environment["DLS_SHOTS"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir, isDirectory: true)
            let probe = url.appendingPathComponent(".probe-\(UUID().uuidString)")
            if (try? fm.createDirectory(at: url, withIntermediateDirectories: true)) != nil,
               (try? Data().write(to: probe)) != nil {
                try? fm.removeItem(at: probe)
                return url
            }
        }
        return fm.temporaryDirectory.appendingPathComponent("dls-shots", isDirectory: true)
    }

    /// The audit catches a cut text, and passes the same text left to wrap.
    @MainActor
    func testTheAuditSeesACutText() async throws {
        let check = await AuditScreens.selfCheck()
        XCTAssertEqual(check.cut.measured, 1)
        XCTAssertEqual(check.cut.problems.count, 1, "a text squeezed into 20 pt was not reported")
        XCTAssertEqual(check.wrapped.measured, 1)
        XCTAssertEqual(check.wrapped.problems, [])
    }

    @MainActor
    func testNoTextIsCutWithComfortAtTheNarrowestWidth() async throws {
        let shots = Self.shots
        print("TruncationAudit macOS screenshots: \(shots.path)")
        let reports = await AuditScreens.reports(shots: shots)
        XCTAssertEqual(reports.map(\.screen), ["main", "settings", "pair"] + AuditScreens.shareCardNames)
        for report in reports {
            print("TruncationAudit macOS \(report.screen): \(report.measured) texts measured, \(report.problems.count) cut")
            XCTAssertGreaterThanOrEqual(report.measured, report.screen.hasPrefix("share-") ? 2 : 5,
                                        "\(report.screen): too few texts reported their size")
            for problem in report.problems {
                XCTFail("\(report.screen): \(problem)")
            }
        }
    }
}
