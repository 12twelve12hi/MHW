import XCTest

/// LAB-PLAN F00.2 and 1.7: with Lab off, each main screen's accessibility tree (element types, labels and values, in
/// order) equals the baseline recorded from the last non-Lab build, the P0 close-out (v1.1 and the F27 baseline with
/// Comfort). Baselines: `lab-off-baseline/<screen>.json` next to this file, re-recorded only with a matching non-Lab
/// change. Without one the test prints the tree between `=====BEGIN lab-off-baseline …=====` markers and fails.
///
/// The walks cover the main window (and its sheets), the Share menu's card and the menu bar item's menu; not the
/// app's main menu, whose system items change with macOS. The main window and the menu bar item's menu are walked with
/// the sample history (`-DLSSampleHistory`: a row in every state, the rows W1's timeline changes; `main`, `menu-bar`)
/// and empty (`main-empty`, `menu-bar-empty`). The History list (an outline) keeps every row in the tree whatever it
/// shows, so one walk of the window holds all six (on the iPhone, whose list holds only the rows on screen, Home is
/// walked at the top of its history and at its end). Each row's age, which counts on by itself, is written "<when>".
///
/// The Lab switch row (`AXTree.labSwitchID`) is the one thing Lab off adds, in Settings and in the Share menu card's
/// own settings (ad-hoc builds, LAB-PLAN 1.1; of the card's samples only `needs-pairing` shows them): it is left out
/// of the compared tree and checked to hold only the switch, off. The menu bar item gets no Lab row.
final class LabOffParityTests: XCTestCase {
    @MainActor
    func testTheMainWindowWithARowInEveryStateMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true, history: true)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        XCTAssertTrue(window.buttons["Settings"].waitForExistence(timeout: 30), "the main window did not show")
        XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show")
        XCTAssertTrue(UITestSupport.staticText(UITestSupport.historyLast, in: window).exists,
                      "the History list does not hold its last row (the walk would miss rows: walk it at its end too)")
        UITestSupport.screenshot(app, "mac-lab-off-main", in: self)
        try UITestSupport.checkBaseline(window, screen: "main")
    }

    @MainActor
    func testTheEmptyMainWindowAndSettingsMatchTheLabOffBaseline() throws {
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        let settings = window.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "the main window did not show")
        UITestSupport.screenshot(app, "mac-lab-off-main-empty", in: self)
        try UITestSupport.checkBaseline(window, screen: "main-empty")

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
    /// A Lab switch may show only on the card with its own settings (`needs-pairing`).
    @MainActor
    func testTheShareMenuCardMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        for card in UITestSupport.shareCards {
            let app = UITestSupport.launchShareCard(card)
            let window = app.windows.firstMatch
            XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
            XCTAssertTrue(window.staticTexts.firstMatch.waitForExistence(timeout: 30), "the \(card) card did not show")
            UITestSupport.screenshot(app, "mac-lab-off-share-\(card)", in: self)
            try UITestSupport.checkBaseline(window, screen: "share-\(card)",
                                            labSwitch: card == UITestSupport.cardWithItsOwnSettings)
            app.terminate()
        }
    }

    /// The menu bar item's menu, paired, with the sample history (its six rows) and empty (F00: the menu bar item gets
    /// no Lab row).
    @MainActor
    func testTheMenuBarMenuMatchesTheLabOffBaseline() throws {
        continueAfterFailure = true
        try walkTheMenuBarMenu(history: true, screen: "menu-bar")
        try walkTheMenuBarMenu(history: false, screen: "menu-bar-empty")
    }

    @MainActor
    func walkTheMenuBarMenu(history: Bool, screen: String) throws {
        let app = UITestSupport.launch(paired: true, history: history)
        defer { app.terminate() }
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        XCTAssertTrue(window.buttons["Settings"].waitForExistence(timeout: 30), "the main window did not show")
        if history { XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show") }
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
        UITestSupport.screenshot(app, "mac-lab-off-\(screen)", in: self)
        try UITestSupport.checkBaseline(root, screen: screen)
        app.typeKey(XCUIKeyboardKey.escape, modifierFlags: [])
    }
}
