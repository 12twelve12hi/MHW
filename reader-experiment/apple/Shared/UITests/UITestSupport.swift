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

    /// Starts the app on fresh, empty storage of its own (`-DLSTestStorage`), with Lab off (`-DLSLab 0`, for the Lab
    /// builds) and Comfort as given (nil: not set, so the app's default), paired with `pairingLink` or not.
    static func launch(paired: Bool, comfort: Bool? = false, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-DLSTestStorage", "-DLSLab", "0"]
        if let comfort { arguments += ["-DLSComfort", comfort ? "1" : "0"] }
        if paired { arguments += ["-DLSPairLink", pairingLink] }
        app.launchArguments = arguments + extra
        app.launch()
        return app
    }

    // MARK: The tree walk (LAB-PLAN 1.7)

    /// The element types the walk records. Containers (windows, groups, cells, scroll views) are left out: their
    /// nesting changes with the OS, not with the app.
    static let typeNames: [XCUIElement.ElementType: String] = [
        .staticText: "staticText", .button: "button", .textField: "textField", .secureTextField: "secureTextField",
        .switch: "switch", .checkBox: "checkBox", .radioButton: "radioButton", .link: "link", .image: "image",
        .navigationBar: "navigationBar", .searchField: "searchField", .textView: "textView",
        .menuButton: "menuButton", .popUpButton: "popUpButton", .segmentedControl: "segmentedControl",
        .slider: "slider", .stepper: "stepper", .activityIndicator: "activityIndicator",
        .progressIndicator: "progressIndicator", .comboBox: "comboBox", .incrementArrow: "incrementArrow",
        .decrementArrow: "decrementArrow",
    ]

    /// Types recorded even without a label or value (an unlabelled control is exactly what the walk should show).
    static let alwaysKept: Set<XCUIElement.ElementType> = [
        .button, .textField, .secureTextField, .switch, .checkBox, .radioButton, .link, .searchField, .textView,
        .menuButton, .popUpButton, .slider, .stepper, .comboBox,
    ]

    /// An explicit walk of the element tree under `root`, in order: each kept element's type, label and value. Never
    /// `debugDescription`, whose format changes between Xcode releases. Elements whose identifier starts with "lab."
    /// are left out with everything under them: the Lab switch row shows even with Lab off (LAB-PLAN 1.1).
    static func walk(_ root: XCUIElement) throws -> [AXNode] {
        var out: [AXNode] = []
        visit(try root.snapshot(), into: &out)
        return out
    }

    static func visit(_ s: XCUIElementSnapshot, into out: inout [AXNode]) {
        if s.identifier.hasPrefix("lab.") { return }
        if let name = typeNames[s.elementType] {
            let value = text(s.value)
            if !(s.label.isEmpty && value.isEmpty && !alwaysKept.contains(s.elementType)) {
                out.append(AXNode(type: name, label: s.label, value: value))
            }
        }
        for child in s.children { visit(child, into: &out) }
    }

    nonisolated static func text(_ value: Any?) -> String {
        switch value {
        case let s as String: return s
        case let n as NSNumber: return n.stringValue
        default: return ""
        }
    }

    /// Walks until two walks half a second apart agree (at most `timeout` seconds), so a screen still settling (an
    /// answer arriving, a sheet sliding in) is not recorded half way.
    static func stableWalk(_ root: XCUIElement, timeout: TimeInterval = 15) throws -> [AXNode] {
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

    /// Compares `root`'s tree with the screen's baseline. Without a baseline (record mode) it prints the tree and
    /// fails, so it cannot pass unnoticed; on a difference it prints the new tree and the first differences.
    static func checkBaseline(_ root: XCUIElement, screen: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let nodes = try stableWalk(root)
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
            element = "\(typeNames[e.elementType] ?? "type \(e.elementType.rawValue)") “\(e.label)”"
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
