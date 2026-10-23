import XCTest

/// LAB-PLAN F00.3, F00.5, F00.6 and F17.2 on the iPhone: What's in Lab's short states and needs-setup notes, and the
/// Daylight server section's Server code, against relays CI runs (`LabUI`): the mock relay with no Daylight server on it
/// (needs-server), nothing at all (offline), and one that never answers.
final class LabNoteTests: XCTestCase {
    /// F00.3 and F00.6 (online): with no Daylight server, "Summaries with Claude" says exactly the needs-server sentence
    /// under itself within 5 s, with Copy Server code and OK; the row looks and acts like any control, the sentence is
    /// said to VoiceOver, and OK takes it away. Every server feature says the same. Copy Server code puts the Server
    /// code on the clipboard (F00.5).
    @MainActor
    func testANeedsSetupFeatureSaysItsSentenceUnderIt() throws {
        continueAfterFailure = true
        let relay = try LabUI.onlineRelay()
        let log = LabUI.announceLog()
        let app = LabUI.launch(relay: relay, announceLog: log)
        let notSetUp = LabUI.string("serverHeadingShort.needs-server")
        LabUI.openWhatsInLab(app, short: notSetUp)
        // F17.2: no hello from the Daylight yet.
        XCTAssertTrue(LabUI.text(LabUI.string("short.needs-inbox"), in: app).exists, "the header is not the needs-inbox line")
        let sentence = LabUI.needs("needs-server")

        let row = LabUI.element(LabUI.feature("F37"), in: app)
        XCTAssertTrue(LabUI.scrollTo(row, in: app), "Summaries with Claude cannot be tapped")
        XCTAssertTrue(row.isEnabled, "Summaries with Claude looks unavailable")
        let start = Date()
        LabUI.tapRow(row, in: app)
        let words = LabUI.text(sentence, in: app)
        XCTAssertTrue(words.waitForExistence(timeout: Self.quickAsSeen),
                      "no needs-server sentence after tapping Summaries with Claude")
        let took = Date().timeIntervalSince(start)
        print("UI test: the needs-server note showed \(String(format: "%.1f", took)) s after the tap started")
        // Within the gate's 5 s by the app's own clock: an answer after the deadline would have been OFFLINE.
        if let offline = LabUI.stateMessages["OFFLINE"] {
            XCTAssertFalse(LabUI.text(offline, in: app).exists, "the gate gave OFFLINE: the server's answer came after 5 s")
        }
        let note = LabUI.element(LabUI.note, in: app)
        XCTAssertTrue(note.exists, "the sentence is not in a note")
        XCTAssertGreaterThanOrEqual(note.frame.minY, row.frame.minY, "the note is not under the tapped control")
        XCTAssertTrue(note.buttons[LabUI.string("buttons.needs-server")].exists, "the note has no Copy Server code")
        XCTAssertTrue(note.buttons[LabUI.string("noteButton")].exists, "the note has no OK")
        XCTAssertTrue(row.isEnabled, "the control looks unavailable after its note")
        XCTAssertTrue(LabUI.waitForAnnouncement(sentence, in: log), "the sentence was not said to VoiceOver: "
                      + "\(LabUI.announcements(log))")
        UITestSupport.screenshot(app, "ios-lab-note-needs-server", in: self)

        // Copy Server code: the clipboard holds it (pasted on Home below).
        note.buttons[LabUI.string("buttons.needs-server")].tap()
        XCTAssertTrue(note.buttons[LabUI.string("setup.copied")].waitForExistence(timeout: 5), "Copy Server code did not say Copied")

        note.buttons[LabUI.string("noteButton")].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: words)
        waitForExpectations(timeout: 5)

        // The other server features are in the same state, and say so the same way.
        for id in ["F02", "F19", "F36"] {
            let other = LabUI.element(LabUI.feature(id), in: app)
            LabUI.scrollTo(other, in: app)
            LabUI.tapRow(other, in: app)
            XCTAssertTrue(LabUI.text(sentence, in: app).waitForExistence(timeout: Self.quickAsSeen), "\(id): no needs-server sentence")
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: LabUI.note).count, 1,
                           "\(id): more than one note (a tap on another control replaces it)")
        }

        LabUI.backToSettings(app, from: LabUI.string("whatsInLab"))
        LabUI.closeSettings(app)
        XCTAssertEqual(LabUI.pasteOnHome(app), try Self.expectedServerCode(relay: relay),
                       "Copy Server code did not put this pairing's Server code on the clipboard")
    }

    /// F00.6: with the relay out of reach, the OFFLINE sentence; with a relay that never answers, "Checking your Daylight
    /// server…" under the control, then the OFFLINE sentence at 5 s.
    @MainActor
    func testTheServerOutOfReachAndNeverAnswering() throws {
        continueAfterFailure = true
        let offline = try XCTUnwrap(LabUI.stateMessages["OFFLINE"], "server-vectors.json has no OFFLINE message")
        let short = LabUI.string("short.OFFLINE")

        let app = LabUI.launch(relay: LabUI.offlineRelay)
        LabUI.openWhatsInLab(app, short: short)
        let row = LabUI.element(LabUI.feature("F37"), in: app)
        LabUI.scrollTo(row, in: app)
        let start = Date()
        LabUI.tapRow(row, in: app)
        XCTAssertTrue(LabUI.text(offline, in: app).waitForExistence(timeout: Self.quickAsSeen),
                      "no OFFLINE sentence with the relay out of reach")
        print("UI test: with the relay out of reach, OFFLINE showed \(String(format: "%.1f", Date().timeIntervalSince(start))) s "
              + "after the tap started")
        UITestSupport.screenshot(app, "ios-lab-note-offline", in: self)
        app.terminate()

        let hanging = LabUI.launch(relay: try LabUI.hangingRelay())
        // What's in Lab asks too when it opens: wait for its answer (OFFLINE at 5 s) before tapping.
        LabUI.openWhatsInLab(hanging, short: short)
        let slow = LabUI.element(LabUI.feature("F37"), in: hanging)
        LabUI.scrollTo(slow, in: hanging)
        // The gate starts with the tap; its note says "Checking your Daylight server…" 150 ms later. A tap, and seeing
        // a text, each take the test a second or two, so the gate's 5 s lie between the tap's start (before the gate
        // started: OFFLINE at least 4.5 s after it) and the test seeing "Checking…" (after it started: OFFLINE at most
        // 8 s after it). In runs 39861246341 and 39864055620 one clock alone gave 7.4 to 14.9 s and 3.3 s.
        var tapped = Date()
        LabUI.tapRow(slow, in: hanging)
        let note = LabUI.element(LabUI.note, in: hanging)
        let checking = LabUI.text(LabUI.string("checking"), in: note)
        if !checking.waitForExistence(timeout: 4) {
            print("UI test: no “Checking…” after tapping F37 (\(slow.frame)); tapping it again")
            tapped = Date()
            LabUI.tapRow(slow, in: hanging)
        }
        XCTAssertTrue(checking.waitForExistence(timeout: 4), "the note did not say “Checking your Daylight server…”")
        let seen = Date()
        UITestSupport.screenshot(hanging, "ios-lab-note-checking", in: self)
        XCTAssertTrue(LabUI.text(offline, in: hanging).waitForExistence(timeout: 12), "no OFFLINE sentence from a relay that never answers")
        let fromTap = Date().timeIntervalSince(tapped)
        let fromSeen = Date().timeIntervalSince(seen)
        print("UI test: a relay that never answers gave OFFLINE \(String(format: "%.1f", fromTap)) s after the tap "
              + "started, \(String(format: "%.1f", fromSeen)) s after “Checking…” was seen")
        XCTAssertGreaterThanOrEqual(fromTap, 4.5, "OFFLINE came before the 5 s deadline")
        XCTAssertLessThanOrEqual(fromSeen, Self.gateAsSeen, "OFFLINE came long after the 5 s deadline")
    }

    /// F00.5: the Daylight server section shows this pairing's Server code: the vectors' (server-vectors.json ›
    /// derived) in the link form, since the relay is not ntfy.sh (2.6), and Copy puts it on the clipboard.
    @MainActor
    func testTheServerCodeIsTheVectorsAndCopyPutsItOnTheClipboard() throws {
        continueAfterFailure = true
        let relay = try LabUI.onlineRelay()
        let app = LabUI.launch(relay: relay)
        LabUI.openServerSection(app)
        let expected = try Self.expectedServerCode(relay: relay)
        // With no Daylight server: the needs-server long text first (with the secrets' names, where setup happens).
        if let message = LabUI.stateMessages["needs-server"] {
            XCTAssertTrue(LabUI.text(message, in: app).exists, "the section does not show the needs-server long text")
        }
        UITestSupport.screenshot(app, "ios-lab-server-section", in: self)
        let code = LabUI.element(LabUI.serverCode, in: app)
        XCTAssertTrue(LabUI.scrollTo(code, in: app), "the section shows no Server code")
        XCTAssertEqual(code.label, expected)
        UITestSupport.screenshot(app, "ios-lab-server-code", in: self)
        let copy = LabUI.element(LabUI.copyServerCode, in: app)
        LabUI.scrollTo(copy, in: app)
        copy.tap()
        XCTAssertTrue(LabUI.text(LabUI.string("setup.copied"), in: app).waitForExistence(timeout: 5), "Copy did not say Copied")
        LabUI.backToSettings(app, from: LabUI.string("serverRow"))
        LabUI.closeSettings(app)
        XCTAssertEqual(LabUI.pasteOnHome(app), expected, "Copy did not put the Server code on the clipboard")
    }

    /// Set up with a link (2.6 "Setup link", steps 2 and 3): Set up (here the field's Return) sends nothing and asks
    /// "Use this Daylight server?" with the address of the link itself (server-vectors.json › setupLinks); another link
    /// in the field withdraws the question, since Use it sends only the link it asked about; the same link asks again.
    /// Use it is not tapped: the vectors' address is a workers.dev name.
    @MainActor
    func testTheSetupLinkAsksWithItsOwnAddress() throws {
        continueAfterFailure = true
        let setup = try XCTUnwrap(LabUI.serverVectors["setupLinks"] as? [String: Any])
        let link = try XCTUnwrap(setup["link"] as? String)
        let server = try XCTUnwrap(setup["server"] as? String)
        let host = try XCTUnwrap(URL(string: server)?.host)
        let title = LabUI.string("serverSection.setupConfirmTitle")
        let body = LabUI.string("serverSection.setupConfirmBody").replacingOccurrences(of: "{host}", with: host)
        let app = LabUI.launch(relay: try LabUI.onlineRelay())
        LabUI.openServerSection(app)
        let field = LabUI.element(LabUI.setupField, in: app)
        XCTAssertTrue(LabUI.scrollTo(field, in: app), "the section shows no setup link field")
        field.tap()
        field.typeText(link + "\n")
        let question = LabUI.text(title, in: app)
        XCTAssertTrue(question.waitForExistence(timeout: 5), "Set up did not ask “\(title)”")
        XCTAssertTrue(LabUI.text(body, in: app).exists, "the question does not name the link's own address: \(body)")
        UITestSupport.screenshot(app, "ios-lab-setup-question", in: self)
        // A tap puts the cursor in the link: "x" there makes another link, and the delete right after it takes it out.
        field.tap()
        field.typeText("x")
        LabUI.waitUntil(question, exists: false, timeout: 5)
        field.typeText(XCUIKeyboardKey.delete.rawValue + "\n")
        XCTAssertTrue(question.waitForExistence(timeout: 5), "the same link did not ask again")
        XCTAssertTrue(LabUI.text(body, in: app).exists, "the question again does not name the link's own address")
    }

    /// F17.2: a sender that never heard a hello shows "Delivered ✓" (not the Lab timeline's "On your Daylight ✓") and,
    /// in What's in Lab, the needs-inbox header line.
    @MainActor
    func testWithoutAHelloRowsSayDeliveredAndTheHeaderNeedsLab() throws {
        continueAfterFailure = true
        let app = LabUI.launch(history: true, rows: [4])
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 30), "Home did not show")
        XCTAssertTrue(UITestSupport.waitForHistory(app), "the sample history did not show")
        XCTAssertTrue(LabUI.containing("Delivered ✓", in: app).exists, "the delivered row does not say Delivered ✓")
        XCTAssertFalse(LabUI.containing(LabUI.string("rows.delivered.label"), in: app).exists,
                       "a row says the Lab timeline's “On your Daylight ✓” with no hello")
        LabUI.openWhatsInLab(app, short: LabUI.string("short.OFFLINE"))
        XCTAssertTrue(LabUI.text(LabUI.string("short.needs-inbox"), in: app).exists, "the header is not the needs-inbox line")
        UITestSupport.screenshot(app, "ios-lab-no-hello", in: self)
    }

    /// The gate's 5 s deadline as a UI test can see it: a tap and a look each take the test a second or two on CI.
    static let gateAsSeen: TimeInterval = 8

    /// How long the test waits for a note the gate answers at once (the mock relay with no server, a relay out of
    /// reach). The 5 s are the app's own: the gate turns a server answer later than its deadline into OFFLINE
    /// (`LabGate`, pinned by the kit's LabVectorTests and DaylightServerTests), so a needs-server sentence is an answer
    /// in time, and the never-answering relay checks the deadline itself from both sides. A wall clock from the tap's
    /// start measures the test's own tap and look too: 5.0 to 8.4 s for the same needs-server note on CI (runs
    /// 39866465819, 39888465664).
    static let quickAsSeen: TimeInterval = 15

    /// The Server code for the vectors' pairing on `relay`: server-vectors.json's `derived.serverCode` without its
    /// SERVER- and dashes, in the `daylightserver://setup?c=…&r=…` link form a relay other than ntfy.sh takes.
    @MainActor
    static func expectedServerCode(relay: String) throws -> String {
        let vectors = LabUI.serverVectors
        let pairing = (vectors["pairingCode"] as? String ?? "").replacingOccurrences(of: "-", with: "")
        XCTAssertEqual(pairing, UITestSupport.pairingCode, "the UI tests' pairing is not the server vectors'")
        let derived = try XCTUnwrap(vectors["derived"] as? [String: Any])
        let code = try XCTUnwrap(derived["serverCode"] as? String)
        let c = code.replacingOccurrences(of: "SERVER-", with: "").replacingOccurrences(of: "-", with: "")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "*-._") // as ServerCode.formEncode (application/x-www-form-urlencoded)
        let r = relay.addingPercentEncoding(withAllowedCharacters: allowed) ?? relay
        return "daylightserver://setup?c=\(c)&r=\(r)"
    }
}
