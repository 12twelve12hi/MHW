import XCTest

/// LAB-PLAN F00.2 and 1.7: with Lab off, each main screen's accessibility tree (element types, labels and values, in
/// order) equals the baseline recorded from the last non-Lab build, the P0 close-out (v1.1 and the F27 baseline with
/// Comfort). Baselines: `lab-off-baseline/<screen>.json` next to this file, re-recorded only with a matching non-Lab
/// change. Without one the test prints the tree between `=====BEGIN lab-off-baseline …=====` markers and fails.
final class LabOffParityTests: XCTestCase {
    @MainActor
    func testHomeAndSettingsMatchTheLabOffBaseline() throws {
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        UITestSupport.screenshot(app, "ios-lab-off-home", in: self)
        try UITestSupport.checkBaseline(app, screen: "home")

        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "ios-lab-off-settings", in: self)
        try UITestSupport.checkBaseline(app, screen: "settings")
    }

    @MainActor
    func testThePairingScreenMatchesTheLabOffBaseline() throws {
        let app = UITestSupport.launch(paired: false)
        XCTAssertTrue(app.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(app, "ios-lab-off-pair", in: self)
        try UITestSupport.checkBaseline(app, screen: "pair")
    }
}
