import XCTest

/// The accessibility baseline's rules that a UI test can see (LAB-PLAN F27): Comfort is a Settings switch outside Lab,
/// off by default, with its footer; typing the pairing code is always offered.
final class BaselineTests: XCTestCase {
    @MainActor
    func testComfortIsInSettingsAndOffByDefault() throws {
        let app = UITestSupport.launch(paired: true, comfort: nil)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        settings.tap()
        let comfort = app.switches["comfort"]
        XCTAssertTrue(comfort.waitForExistence(timeout: 10), "no Comfort switch in Settings")
        XCTAssertEqual(comfort.label, "Comfort")
        XCTAssertEqual(UITestSupport.text(comfort.value), "0", "Comfort is on by default")
        XCTAssertTrue(app.staticTexts["Larger text and buttons, more contrast, no motion."].exists, "no Comfort footer")
        // The switch itself is at the row's trailing end.
        comfort.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        let on = NSPredicate(format: "value == '1'")
        expectation(for: on, evaluatedWith: comfort)
        waitForExpectations(timeout: 5)
        UITestSupport.screenshot(app, "ios-settings-comfort-switched-on", in: self)
    }

    /// A share card that keeps its own storage (no App Group) has its own Comfort switch, off, labelled, with its
    /// footer (F27: a switch in every build's settings; LAB-PLAN 1.1: such a card counts as its own app).
    @MainActor
    func testTheShareCardHasItsOwnComfortWithoutAnAppGroup() throws {
        let app = UITestSupport.launchShareCard("needs-pairing")
        let comfort = app.switches["comfort"]
        XCTAssertTrue(comfort.waitForExistence(timeout: 30), "no Comfort switch on the share card")
        XCTAssertEqual(comfort.label, "Comfort")
        XCTAssertEqual(UITestSupport.text(comfort.value), "0", "Comfort is on by default")
        XCTAssertTrue(app.staticTexts["Larger text and buttons, more contrast, no motion."].exists, "no Comfort footer")
        for _ in 0..<4 where !comfort.isHittable { app.swipeUp() }
        comfort.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        expectation(for: NSPredicate(format: "value == '1'"), evaluatedWith: comfort)
        waitForExpectations(timeout: 5)
        UITestSupport.screenshot(app, "ios-share-card-comfort-switched-on", in: self)
    }

    /// The pairing screen offers the typed code next to the camera, and a typed code pairs.
    @MainActor
    func testTypedCodePairingIsAlwaysOffered() throws {
        let app = UITestSupport.launch(paired: false)
        let field = app.textFields[UITestSupport.pairingField]
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no pairing code field")
        XCTAssertTrue(app.buttons["Scan the QR code"].exists)
        XCTAssertTrue(app.buttons["Pair"].exists)
        field.tap()
        field.typeText(UITestSupport.pairingCode + "\n")
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20), "typing the code did not pair")
    }
}
