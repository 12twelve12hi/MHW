import Foundation
import XCTest

/// The tree walk's own rules (LAB-PLAN 1.7, F00.2 and the Lab rule of 1.1), on trees built by hand: no app is launched.
/// Runs in both UI test bundles (iPhone and Mac).
final class TreeWalkTests: XCTestCase {
    typealias E = AXRaw

    /// A Settings screen as the iPhone shows one: a header, a Comfort switch with its footer, a version row, and
    /// whatever else is given (the Lab section goes first, as LAB-PLAN 1.1 places it).
    func settings(_ lab: [AXRaw] = []) -> AXRaw {
        E(.application, label: "Send to Daylight", [
            E(.window, [
                E(.other, [
                    E(.navigationBar, [E(.staticText, label: "Settings"), E(.button, label: "Done")]),
                    E(.table, lab + [
                        E(.staticText, label: "YOUR DAYLIGHT"),
                        E(.cell, [E(.staticText, label: "Name, Test Daylight")]),
                        E(.switch, id: "comfort", label: "Comfort", value: "0", [
                            E(.staticText, label: "Comfort"), E(.switch, value: "0"),
                        ]),
                        E(.staticText, label: "Larger text and buttons, more contrast, no motion."),
                        E(.cell, [E(.staticText, label: "Version, 1.1.0")]),
                        E(.other, label: "Vertical scroll bar, 2 pages", value: "0%"),
                    ]),
                ]),
            ]),
        ])
    }

    /// The Lab section as LAB-PLAN 1.1 has it with Lab off: a header, the switch (with the system's unnamed switch
    /// inside it) and its footer.
    func labSection(on: Bool = false, inside: [AXRaw] = []) -> [AXRaw] {
        [
            E(.staticText, label: "LAB"),
            E(.switch, id: AXTree.labSwitchID, label: "Lab", value: on ? "1" : "0", [
                E(.staticText, label: "Lab"), E(.switch, value: on ? "1" : "0"),
            ] + inside),
            E(.staticText, label: AXTree.labFooter),
        ]
    }

    func labels(_ walk: AXWalk) -> [String] { walk.nodes.map { $0.label.isEmpty ? $0.value : $0.label } }

    /// With Lab off, the switch row and its words are left out and nothing else: the tree equals the one without Lab.
    func testWithLabOffOnlyTheSwitchRowIsLeftOut() {
        let plain = AXTree.walk(settings())
        let lab = AXTree.walk(settings(labSection()))
        XCTAssertEqual(lab.nodes, plain.nodes)
        XCTAssertEqual(lab.labRows.count, 1)
        XCTAssertEqual(lab.labTexts.map(\.label), ["LAB", AXTree.labFooter])
        XCTAssertEqual(AXTree.labOffProblems(lab, allowed: true), [])
        XCTAssertEqual(AXTree.labOffProblems(plain, allowed: false), [], "no Lab switch, nothing to check")
    }

    /// What's in Lab (or anything else of Lab) showing with Lab off changes the compared tree, whatever its
    /// identifier; inside the switch's element it is reported.
    func testAnythingElseOfLabShows() {
        let row = E(.button, id: "lab.whatsInLab", label: "What’s in Lab ›")
        let beside = AXTree.walk(settings(labSection() + [row]))
        XCTAssertTrue(beside.nodes.contains(AXNode(type: "button", label: "What’s in Lab ›", value: "")))
        XCTAssertNotEqual(beside.nodes, AXTree.walk(settings()).nodes)

        let inside = AXTree.walk(settings(labSection(inside: [row])))
        XCTAssertEqual(AXTree.labOffProblems(inside, allowed: true), ["shown with Lab off: button “What’s in Lab ›”"])
    }

    /// The row holds one switch named "Lab", off; one row only; only where the switch lives.
    func testTheLabSwitchIsOneSwitchNamedLabAndOff() {
        let on = AXTree.walk(settings(labSection(on: true)))
        XCTAssertEqual(AXTree.labOffProblems(on, allowed: true), [
            "the Lab switch is not off: switch “Lab” = “1”", "the Lab switch is not off: switch “” = “1”",
        ])
        let twice = AXTree.walk(settings(labSection() + labSection()))
        XCTAssertTrue(AXTree.labOffProblems(twice, allowed: true).contains("2 Lab switch rows, not one"))
        let elsewhere = AXTree.walk(settings(labSection()))
        XCTAssertEqual(AXTree.labOffProblems(elsewhere, allowed: false),
                       ["a Lab switch (lab-switch) on a screen that has none"])
        let unnamed = AXTree.walk(settings([E(.switch, id: AXTree.labSwitchID, value: "0")]))
        XCTAssertEqual(AXTree.labOffProblems(unnamed, allowed: true),
                       ["the Lab switch row holds 0 switches named “Lab”, not one"])
    }

    /// Without a Lab switch, texts with its words are compared like any other.
    func testLabWordsWithoutTheSwitchAreCompared() {
        let walk = AXTree.walk(settings([E(.staticText, label: "LAB"), E(.staticText, label: AXTree.labFooter)]))
        XCTAssertEqual(Array(labels(walk).prefix(4)), ["Send to Daylight", "Settings", "Done", "LAB"])
        XCTAssertTrue(labels(walk).contains(AXTree.labFooter))
        XCTAssertEqual(walk.labTexts, [])
    }

    /// Every element with words is kept, whatever its type; unnamed containers and scroll bars are not; unnamed
    /// controls are.
    func testEveryElementWithWordsIsKept() {
        let tree = E(.window, label: "Send to Daylight", [
            E(.group, [
                E(.other, label: "Labelled custom element"),
                E(.disclosureTriangle, label: "More"),
                E(.cell, label: "A cell"),
                E(.menuItem, label: "Send Clipboard Link"),
                E(.group),
                E(.button),
                E(.scrollBar, value: "0", [E(.valueIndicator, value: "0")]),
                E(.staticText, value: "Only a value"),
            ]),
        ])
        XCTAssertEqual(AXTree.walk(tree).nodes, [
            AXNode(type: "window", label: "Send to Daylight", value: ""),
            AXNode(type: "other", label: "Labelled custom element", value: ""),
            AXNode(type: "disclosureTriangle", label: "More", value: ""),
            AXNode(type: "cell", label: "A cell", value: ""),
            AXNode(type: "menuItem", label: "Send Clipboard Link", value: ""),
            AXNode(type: "button", label: "", value: ""),
            AXNode(type: "staticText", label: "", value: "Only a value"),
        ])
    }

    /// The app's version reads "<version>"; addresses are left alone.
    func testTheVersionIsNormalised() {
        XCTAssertEqual(AXTree.normalised("Version, 1.1.0"), "Version, <version>")
        XCTAssertEqual(AXTree.normalised("12.30.4"), "<version>")
        XCTAssertEqual(AXTree.normalised("http://127.0.0.1:9"), "http://127.0.0.1:9")
        XCTAssertEqual(AXTree.normalised("Version 2.0"), "Version 2.0")
        let walk = AXTree.walk(settings())
        XCTAssertTrue(walk.nodes.contains(AXNode(type: "staticText", label: "Version, <version>", value: "")))
    }

    /// The type names follow the enum's raw values.
    func testTypeNamesMatchTheCases() {
        let cases: [(XCUIElement.ElementType, String)] = [
            (.other, "other"), (.window, "window"), (.button, "button"), (.switch, "switch"), (.image, "image"),
            (.staticText, "staticText"), (.textField, "textField"), (.menuItem, "menuItem"), (.cell, "cell"),
            (.scrollBar, "scrollBar"), (.stepper, "stepper"),
        ]
        for (type, name) in cases { XCTAssertEqual(AXTree.typeName(type), name) }
    }

    /// The Lab switch's words are LAB_TEXT's (share/vectors/lab-vectors.json › labText.strings).
    func testTheLabWordsAreLabText() throws {
        let url = URL(fileURLWithPath: #filePath) // …/reader-experiment/apple/Shared/UITests/<this file>
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("share/vectors/lab-vectors.json")
        let vectors = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let strings = try XCTUnwrap((vectors["labText"] as? [String: Any])?["strings"] as? [String: Any])
        XCTAssertEqual(AXTree.labTitle, strings["lab"] as? String)
        XCTAssertEqual(AXTree.labFooter, strings["switchFooter"] as? String)
    }
}
