import Foundation
import XCTest

// Shared by the iPhone and Mac UI tests (apple/iOS/UITests, apple/macOS/UITests): launching the app on its own empty
// storage, the accessibility tree walk and the Lab-off baselines (LAB-PLAN 1.7, F00.2), the audits (F27.2) and
// screenshots.

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
        let label = normalised(e.label)
        let value = normalised(e.value)
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

    /// Starts the app on fresh, empty storage of its own (`-DLSTestStorage`), with Lab off (`-DLSLab 0`, for the Lab
    /// builds) and Comfort as given (nil: not set, so the app's default), paired with `pairingLink` or not.
    static func launch(paired: Bool, comfort: Bool? = false, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-DLSTestStorage", "-DLSLab", "0"]
        if let comfort { arguments += ["-DLSComfort", comfort ? "1" : "0"] }
        if paired { arguments += ["-DLSPairLink", pairingLink] }
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

    /// Runs Xcode's accessibility audit on what the app shows. Every issue is printed; an issue is ignored only when
    /// `allowed` names why (an element the app does not draw), and anything else fails the test.
    @available(iOS 17.0, macOS 14.0, *)
    static func audit(_ app: XCUIApplication, _ screen: String, types: XCUIAccessibilityAuditType = .all,
                      allowed: @escaping (XCUIAccessibilityAuditIssue) -> String? = { _ in nil }) throws {
        try app.performAccessibilityAudit(for: types) { issue in
            let description = describe(issue)
            if let why = allowed(issue) {
                print("AUDIT \(platform) \(screen) allowed (\(why)): \(description)")
                return true
            }
            print("AUDIT \(platform) \(screen) issue: \(description)")
            return false
        }
    }

    @available(iOS 17.0, macOS 14.0, *)
    static func describe(_ issue: XCUIAccessibilityAuditIssue) -> String {
        var element = "no element"
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
