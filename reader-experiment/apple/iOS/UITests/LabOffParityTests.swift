import XCTest

/// LAB-PLAN F00.2 and 1.7: with Lab off, each main screen's accessibility tree (element types, labels and values, in
/// order) equals the baseline recorded from the last non-Lab build, the P0 close-out (v1.1 and the F27 baseline with
/// Comfort). Baselines: `lab-off-baseline/<screen>.json` next to this file, re-recorded only with a matching non-Lab
/// change. Without one the test prints the tree between `=====BEGIN lab-off-baseline …=====` markers and fails.
///
/// Home is walked with the sample history (`-DLSSampleHistory`: a row in every state, the rows W1's timeline changes) in
/// three parts that each show whole at the top of the screen (`home-rows-1-2`, `-3-4`, `-5-6`; the list holds only
/// the rows on screen, and the parts need no scrolling), and empty (`home-empty`). Each row's time, which depends on
/// when the test runs, is written "<when>".
///
/// The Lab switch row (`AXTree.labSwitchID`) is the one thing Lab off adds, and on the iPhone only in Settings: it is
/// left out of the compared tree and checked to hold only the switch, off (LAB-PLAN 1.1). The share sheet follows the
/// app's switch and has none of its own, so its cards may show no Lab switch at all.
final class LabOffParityTests: XCTestCase {
    @MainActor
    func testHomeWithARowInEveryStateMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        for rows in UITestSupport.historyParts {
            let name = "home-rows-" + rows.map(String.init).joined(separator: "-")
            let app = UITestSupport.launch(paired: true, history: true, rows: rows)
            XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
            XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show")
            UITestSupport.screenshot(app, "ios-lab-off-\(name)", in: self)
            try UITestSupport.checkBaseline(app, screen: name)
            app.terminate()
        }
    }

    @MainActor
    func testTheEmptyHomeAndSettingsMatchTheLabOffBaseline() throws {
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        UITestSupport.screenshot(app, "ios-lab-off-home-empty", in: self)
        try UITestSupport.checkBaseline(app, screen: "home-empty")

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
    /// off it is exactly v1.1's (the F00 table), and W1 changes it the most. No card may show a Lab switch.
    @MainActor
    func testTheShareCardMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        for card in UITestSupport.shareCards {
            let app = UITestSupport.launchShareCard(card)
            XCTAssertTrue(app.staticTexts.firstMatch.waitForExistence(timeout: 30), "the \(card) card did not show")
            UITestSupport.screenshot(app, "ios-lab-off-share-\(card)", in: self)
            try UITestSupport.checkBaseline(app, screen: "share-\(card)", labSwitch: false)
            app.terminate()
        }
    }
}
