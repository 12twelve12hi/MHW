import XCTest

/// LAB-PLAN F27.2: Xcode's accessibility audit passes on the iPhone app's Home (empty, and with the sample history: a
/// row in every state, its status label, sentence and "Retry now" or "Try again"), Settings and the pairing screen
/// (iOS 17 and later), at the default text size and with Comfort at the largest text size.
final class AccessibilityAuditTests: XCTestCase {
    /// Issues allowed on `screen`, each with why; everything else fails. A navigation bar's button (the system draws it
    /// and caps its size), and Dynamic Type reports on the texts `DynamicTypeWaivers` names for the screen (the audit
    /// loses them at the largest size; `TruncationAuditTests.testEveryTextGrowsWithTheTextSize` measures each growing).
    @available(iOS 17.0, *)
    static func allowed(on screen: String) -> (XCUIAccessibilityAuditIssue) -> String? {
        { issue in
            guard let element = issue.element, element.exists else { return nil }
            if issue.auditType == .dynamicType, element.elementType == .staticText,
               DynamicTypeWaivers.texts[screen, default: []].contains(element.label) {
                return "a text the audit loses at the largest size, where it scrolls off the screen (DynamicTypeWaivers); "
                    + "TruncationAuditTests.testEveryTextGrowsWithTheTextSize measures it growing with the size"
            }
            if issue.auditType == .dynamicType, element.elementType == .button {
                let bars = XCUIApplication().navigationBars.buttons
                for i in 0..<bars.count where bars.element(boundBy: i).frame == element.frame {
                    return "a button in the navigation bar, which the system draws and caps in size (it offers the large content viewer instead)"
                }
            }
            // The audit measures contrast where an element is laid out, also where the list has scrolled it under the
            // navigation bar (which blurs it) or past the bottom of the screen.
            if issue.auditType == .contrast {
                let app = XCUIApplication()
                let bar = app.navigationBars.firstMatch
                let screen = app.windows.firstMatch.frame
                let top = bar.exists ? bar.frame.maxY : screen.minY
                let shown = CGRect(x: screen.minX, y: top, width: screen.width, height: screen.maxY - top)
                if !shown.insetBy(dx: -1, dy: -1).contains(element.frame) {
                    return "an element the list has scrolled partly under the navigation bar or off the screen"
                }
            }
            return nil
        }
    }

    /// The audits of Home with the sample history leave Dynamic Type out: at the largest size the audit loses every
    /// row that was on screen (the list scrolls them away) and reports each of its texts. Each text of every row is
    /// measured growing with the text size by `TruncationAuditTests.testEveryTextGrowsWithTheTextSize` (Home with the
    /// same rows), and the empty Home is audited with Dynamic Type.
    @available(iOS 17.0, *)
    static var withoutDynamicType: XCUIAccessibilityAuditType { XCUIAccessibilityAuditType.all.subtracting(.dynamicType) }

    @MainActor
    func testHomeSettingsAndPairingPassTheAudit() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17 or later") }
        continueAfterFailure = true
        let app = UITestSupport.launch(paired: true)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        UITestSupport.screenshot(app, "ios-home-empty", in: self)
        try UITestSupport.audit(app, "home-empty", allowed: Self.allowed(on: "home-empty"))

        settings.tap()
        XCTAssertTrue(app.switches["comfort"].waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "ios-settings", in: self)
        try UITestSupport.audit(app, "settings", allowed: Self.allowed(on: "settings"))
        app.terminate()

        let unpaired = UITestSupport.launch(paired: false)
        XCTAssertTrue(unpaired.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(unpaired, "ios-pair", in: self)
        try UITestSupport.audit(unpaired, "pair", allowed: Self.allowed(on: "pair"))
    }

    /// Home with a row in every state, in parts that show whole at the top of the screen (`historyParts`): the
    /// audit scrolls a list itself, so a list scrolled to a row does not stay put under it.
    @MainActor
    func testHomeWithARowInEveryStatePassesTheAudit() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17 or later") }
        continueAfterFailure = true
        for rows in UITestSupport.historyParts {
            let name = "home-rows-" + rows.map(String.init).joined(separator: "-")
            let app = UITestSupport.launch(paired: true, history: true, rows: rows)
            XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
            XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show")
            UITestSupport.screenshot(app, "ios-\(name)", in: self)
            try UITestSupport.auditHere(app, name, types: Self.withoutDynamicType, allowed: Self.allowed(on: "home"))
            app.terminate()
        }
    }

    /// Comfort: Home with each row of the sample history alone, at Comfort's smallest text size (xxLarge, the system's
    /// default size held up to it), where one row shows whole under the sending section; then Home (with the history
    /// below), Settings and pairing at the largest size (Comfort keeps it at accessibility3), where a row is taller than
    /// the screen (`TruncationAuditTests` measures every row text there). Dynamic Type is audited in the run above, with
    /// Comfort off; here it is left out because Comfort holds the text between xxLarge and accessibility3 on purpose
    /// (the F27 table), so text that stops growing past accessibility3 is what Comfort is for.
    @MainActor
    func testWithComfortAtTheLargestTextSize() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17 or later") }
        continueAfterFailure = true
        let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        let types = Self.withoutDynamicType
        for row in 1...6 {
            let app = UITestSupport.launch(paired: true, comfort: true, history: true, rows: [row])
            XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
            XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show")
            UITestSupport.screenshot(app, "ios-home-row-\(row)-comfort", in: self)
            try UITestSupport.auditHere(app, "home-row-\(row) (Comfort)", types: types, allowed: Self.allowed(on: "home"))
            app.terminate()
        }

        let history = UITestSupport.launch(paired: true, comfort: true, history: true, extra: largest)
        XCTAssertTrue(history.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
        XCTAssertTrue(UITestSupport.waitForHistory(history), "the sample history did not show")
        UITestSupport.screenshot(history, "ios-home-comfort", in: self)
        try UITestSupport.auditHere(history, "home (Comfort, largest)", types: types, allowed: Self.allowed(on: "home"))
        history.terminate()

        let app = UITestSupport.launch(paired: true, comfort: true, extra: largest)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show")
        UITestSupport.screenshot(app, "ios-home-empty-comfort", in: self)
        try UITestSupport.audit(app, "home-empty (Comfort)", types: types, allowed: Self.allowed(on: "home-empty"))

        settings.tap()
        XCTAssertTrue(app.switches["comfort"].waitForExistence(timeout: 10), "Settings did not open")
        UITestSupport.screenshot(app, "ios-settings-comfort", in: self)
        try UITestSupport.audit(app, "settings (Comfort)", types: types, allowed: Self.allowed(on: "settings"))
        app.terminate()

        let unpaired = UITestSupport.launch(paired: false, comfort: true, extra: largest)
        XCTAssertTrue(unpaired.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        UITestSupport.screenshot(unpaired, "ios-pair-comfort", in: self)
        try UITestSupport.audit(unpaired, "pair (Comfort)", types: types, allowed: Self.allowed(on: "pair"))
    }
}
