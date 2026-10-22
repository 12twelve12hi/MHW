import XCTest

/// LAB-PLAN F00.2 and 1.7: with Lab off, each main screen's accessibility tree (element types, labels and values, in
/// order) equals the baseline recorded from the last non-Lab build, the P0 close-out (v1.1 and the F27 baseline with
/// Comfort). Baselines: `lab-off-baseline/<screen>.json` next to this file, re-recorded only with a matching non-Lab
/// change. Without one the test prints the tree between `=====BEGIN lab-off-baseline …=====` markers and fails.
///
/// The walks cover the main window (and its sheets), the Share menu's card and the menu bar item's menu; not the
/// app's main menu, whose system items change with macOS. The Lab switch row (`AXTree.labSwitchID`) is the one thing
/// Lab off adds, in Settings and in the Share menu card's own settings (ad-hoc builds, LAB-PLAN 1.1): it is left out of
/// the compared tree and checked to hold only the switch, off. The menu bar item gets no Lab row.
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
        try UITestSupport.checkBaseline(window, screen: "settings", labSwitch: true)
    }

    @MainActor
    func testThePairingScreenMatchesTheLabOffBaseline() throws {
        let app = UITestSupport.launch(paired: false)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(app, "mac-lab-off-pair", in: self)
        try UITestSupport.checkBaseline(window, screen: "pair")
    }

    /// The Share menu's card (`ShareExtensionView`, 360 pt wide as in the Share menu) in each of its states
    /// (`-DLSShareCard`, Debug builds): with Lab off it is exactly v1.1's (the F00 table), and W1 changes it the most.
    @MainActor
    func testTheShareMenuCardMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        for card in UITestSupport.shareCards {
            let app = UITestSupport.launchShareCard(card)
            let window = app.windows.firstMatch
            XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
            XCTAssertTrue(window.staticTexts.firstMatch.waitForExistence(timeout: 30), "the \(card) card did not show")
            UITestSupport.screenshot(app, "mac-lab-off-share-\(card)", in: self)
            try UITestSupport.checkBaseline(window, screen: "share-\(card)", labSwitch: true)
            app.terminate()
        }
    }

    /// The menu bar item's menu, paired (F00: the menu bar item gets no Lab row).
    @MainActor
    func testTheMenuBarMenuMatchesTheLabOffBaseline() throws {
        let app = UITestSupport.launch(paired: true)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        XCTAssertTrue(window.buttons["Settings"].waitForExistence(timeout: 30), "the main window did not show")
        let item = app.descendants(matching: .statusItem).firstMatch
        guard item.waitForExistence(timeout: 10) else {
            XCTFail("no menu bar item; the app's menu bars: \(app.menuBars.debugDescription.prefix(2000))")
            return
        }
        item.click()
        // The menu is the item's child in the accessibility tree; if this macOS puts it elsewhere, it is the menu
        // with "Open Send to Daylight" (only this menu has it).
        let open = NSPredicate(format: "title == %@ OR label == %@", "Open Send to Daylight", "Open Send to Daylight")
        var root = item
        if !item.descendants(matching: .menuItem).matching(open).firstMatch.waitForExistence(timeout: 5) {
            root = app.menus.containing(open).firstMatch
            print("the menu bar item's menu is not inside the item; walking the menu that holds Open Send to Daylight")
        }
        XCTAssertTrue(root.descendants(matching: .menuItem).matching(open).firstMatch.waitForExistence(timeout: 10),
                      "the menu bar item's menu did not open: \(app.menuBars.debugDescription.prefix(3000))")
        UITestSupport.screenshot(app, "mac-lab-off-menu-bar", in: self)
        try UITestSupport.checkBaseline(root, screen: "menu-bar")
        app.typeKey(XCUIKeyboardKey.escape, modifierFlags: [])
    }
}
