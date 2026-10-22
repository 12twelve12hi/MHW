import XCTest

/// The accessibility baseline's rules that a UI test can see (LAB-PLAN F27): Comfort is a Settings switch outside Lab,
/// off by default, with its footer; typing (or pasting) the pairing code is how the Mac pairs.
final class BaselineTests: XCTestCase {
    @MainActor
    func testComfortIsInSettingsAndOffByDefault() throws {
        let app = UITestSupport.launch(paired: true, comfort: nil)
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        let settings = window.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "the main window did not show")
        settings.click()
        let sheet = window.sheets.firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 10), "Settings did not open")
        let comfort = sheet.descendants(matching: .any).matching(identifier: "comfort").firstMatch
        XCTAssertTrue(comfort.waitForExistence(timeout: 10), "no Comfort switch in Settings")
        XCTAssertEqual(comfort.elementType, .switch)
        XCTAssertEqual(comfort.label, "Comfort", "the switch has no name of its own")
        XCTAssertEqual(UITestSupport.text(comfort.value), "0", "Comfort is on by default")
        XCTAssertTrue(sheet.staticTexts["Larger text and buttons, more contrast, no motion."].exists, "no Comfort footer")
        comfort.click()
        let on = NSPredicate(format: "value == 1 OR value == '1'")
        expectation(for: on, evaluatedWith: comfort)
        waitForExpectations(timeout: 5)
        UITestSupport.screenshot(app, "mac-settings-comfort-switched-on", in: self)
    }

    /// The Share menu's card keeps its own storage in the ad-hoc build (no App Group), so it has its own Comfort switch,
    /// off, labelled, with its footer (F27: a switch in every build's settings; LAB-PLAN 1.1: such a card counts as its
    /// own app).
    @MainActor
    func testTheShareMenuCardHasItsOwnComfortWithoutAnAppGroup() throws {
        let app = UITestSupport.launchShareCard("needs-pairing")
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
        let comfort = window.descendants(matching: .any).matching(identifier: "comfort").firstMatch
        XCTAssertTrue(comfort.waitForExistence(timeout: 30), "no Comfort switch on the Share menu card")
        XCTAssertEqual(comfort.elementType, .switch)
        XCTAssertEqual(comfort.label, "Comfort")
        XCTAssertEqual(UITestSupport.text(comfort.value), "0", "Comfort is on by default")
        XCTAssertTrue(window.staticTexts.matching(NSPredicate(format: "value == %@ OR label == %@", "Larger text and buttons, more contrast, no motion.", "Larger text and buttons, more contrast, no motion.")).firstMatch.exists, "no Comfort footer")
        comfort.click()
        expectation(for: NSPredicate(format: "value == 1 OR value == '1'"), evaluatedWith: comfort)
        waitForExpectations(timeout: 5)
        UITestSupport.screenshot(app, "mac-share-card-comfort-switched-on", in: self)
    }

    /// The pairing screen offers the typed code, and a typed code pairs.
    @MainActor
    func testTypedCodePairingIsAlwaysOffered() throws {
        let app = UITestSupport.launch(paired: false)
        let window = app.windows.firstMatch
        let field = window.textFields[UITestSupport.pairingField]
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no pairing code field")
        XCTAssertTrue(window.buttons["Pair"].exists)
        field.click()
        field.typeText(UITestSupport.pairingCode + "\r")
        XCTAssertTrue(window.buttons["Settings"].waitForExistence(timeout: 20), "typing the code did not pair")
    }
}
