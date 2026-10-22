import XCTest

/// LAB-PLAN F00.2 and 1.7: with Lab off, each main screen's accessibility tree (element types, labels and values, in
/// order) equals the baseline recorded from the last non-Lab build, the P0 close-out (v1.1 and the F27 baseline with
/// Comfort). Baselines: `lab-off-baseline/<screen>.json` next to this file, re-recorded only with a matching non-Lab
/// change. Without one the test prints the tree between `=====BEGIN lab-off-baseline …=====` markers and fails.
///
/// The Lab switch row (`AXTree.labSwitchID`) is the one thing Lab off adds, in Settings and in the share card's own
/// settings: it is left out of the compared tree and checked to hold only the switch, off (LAB-PLAN 1.1).
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
        XCTAssertTrue(app.switches["comfort"].waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "ios-lab-off-settings", in: self)
        try UITestSupport.checkBaseline(app, screen: "settings", labSwitch: true)
    }

    @MainActor
    func testThePairingScreenMatchesTheLabOffBaseline() throws {
        let app = UITestSupport.launch(paired: false)
        XCTAssertTrue(app.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(app, "ios-lab-off-pair", in: self)
        try UITestSupport.checkBaseline(app, screen: "pair")
    }

    /// The share sheet's card (`ShareExtensionView`) in each of its states (`-DLSShareCard`, Debug builds): with Lab
    /// off it is exactly v1.1's (the F00 table), and W1 changes it the most.
    @MainActor
    func testTheShareCardMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        for card in UITestSupport.shareCards {
            let app = UITestSupport.launchShareCard(card)
            XCTAssertTrue(app.staticTexts.firstMatch.waitForExistence(timeout: 30), "the \(card) card did not show")
            UITestSupport.screenshot(app, "ios-lab-off-share-\(card)", in: self)
            try UITestSupport.checkBaseline(app, screen: "share-\(card)", labSwitch: true)
            app.terminate()
        }
    }
}
