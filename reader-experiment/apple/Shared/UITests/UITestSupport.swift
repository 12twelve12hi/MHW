import Foundation
import XCTest
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Shared by the iPhone and Mac UI tests (apple/iOS/UITests, apple/macOS/UITests): launching the app on its own empty
// storage (or with the sample history), the accessibility tree walk and the Lab-off baselines (LAB-PLAN 1.7, F00.2),
// scrolling the history, the audits (F27.2) and screenshots.

/// One element of the accessibility tree, as the Lab-off parity test compares it: its type, label and value.
struct AXNode: Codable, Equatable, CustomStringConvertible {
    var type: String
    var label: String
    var value: String

    var description: String { "\(type) “\(label)”\(value.isEmpty ? "" : " = “\(value)”")" }
}

/// A screen's recorded tree (`…/lab-off-baseline/<screen>.json`).
struct AXBaseline: Codable, Equatable {
    var platform: String
    var screen: String
    var nodes: [AXNode]
}

/// One element as the walk reads it, before anything is left out: from an `XCUIElementSnapshot`, or built by hand
/// (`TreeWalkTests`).
struct AXRaw {
    var type: XCUIElement.ElementType
    var identifier: String
    var label: String
    var value: String
    var children: [AXRaw]

    init(_ type: XCUIElement.ElementType, id identifier: String = "", label: String = "", value: String = "",
         _ children: [AXRaw] = []) {
        self.type = type
        self.identifier = identifier
        self.label = label
        self.value = value
        self.children = children
    }

    @MainActor
    init(_ s: XCUIElementSnapshot) {
        type = s.elementType
        identifier = s.identifier
        // What VoiceOver reads first: the label, or the title where an element has only that (menu items, windows).
        label = s.label.isEmpty ? s.title : s.label
        value = AXTree.text(s.value)
        children = s.children.map { AXRaw($0) }
    }
}

/// What a walk found: the compared nodes, and apart from them what Lab off keeps (LAB-PLAN 1.1).
struct AXWalk: Equatable {
    /// Every kept element in order, without the Lab switch row (and its words, when there is a Lab switch).
    var nodes: [AXNode] = []
    /// Each element with the Lab switch's identifier (`AXTree.labSwitchID`), with everything inside it.
    var labRows: [[AXNode]] = []
    /// Texts outside those rows with exactly the Lab switch's words ("Lab" in any case, or its footer): its label shown
    /// as a text of its own, a section header, the footer. Left out of `nodes` only when there is a Lab switch.
    var labTexts: [AXNode] = []
}

/// The tree walk of LAB-PLAN 1.7 (element type, label and value, in order; never `debugDescription`, whose format
/// changes between Xcode releases) and the Lab-off rules of 1.1. Pure functions: `TreeWalkTests` checks them on trees
/// built by hand.
enum AXTree {
    /// The Lab switch's accessibility identifier (LAB-PLAN 1.1; Android's test tag "lab-switch"): the one row Lab off
    /// keeps. Put it on the Lab `Toggle` itself and on nothing else: the walk leaves that element out with everything
    /// inside it, and checks that it holds only the switch, off (`labOffProblems`). What's in Lab and Daylight server
    /// are rows of their own, outside it, so a bug that shows them with Lab off changes the compared tree.
    static let labSwitchID = "lab-switch"
    /// LAB_TEXT.lab and LAB_TEXT.switchFooter (share/js/daylight-lab.js; `TreeWalkTests` checks them against
    /// share/vectors/lab-vectors.json).
    static let labTitle = "Lab"
    static let labFooter = "New features we’re trying out. Turn Lab off for the plain app; nothing you sent is lost."

    /// The accessibility identifier of a history row's age (`HistoryRowView.timeID` in DaylightShareUI): its words
    /// ("2 days, 3 hr", "12 sec") count on by themselves, so the walk writes them as `when`, as Android's walk does.
    static let rowTimeID = "history-row-time"
    /// The identifier of a history row's words as one element on the iPhone (`HistoryRowView.rowID`): its value is the
    /// row's age, written as `when` too.
    static let rowID = "history-row"
    static let when = "<when>"

    /// The element type's name in the baselines: `XCUIElement.ElementType`'s case name, by raw value
    /// (XCUIElementTypes.h, 0 `any` … 82 `statusItem`; `TreeWalkTests` checks a few against the cases).
    static let typeNames: [String] = [
        "any", "other", "application", "group", "window", "sheet", "drawer", "alert", "dialog", "button",
        "radioButton", "radioGroup", "checkBox", "disclosureTriangle", "popUpButton", "comboBox", "menuButton",
        "toolbarButton", "popover", "keyboard", "key", "navigationBar", "tabBar", "tabGroup", "toolbar", "statusBar",
        "table", "tableRow", "tableColumn", "outline", "outlineRow", "browser", "collectionView", "slider",
        "pageIndicator", "progressIndicator", "activityIndicator", "segmentedControl", "picker", "pickerWheel",
        "switch", "toggle", "link", "image", "icon", "searchField", "scrollView", "scrollBar", "staticText",
        "textField", "secureTextField", "datePicker", "textView", "menu", "menuItem", "menuBar", "menuBarItem",
        "map", "webView", "incrementArrow", "decrementArrow", "timeline", "ratingIndicator", "valueIndicator",
        "splitGroup", "splitter", "relevanceIndicator", "colorWell", "helpTag", "matte", "dockItem", "ruler",
        "rulerMarker", "grid", "levelIndicator", "cell", "layoutArea", "layoutItem", "handle", "stepper", "tab",
        "touchBar", "statusItem",
    ]

    static func typeName(_ type: XCUIElement.ElementType) -> String {
        let raw = Int(type.rawValue)
        return raw < typeNames.count ? typeNames[raw] : "type\(raw)"
    }

    /// Controls recorded even without a label or value (an unlabelled control is exactly what the walk should show).
    /// Every other element is recorded when it has a label (or a title) or a value, whatever its type: only
    /// containers with no words of their own are left out (their nesting changes with the OS, not with the app).
    static let alwaysKept: Set<XCUIElement.ElementType> = [
        .button, .textField, .secureTextField, .switch, .toggle, .checkBox, .radioButton, .link, .searchField,
        .textView, .menuButton, .popUpButton, .slider, .stepper, .comboBox, .disclosureTriangle, .toolbarButton,
        .segmentedControl, .picker, .datePicker, .colorWell, .incrementArrow, .decrementArrow, .tab,
    ]

    /// The system's scroll bars (the Mac's, and the iPhone's scroll indicators, which read "Vertical scroll bar,
    /// 2 pages"): left out with what is inside them. Their value is only the scroll position.
    static func isScrollChrome(_ e: AXRaw) -> Bool {
        e.type == .scrollBar || e.label.hasPrefix("Vertical scroll bar") || e.label.hasPrefix("Horizontal scroll bar")
    }

    /// What changes with the build or the machine, not with the screen (LAB-PLAN 1.7), in fixed words: the app's
    /// version ("1.1.0" in the Version row) becomes "<version>" (dotted numbers that are part of something longer, such
    /// as 127.0.0.1, stay as they are), and the Mac's "Safari extension, On|Off|Unknown" row, which says what Safari
    /// answers on that runner, becomes "Safari extension, <Safari's answer>".
    static func normalised(_ s: String) -> String {
        s.replacingOccurrences(of: #"(?<![0-9.])[0-9]+\.[0-9]+\.[0-9]+(?![0-9.])"#, with: "<version>",
                               options: .regularExpression)
            .replacingOccurrences(of: #"^Safari extension, (On|Off|Unknown)$"#, with: "Safari extension, <Safari's answer>",
                                  options: .regularExpression)
    }

    static func text(_ value: Any?) -> String {
        switch value {
        case let s as String: return s
        case let n as NSNumber: return n.stringValue
        default: return ""
        }
    }

    static func node(_ e: AXRaw) -> AXNode? {
        var label = normalised(e.label)
        var value = normalised(e.value)
        if e.identifier == rowTimeID {
            if !label.isEmpty { label = when }
            if !value.isEmpty { value = when }
        }
        if e.identifier == rowID && !value.isEmpty { value = when }
        guard !label.isEmpty || !value.isEmpty || alwaysKept.contains(e.type) else { return nil }
        return AXNode(type: typeName(e.type), label: label, value: value)
    }

    /// The walk of a tree, in order. The Lab switch's element (`labSwitchID`) goes into `labRows` with everything
    /// inside it; texts with exactly its words go into `labTexts` when there is a Lab switch (else they are compared
    /// like any other text); everything else that is kept goes into `nodes`.
    static func walk(_ root: AXRaw) -> AXWalk {
        var entries: [(node: AXNode, labWords: Bool)] = []
        var rows: [[AXNode]] = []
        func all(_ e: AXRaw, into out: inout [AXNode]) {
            if isScrollChrome(e) { return }
            if let n = node(e) { out.append(n) }
            for child in e.children { all(child, into: &out) }
        }
        func visit(_ e: AXRaw) {
            if isScrollChrome(e) { return }
            if e.identifier == labSwitchID {
                var row: [AXNode] = []
                all(e, into: &row)
                rows.append(row)
                return
            }
            if let n = node(e) { entries.append((node: n, labWords: isLabWords(n))) }
            for child in e.children { visit(child) }
        }
        visit(root)
        var out = AXWalk()
        out.labRows = rows
        for entry in entries {
            if entry.labWords && !rows.isEmpty { out.labTexts.append(entry.node) } else { out.nodes.append(entry.node) }
        }
        return out
    }

    /// The Lab switch's footer, as a text.
    static func isLabFooter(_ n: AXNode) -> Bool {
        n.type == "staticText" && (n.label == labFooter || n.value == labFooter)
    }

    /// A text with exactly the Lab switch's words: "Lab" in any case (its label, a section header "LAB") or its footer.
    static func isLabWords(_ n: AXNode) -> Bool {
        guard n.type == "staticText" else { return false }
        return isLabFooter(n) || [n.label, n.value].contains { $0.caseInsensitiveCompare(labTitle) == .orderedSame }
    }

    /// LAB-PLAN 1.1, with Lab off: a screen shows at most one Lab switch row, and only where the switch lives
    /// (`allowed`: Settings, and the share card's own settings). The row holds one switch named "Lab", off, and nothing
    /// else but its words (and the system's unnamed switch inside it, off too); outside it, its words show at most
    /// twice (a label, a header) and its footer once. -> what is wrong, one line each; nothing when there is no Lab
    /// switch at all, as in a build without Lab.
    static func labOffProblems(_ walk: AXWalk, allowed: Bool) -> [String] {
        guard !walk.labRows.isEmpty else { return [] }
        var out: [String] = []
        if !allowed { out.append("a Lab switch (\(labSwitchID)) on a screen that has none") }
        if walk.labRows.count != 1 { out.append("\(walk.labRows.count) Lab switch rows, not one") }
        for row in walk.labRows {
            let named = row.filter { $0.type == "switch" && $0.label == labTitle }
            if named.count != 1 { out.append("the Lab switch row holds \(named.count) switches named “\(labTitle)”, not one") }
            for s in row where s.type == "switch" && (s.label == labTitle || s.label.isEmpty) && s.value != "0" {
                out.append("the Lab switch is not off: \(s)")
            }
            for n in row where !(n.type == "switch" && (n.label == labTitle || n.label.isEmpty)) && !isLabWords(n) {
                out.append("shown with Lab off: \(n)")
            }
        }
        let footers = walk.labTexts.filter(isLabFooter).count
        let titles = walk.labTexts.count - footers
        if titles > 2 { out.append("“\(labTitle)” shows \(titles) times outside the Lab switch") }
        if footers > 1 { out.append("the Lab switch's footer shows \(footers) times") }
        return out
    }
}

@MainActor
enum UITestSupport {
    #if os(macOS)
    static let platform = "macos"
    #else
    static let platform = "ios"
    #endif

    /// The pairing the UI tests use: the vectors' first secret, a relay nothing listens on (nothing leaves the
    /// machine, and nothing arrives), and a fixed name, so every screen reads the same on every run.
    static let pairingLink = "daylightshare://pair?c=E4AY56TMADQP5QSNMY7BCGPZUFRA&r=http%3A%2F%2F127.0.0.1%3A9&n=Test%20Daylight"

    /// The vectors' first pairing code, typed on the pairing screen.
    static let pairingCode = "E4AY56TMADQP5QSNMY7BCGPZUFRA"

    /// The pairing screen's code field (`PairingForm.fieldTitle`).
    static let pairingField = "Pairing code, e.g. ABCD-EFGH-…"

    /// The share card's samples (`ShareCardSample` in DaylightShareUI), shown by `-DLSShareCard <name>` in a Debug
    /// build of the app instead of its window.
    static let shareCards = ["reading", "sent", "sent-note", "result-note", "needs-pairing", "confirm-pairing"]

    /// The share card's sample that keeps its own storage (no App Group) and so shows the card's own settings: on the
    /// Mac, the only card where a Lab switch may show (the ad-hoc build's Share menu item, LAB-PLAN 1.1). The iPhone's
    /// share sheet follows the app's switch and never shows one.
    static let cardWithItsOwnSettings = "needs-pairing"

    /// The sample history's first row's label and last row's sentence (`HistorySample` in DaylightShareUI, shown with
    /// `-DLSSampleHistory`; newest first).
    static let historyFirst = "Sending…"
    static let historyLast = "Your Daylight didn’t pick this up within a week. Is it on and online?"
    /// The buttons of the sample history's second row ("Waiting to send") and of its last ("Not delivered" within a
    /// week): the history is there, and it is scrolled to its end. Buttons, because on the iPhone a row's words are one
    /// element (`HistoryRowView.spokenLabel`).
    static let historySecondButton = "Retry now"
    static let historyLastButton = "Try again"

    /// Starts the app on fresh, empty storage of its own (`-DLSTestStorage`), with Lab off (`-DLSLab 0`, for the Lab
    /// builds) and Comfort as given (nil: not set, so the app's default), paired with `pairingLink` or not, and with
    /// `history` the sample history: a row in every state (`-DLSSampleHistory`, Debug builds).
    static func launch(paired: Bool, comfort: Bool? = false, history: Bool = false,
                       extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-DLSTestStorage", "-DLSLab", "0"]
        if let comfort { arguments += ["-DLSComfort", comfort ? "1" : "0"] }
        if paired { arguments += ["-DLSPairLink", pairingLink] }
        if history { arguments += ["-DLSSampleHistory"] }
        app.launchArguments = arguments + extra
        app.launch()
        waitUntilReadable(app)
        return app
    }

    /// Waits until the app answers accessibility queries. Right after the simulator starts, its accessibility server
    /// can take a while ("kAXErrorServerNotFound"), and the first query of a test then fails. This tries a snapshot
    /// every second for up to `timeout` seconds and launches the app once more half way; it does not re-run anything a
    /// test checks.
    static func waitUntilReadable(_ app: XCUIApplication, timeout: TimeInterval = 60) {
        _ = app.wait(for: .runningForeground, timeout: 30)
        let start = Date()
        var relaunched = false
        while Date().timeIntervalSince(start) < timeout {
            if (try? app.snapshot()) != nil { return }
            if !relaunched && Date().timeIntervalSince(start) > timeout / 2 {
                relaunched = true
                print("UI test: the app's accessibility has not answered for \(Int(timeout / 2)) s; launching it again")
                app.terminate()
                app.launch()
                _ = app.wait(for: .runningForeground, timeout: 30)
            }
            Thread.sleep(forTimeInterval: 1)
        }
        print("UI test: the app's accessibility still does not answer after \(Int(timeout)) s")
    }

    /// The app showing the share card's sample `name` (`-DLSShareCard`), unpaired, Comfort off.
    static func launchShareCard(_ name: String, comfort: Bool = false) -> XCUIApplication {
        launch(paired: false, comfort: comfort, extra: ["-DLSShareCard", name])
    }

    nonisolated static func text(_ value: Any?) -> String { AXTree.text(value) }

    // MARK: The sample history

    /// A text with these words, as its label (iPhone) or its value (Mac).
    static func staticText(_ words: String, in root: XCUIElement) -> XCUIElement {
        root.staticTexts.matching(NSPredicate(format: "label == %@ OR value == %@", words, words)).firstMatch
    }

    /// Waits until the sample history shows (its second row's button).
    static func waitForHistory(_ app: XCUIApplication, timeout: TimeInterval = 30) -> Bool {
        app.buttons[historySecondButton].waitForExistence(timeout: timeout)
    }

    /// The sample history's last row's button ("Try again"): hittable once the history is scrolled to its end.
    static func historyEnd(in root: XCUIElement) -> XCUIElement {
        root.buttons[historyLastButton]
    }

    /// Where each text and button is (its words and its top edge; a row's age by its identifier, since its words count
    /// on), to tell whether a scroll moved anything.
    static func positions(_ app: XCUIApplication) throws -> [String] {
        var out: [String] = []
        func visit(_ s: XCUIElementSnapshot) {
            if s.elementType == .staticText || s.elementType == .button || s.identifier == AXTree.rowID {
                let words = s.identifier == AXTree.rowTimeID ? AXTree.rowTimeID : (s.label.isEmpty ? AXTree.text(s.value) : s.label)
                out.append("\(words)@\(Int(s.frame.minY.rounded()))")
            }
            for child in s.children { visit(child) }
        }
        visit(try app.snapshot())
        return out
    }

    #if os(macOS)
    /// Which way a scroll event moves the history: it depends on the Mac's scrolling setting, so `scrollHistory` tries
    /// one way and turns round when nothing moved.
    static var scrollSign: CGFloat = -1
    #endif

    /// Scrolls the history one step towards its end, without momentum: on the iPhone a drag over half the screen, by
    /// the left margin where no control is, held still before it lets go; on the Mac a scroll of the History list.
    static func scrollStep(_ app: XCUIApplication) {
        #if os(macOS)
        app.windows.firstMatch.outlines.firstMatch.scroll(byDeltaX: 0, deltaY: scrollSign * 120)
        #else
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.8))
        let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.3))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .default, thenHoldForDuration: 0.5)
        #endif
    }

    /// Scrolls the history step by step to its end, calling `atEachStep` with the step's number after each step that
    /// moved: until a step moves nothing, or one step after the last row's button (`historyEnd`) can be hit. The
    /// iPhone's list holds only the rows on screen, so the walks and audits see the history at its top and at its end,
    /// and the audits at every step between. -> the steps that moved.
    @discardableResult
    static func scrollHistory(_ app: XCUIApplication, atEachStep: (Int) throws -> Void = { _ in }) throws -> Int {
        var last = try positions(app)
        var steps = 0
        var pastEnd = false
        #if os(macOS)
        var turned = false
        #endif
        for _ in 0..<80 {
            scrollStep(app)
            Thread.sleep(forTimeInterval: 1)
            let now = try positions(app)
            if now == last {
                #if os(macOS)
                if steps == 0 && !turned {
                    turned = true
                    scrollSign = -scrollSign
                    continue
                }
                #endif
                break
            }
            last = now
            steps += 1
            try atEachStep(steps)
            if pastEnd { break }
            pastEnd = historyEnd(in: app).isHittable
        }
        print("UI test: the history scrolled to its end in \(steps) steps")
        return steps
    }

    #if os(macOS)
    /// The Mac's History list: the outline, and the part of it its scroll view shows (the outline keeps every row in
    /// the accessibility tree, also the rows scrolled out of view). nil when the main window has none.
    nonisolated static func historyList() -> (outline: XCUIElement, visible: CGRect)? {
        let window = XCUIApplication().windows.firstMatch
        let scroll = window.scrollViews.containing(.outline, identifier: nil).firstMatch
        guard scroll.exists else { return nil }
        let outline = scroll.outlines.firstMatch
        guard outline.exists else { return nil }
        return (outline, scroll.frame)
    }
    #endif

    /// Scrolls the history to its very end (where the walk's tree is the same every time) and checks that its last row
    /// shows.
    static func scrollHistoryToEnd(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) throws {
        try scrollHistory(app)
        #if os(iOS)
        // To the bottom of the list, wherever the last step stopped: flicks past the end come back to the same place.
        app.swipeUp()
        app.swipeUp()
        Thread.sleep(forTimeInterval: 2)
        #endif
        XCTAssertTrue(historyEnd(in: app).isHittable, "the history's last row is not there at its end",
                      file: file, line: line)
    }

    // MARK: The tree walk (LAB-PLAN 1.7)

    /// An explicit walk of the element tree under `root` (`AXTree.walk`).
    static func walk(_ root: XCUIElement) throws -> AXWalk {
        AXTree.walk(AXRaw(try root.snapshot()))
    }

    /// Walks until two walks half a second apart agree (at most `timeout` seconds), so a screen still settling (an
    /// answer arriving, a sheet sliding in) is not recorded half way.
    static func stableWalk(_ root: XCUIElement, timeout: TimeInterval = 15) throws -> AXWalk {
        var last = try walk(root)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            Thread.sleep(forTimeInterval: 0.5)
            let next = try walk(root)
            if next == last { return next }
            last = next
        }
        return last
    }

    // MARK: Lab-off baselines (F00.2)

    /// `<folder of the calling test file>/lab-off-baseline/<screen>.json`. The tests read it straight from the source
    /// tree (the simulator and the Mac test runner can), so nothing needs to be bundled.
    static func baselineURL(_ screen: String, file: StaticString) -> URL {
        URL(fileURLWithPath: "\(file)").deletingLastPathComponent()
            .appendingPathComponent("lab-off-baseline", isDirectory: true)
            .appendingPathComponent("\(screen).json")
    }

    static func json(_ baseline: AXBaseline) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = (try? encoder.encode(baseline)) ?? Data()
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    /// Prints the tree between markers (and writes it to $DLS_BASELINE_OUT when set), so a missing or deliberately
    /// changed baseline can be copied from the CI log into `lab-off-baseline/`.
    static func emit(_ baseline: AXBaseline) {
        let text = json(baseline)
        let name = "\(baseline.platform)-\(baseline.screen).json"
        print("=====BEGIN lab-off-baseline \(name)=====")
        print(text, terminator: "")
        print("=====END lab-off-baseline \(name)=====")
        if let dir = ProcessInfo.processInfo.environment["DLS_BASELINE_OUT"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir, isDirectory: true)
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            try? Data(text.utf8).write(to: url.appendingPathComponent(name))
        }
    }

    /// Compares `root`'s tree with the screen's baseline, after checking the Lab rule of LAB-PLAN 1.1 (`labSwitch`:
    /// whether the screen is where the Lab switch lives; with Lab off only its row may show, off). Without a baseline
    /// (record mode) it prints the tree and fails, so it cannot pass unnoticed; on a difference it prints the new tree
    /// and the first differences.
    static func checkBaseline(_ root: XCUIElement, screen: String, labSwitch: Bool = false, file: StaticString = #filePath,
                              line: UInt = #line) throws {
        let walk = try stableWalk(root)
        for problem in AXTree.labOffProblems(walk, allowed: labSwitch) {
            XCTFail("\(platform) \(screen), with Lab off (LAB-PLAN 1.1): \(problem)", file: file, line: line)
        }
        let nodes = walk.nodes
        let current = AXBaseline(platform: platform, screen: screen, nodes: nodes)
        let url = baselineURL(screen, file: file)
        guard let data = try? Data(contentsOf: url) else {
            emit(current)
            XCTFail("No Lab-off baseline for \(platform) \(screen) at \(url.path): the tree is in the log between the "
                    + "lab-off-baseline markers; commit it there.", file: file, line: line)
            return
        }
        guard let saved = try? JSONDecoder().decode(AXBaseline.self, from: data) else {
            XCTFail("Unreadable Lab-off baseline \(url.path)", file: file, line: line)
            return
        }
        guard saved.nodes != nodes else { return }
        emit(current)
        var lines: [String] = []
        for i in 0..<max(saved.nodes.count, nodes.count) where lines.count < 12 {
            let a = i < saved.nodes.count ? saved.nodes[i].description : "(nothing)"
            let b = i < nodes.count ? nodes[i].description : "(nothing)"
            if a != b { lines.append("  #\(i): baseline \(a) | now \(b)") }
        }
        XCTFail("The \(platform) \(screen) screen's tree differs from its Lab-off baseline (\(saved.nodes.count) → "
                + "\(nodes.count) elements):\n" + lines.joined(separator: "\n"), file: file, line: line)
    }

    // MARK: Screenshots

    /// Attaches a screenshot to the test and writes it to $DLS_SHOTS (CI uploads them for review; never compared).
    static func screenshot(_ app: XCUIApplication, _ name: String, in test: XCTestCase) {
        #if os(macOS)
        let window = app.windows.firstMatch
        let shot = window.exists ? window.screenshot() : XCUIScreen.main.screenshot()
        #else
        let shot = XCUIScreen.main.screenshot()
        #endif
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        test.add(attachment)
        if let dir = ProcessInfo.processInfo.environment["DLS_SHOTS"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir, isDirectory: true)
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
        }
    }

    // MARK: Audits (F27.2)

    /// Audits the screen with the sample history at its top, then after every step of scrolling it to its end
    /// (`scrollHistory`), so every row is audited where it shows.
    @available(iOS 17.0, macOS 14.0, *)
    static func auditHistory(_ app: XCUIApplication, _ screen: String, types: XCUIAccessibilityAuditType = .all,
                             allowed: @escaping (XCUIAccessibilityAuditIssue) -> String? = { _ in nil }) throws {
        try audit(app, screen, types: types, allowed: allowed)
        try scrollHistory(app) { step in
            try audit(app, "\(screen), scrolled \(step)", types: types, allowed: allowed)
        }
        XCTAssertTrue(historyEnd(in: app).isHittable, "\(screen): the history's last row was not reached")
    }

    /// Runs Xcode's accessibility audit on what the app shows. Every issue is printed; an issue is ignored only when
    /// `allowed` names why (an element the app does not draw), and anything else fails the test.
    ///
    /// An audit that the system stops before it finishes ("Audit failed to complete in time", which a simulator that
    /// has just started can do on the first audit) found nothing either way: it is run again, at most twice, and said
    /// so in the log. Issues are never run again; any error but that one fails the test.
    @available(iOS 17.0, macOS 14.0, *)
    static func audit(_ app: XCUIApplication, _ screen: String, types: XCUIAccessibilityAuditType = .all,
                      allowed: @escaping (XCUIAccessibilityAuditIssue) -> String? = { _ in nil }) throws {
        #if os(macOS)
        // Where the History list shows its rows, to place the issues on its texts (diagnostics only).
        if let list = historyList() {
            let f = list.visible
            print("AUDIT \(platform) \(screen): the History list shows \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))×\(Int(f.height))")
        }
        #endif
        var attempt = 1
        while true {
            var failed = false
            do {
                defer { if failed { printShot(app, "audit \(screen)") } }
                try app.performAccessibilityAudit(for: types) { issue in
                    let description = describe(issue)
                    if let why = allowed(issue) {
                        print("AUDIT \(platform) \(screen) allowed (\(why)): \(description)")
                        return true
                    }
                    print("AUDIT \(platform) \(screen) issue: \(description)")
                    failed = true
                    return false
                }
                return
            } catch let error as NSError where isAuditTimeout(error) && attempt < 3 {
                print("AUDIT \(platform) \(screen): the audit did not finish in time (attempt \(attempt)); running it again")
                attempt += 1
                Thread.sleep(forTimeInterval: 5)
            }
        }
    }

    /// XCTest's "Audit failed to complete in time" (com.apple.xcode.xctest.accessibilityAudit, code -56).
    nonisolated static func isAuditTimeout(_ error: NSError) -> Bool {
        error.domain == "com.apple.xcode.xctest.accessibilityAudit" && error.code == -56
    }

    /// The screenshots `printShot` has printed so far (at most `maxPrintedShots` a run).
    static var printedShots = 0
    static let maxPrintedShots = 6

    /// Prints a screenshot of what the app shows into the log, as a JPEG at 1× between `=====BEGIN shot <name>=====`
    /// and `=====END shot=====` (ci-test-summary.sh passes them on): the screenshots attached to the result bundle
    /// cannot be read from the job log. Diagnostics only, for an audit that failed; at most `maxPrintedShots` a run.
    static func printShot(_ app: XCUIApplication, _ name: String) {
        guard printedShots < maxPrintedShots else { return }
        printedShots += 1
        #if os(macOS)
        let window = app.windows.firstMatch
        let image = (window.exists ? window.screenshot() : XCUIScreen.main.screenshot()).image
        let size = image.size
        guard size.width > 0, size.height > 0,
              let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6]) else { return }
        #else
        let image = XCUIScreen.main.screenshot().image
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
        guard let data = small.jpegData(compressionQuality: 0.6) else { return }
        #endif
        print("=====BEGIN shot \(platform) \(name)=====")
        print(data.base64EncodedString())
        print("=====END shot=====")
    }

    @available(iOS 17.0, macOS 14.0, *)
    static func describe(_ issue: XCUIAccessibilityAuditIssue) -> String {
        var element = "no element"
        if let e = issue.element, !e.exists {
            // What it was, as far as the audit's reference tells without finding it again (diagnostics only).
            element = "an element no longer there (\(String(describing: e).prefix(300)))"
        }
        if let e = issue.element, e.exists {
            let value = text(e.value)
            element = "\(AXTree.typeName(e.elementType)) “\(e.label)”"
                + (value.isEmpty ? "" : " = “\(value.prefix(80))”")
                + (e.identifier.isEmpty ? "" : " id \(e.identifier)")
                + " at \(Int(e.frame.minX)),\(Int(e.frame.minY)) \(Int(e.frame.width))×\(Int(e.frame.height))"
            // An element without words: say what it holds, to tell which view it is (diagnostics only).
            if e.label.isEmpty && value.isEmpty {
                let tree = e.debugDescription.split(separator: "\n").prefix(8).joined(separator: " | ")
                element += " [\(tree.prefix(600))]"
            }
        }
        return "[\(names(issue.auditType))] \(issue.compactDescription) — \(element) — \(issue.detailedDescription)"
    }

    @available(iOS 17.0, macOS 14.0, *)
    static func names(_ type: XCUIAccessibilityAuditType) -> String {
        var out: [String] = []
        if type.contains(.contrast) { out.append("contrast") }
        if type.contains(.elementDetection) { out.append("elementDetection") }
        if type.contains(.hitRegion) { out.append("hitRegion") }
        if type.contains(.sufficientElementDescription) { out.append("sufficientElementDescription") }
        #if os(iOS)
        if type.contains(.dynamicType) { out.append("dynamicType") }
        if type.contains(.textClipped) { out.append("textClipped") }
        if type.contains(.trait) { out.append("trait") }
        #else
        if type.contains(.action) { out.append("action") }
        if type.contains(.parentChild) { out.append("parentChild") }
        #endif
        return out.isEmpty ? "\(type.rawValue)" : out.joined(separator: ",")
    }
}
