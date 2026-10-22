import Foundation
import XCTest

/// The iPhone's Lab UI tests' own support (LAB-PLAN 1.7, F00, F17.2): launching with Lab as a fresh install has it,
/// on a relay of the test's choice; the Lab screens' identifiers (`LabIDs` in DaylightShareUI) and words
/// (`share/vectors/lab-vectors.json` › labText, `server/vectors/server-vectors.json`); the announcements the app made
/// (`-DLSAnnounceLog`); and the walk of a screen that scrolls.
///
/// CI (rx-apple.yml, ios job) passes the relays through the test runner's environment: `DLS_RELAY`, the mock ntfy relay
/// (it answers, and no Daylight server is on it: needs-server), and `DLS_HANG_RELAY`, which takes connections and never
/// answers. `UITestSupport.pairingLink`'s relay (`offlineRelay`) has nothing listening: no network.
enum LabUI {
    // MARK: Relays

    /// Nothing listens there: every request fails at once, as offline.
    static let offlineRelay = "http://127.0.0.1:9"

    static func environment(_ name: String) throws -> String {
        guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
            throw XCTSkip("\(name) is not set: run these tests as rx-apple.yml does (TEST_RUNNER_\(name))")
        }
        return value
    }

    /// The mock ntfy relay: it answers, and no Daylight server announced itself on it.
    static func onlineRelay() throws -> String { try environment("DLS_RELAY") }

    /// A relay that takes the connection and never answers.
    static func hangingRelay() throws -> String { try environment("DLS_HANG_RELAY") }

    /// `UITestSupport.pairingLink` on another relay: the vectors' first pairing (server-vectors.json's too).
    @MainActor
    static func pairingLink(relay: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let r = relay.addingPercentEncoding(withAllowedCharacters: allowed) ?? relay
        return "daylightshare://pair?c=\(UITestSupport.pairingCode)&r=\(r)&n=Test%20Daylight"
    }

    // MARK: Launching

    /// The app on fresh, empty storage of its own (`-DLSTestStorage`), Comfort off, paired on `relay` (nil: not paired),
    /// with Lab as given (`-DLSLab`; nil: not given, so as a fresh install has it: on), and the sample history when asked.
    @MainActor
    static func launch(relay: String? = LabUI.offlineRelay, lab: Bool? = nil, comfort: Bool = false, history: Bool = false,
                       rows: [Int]? = nil, announceLog: URL? = nil, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-DLSTestStorage", "-DLSComfort", comfort ? "1" : "0"]
        if let lab { arguments += ["-DLSLab", lab ? "1" : "0"] }
        if let relay { arguments += ["-DLSPairLink", pairingLink(relay: relay)] }
        if history {
            arguments += ["-DLSSampleHistory"]
            if let rows { arguments += [rows.map(String.init).joined(separator: ",")] }
        }
        if let announceLog { arguments += ["-DLSAnnounceLog", announceLog.path] }
        app.launchArguments = arguments + extra
        app.launch()
        UITestSupport.waitUntilReadable(app)
        return app
    }

    // MARK: The Lab screens (identifiers: LabIDs in DaylightShareUI)

    static let labSwitch = "lab-switch"
    static let whatsInLab = "lab-whats-in-lab"
    static let serverRow = "lab-server"
    static let note = "lab-note"
    static let serverCode = "lab-server-code"
    static let copyServerCode = "lab-server-copy"
    static func feature(_ id: String) -> String { "lab-feature-\(id)" }

    /// The first element with this identifier, whatever its type.
    @MainActor
    static func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// A text with exactly these words (its label or its value).
    @MainActor
    static func text(_ words: String, in root: XCUIElement) -> XCUIElement {
        UITestSupport.staticText(words, in: root)
    }

    /// Any element whose label contains these words.
    @MainActor
    static func containing(_ words: String, in root: XCUIElement) -> XCUIElement {
        root.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    /// Home's Settings button, then Settings (its Comfort switch shows).
    @MainActor
    static func openSettings(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 30), "Home did not show", file: file, line: line)
        settings.tap()
        XCTAssertTrue(app.switches["comfort"].waitForExistence(timeout: 10), "Settings did not open", file: file, line: line)
    }

    /// From Settings: What's in Lab, once its server group shows `short` (e.g. "Not set up"; nil: do not wait).
    @MainActor
    static func goToWhatsInLab(_ app: XCUIApplication, short: String?, file: StaticString = #filePath, line: UInt = #line) {
        let row = element(whatsInLab, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no “What’s in Lab ›” row", file: file, line: line)
        scrollTo(row, in: app)
        row.tap()
        XCTAssertTrue(app.navigationBars[string("whatsInLab")].waitForExistence(timeout: 10), "What’s in Lab did not open",
                      file: file, line: line)
        if let short {
            XCTAssertTrue(text(short, in: app).waitForExistence(timeout: 15), "What’s in Lab never showed “\(short)”",
                          file: file, line: line)
        }
    }

    /// Home › Settings › What's in Lab (`goToWhatsInLab`).
    @MainActor
    static func openWhatsInLab(_ app: XCUIApplication, short: String?, file: StaticString = #filePath, line: UInt = #line) {
        openSettings(app, file: file, line: line)
        goToWhatsInLab(app, short: short, file: file, line: line)
    }

    /// From Settings: the Daylight server section, once it shows the server's state (no longer "Checking your Daylight
    /// server…"), at its top. Its Server code is further down: `scrollTo` it.
    @MainActor
    static func goToServerSection(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let row = element(serverRow, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no “Daylight server ›” row", file: file, line: line)
        scrollTo(row, in: app)
        row.tap()
        XCTAssertTrue(app.navigationBars[string("serverRow")].waitForExistence(timeout: 10),
                      "the Daylight server section did not open", file: file, line: line)
        let checking = text(string("checking"), in: app)
        _ = checking.waitForExistence(timeout: 2) // shown until the server's state is known (at most 5 s)
        let deadline = Date().addingTimeInterval(15)
        while checking.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.25) }
        XCTAssertFalse(checking.exists, "the Daylight server section never showed the server's state", file: file, line: line)
        Thread.sleep(forTimeInterval: 0.5)
    }

    /// Home › Settings › Daylight server (`goToServerSection`).
    @MainActor
    static func openServerSection(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        openSettings(app, file: file, line: line)
        goToServerSection(app, file: file, line: line)
    }

    /// Back to Settings from the Lab screen titled `title` (its navigation bar's back button; Home's bar, under the
    /// sheet, has a button named Settings too).
    @MainActor
    static func backToSettings(_ app: XCUIApplication, from title: String, file: StaticString = #filePath, line: UInt = #line) {
        let back = app.navigationBars[title].buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10), "no way back to Settings from \(title)", file: file, line: line)
        back.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings did not come back",
                      file: file, line: line)
    }

    /// Settings' Done: back to Home.
    @MainActor
    static func closeSettings(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let done = app.navigationBars["Settings"].buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), "Settings has no Done", file: file, line: line)
        done.tap()
        waitUntil(app.navigationBars["Settings"], exists: false, timeout: 10, file: file, line: line)
    }

    /// Waits until `element` exists or not.
    @MainActor
    static func waitUntil(_ element: XCUIElement, exists: Bool, timeout: TimeInterval, file: StaticString = #filePath,
                            line: UInt = #line) {
        let deadline = Date().addingTimeInterval(timeout)
        while element.exists != exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertEqual(element.exists, exists, "\(element) \(exists ? "never showed" : "did not go")", file: file, line: line)
    }

    /// The Lab switch's own switch, at the row's trailing end (a tap on its words does not turn it).
    @MainActor
    static func flipLab(_ app: XCUIApplication) {
        element(labSwitch, in: app).coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    }

    /// Home's Paste button (the system's, which needs no permission): what it puts in the link field.
    @MainActor
    static func pasteOnHome(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) -> String {
        let paste = app.buttons["Paste"]
        XCTAssertTrue(paste.waitForExistence(timeout: 10), "no Paste button on Home", file: file, line: line)
        paste.tap()
        let field = app.textFields["Paste or type a link"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no link field on Home", file: file, line: line)
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline && AXTree.text(field.value).hasPrefix("Paste or type") {
            Thread.sleep(forTimeInterval: 0.2)
        }
        return AXTree.text(field.value)
    }

    /// Scrolls (a drag by the left margin, held still before letting go) until `element` can be hit, at most `steps`
    /// times. -> whether it can.
    @MainActor @discardableResult
    static func scrollTo(_ element: XCUIElement, in app: XCUIApplication, steps: Int = 8) -> Bool {
        for _ in 0..<steps where !(element.exists && element.isHittable) {
            UITestSupport.scrollStep(app)
            Thread.sleep(forTimeInterval: 0.5)
        }
        return element.exists && element.isHittable
    }

    // MARK: Words (the vectors: every app shows the same)

    static var repo: URL {
        URL(fileURLWithPath: "\(#filePath)") // …/reader-experiment/apple/iOS/UITests/<this file>
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }

    static func json(_ path: String) -> [String: Any] {
        let url = repo.appendingPathComponent(path)
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            XCTFail("could not read \(url.path)")
            return [:]
        }
        return object
    }

    /// LAB_TEXT's strings (share/vectors/lab-vectors.json › labText.strings), by id.
    static let strings: [String: String] = {
        let labText = json("share/vectors/lab-vectors.json")["labText"] as? [String: Any]
        return (labText?["strings"] as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
    }()

    static func string(_ id: String) -> String {
        guard let s = strings[id] else {
            XCTFail("LAB_TEXT has no \(id)")
            return id
        }
        return s
    }

    /// A needs-setup sentence for the iPhone ({app} filled in).
    static func needs(_ state: String) -> String {
        string("needs.\(state)").replacingOccurrences(of: "{app}", with: "Send to Daylight")
    }

    static var serverVectors: [String: Any] { json("server/vectors/server-vectors.json") }

    /// The server module's message for each state it can show (server-vectors.json › serverState: STATE_MESSAGES).
    static let stateMessages: [String: String] = {
        let serverState = (json("server/vectors/server-vectors.json")["serverState"] as? [String: Any]) ?? [:]
        var out: [String: String] = [:]
        for key in ["fromStatus", "fromError"] {
            for case let c as [String: Any] in (serverState[key] as? [Any]) ?? [] {
                guard let expect = c["expect"] as? [String: Any], let state = expect["state"] as? String,
                      let message = expect["message"] as? String, state != "error", state != "ready" else { continue }
                if out[state] == nil { out[state] = message }
            }
        }
        return out
    }()

    /// The start of every sentence that says how to set something up: LAB_TEXT's needs-setup sentences and "Turn on
    /// Lab in …", the server module's state messages, and the deploy's re-run help (as Android's LabKit.setupSentences).
    static let setupSentences: [String] = {
        var all = strings.filter { $0.key.hasPrefix("needs.") || $0.key == "labOff" }.map { $0.value }
        all += stateMessages.values
        all += [rerunHelp]
        var out: [String] = []
        for s in all {
            let head = String(s.prefix { $0 != "{" }.prefix(40)).trimmingCharacters(in: .whitespaces)
            if head.count >= 12 && !out.contains(head) { out.append(head) }
        }
        return out
    }()

    /// The start of RERUN_HELP, the second of the server section's steps ("In GitHub › Actions, open the latest …").
    static var rerunHelp: String {
        let steps = strings["serverSection.steps"] ?? ""
        guard let r = steps.range(of: "In GitHub › Actions") else { return "In GitHub › Actions, open the latest" }
        return String(steps[r.lowerBound...].prefix(40))
    }

    /// A secret's or a variable's name (ANTHROPIC_API_KEY, CLOUDFLARE_ACCOUNT_ID, DAYLIGHT_SERVER_CODE, …).
    static let secretName = try! NSRegularExpression(pattern: "\\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\\b")

    /// Every label, title and value on screen.
    @MainActor
    static func texts(_ app: XCUIApplication) throws -> [String] {
        var out: [String] = []
        func visit(_ s: XCUIElementSnapshot) {
            for t in [s.label, s.title, AXTree.text(s.value)] where !t.isEmpty { out.append(t) }
            for child in s.children { visit(child) }
        }
        visit(try app.snapshot())
        return out
    }

    /// The texts on screen that name a secret or say how to set something up (F00.7).
    static func setupWords(_ texts: [String]) -> [String] {
        texts.filter { t in
            secretName.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil
                || setupSentences.contains { t.contains($0) }
        }
    }

    // MARK: What VoiceOver was told (-DLSAnnounceLog)

    /// A new, empty file for the app's announcements.
    static func announceLog() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("announce-\(UUID().uuidString).log")
        try? FileManager.default.removeItem(at: url)
        return url
    }

    /// The announcements so far, one per line.
    static func announcements(_ url: URL) -> [String] {
        ((try? String(contentsOf: url, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
    }

    /// Waits (at most `timeout` seconds) until `text` was announced.
    static func waitForAnnouncement(_ text: String, in url: URL, timeout: TimeInterval = 5) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if announcements(url).contains(text) { return true }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return announcements(url).contains(text)
    }
}

// MARK: The walk of a screen that scrolls (F00.2)

extension LabUI {
    /// Settings' tree as if the whole form were on one screen: walked at its top, then after each scroll step until
    /// nothing moves, the walks put together in order (`merge`). Settings now starts with the Lab section (LAB-PLAN 1.1),
    /// which can push its last rows (About) below the screen, and the form holds only the rows on screen. With Lab off
    /// the Lab switch row and its words are left out as in `AXTree.walk`, also when a step shows only part of them, and
    /// each step's Lab switch is checked to be off (`AXTree.labOffProblems`).
    @MainActor
    static func scrolledWalk(_ app: XCUIApplication, labSwitch: Bool) throws -> (walk: AXWalk, problems: [String]) {
        let first = try UITestSupport.stableWalk(app)
        var walk = first
        var problems = AXTree.labOffProblems(first, allowed: labSwitch)
        let hasLab = !first.labRows.isEmpty
        var last = try UITestSupport.positions(app)
        var steps = 0
        for _ in 0..<8 {
            UITestSupport.scrollStep(app)
            Thread.sleep(forTimeInterval: 1)
            let now = try UITestSupport.positions(app)
            if now == last { break }
            last = now
            steps += 1
            let next = try UITestSupport.stableWalk(app)
            // A step that shows the Lab switch row (or part of it) again: still one switch named Lab, off.
            if !next.labRows.isEmpty {
                let rows = AXWalk(nodes: [], labRows: next.labRows, labTexts: next.labTexts)
                let seen = problems
                problems += AXTree.labOffProblems(rows, allowed: labSwitch).filter { !seen.contains($0) }
            }
            let nodes = hasLab || !next.labRows.isEmpty ? next.nodes.filter { !AXTree.isLabWords($0) } : next.nodes
            walk.nodes = merge(walk.nodes, nodes)
        }
        print("UI test: Settings scrolled \(steps) steps to its end")
        return (walk, problems)
    }

    /// Two walks of one screen, the second after scrolling: the nodes both start with (the window and the navigation
    /// bar), then the first walk's rows, then the second's after the longest run of rows that ends the first and starts
    /// the second (the rows both showed).
    static func merge(_ a: [AXNode], _ b: [AXNode]) -> [AXNode] {
        var p = 0
        while p < a.count && p < b.count && a[p] == b[p] { p += 1 }
        if p == b.count { return a }
        if p == a.count { return b }
        let restA = Array(a[p...]), restB = Array(b[p...])
        var k = min(restA.count, restB.count)
        while k > 0 && Array(restA.suffix(k)) != Array(restB.prefix(k)) { k -= 1 }
        return a + restB.dropFirst(k)
    }

    /// `UITestSupport.checkBaseline` for a screen that scrolls (`scrolledWalk`): the Lab rule of LAB-PLAN 1.1 at every
    /// step, then the put-together tree against `lab-off-baseline/<screen>.json` next to the calling test file.
    @MainActor
    static func checkScrolledBaseline(_ app: XCUIApplication, screen: String, labSwitch: Bool,
                                      file: StaticString = #filePath, line: UInt = #line) throws {
        let (walk, problems) = try scrolledWalk(app, labSwitch: labSwitch)
        for problem in problems {
            XCTFail("\(UITestSupport.platform) \(screen), with Lab off (LAB-PLAN 1.1): \(problem)", file: file, line: line)
        }
        let nodes = walk.nodes
        let current = AXBaseline(platform: UITestSupport.platform, screen: screen, nodes: nodes)
        let url = UITestSupport.baselineURL(screen, file: file)
        guard let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(AXBaseline.self, from: data) else {
            UITestSupport.emit(current)
            XCTFail("No readable Lab-off baseline for \(UITestSupport.platform) \(screen) at \(url.path)", file: file, line: line)
            return
        }
        guard saved.nodes != nodes else { return }
        UITestSupport.emit(current)
        var lines: [String] = []
        for i in 0..<max(saved.nodes.count, nodes.count) where lines.count < 12 {
            let a = i < saved.nodes.count ? saved.nodes[i].description : "(nothing)"
            let b = i < nodes.count ? nodes[i].description : "(nothing)"
            if a != b { lines.append("  #\(i): baseline \(a) | now \(b)") }
        }
        XCTFail("The \(UITestSupport.platform) \(screen) screen's tree, walked to its end, differs from its Lab-off baseline "
                + "(\(saved.nodes.count) → \(nodes.count) elements):\n" + lines.joined(separator: "\n"), file: file, line: line)
    }
}
