import XCTest

/// LAB-PLAN F27.2: Xcode's accessibility audit passes on the Mac app's main window, its Settings and the pairing screen
/// (macOS 14 and later), with Comfort off and on.
final class AccessibilityAuditTests: XCTestCase {
    /// Issues the app cannot fix because the system draws the element; each names why. Everything else fails.
    @available(macOS 14.0, *)
    static func allowed(_ issue: XCUIAccessibilityAuditIssue) -> String? {
        guard let element = issue.element, element.exists else {
            if issue.auditType == .parentChild {
                return "reported without an element (only with the Settings sheet open), so there is nothing to attribute it to"
            }
            return nil
        }
        if issue.auditType == .parentChild, element.elementType == .group {
            let window = XCUIApplication().windows.firstMatch
            for id in ["_XCUI:CloseWindow", "_XCUI:MinimizeWindow", "_XCUI:ZoomWindow", "_XCUI:FullScreenWindow"] {
                let button = window.buttons[id]
                if button.exists && button.frame.insetBy(dx: -2, dy: -2).contains(element.frame) {
                    return "a group inside the window's \(id.dropFirst(6)) button, which the system draws"
                }
            }
        }
        switch element.elementType {
        case .touchBar:
            return "the system's Touch Bar element, which the runner's Mac does not even have"
        case .helpTag:
            return "the system's tooltip for the Settings button (its words are the button's label)"
        default:
            break
        }
        if element.elementType == .group, element.label.isEmpty,
           ["Send to Daylight", "Settings"].contains(element.children(matching: .any).firstMatch.label) {
            return "the AppKit view that hosts the SwiftUI content, around the content's named group"
        }
        if element.label == "emoji & symbols" {
            return "the system's emoji item in the Touch Bar of a text field"
        }
        if issue.auditType == .contrast, element.elementType == .staticText,
           UITestSupport.text(element.value) == "Send to Daylight" {
            return "the window's title, which the system dims while a sheet is open"
        }
        return nil
    }

    @MainActor
    func testMainWindowSettingsAndPairingPassTheAudit() throws {
        guard #available(macOS 14.0, *) else { throw XCTSkip("performAccessibilityAudit needs macOS 14 or later") }
        continueAfterFailure = true
        for comfort in [false, true] {
            let suffix = comfort ? " (Comfort)" : ""
            let app = UITestSupport.launch(paired: true, comfort: comfort)
            let window = app.windows.firstMatch
            XCTAssertTrue(window.waitForExistence(timeout: 30), "no window")
            let settings = window.buttons["Settings"]
            XCTAssertTrue(settings.waitForExistence(timeout: 30), "the main window did not show")
            UITestSupport.screenshot(app, comfort ? "mac-main-comfort" : "mac-main", in: self)
            try UITestSupport.audit(app, "main" + suffix, allowed: Self.allowed)

            settings.click()
            let sheet = window.sheets.firstMatch
            XCTAssertTrue(sheet.waitForExistence(timeout: 10), "Settings did not open")
            UITestSupport.screenshot(app, comfort ? "mac-settings-comfort" : "mac-settings", in: self)
            try UITestSupport.audit(app, "settings" + suffix, allowed: Self.allowed)
            app.terminate()

            let unpaired = UITestSupport.launch(paired: false, comfort: comfort)
            let field = unpaired.windows.firstMatch.textFields[UITestSupport.pairingField]
            XCTAssertTrue(field.waitForExistence(timeout: 30), "the pairing screen did not show")
            UITestSupport.screenshot(unpaired, comfort ? "mac-pair-comfort" : "mac-pair", in: self)
            try UITestSupport.audit(unpaired, "pair" + suffix, allowed: Self.allowed)
            unpaired.terminate()
        }
    }
}
