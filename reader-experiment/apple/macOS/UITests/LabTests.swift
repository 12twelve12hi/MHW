import AppKit
import XCTest

// The Mac's Lab (LAB-PLAN F00 and F17, card A2) as someone using the app meets it: the switch at the top of Settings, on
// by default with no note in W0 (F00.1); nothing about setup until something is tapped (F00.7); What's in Lab's short
// states and the one sentence under a tapped row (F00.3), the Server code (F00.5), the server's answers within 5 s
// (F00.6); a Daylight that never said hello (F17.2); the Share menu card's own Lab switch (ad-hoc builds, 1.1); and the
// accessibility audit of every Lab screen (F27.2). The Lab-off parity walk (F00.2) is LabOffParityTests.
//
// The app runs on its own empty storage (`-DLSTestStorage`), which is a first start every launch. Words come from the
// vectors in the source tree (LAB_TEXT: share/vectors/lab-vectors.json; the Server code and the server module's
// messages: server/vectors), as the apps take them from LAB_TEXT. Two tests need relays the CI job starts (rx-apple.yml,
// mac): a mock ntfy relay with no Daylight server on it ($DLS_LAB_RELAY), and one that takes connections and never
// answers ($DLS_SILENT_RELAY). The UI tests' pairing link's relay, 127.0.0.1:9, refuses every connection: no network.
// What VoiceOver was told is listed in the main window with `-DLSShowAnnouncements` (Debug; `AnnouncementLog`).

/// What the Lab UI tests share.
@MainActor
enum LabUI {
    /// The Lab switch's identifier (`LabIDs.labSwitch`, `AXTree.labSwitchID`) and the Lab screens' others (`LabIDs`).
    static let labSwitchID = AXTree.labSwitchID
    static let whatsInLabID = "lab-whats-in-lab"
    static let serverRowID = "lab-server"
    static let noteID = "lab-note"
    static let serverCodeID = "lab-server-code"
    static let copyServerCodeID = "lab-server-copy"
    static func featureID(_ id: String) -> String { "lab-feature-\(id)" }

    /// The Back button of the pages the Lab section opens (`MacLabPage.back`), their title (`MacLabPage.titleID`) and
    /// What's in Lab's list, whose name is that title (`MacWhatsInLab.listID`).
    static let back = "Back"
    static let pageTitleID = "lab-page-title"
    static let whatsInLabListID = "lab-whats-in-lab-list"

    /// Each announcement's text in the main window with `-DLSShowAnnouncements` (`AnnouncementLog.textID`).
    static let announcedID = "dls-announced"

    /// The gate's 5 s deadline as a UI test can see it (a click and a look each take the test a moment), as the
    /// iPhone's LabNoteTests.gateAsSeen.
    static let gateAsSeen: TimeInterval = 8

    /// The secrets the setup texts name: none may show before something is tapped (F00.7).
    static let secretNames = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "ANTHROPIC_API_KEY", "DAYLIGHT_SERVER_CODE",
                              "DAYLIGHT_EMAIL_DOMAIN", "DAYLIGHT_WORKERS_PLAN"]

    /// …/reader-experiment/<path>, read from the source tree (as the Lab-off baselines are).
    static func repo(_ path: String) -> URL {
        URL(fileURLWithPath: #filePath) // …/reader-experiment/apple/macOS/UITests/<this file>
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(path)
    }

    static func json(_ path: String) throws -> [String: Any] {
        let data = try Data(contentsOf: repo(path))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any], "\(path) is not a JSON object")
    }

    static func labText() throws -> [String: Any] {
        try XCTUnwrap(try json("share/vectors/lab-vectors.json")["labText"] as? [String: Any], "no labText in the Lab vectors")
    }

    /// The server module's message for a state (server/client/daylight-server.js STATE_MESSAGES, `ServerMessages`), as
    /// server-vectors.json › serverState expects it. Under a control these states show the module's sentence (LAB-PLAN
    /// 1.6); labText.messages has only their short states (OFFLINE's: "Can’t reach the server").
    static func stateMessage(_ state: String) throws -> String {
        let serverState = try XCTUnwrap(try json("server/vectors/server-vectors.json")["serverState"] as? [String: Any])
        for key in ["fromStatus", "fromError"] {
            for case let c as [String: Any] in (serverState[key] as? [Any]) ?? [] {
                guard let expect = c["expect"] as? [String: Any], expect["state"] as? String == state,
                      let message = expect["message"] as? String else { continue }
                return message
            }
        }
        XCTFail("server-vectors.json has no \(state) message")
        return ""
    }

    /// A LAB_TEXT string by its dotted id (lab-vectors.json › labText.strings).
    static func text(_ id: String) throws -> String {
        let strings = try XCTUnwrap(try labText()["strings"] as? [String: Any])
        return try XCTUnwrap(strings[id] as? String, "LAB_TEXT has no \(id)")
    }

    /// The one sentence a tapped control shows for `state` on the Mac (labText.messages, platform "mac").
    static func needsSentence(_ state: String) throws -> String {
        let messages = try XCTUnwrap(try labText()["messages"] as? [[String: Any]])
        let m = messages.first { $0["state"] as? String == state && $0["platform"] as? String == "mac" && $0["short"] as? Bool != true }
        return try XCTUnwrap(m?["expect"] as? String, "no Mac sentence for \(state) in the Lab vectors")
    }

    /// Every needs-setup sentence the Mac can show (F00.7).
    static func needsSentences() throws -> [String] {
        let messages = try XCTUnwrap(try labText()["messages"] as? [[String: Any]])
        return messages.filter { $0["platform"] as? String == "mac" && $0["short"] as? Bool != true }
            .compactMap { $0["expect"] as? String }
    }

    /// The Server code of the UI tests' pairing (the vectors' first secret: server-vectors.json › derived.serverCode)
    /// on a relay that is not ntfy.sh: the daylightserver:// link with that relay (LAB-PLAN 2.6, `ServerCode.format`).
    static func serverCode(relay: String) throws -> String {
        let derived = try XCTUnwrap(try json("server/vectors/server-vectors.json")["derived"] as? [String: Any])
        let code = try XCTUnwrap(derived["serverCode"] as? String)
        let c = code.replacingOccurrences(of: "SERVER-", with: "").replacingOccurrences(of: "-", with: "")
        return "daylightserver://setup?c=\(c)&r=\(formEncode(relay))"
    }

    /// URLSearchParams' encoding (`ServerCode.formEncode`).
    static func formEncode(_ s: String) -> String {
        var allowed = CharacterSet(charactersIn: "*-._")
        allowed.formUnion(CharacterSet(charactersIn: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"))
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    /// The UI tests' pairing link (`UITestSupport.pairingLink`), on `relay` when given.
    static func pairingLink(relay: String?) -> String {
        guard let relay else { return UITestSupport.pairingLink }
        return "daylightshare://pair?c=\(UITestSupport.pairingCode)&r=\(formEncode(relay))&n=Test%20Daylight"
    }

    /// Starts the app on fresh, empty storage of its own: with Lab as `-DLSLab` says, or not set (nil: a first start, as
    /// a fresh install or the first start after an update has it), Comfort as given, paired or not (on `relay`; nil: the
    /// pairing link's 127.0.0.1:9, where nothing listens), with the sample history, and listing what VoiceOver is told
    /// (`announcements`: `-DLSShowAnnouncements`).
    static func launch(lab: Bool?, paired: Bool, relay: String? = nil, comfort: Bool = false, history: Bool = false,
                       announcements: Bool = false, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-DLSTestStorage", "-DLSComfort", comfort ? "1" : "0"]
        if let lab { arguments += ["-DLSLab", lab ? "1" : "0"] }
        if paired { arguments += ["-DLSPairLink", pairingLink(relay: relay)] }
        if history { arguments += ["-DLSSampleHistory"] }
        if announcements { arguments += ["-DLSShowAnnouncements"] }
        app.launchArguments = arguments + extra
        app.launch()
        UITestSupport.waitUntilReadable(app)
        return app
    }

    static func element(_ id: String, in root: XCUIElement) -> XCUIElement {
        root.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Opens Settings: the main window's sheet when paired (its Settings button), else the Settings window (⌘,).
    /// -> what holds it, once its Lab switch shows.
    static func openSettings(_ app: XCUIApplication, paired: Bool) -> XCUIElement {
        let root: XCUIElement
        if paired {
            let window = app.windows.firstMatch
            let button = window.buttons["Settings"]
            XCTAssertTrue(button.waitForExistence(timeout: 30), "the main window did not show")
            button.click()
            root = window.sheets.firstMatch
            XCTAssertTrue(root.waitForExistence(timeout: 10), "the Settings sheet did not open")
        } else {
            XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 30), "no window")
            app.typeKey(",", modifierFlags: .command)
            // The Settings window: the one that is not the main window. (Not found by what it shows: a page the Lab
            // section opens takes the place of everything in it.)
            root = app.windows.matching(NSPredicate(format: "title != %@", mainWindowTitle)).firstMatch
        }
        if !element(labSwitchID, in: root).waitForExistence(timeout: 10) {
            let titles = app.windows.allElementsBoundByIndex.map { "“\($0.title)”" }.joined(separator: ", ")
            XCTFail("Settings has no Lab switch (the app's windows: \(titles))")
        }
        return root
    }

    /// The main window's title (`MainWindow`).
    static let mainWindowTitle = "Send to Daylight"

    /// Opens a row of the Lab section ("What’s in Lab ›" or "Daylight server ›") and waits for its page (its Back
    /// button).
    static func open(_ rowID: String, in root: XCUIElement) {
        let row = element(rowID, in: root)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no \(rowID) row: is Lab on?")
        row.click()
        XCTAssertTrue(root.buttons[back].waitForExistence(timeout: 10), "\(rowID) did not open its page")
    }

    /// Back to Settings from a Lab page: the page goes (its Back button, its title and `pageOnly`, an element only that
    /// page has, leave the tree), and Settings shows. The navigation stack keeps Settings in the tree under a page, so the
    /// Lab switch being there proves nothing by itself.
    static func goBack(in root: XCUIElement, leaving pageOnly: String) {
        let button = root.buttons[back]
        let page = element(pageOnly, in: root)
        XCTAssertTrue(page.exists, "\(pageOnly) is not on the page Back should leave")
        button.click()
        XCTAssertTrue(waitUntilGone(button), "Back did not leave the page: its Back button is still there")
        XCTAssertTrue(waitUntilGone(element(pageTitleID, in: root)), "Back did not leave the page: its title is still there")
        XCTAssertTrue(waitUntilGone(page), "Back did not leave the page: \(pageOnly) is still there")
        XCTAssertTrue(element(labSwitchID, in: root).waitForExistence(timeout: 10), "Back did not return to Settings")
    }

    /// Waits (at most `timeout` seconds) until `element` is no longer in the tree.
    static func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }

    /// A Lab page shows its title once: as its own header (`MacLabPage`), and nowhere else under `root` but in the row
    /// that opened it (which the navigation stack keeps underneath) and as the name of What's in Lab's list. macOS 15
    /// also put the kit's `.navigationTitle` in a strip at the top of the sheet, so the title showed twice.
    static func checkTitleShowsOnce(_ title: String, openedBy rowID: String, in root: XCUIElement,
                                    file: StaticString = #filePath, line: UInt = #line) throws {
        let snapshot = try root.snapshot()
        // Where the row is laid out (its words may be an element beside it rather than inside it).
        var rows: [CGRect] = []
        func findRows(_ s: XCUIElementSnapshot) {
            if s.identifier == rowID, !s.frame.isEmpty { rows.append(s.frame.insetBy(dx: -1, dy: -1)) }
            for child in s.children { findRows(child) }
        }
        findRows(snapshot)
        var headers = 0
        var others: [String] = []
        func visit(_ s: XCUIElementSnapshot, isRoot: Bool) {
            if s.identifier == rowID { return }
            if !isRoot, s.identifier != whatsInLabListID, !rows.contains(where: { $0.contains(s.frame) }),
               [s.label, s.title, UITestSupport.text(s.value)].contains(title) {
                if s.identifier == pageTitleID {
                    headers += 1
                } else {
                    let f = s.frame
                    others.append("\(AXTree.typeName(s.elementType)) “\(s.identifier)” at \(Int(f.minX)),\(Int(f.minY)) "
                                  + "\(Int(f.width))×\(Int(f.height))")
                }
            }
            for child in s.children { visit(child, isRoot: false) }
        }
        visit(snapshot, isRoot: true)
        print("UI test: “\(title)” shows as the page's title \(headers)×, and elsewhere \(others.count)× \(others)")
        XCTAssertEqual(headers, 1, "the page does not show its title “\(title)” once", file: file, line: line)
        XCTAssertEqual(others, [], "the page's title “\(title)” also shows elsewhere", file: file, line: line)
    }

    /// What VoiceOver was told since launch, in order (`-DLSShowAnnouncements`: one text each in the main window).
    static func announcements(_ app: XCUIApplication) -> [String] {
        app.staticTexts.matching(identifier: announcedID).allElementsBoundByIndex.map { (e: XCUIElement) -> String in
            let value = UITestSupport.text(e.value)
            return value.isEmpty ? e.label : value
        }
    }

    /// Waits (at most `timeout` seconds) until `text` was said to VoiceOver.
    static func waitForAnnouncement(_ text: String, in app: XCUIApplication, timeout: TimeInterval = 5) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if announcements(app).contains(text) { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return announcements(app).contains(text)
    }

    /// Every word an element and everything inside it shows or says: labels, titles and values.
    static func texts(_ root: XCUIElement) throws -> [String] {
        var out: [String] = []
        func visit(_ s: XCUIElementSnapshot) {
            for t in [s.label, s.title, UITestSupport.text(s.value)] where !t.isEmpty { out.append(t) }
            for child in s.children { visit(child) }
        }
        visit(try root.snapshot())
        return out
    }

    /// What an element shows, for a failure's message.
    static func said(_ root: XCUIElement) -> String {
        ((try? texts(root)) ?? []).map { "“\($0.prefix(80))”" }.joined(separator: ", ")
    }

    /// The texts that spell out setup (F00.7): a secret's name, or a needs-setup sentence.
    static func setupWords(_ texts: [String]) throws -> [String] {
        let sentences = try needsSentences()
        return texts.filter { t in secretNames.contains { t.contains($0) } || sentences.contains { t.contains($0) } }
    }

    /// Waits until some element under `root` has exactly these words as its label, title or value. (A walk of the tree,
    /// not a query: a list section's header is a text a `staticTexts` query does not match by its label.)
    @discardableResult
    static func waitFor(_ words: String, in root: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            if ((try? texts(root)) ?? []).contains(words) { return true }
            if Date() > deadline { return false }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    /// Waits until What's in Lab has the server's answer: its server heading's line no longer says "Checking your
    /// Daylight server…" (the gate's 5 s at most, and the ack topic's).
    static func waitForOverview(in root: XCUIElement) throws {
        XCTAssertTrue(waitFor(try text("serverHeading"), in: root), "What's in Lab did not show its server heading: \(said(root))")
        let checking = try text("checking")
        let deadline = Date().addingTimeInterval(15)
        while ((try? texts(root)) ?? []).contains(checking) && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertFalse(((try? texts(root)) ?? []).contains(checking), "What's in Lab still says it is checking the server after 15 s")
    }

    /// The general pasteboard's text once it is `expected` (at most `timeout` seconds), else what it holds.
    static func pasteboard(becomes expected: String, timeout: TimeInterval = 5) -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        var now = NSPasteboard.general.string(forType: .string)
        while now != expected && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.25)
            now = NSPasteboard.general.string(forType: .string)
        }
        return now
    }

    /// A relay the CI job started ($DLS_LAB_RELAY, $DLS_SILENT_RELAY), or a failure that says it is missing.
    static func relay(_ name: String) throws -> String {
        guard let relay = ProcessInfo.processInfo.environment[name], !relay.isEmpty else {
            throw XCTSkip("$\(name) is not set (the rx-apple mac job starts it); run this test with that relay")
        }
        return relay
    }
}

/// F00.1, F00.7 and the switch itself (1.1, 1.3, F27.6).
final class LabFirstRunTests: XCTestCase {
    /// F00.1: a first start (a fresh install, or the first start after an update from the non-Lab build) has Lab on,
    /// with its rows, and shows no one-time note: the Mac's W0 build has neither F01 nor F04 (`LAB_NOTE_ENABLED` false).
    /// After an update the pairing and the history are still there.
    @MainActor
    func testAFirstStartHasLabOnAndShowsNoNote() throws {
        continueAfterFailure = true
        let note = try LabUI.text("note")

        // A fresh install: not paired; Settings is the Settings window.
        let fresh = LabUI.launch(lab: nil, paired: false)
        XCTAssertTrue(fresh.windows.firstMatch.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30),
                      "the pairing screen did not show")
        XCTAssertFalse(try LabUI.texts(fresh.windows.firstMatch).contains(note), "a W0 build shows the one-time Lab note")
        let settings = LabUI.openSettings(fresh, paired: false)
        let lab = LabUI.element(LabUI.labSwitchID, in: settings)
        XCTAssertEqual(lab.elementType, .switch)
        XCTAssertEqual(lab.label, try LabUI.text("lab"))
        XCTAssertEqual(UITestSupport.text(lab.value), "1", "Lab is not on at the first start")
        XCTAssertTrue(LabUI.element(LabUI.whatsInLabID, in: settings).exists, "no What's in Lab row with Lab on")
        XCTAssertTrue(LabUI.element(LabUI.serverRowID, in: settings).exists, "no Daylight server row with Lab on")
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("switchFooter"), in: settings), "no footer under the Lab switch")
        // Not paired: the server row says so in its subtitle ("Optional · Pair first").
        let subtitle = try LabUI.text("serverRowSubtitle").replacingOccurrences(of: "{short}", with: try LabUI.text("short.needs-pairing"))
        XCTAssertTrue(LabUI.element(LabUI.serverRowID, in: settings).label.contains(subtitle)
                      || LabUI.waitFor(subtitle, in: settings), "the Daylight server row is not subtitled “\(subtitle)”")
        UITestSupport.screenshot(fresh, "mac-lab-first-start-settings", in: self)
        fresh.terminate()

        // The first start after an update: paired, with a history, and no Lab key yet.
        let updated = LabUI.launch(lab: nil, paired: true, history: true)
        let window = updated.windows.firstMatch
        XCTAssertTrue(window.buttons["Settings"].waitForExistence(timeout: 30), "the main window did not show")
        XCTAssertTrue(UITestSupport.waitForHistory(updated), "the history did not show")
        XCTAssertTrue(UITestSupport.staticText(UITestSupport.historyFirst, in: window).exists, "the history lost its rows")
        XCTAssertFalse(try LabUI.texts(window).contains(note), "a W0 build shows the one-time Lab note")
        let sheet = LabUI.openSettings(updated, paired: true)
        XCTAssertEqual(UITestSupport.text(LabUI.element(LabUI.labSwitchID, in: sheet).value), "1", "Lab is not on after the update")
        XCTAssertTrue(UITestSupport.staticText("Daylight, Test Daylight", in: sheet).waitForExistence(timeout: 10),
                      "the pairing is gone")
        UITestSupport.screenshot(updated, "mac-lab-first-start-updated", in: self)
        updated.terminate()
    }

    /// F00.7: with nothing set up, no screen reachable without tapping a Lab feature or opening the Daylight server
    /// section names a secret or shows a needs-setup sentence: the pairing screen, the main window with its history,
    /// Settings (the window and the sheet), What's in Lab (opened, nothing tapped) and the Share menu card.
    @MainActor
    func testNothingSpellsOutSetupUntilSomethingIsTapped() throws {
        continueAfterFailure = true
        func check(_ root: XCUIElement, _ screen: String) throws {
            let found = try LabUI.setupWords(try LabUI.texts(root))
            XCTAssertEqual(found, [], "\(screen) spells out setup before anything was tapped")
        }

        let unpaired = LabUI.launch(lab: nil, paired: false)
        XCTAssertTrue(unpaired.windows.firstMatch.textFields[UITestSupport.pairingField].waitForExistence(timeout: 30))
        try check(unpaired.windows.firstMatch, "the pairing screen")
        let window = LabUI.openSettings(unpaired, paired: false)
        try check(window, "Settings (the Settings window, not paired)")
        LabUI.open(LabUI.whatsInLabID, in: window)
        try LabUI.waitForOverview(in: window)
        try check(window, "What's in Lab (not paired)")
        unpaired.terminate()

        let paired = LabUI.launch(lab: nil, paired: true, history: true)
        let main = paired.windows.firstMatch
        XCTAssertTrue(UITestSupport.waitForHistory(paired), "the history did not show")
        try check(main, "the main window")
        let sheet = LabUI.openSettings(paired, paired: true)
        try check(sheet, "Settings")
        LabUI.open(LabUI.whatsInLabID, in: sheet)
        try LabUI.waitForOverview(in: sheet)
        UITestSupport.screenshot(paired, "mac-lab-first-start-whats-in-lab", in: self)
        try check(sheet, "What's in Lab")
        paired.terminate()

        let card = LabUI.launch(lab: nil, paired: false, extra: ["-DLSShareCard", UITestSupport.cardWithItsOwnSettings])
        XCTAssertTrue(LabUI.element(LabUI.labSwitchID, in: card.windows.firstMatch).waitForExistence(timeout: 30))
        try check(card.windows.firstMatch, "the Share menu card")
        card.terminate()
    }

    /// 1.1, 1.3 and F27.6: the switch hides What's in Lab and Daylight server and brings them back, and Comfort stays as
    /// it was.
    @MainActor
    func testTheSwitchHidesItsRowsAndLeavesComfort() throws {
        continueAfterFailure = true
        let app = LabUI.launch(lab: true, paired: true, comfort: true)
        let sheet = LabUI.openSettings(app, paired: true)
        let lab = LabUI.element(LabUI.labSwitchID, in: sheet)
        let comfort = LabUI.element("comfort", in: sheet)
        XCTAssertEqual(UITestSupport.text(comfort.value), "1")
        XCTAssertTrue(LabUI.element(LabUI.whatsInLabID, in: sheet).exists)

        lab.click()
        expectation(for: NSPredicate(format: "value == 0 OR value == '0'"), evaluatedWith: lab)
        waitForExpectations(timeout: 5)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: LabUI.element(LabUI.whatsInLabID, in: sheet))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: LabUI.element(LabUI.serverRowID, in: sheet))
        waitForExpectations(timeout: 5)
        XCTAssertEqual(UITestSupport.text(comfort.value), "1", "turning Lab off changed Comfort (F27.6)")
        UITestSupport.screenshot(app, "mac-lab-switched-off", in: self)

        lab.click()
        XCTAssertTrue(LabUI.element(LabUI.whatsInLabID, in: sheet).waitForExistence(timeout: 5), "Lab on did not bring its rows back")
        XCTAssertTrue(LabUI.element(LabUI.serverRowID, in: sheet).exists)
        XCTAssertEqual(UITestSupport.text(comfort.value), "1", "turning Lab on changed Comfort (F27.6)")
        app.terminate()
    }
}

/// F00.3 (not paired), F00.6 with no network, F17.2 and the Share menu card's own switch: no relay needed.
final class LabNoteTests: XCTestCase {
    /// F17.2: a Mac that has never heard a Lab hello shows its delivered rows as "Delivered ✓" (v1.1's words) and, at
    /// the top of What's in Lab, the needs-inbox short state.
    @MainActor
    func testADaylightThatNeverSaidHelloReadsAsV11() throws {
        continueAfterFailure = true
        let app = LabUI.launch(lab: true, paired: true, history: true)
        let window = app.windows.firstMatch
        XCTAssertTrue(UITestSupport.waitForHistory(app), "the history did not show")
        XCTAssertTrue(UITestSupport.staticText("Delivered ✓", in: window).exists, "no “Delivered ✓” row with Lab on")
        XCTAssertFalse(UITestSupport.staticText(try LabUI.text("rows.delivered.label"), in: window).exists,
                       "a row says “On your Daylight ✓” though no Lab hello was ever heard")
        let sheet = LabUI.openSettings(app, paired: true)
        LabUI.open(LabUI.whatsInLabID, in: sheet)
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("short.needs-inbox"), in: sheet),
                      "What's in Lab does not start with “Needs Lab on your Daylight”")
        UITestSupport.screenshot(app, "mac-lab-never-said-hello", in: self)
        app.terminate()
    }

    /// F00.3, not paired: each server feature is listed under the heading with its short state ("Pair first"); a row is
    /// an enabled control, and a tap shows exactly the needs-pairing sentence under it, said to VoiceOver, with OK, which
    /// closes it. What's in Lab (in the Settings window) shows its title once.
    @MainActor
    func testATapWhenNotPairedSaysPairFirst() throws {
        continueAfterFailure = true
        let app = LabUI.launch(lab: true, paired: false, announcements: true)
        let window = LabUI.openSettings(app, paired: false)
        LabUI.open(LabUI.whatsInLabID, in: window)
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("short.needs-pairing"), in: window), "the server heading's line is not “Pair first”")
        try LabUI.checkTitleShowsOnce(try LabUI.text("whatsInLab"), openedBy: LabUI.whatsInLabID, in: window)
        for id in ["F02", "F37", "F19", "F36"] {
            let row = LabUI.element(LabUI.featureID(id), in: window)
            XCTAssertTrue(row.exists, "What's in Lab does not list \(id)")
            XCTAssertTrue(row.isEnabled, "\(id) looks unavailable (LAB-PLAN 1.5: never greyed out)")
        }
        LabUI.element(LabUI.featureID("F37"), in: window).click()
        let note = LabUI.element(LabUI.noteID, in: window)
        XCTAssertTrue(note.waitForExistence(timeout: 5), "no note under Summaries with Claude")
        let sentence = try LabUI.needsSentence("needs-pairing")
        XCTAssertTrue(UITestSupport.staticText(sentence, in: note).exists,
                      "the note is not the needs-pairing sentence: \(LabUI.said(note))")
        XCTAssertFalse(UITestSupport.staticText(try LabUI.text("checking"), in: window).exists,
                       "a local answer said it was checking the server")
        XCTAssertTrue(LabUI.waitForAnnouncement(sentence, in: app), "the needs-pairing sentence was not said to VoiceOver: "
                      + "\(LabUI.announcements(app))")
        XCTAssertFalse(LabUI.announcements(app).contains(try LabUI.text("checking")), "a local answer was said to be checking the server")
        UITestSupport.screenshot(app, "mac-lab-note-needs-pairing", in: self)
        let ok = try LabUI.text("noteButton")
        note.buttons[ok].click()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: note)
        waitForExpectations(timeout: 5)
        app.terminate()
    }

    /// F00.6 (offline): paired on a relay that refuses every connection (the pairing link's 127.0.0.1:9), What's in Lab's
    /// server heading says it can't reach the server, and a tap on Summaries with Claude shows the server module's
    /// OFFLINE sentence under it within the gate's 5 s, said to VoiceOver.
    @MainActor
    func testWithNoNetworkSummariesSayOffline() throws {
        continueAfterFailure = true
        let offline = try LabUI.stateMessage("OFFLINE")
        let app = LabUI.launch(lab: true, paired: true, announcements: true)
        let sheet = LabUI.openSettings(app, paired: true)
        LabUI.open(LabUI.whatsInLabID, in: sheet)
        try LabUI.waitForOverview(in: sheet)
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("short.OFFLINE"), in: sheet),
                      "the server heading's line is not “Can’t reach the server”: \(LabUI.said(sheet))")
        let row = LabUI.element(LabUI.featureID("F37"), in: sheet)
        XCTAssertTrue(row.isEnabled, "Summaries with Claude looks unavailable")
        let tapped = Date()
        row.click()
        let note = LabUI.element(LabUI.noteID, in: sheet)
        XCTAssertTrue(note.waitForExistence(timeout: 5), "no note under Summaries with Claude")
        XCTAssertTrue(LabUI.waitFor(offline, in: note, timeout: 12), "no OFFLINE sentence with no network: \(LabUI.said(sheet))")
        let took = Date().timeIntervalSince(tapped)
        print("UI test: with no network, OFFLINE showed \(String(format: "%.1f", took)) s after the tap started")
        XCTAssertLessThanOrEqual(took, LabUI.gateAsSeen, "the OFFLINE sentence took longer than the gate's 5 s")
        XCTAssertTrue(LabUI.waitForAnnouncement(offline, in: app), "the OFFLINE sentence was not said to VoiceOver: "
                      + "\(LabUI.announcements(app))")
        UITestSupport.screenshot(app, "mac-lab-note-no-network", in: self)
        app.terminate()
    }

    /// LAB-PLAN 1.1: the ad-hoc build's Share menu card counts as an app of its own: its settings start with its own
    /// Lab switch, on by default, named "Lab", with its footer, above Comfort, and it switches off.
    @MainActor
    func testTheShareMenuCardHasItsOwnLabSwitch() throws {
        continueAfterFailure = true
        let app = LabUI.launch(lab: nil, paired: false, extra: ["-DLSShareCard", UITestSupport.cardWithItsOwnSettings])
        let window = app.windows.firstMatch
        let lab = LabUI.element(LabUI.labSwitchID, in: window)
        XCTAssertTrue(lab.waitForExistence(timeout: 30), "the Share menu card has no Lab switch")
        XCTAssertEqual(lab.elementType, .switch)
        XCTAssertEqual(lab.label, try LabUI.text("lab"))
        XCTAssertEqual(UITestSupport.text(lab.value), "1", "the card's Lab switch is not on by default")
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("switchFooter"), in: window), "no footer under the card's Lab switch")
        let comfort = LabUI.element("comfort", in: window)
        XCTAssertTrue(comfort.exists)
        XCTAssertLessThan(lab.frame.minY, comfort.frame.minY, "the card's Lab switch is not first in its settings")
        lab.click()
        expectation(for: NSPredicate(format: "value == 0 OR value == '0'"), evaluatedWith: lab)
        waitForExpectations(timeout: 5)
        UITestSupport.screenshot(app, "mac-share-card-lab-switched-off", in: self)
        app.terminate()

        // A card that shares the app's storage (an App Group) follows the app's switch and shows none.
        let shared = LabUI.launch(lab: nil, paired: false, extra: ["-DLSShareCard", "result-note"])
        XCTAssertTrue(shared.windows.firstMatch.staticTexts.firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(LabUI.element(LabUI.labSwitchID, in: shared.windows.firstMatch).exists,
                       "a card that shares the app's storage shows a Lab switch of its own")
        shared.terminate()
    }
}

/// F00.3, F00.5 and F00.6 against relays the CI job starts: with no Daylight server ("Not set up", the needs-server
/// sentence, Copy Server code), the Server code in the Daylight server section, and a relay that never answers
/// (OFFLINE at 5 s).
final class LabServerNoteTests: XCTestCase {
    /// F00.3, F00.5, F00.6 (online): with no server on the relay, the heading's short state is "Not set up", a tap on
    /// Summaries with Claude shows the needs-server sentence well within 5 s, said to VoiceOver, and its Copy Server code
    /// puts this pairing's Server code on the clipboard; the Daylight server section shows the same code and copies it
    /// too. Each page (in the Settings sheet) shows its title once.
    @MainActor
    func testNoServerSaysSoAndCopiesTheServerCode() throws {
        continueAfterFailure = true
        let relay = try LabUI.relay("DLS_LAB_RELAY")
        let code = try LabUI.serverCode(relay: relay)
        let app = LabUI.launch(lab: true, paired: true, relay: relay, announcements: true)
        let sheet = LabUI.openSettings(app, paired: true)
        LabUI.open(LabUI.whatsInLabID, in: sheet)
        try LabUI.waitForOverview(in: sheet)
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("serverHeadingShort.needs-server"), in: sheet),
                      "the server heading's line is not “Not set up”: \(LabUI.said(sheet))")
        try LabUI.checkTitleShowsOnce(try LabUI.text("whatsInLab"), openedBy: LabUI.whatsInLabID, in: sheet)

        let row = LabUI.element(LabUI.featureID("F37"), in: sheet)
        XCTAssertTrue(row.isEnabled, "Summaries with Claude looks unavailable")
        let tapped = Date()
        row.click()
        let note = LabUI.element(LabUI.noteID, in: sheet)
        let sentence = try LabUI.needsSentence("needs-server")
        XCTAssertTrue(UITestSupport.staticText(sentence, in: sheet).waitForExistence(timeout: 5),
                      "no needs-server sentence within 5 s: \(LabUI.said(sheet))")
        print("UI test: the needs-server note showed \(Int(Date().timeIntervalSince(tapped) * 1000)) ms after the tap")
        XCTAssertTrue(UITestSupport.staticText(sentence, in: note).exists, "the needs-server sentence is not in the note")
        XCTAssertTrue(LabUI.waitForAnnouncement(sentence, in: app), "the needs-server sentence was not said to VoiceOver: "
                      + "\(LabUI.announcements(app))")
        UITestSupport.screenshot(app, "mac-lab-note-needs-server", in: self)

        NSPasteboard.general.clearContents()
        let copyLabel = try LabUI.text("buttons.needs-server")
        let copy = note.buttons[copyLabel]
        XCTAssertTrue(copy.exists, "the needs-server note has no Copy Server code button")
        copy.click()
        XCTAssertEqual(LabUI.pasteboard(becomes: code), code, "Copy Server code did not copy this pairing's Server code")

        LabUI.goBack(in: sheet, leaving: LabUI.featureID("F37"))
        LabUI.open(LabUI.serverRowID, in: sheet)
        let shown = LabUI.element(LabUI.serverCodeID, in: sheet)
        XCTAssertTrue(shown.waitForExistence(timeout: 15), "the Daylight server section shows no Server code")
        try LabUI.checkTitleShowsOnce(try LabUI.text("serverRow"), openedBy: LabUI.serverRowID, in: sheet)
        XCTAssertTrue([shown.label, UITestSupport.text(shown.value)].contains(code),
                      "the Server code shown is not server-vectors.json › derived's: \(shown.label) / \(UITestSupport.text(shown.value))")
        NSPasteboard.general.clearContents()
        LabUI.element(LabUI.copyServerCodeID, in: sheet).click()
        XCTAssertEqual(LabUI.pasteboard(becomes: code), code, "Copy in the Daylight server section did not copy the Server code")
        // The section is where setup happens: the steps show there (with the secret names), and only there.
        XCTAssertTrue(LabUI.waitFor(try LabUI.text("serverSection.stepsHeading"), in: sheet), "no setup steps with no server")
        UITestSupport.screenshot(app, "mac-lab-server-section", in: self)
        LabUI.goBack(in: sheet, leaving: LabUI.serverCodeID)
        app.terminate()
    }

    /// F00.6: with a relay that never answers, a tap on Summaries with Claude says "Checking your Daylight server…" under
    /// it and then, at 5 s, the OFFLINE sentence; VoiceOver is told both, in that order.
    ///
    /// Two clocks, as the iPhone's: the tap's start comes before the gate starts, so OFFLINE must come at least 4.5 s
    /// after it; the test seeing "Checking…" comes after the gate started, so OFFLINE must come at most 8 s after that
    /// (`gateAsSeen`). A gate that gave up at 3 s fails the first, one that answered at 9.5 s the second.
    @MainActor
    func testARelayThatNeverAnswersSaysOfflineAtFiveSeconds() throws {
        continueAfterFailure = true
        let relay = try LabUI.relay("DLS_SILENT_RELAY")
        let offline = try LabUI.stateMessage("OFFLINE")
        let checking = try LabUI.text("checking")
        let app = LabUI.launch(lab: true, paired: true, relay: relay, announcements: true)
        let sheet = LabUI.openSettings(app, paired: true)
        LabUI.open(LabUI.whatsInLabID, in: sheet)
        // What's in Lab asks the server too when it opens: its answer (OFFLINE, at 5 s) comes before the tap.
        try LabUI.waitForOverview(in: sheet)
        let tapped = Date()
        LabUI.element(LabUI.featureID("F37"), in: sheet).click()
        let note = LabUI.element(LabUI.noteID, in: sheet)
        XCTAssertTrue(LabUI.waitFor(checking, in: note, timeout: 4),
                      "no “Checking your Daylight server…” under the control while the server does not answer: \(LabUI.said(sheet))")
        let seen = Date()
        XCTAssertTrue(LabUI.waitFor(offline, in: note, timeout: 12), "no OFFLINE sentence: \(LabUI.said(sheet))")
        let fromTap = Date().timeIntervalSince(tapped)
        let fromSeen = Date().timeIntervalSince(seen)
        print("UI test: a relay that never answers gave OFFLINE \(String(format: "%.1f", fromTap)) s after the tap started, "
              + "\(String(format: "%.1f", fromSeen)) s after “Checking…” was seen")
        XCTAssertGreaterThanOrEqual(fromTap, 4.5, "OFFLINE came before the gate's 5 s: the relay did answer")
        XCTAssertLessThanOrEqual(fromSeen, LabUI.gateAsSeen, "OFFLINE came long after the gate's 5 s")
        XCTAssertTrue(LabUI.waitForAnnouncement(offline, in: app), "the OFFLINE sentence was not said to VoiceOver: "
                      + "\(LabUI.announcements(app))")
        let said = LabUI.announcements(app)
        if let c = said.lastIndex(of: checking), let o = said.lastIndex(of: offline) {
            XCTAssertLessThan(c, o, "VoiceOver was told OFFLINE before “Checking…”: \(said)")
        } else {
            XCTFail("VoiceOver was not told “Checking your Daylight server…” and then OFFLINE: \(said)")
        }
        UITestSupport.screenshot(app, "mac-lab-note-offline", in: self)
        app.terminate()
    }
}

/// F27.2 for the Lab screens: Settings with Lab on, What's in Lab (with and without a note) and the Daylight server
/// section (with no server on the relay: its longest version, with the steps), with Comfort off and on. (The Share menu
/// card is not one of F27.2's screens; its texts are measured by the truncation audit, F27.4.)
///
/// Allowed: what `AccessibilityAuditTests.allowed` allows (elements the system draws), and a contrast report on a text
/// whose own pixels measure at least 7:1 (WCAG's AAA level; the audit asks for 4.5:1). On these pages the Mac's audit
/// reported the first setup step as failing contrast in three runs, though it is black on white (its glyphs measure
/// about (19, 19, 19) on (251, 251, 251), some 17:1), while every other text of the same size and colour passed. Both
/// numbers are printed for every such report; grey text (the system's secondary grey is about 3.5:1) is not allowed.
final class LabAccessibilityAuditTests: XCTestCase {
    /// The contrast WCAG asks of text at AAA, which a reported text's own pixels must reach to be allowed.
    static let measuredContrastFloor = 7.0

    @available(macOS 14.0, *)
    static func allowed(_ issue: XCUIAccessibilityAuditIssue) -> String? {
        if let why = AccessibilityAuditTests.allowed(issue) { return why }
        guard issue.auditType == .contrast, let element = issue.element, element.exists,
              element.elementType == .staticText,
              let m = MeasuredContrast.of(element) else { return nil }
        let summary = String(format: "%.1f:1 (glyphs %@ on %@)", m.ratio, m.glyphs, m.background)
        print("AUDIT macos contrast report on “\(UITestSupport.text(element.value).prefix(60))”: its pixels measure \(summary)")
        guard m.ratio >= measuredContrastFloor else { return nil }
        return "its own pixels measure \(summary), above WCAG's 7:1"
    }

    @MainActor
    func testTheLabScreensPassTheAudit() throws {
        guard #available(macOS 14.0, *) else { throw XCTSkip("performAccessibilityAudit needs macOS 14 or later") }
        continueAfterFailure = true
        let relay = ProcessInfo.processInfo.environment["DLS_LAB_RELAY"].flatMap { $0.isEmpty ? nil : $0 }
        for comfort in [false, true] {
            let suffix = comfort ? " (Comfort)" : ""
            let shot = comfort ? "-comfort" : ""
            let app = LabUI.launch(lab: true, paired: true, relay: relay, comfort: comfort)
            let sheet = LabUI.openSettings(app, paired: true)
            UITestSupport.screenshot(app, "mac-lab-settings\(shot)", in: self)
            try UITestSupport.audit(app, "settings, Lab on" + suffix, allowed: Self.allowed)

            LabUI.open(LabUI.whatsInLabID, in: sheet)
            try LabUI.waitForOverview(in: sheet)
            UITestSupport.screenshot(app, "mac-lab-whats-in-lab\(shot)", in: self)
            try UITestSupport.audit(app, "what's in lab" + suffix, allowed: Self.allowed)
            LabUI.element(LabUI.featureID("F37"), in: sheet).click()
            XCTAssertTrue(LabUI.element(LabUI.noteID, in: sheet).waitForExistence(timeout: 10), "no note after a tap")
            Thread.sleep(forTimeInterval: 6) // past "Checking…", to the gate's answer
            UITestSupport.screenshot(app, "mac-lab-whats-in-lab-note\(shot)", in: self)
            try UITestSupport.audit(app, "what's in lab, a note" + suffix, allowed: Self.allowed)

            LabUI.goBack(in: sheet, leaving: LabUI.featureID("F37"))
            LabUI.open(LabUI.serverRowID, in: sheet)
            XCTAssertTrue(LabUI.element(LabUI.serverCodeID, in: sheet).waitForExistence(timeout: 15), "the server section did not load")
            Thread.sleep(forTimeInterval: 2) // the section's rows have settled in place
            UITestSupport.screenshot(app, "mac-lab-server\(shot)", in: self)
            try UITestSupport.audit(app, "daylight server" + suffix, allowed: Self.allowed)
            app.terminate()
        }
    }
}

/// A text's contrast as its own pixels show it (`XCUIElement.screenshot()`): WCAG's ratio between its glyphs (the
/// darkest 2% of its pixels) and its background (its median pixel), from sRGB relative luminance. For dark text on a
/// light background; light text on a dark one is measured the other way round (the lightest 2%), and the larger ratio
/// counts. nil for an element not wholly inside the window (the audit measures hidden text where it is laid out).
enum MeasuredContrast {
    struct Result {
        let ratio: Double
        let glyphs: String
        let background: String
    }

    struct Pixel {
        let lum: Double
        let r: Int, g: Int, b: Int
        var rgb: String { "(\(r), \(g), \(b))" }
    }

    static func of(_ element: XCUIElement) -> Result? {
        let window = XCUIApplication().windows.firstMatch.frame
        guard element.frame.width >= 4, element.frame.height >= 4,
              window.insetBy(dx: -1, dy: -1).contains(element.frame),
              let tiff = element.screenshot().image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        var pixels: [Pixel] = []
        pixels.reserveCapacity(rep.pixelsWide * rep.pixelsHigh)
        for y in 0..<rep.pixelsHigh {
            for x in 0..<rep.pixelsWide {
                guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
                let r = c.redComponent, g = c.greenComponent, b = c.blueComponent
                pixels.append(Pixel(lum: luminance(r, g, b), r: Int(r * 255), g: Int(g * 255), b: Int(b * 255)))
            }
        }
        guard pixels.count >= 50 else { return nil }
        pixels.sort { $0.lum < $1.lum }
        let edge = pixels.count / 50
        let background = pixels[pixels.count / 2]
        let dark = pixels[edge], light = pixels[pixels.count - 1 - edge]
        let darkOnLight = (background.lum + 0.05) / (dark.lum + 0.05)
        let lightOnDark = (light.lum + 0.05) / (background.lum + 0.05)
        return darkOnLight >= lightOnDark
            ? Result(ratio: darkOnLight, glyphs: dark.rgb, background: background.rgb)
            : Result(ratio: lightOnDark, glyphs: light.rgb, background: background.rgb)
    }

    /// WCAG 2's relative luminance of an sRGB colour (components 0...1).
    static func luminance(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> Double {
        func channel(_ c: CGFloat) -> Double {
            let v = Double(c)
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
}
