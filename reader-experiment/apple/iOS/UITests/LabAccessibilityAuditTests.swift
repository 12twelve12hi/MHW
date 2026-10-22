import XCTest

/// LAB-PLAN F27.2 with Lab on (F27.1–F27.4 still hold, card A1): Xcode's accessibility audit passes on Settings with its
/// Lab section, What's in Lab, What's in Lab with a needs-setup note open, and the Daylight server section (no server
/// deployed: its longest form), at the default text size and with Comfort at the largest size (iOS 17 and later).
///
/// Dynamic Type is left out here, as for Home with the sample history (`AccessibilityAuditTests.withoutDynamicType`):
/// these screens are longer than one screen, and the audit reports every text it loses off the screen at the largest
/// size. `TruncationAuditTests.testEveryTextGrowsWithTheTextSize` measures each of their texts growing with the size
/// (Settings with Lab on, `whats-in-lab`, `server`, `lab-notes`), and Settings is audited with Dynamic Type with Lab off.
final class LabAccessibilityAuditTests: XCTestCase {
    @MainActor
    func testTheLabScreensPassTheAudit() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17 or later") }
        continueAfterFailure = true
        let relay = try LabUI.onlineRelay()
        let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        let types = AccessibilityAuditTests.withoutDynamicType
        let notSetUp = LabUI.string("serverHeadingShort.needs-server")
        for comfort in [false, true] {
            let mode = comfort ? " (Comfort, largest)" : ""
            let suffix = comfort ? "-comfort" : ""
            let app = LabUI.launch(relay: relay, comfort: comfort, extra: comfort ? largest : [])
            LabUI.openSettings(app)
            let server = LabUI.element(LabUI.serverRow, in: app)
            expectation(for: NSPredicate(format: "label CONTAINS %@", notSetUp), evaluatedWith: server)
            waitForExpectations(timeout: 15)
            UITestSupport.screenshot(app, "ios-lab-settings\(suffix)", in: self)
            try UITestSupport.audit(app, "settings-lab\(mode)", types: types,
                                    allowed: AccessibilityAuditTests.allowed(on: "settings-lab"))

            LabUI.goToWhatsInLab(app, short: notSetUp)
            UITestSupport.screenshot(app, "ios-lab-whats-in-lab\(suffix)", in: self)
            try UITestSupport.audit(app, "whats-in-lab\(mode)", types: types,
                                    allowed: AccessibilityAuditTests.allowed(on: "whats-in-lab"))

            let row = LabUI.element(LabUI.feature("F37"), in: app)
            LabUI.scrollTo(row, in: app)
            row.tap()
            let note = LabUI.element(LabUI.note, in: app)
            XCTAssertTrue(LabUI.text(LabUI.needs("needs-server"), in: app).waitForExistence(timeout: 6), "no note")
            LabUI.scrollTo(note.buttons[LabUI.string("noteButton")], in: app)
            UITestSupport.screenshot(app, "ios-lab-note\(suffix)", in: self)
            try UITestSupport.audit(app, "whats-in-lab-note\(mode)", types: types,
                                    allowed: AccessibilityAuditTests.allowed(on: "whats-in-lab-note"))

            LabUI.backToSettings(app, from: LabUI.string("whatsInLab"))
            LabUI.goToServerSection(app)
            UITestSupport.screenshot(app, "ios-lab-server\(suffix)", in: self)
            try UITestSupport.audit(app, "server\(mode)", types: types, allowed: AccessibilityAuditTests.allowed(on: "server"))
            app.terminate()
        }
    }
}
