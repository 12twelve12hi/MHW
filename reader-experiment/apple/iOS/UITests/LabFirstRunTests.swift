import XCTest

/// LAB-PLAN F00.1 and F00.7 on the iPhone, as a fresh install sees it (no `-DLSLab`: Lab as the build starts it), on
/// storage of its own (`-DLSTestStorage`):
///
/// - F00.1: Lab is on; this Wave 0 build shows no one-time note (`LAB_NOTE_ENABLED` is false), so Home, with Lab on,
///   is exactly the Lab-off baseline's, as is the share sheet's card in each state; Settings starts with Lab, on, and
///   its rows. (The update from the non-Lab build, with its pairing and history, is `LabAppTests`.)
/// - F00.7: until something is tapped, no screen names a secret or says how to set something up: the pairing screen,
///   Home, Settings and What's in Lab (short states only), with no Daylight server on the relay.
final class LabFirstRunTests: XCTestCase {
    /// F00.1: Lab on, no note, Settings › Lab with its rows; turning it off hides them and leaves Comfort as it was
    /// (F27.6); on again, they are back.
    @MainActor
    func testAFreshInstallHasLabOnAndShowsNoNote() throws {
        continueAfterFailure = true
        let app = LabUI.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
        XCTAssertFalse(LabUI.containing(LabUI.string("note"), in: app).exists, "a Wave 0 build shows no one-time note")
        UITestSupport.screenshot(app, "ios-lab-first-run-home", in: self)
        // Home with Lab on is the Lab-off Home: the note is the only thing Lab adds there before Wave 1.
        try UITestSupport.checkBaseline(app, screen: "home-empty")

        LabUI.openSettings(app)
        let lab = LabUI.element(LabUI.labSwitch, in: app)
        XCTAssertTrue(lab.waitForExistence(timeout: 10), "no Lab switch in Settings")
        XCTAssertEqual(lab.label, LabUI.string("lab"))
        XCTAssertEqual(UITestSupport.text(lab.value), "1", "Lab is on on a fresh install")
        XCTAssertTrue(LabUI.text(LabUI.string("switchFooter"), in: app).exists, "no Lab footer")
        let whatsIn = LabUI.element(LabUI.whatsInLab, in: app)
        let server = LabUI.element(LabUI.serverRow, in: app)
        XCTAssertTrue(whatsIn.exists, "no “What’s in Lab ›” row with Lab on")
        XCTAssertTrue(server.exists, "no “Daylight server ›” row with Lab on")
        // "Optional · {short state}": here the relay is out of reach.
        let subtitle = "Optional · " + LabUI.string("short.OFFLINE")
        expectation(for: NSPredicate(format: "label CONTAINS %@", subtitle), evaluatedWith: server)
        waitForExpectations(timeout: 15)
        UITestSupport.screenshot(app, "ios-lab-first-run-settings", in: self)
        // Settings is the first thing above Your Daylight.
        XCTAssertLessThan(lab.frame.minY, app.textFields["Relay"].frame.minY, "Lab is not Settings' first section")

        let comfort = app.switches["comfort"]
        let comfortBefore = UITestSupport.text(comfort.value)
        LabUI.flipLab(app)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: whatsIn)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: server)
        waitForExpectations(timeout: 10)
        XCTAssertEqual(UITestSupport.text(lab.value), "0")
        XCTAssertEqual(UITestSupport.text(comfort.value), comfortBefore, "turning Lab off changed Comfort (F27.6)")
        UITestSupport.screenshot(app, "ios-lab-first-run-settings-lab-off", in: self)
        LabUI.flipLab(app)
        XCTAssertTrue(whatsIn.waitForExistence(timeout: 10), "What’s in Lab did not come back with Lab on")
        XCTAssertTrue(server.exists)
        XCTAssertEqual(UITestSupport.text(lab.value), "1")
    }

    /// F00.1 and F17.2: with Lab on, Home with the sample history (a row in every state, in the parts that show whole)
    /// is the Lab-off baseline's: a sender that never heard a hello shows "Delivered ✓", and Wave 0 changes no row.
    @MainActor
    func testHomeWithLabOnIsTheLabOffHomeInWave0() throws {
        continueAfterFailure = true
        for rows in UITestSupport.historyParts {
            let name = "home-rows-" + rows.map(String.init).joined(separator: "-")
            let app = LabUI.launch(history: true, rows: rows)
            XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
            XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show")
            if rows.contains(4) {
                XCTAssertTrue(LabUI.containing("Delivered ✓", in: app).exists, "the delivered row does not say Delivered ✓")
            }
            UITestSupport.screenshot(app, "ios-lab-on-\(name)", in: self)
            try UITestSupport.checkBaseline(app, screen: name)
            app.terminate()
        }
    }

    /// F00.1: the share sheet's card follows the app's Lab (on here, as on a fresh install) and, in Wave 0, reads
    /// exactly as with Lab off in each of its states, with no Lab switch of its own.
    @MainActor
    func testTheShareCardWithLabOnIsTheLabOffCardInWave0() throws {
        continueAfterFailure = true
        for card in UITestSupport.shareCards {
            let app = LabUI.launch(relay: nil, extra: ["-DLSShareCard", card])
            XCTAssertTrue(app.staticTexts.firstMatch.waitForExistence(timeout: 30), "the \(card) card did not show")
            UITestSupport.screenshot(app, "ios-lab-on-share-\(card)", in: self)
            try UITestSupport.checkBaseline(app, screen: "share-\(card)", labSwitch: false)
            app.terminate()
        }
    }

    /// F00.7: nothing names a secret or says how to set something up before a Lab feature is tapped or the Daylight
    /// server section is opened: the pairing screen; then, paired on a relay with no Daylight server, Home, Settings
    /// (its server row says "Optional · Not set up") and What's in Lab, which lists every server feature with its name,
    /// its sentence and short states only. The server section, opened, does say how (the check sees those words).
    @MainActor
    func testNothingSaysHowToSetUpUntilAsked() throws {
        continueAfterFailure = true
        let relay = try LabUI.onlineRelay()
        func check(_ app: XCUIApplication, _ screen: String) throws {
            let found = LabUI.setupWords(try LabUI.texts(app))
            XCTAssertEqual(found, [], "\(screen) says how to set something up before anything was tapped")
        }

        let unpaired = LabUI.launch(relay: nil)
        XCTAssertTrue(unpaired.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30), "Pairing did not show")
        try check(unpaired, "the pairing screen")
        unpaired.terminate()

        let app = LabUI.launch(relay: relay)
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
        try check(app, "Home")
        LabUI.openSettings(app)
        let server = LabUI.element(LabUI.serverRow, in: app)
        let notSetUp = LabUI.string("serverHeadingShort.needs-server")
        expectation(for: NSPredicate(format: "label CONTAINS %@", "Optional · " + notSetUp), evaluatedWith: server)
        waitForExpectations(timeout: 15)
        try check(app, "Settings")
        LabUI.goToWhatsInLab(app, short: notSetUp)
        XCTAssertTrue(LabUI.text(LabUI.string("short.needs-inbox"), in: app).exists,
                      "What’s in Lab's header is not the needs-inbox line (no hello yet, F17.2)")
        XCTAssertTrue(LabUI.text(LabUI.string("serverHeading"), in: app).exists
                      || LabUI.text(LabUI.string("serverHeading").uppercased(), in: app).exists, "no server group heading")
        for id in ["F02", "F37", "F19", "F36"] {
            let row = LabUI.element(LabUI.feature(id), in: app)
            LabUI.scrollTo(row, in: app)
            XCTAssertTrue(row.exists, "What’s in Lab does not list \(id)")
            XCTAssertTrue(row.isEnabled, "\(id) looks unavailable")
            XCTAssertTrue(row.label.contains(LabUI.string("features.\(id).name")), "\(id)'s row lacks its name: \(row.label)")
        }
        UITestSupport.screenshot(app, "ios-lab-first-run-whats-in-lab", in: self)
        try check(app, "What’s in Lab")

        // Where setup happens, the words are there: the check is not blind.
        LabUI.backToSettings(app, from: LabUI.string("whatsInLab"))
        LabUI.goToServerSection(app)
        XCTAssertNotEqual(LabUI.setupWords(try LabUI.texts(app)), [], "the server section shows no setup words")
    }
}

/// The scrolled walk's merge (`LabUI.merge`), on node lists built by hand: no app is launched.
final class ScrolledWalkTests: XCTestCase {
    func n(_ label: String, _ type: String = "staticText") -> AXNode { AXNode(type: type, label: label, value: "") }

    func testTheStepsAreJoinedWhereTheyOverlap() {
        let nav = [n("Send to Daylight", "application"), n("Settings"), n("Done", "button")]
        let top = nav + [n("YOUR DAYLIGHT"), n("Name"), n("Comfort", "switch"), n("HISTORY")]
        let end = nav + [n("Comfort", "switch"), n("HISTORY"), n("ABOUT"), n("Version")]
        XCTAssertEqual(LabUI.merge(top, end), top + [n("ABOUT"), n("Version")])
    }

    func testAStepThatMovedNothingOrOnlyAddedRowsChangesNothingElse() {
        let nav = [n("Settings"), n("Done", "button")]
        let top = nav + [n("A"), n("B")]
        XCTAssertEqual(LabUI.merge(top, top), top)
        XCTAssertEqual(LabUI.merge(top, top + [n("C")]), top + [n("C")])
        XCTAssertEqual(LabUI.merge(top + [n("C")], top), top + [n("C")])
    }

    func testRepeatedRowsUseTheLongestOverlap() {
        let nav = [n("Settings")]
        let top = nav + [n("A"), n("X"), n("Y"), n("X")]
        let end = nav + [n("X"), n("Y"), n("X"), n("Z")]
        XCTAssertEqual(LabUI.merge(top, end), top + [n("Z")])
    }
}
