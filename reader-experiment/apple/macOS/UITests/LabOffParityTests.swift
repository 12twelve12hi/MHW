import XCTest

/// LAB-PLAN F00.2 and 1.7: with Lab off, each main screen's accessibility tree (element types, labels and values, in
/// order) equals the baseline recorded from the last non-Lab build, the P0 close-out (v1.1 and the F27 baseline with
/// Comfort). Baselines: `lab-off-baseline/<screen>.json` next to this file, re-recorded only with a matching non-Lab
/// change. Without one the test prints the tree between `=====BEGIN lab-off-baseline …=====` markers and fails. The
/// walk covers the main window (and its sheets), not the menu bar, whose system items change with macOS.
final class LabOffParityTests: XCTestCase {
    @MainActor
    func testTheMainWindowAndSettingsMatchTheLabOffBaseline() throws {
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        let settings = window.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "the main window did not show")
        UITestSupport.screenshot(app, "mac-lab-off-main", in: self)
        try UITestSupport.checkBaseline(window, screen: "main")

        settings.click()
        XCTAssertTrue(window.sheets.firstMatch.waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "mac-lab-off-settings", in: self)
        try UITestSupport.checkBaseline(window, screen: "settings")
    }

    @MainActor
    func testThePairingScreenMatchesTheLabOffBaseline() throws {
        let app = UITestSupport.launch(paired: false)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(app, "mac-lab-off-pair", in: self)
        try UITestSupport.checkBaseline(window, screen: "pair")
    }
}
