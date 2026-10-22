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
    /// `AccessibilityAuditTests.allowed(on:)`, and, as for a history row on Home (`UITestSupport.auditHere`), contrast
    /// and clipping reports that come without an element while a text shows partly under the navigation bar or past
    /// the screen's edge, where the audit measures it as laid out: the allowance names those texts. On the Lab screens
    /// (not Settings), a clipping report without an element: the hosted truncation audit measures each of their texts.
    /// Every allowed report is printed with its reason; anything else fails.
    @available(iOS 17.0, *)
    @MainActor
    static func allowed(on screen: String, _ app: XCUIApplication) throws -> (XCUIAccessibilityAuditIssue) -> String? {
        let hidden = try textsPartlyHidden(app)
        let base = AccessibilityAuditTests.allowed(on: screen)
        let labScreen = !screen.hasPrefix("settings")
        return { issue in
            if issue.element == nil, issue.auditType == .contrast || issue.auditType == .textClipped, !hidden.isEmpty {
                let texts = hidden.map { "“\($0.prefix(40))”" }.joined(separator: ", ")
                return "reported without an element while a text shows partly under the navigation bar or past the "
                    + "screen's edge: \(texts)"
            }
            if issue.element == nil, issue.auditType == .textClipped, labScreen {
                return "text the audit reports as maybe clipped at larger sizes without an element to point at (What's "
                    + "in Lab's rows are one element each, as history rows are); TruncationAuditTests measures every text "
                    + "of this screen at the narrowest width and accessibility3 (whats-in-lab, lab-notes, server) and "
                    + "finds none cut, and testEveryTextGrowsWithTheTextSize finds each growing"
            }
            return base(issue)
        }
    }

    /// The texts (and What's in Lab's rows, whose words are one element) that show partly under the navigation bar or
    /// past the bottom of the screen.
    @MainActor
    static func textsPartlyHidden(_ app: XCUIApplication) throws -> [String] {
        var bar = CGRect.null
        var screen = CGRect.null
        var texts: [(words: String, frame: CGRect)] = []
        func visit(_ s: XCUIElementSnapshot) {
            if s.elementType == .navigationBar && bar.isNull { bar = s.frame }
            if s.elementType == .window && screen.isNull { screen = s.frame }
            if s.elementType == .staticText || s.identifier.hasPrefix("lab-feature-") { texts.append((s.label, s.frame)) }
            for child in s.children { visit(child) }
        }
        visit(try app.snapshot())
        return texts.filter { text in
            (!bar.isNull && text.frame.minY < bar.maxY && text.frame.maxY > bar.maxY)
                || (!screen.isNull && text.frame.minY < screen.maxY && text.frame.maxY > screen.maxY)
        }.map { $0.words }
    }

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
                                    allowed: try Self.allowed(on: "settings-lab", app))

            LabUI.goToWhatsInLab(app, short: notSetUp)
            UITestSupport.screenshot(app, "ios-lab-whats-in-lab\(suffix)", in: self)
            try UITestSupport.audit(app, "whats-in-lab\(mode)", types: types,
                                    allowed: try Self.allowed(on: "whats-in-lab", app))

            let row = LabUI.element(LabUI.feature("F37"), in: app)
            LabUI.scrollTo(row, in: app)
            LabUI.tapRow(row, in: app)
            let note = LabUI.element(LabUI.note, in: app)
            let sentence = LabUI.text(LabUI.needs("needs-server"), in: app)
            if !sentence.waitForExistence(timeout: 6) {
                // Diagnostics, then once more: the tap may have met the list still settling after the scroll.
                print("UI test: no note after tapping F37 (\(row.frame), hittable \(row.isHittable)); tapping it again")
                UITestSupport.printShot(app, "lab note tap\(mode)")
                LabUI.tapRow(row, in: app)
            }
            XCTAssertTrue(sentence.waitForExistence(timeout: 6), "no note")
            LabUI.scrollTo(note.buttons[LabUI.string("noteButton")], in: app)
            UITestSupport.screenshot(app, "ios-lab-note\(suffix)", in: self)
            try UITestSupport.audit(app, "whats-in-lab-note\(mode)", types: types,
                                    allowed: try Self.allowed(on: "whats-in-lab-note", app))

            LabUI.backToSettings(app, from: LabUI.string("whatsInLab"))
            LabUI.goToServerSection(app)
            UITestSupport.screenshot(app, "ios-lab-server\(suffix)", in: self)
            try UITestSupport.audit(app, "server\(mode)", types: types, allowed: try Self.allowed(on: "server", app))
            app.terminate()
        }
    }
}
