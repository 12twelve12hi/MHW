import XCTest

/// LAB-PLAN F27.2: Xcode's accessibility audit passes on the iPhone app's Home, Settings and pairing screens (iOS 17
/// and later), at the default text size and with Comfort at the largest text size.
final class AccessibilityAuditTests: XCTestCase {
    /// Issues the app cannot fix because the system draws the element; each names why. Everything else fails.
    @available(iOS 17.0, *)
    static func allowed(_ issue: XCUIAccessibilityAuditIssue) -> String? {
        guard let element = issue.element, element.exists else { return nil }
        if issue.auditType == .dynamicType, element.elementType == .staticText {
            return "text the audit loses at the largest size, where it scrolls off the screen; "
                + "TruncationAuditTests.testEveryTextGrowsWithTheTextSize shows every text of the screen grows with the size"
        }
        if issue.auditType == .dynamicType, element.elementType == .button {
            let bars = XCUIApplication().navigationBars.buttons
            for i in 0..<bars.count where bars.element(boundBy: i).frame == element.frame {
                return "a button in the navigation bar, which the system draws and caps in size (it offers the large content viewer instead)"
            }
        }
        return nil
    }

    @MainActor
    func testHomeSettingsAndPairingPassTheAudit() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17 or later") }
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        UITestSupport.screenshot(app, "ios-home", in: self)
        try UITestSupport.audit(app, "home", allowed: Self.allowed)

        settings.tap()
        XCTAssertTrue(app.switches["comfort"].waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "ios-settings", in: self)
        try UITestSupport.audit(app, "settings", allowed: Self.allowed)
        app.terminate()

        let unpaired = UITestSupport.launch(paired: false)
        XCTAssertTrue(unpaired.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(unpaired, "ios-pair", in: self)
        try UITestSupport.audit(unpaired, "pair", allowed: Self.allowed)
    }

    /// Comfort at the largest text size (Comfort keeps it at accessibility3). Dynamic Type itself is left out of this
    /// run: Comfort holds the text between xxLarge and accessibility3 on purpose.
    @MainActor
    func testWithComfortAtTheLargestTextSize() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17 or later") }
        continueAfterFailure = true
        let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        let types = XCUIAccessibilityAuditType.all.subtracting(.dynamicType)
        let app = UITestSupport.launch(paired: true, comfort: true, extra: largest)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        UITestSupport.screenshot(app, "ios-home-comfort", in: self)
        try UITestSupport.audit(app, "home (Comfort)", types: types, allowed: Self.allowed)

        settings.tap()
        XCTAssertTrue(app.switches["comfort"].waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "ios-settings-comfort", in: self)
        try UITestSupport.audit(app, "settings (Comfort)", types: types, allowed: Self.allowed)
        app.terminate()

        let unpaired = UITestSupport.launch(paired: false, comfort: true, extra: largest)
        XCTAssertTrue(unpaired.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(unpaired, "ios-pair-comfort", in: self)
        try UITestSupport.audit(unpaired, "pair (Comfort)", types: types, allowed: Self.allowed)
    }
}
