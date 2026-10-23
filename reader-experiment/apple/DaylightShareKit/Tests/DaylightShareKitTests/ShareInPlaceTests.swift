#if canImport(DaylightShareUI)
import DaylightShareKit
@testable import DaylightShareUI
import Foundation
import XCTest

/// Share in place in the share sheet (LAB-PLAN F04, with F03, F10, F16; card A3), on a build that hands its uploads to
/// the background session (a fake here): the card "Sending to {name}" sends by itself after 1.5 s unless Options is
/// opened; no countdown for people who need more time; the thin check and Review come first; the link-only line shows
/// once. With the paths off (W0's builds) or Lab off the card is v1.1's.
final class ShareInPlaceTests: XCTestCase {
    var dir: URL!
    var suite: String!
    var used: [(suite: String, dir: URL)] = []
    /// Where the last model's share sheet posts its failure notices.
    var center: FakeNoticeCenter!

    override func setUp() async throws {
        await MainActor.run { ShareInPlace.assistiveOverride = false }
    }

    override func tearDown() async throws {
        await MainActor.run { ShareInPlace.assistiveOverride = nil }
        for u in used {
            UserDefaults.standard.removePersistentDomain(forName: u.suite)
            try? FileManager.default.removeItem(at: u.dir)
        }
    }

    static let all = LabShareFeatures(smartIntake: true, shareInPlace: true, backgroundPublishing: true, linkOnlyHint: true,
                                      bigFilesEntry: true)

    /// A share sheet on fresh storage of its own (an App Group build), paired, with the background session faked.
    /// `linkOnlyShown`: F03's once-only line was shown already (so a link's card counts down).
    @MainActor
    func makeModel(_ features: LabShareFeatures = ShareInPlaceTests.all, lab: Bool = true, comfort: Bool = false,
                   linkOnlyShown: Bool = true,
                   prefs: @escaping @Sendable (LabPreferences) -> Void = { _ in }) async throws -> (ShareExtensionModel, SharedStore, FakeUploads) {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dls-sip-\(UUID().uuidString)")
        suite = "dls-sip-\(UUID().uuidString)"
        used.append((suite, dir))
        let store = SharedStore(defaults: UserDefaults(suiteName: suite)!, directory: dir, appGroup: "group.test.daylight")
        let pairing = try Pairing.generate(relay: "https://relay.test", name: "Test Daylight")
        await AppModel.onStorage {
            store.pairing = pairing
            LabSettings.setOn(lab, store: store)
            store.comfort = comfort
            let p = LabPreferences(store: store)
            p.linkOnlyShown = linkOnlyShown
            prefs(p)
        }
        FakeRelay.reset()
        let model = ShareExtensionModel(store: store)
        model.labFeatures = features
        // What the card sends from here (v1.1's path, F04's Use switch off) goes to the in-process relay.
        model.relaySession = FakeRelay.session
        let uploads = FakeUploads()
        Self.fake(model, uploads)
        center = FakeNoticeCenter()
        center.authorized = true
        model.noticeCenter = center
        model.pageFetch = { _ in nil }
        return (model, store, uploads)
    }

    /// Every share's background session is `uploads`, which keeps the attempt it was made for and its answer handler.
    @MainActor
    static func fake(_ model: ShareExtensionModel, _ uploads: FakeUploads) {
        model.backgroundSession = { attempt, onAnswer in
            uploads.attempts.append(attempt)
            uploads.answer = onAnswer
            return uploads
        }
    }

    @MainActor
    func linkItem(_ url: String) -> NSExtensionItem {
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(object: NSURL(string: url)!)]
        return item
    }

    @MainActor
    func pageItem(url: String, title: String, lab: [String: Any]) -> NSExtensionItem {
        let results: NSDictionary = ["url": url, "title": title, "html": "<html><body><p>Page</p></body></html>", "lab": lab]
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(item: [SharePayloadReader.jsResultsKey: results] as NSDictionary,
                                           typeIdentifier: SharePayloadReader.propertyList)]
        return item
    }

    @MainActor
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: @escaping () -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("timed out waiting for \(what)")
    }

    func rows(_ store: SharedStore) async -> [OutboxRow] { await AppModel.onStorage { OutboxStore(store: store).rows } }

    /// F04: "Sending to {name}" with Options; after 1.5 s it goes by itself, to the background session, and the card
    /// closes. The link goes cleaned, with x-orig (F16).
    @MainActor
    func testTheCardSendsByItselfAfterTheCountdown() async throws {
        let (model, store, uploads) = try await makeModel()
        var finished: Date?
        model.onFinish = { finished = Date() }
        let shared = "https://example.com/story?id=7&utm_source=feed"
        model.start(inputItems: [linkItem(shared)])
        try await waitFor("the card") { model.phase == .card }
        let shown = Date()
        let card = try XCTUnwrap(model.card)
        XCTAssertEqual(card.title, "Sending to Test Daylight")
        XCTAssertFalse(card.waitsForSend)
        XCTAssertFalse(card.optionsOpen)
        try await waitFor("the card to close", timeout: 4) { finished != nil }
        XCTAssertGreaterThanOrEqual(finished!.timeIntervalSince(shown), 1.3, "Options had its 1.5 s")
        XCTAssertEqual(uploads.started.count, 1)
        let all = await rows(store)
        let row = try XCTUnwrap(all.first)
        XCTAssertEqual(row.status, .sending)
        XCTAssertEqual(row.url, "https://example.com/story?id=7")
        XCTAssertEqual(row.header.extras["x-orig"], shared)
        let used = await AppModel.onStorage { (LabPreferences(store: store).shareInPlaceUsed, LabPreferences(store: store).shareSheetUsed) }
        XCTAssertTrue(used.0)
        XCTAssertTrue(used.1)
    }

    /// Options stops the countdown: nothing goes until Send.
    @MainActor
    func testOptionsStopsTheCountdown() async throws {
        let (model, _, uploads) = try await makeModel()
        var finished = false
        model.onFinish = { finished = true }
        model.start(inputItems: [linkItem("https://example.com/a")])
        try await waitFor("the card") { model.phase == .card }
        model.openOptions()
        XCTAssertEqual(model.card?.optionsOpen, true)
        try await Task.sleep(nanoseconds: 2_200_000_000)
        XCTAssertFalse(finished)
        XCTAssertTrue(uploads.started.isEmpty)
        await model.sendFromCard()
        XCTAssertTrue(finished)
        XCTAssertEqual(uploads.started.count, 1)
    }

    /// F04's accessibility rule (WCAG 2.2.1): with Comfort, VoiceOver or Switch Control, or "Always show Options before
    /// sending", the card opens with the choices and Send, and nothing goes until Send.
    @MainActor
    func testNoCountdownForPeopleWhoNeedMoreTime() async throws {
        for setup in ["comfort", "always", "voiceover"] {
            ShareInPlace.assistiveOverride = setup == "voiceover"
            let (model, _, uploads) = try await makeModel(comfort: setup == "comfort", prefs: { p in
                if setup == "always" { p.alwaysShowOptions = true }
            })
            model.start(inputItems: [linkItem("https://example.com/\(setup)")])
            try await waitFor("the card (\(setup))") { model.phase == .card }
            XCTAssertEqual(model.card?.waitsForSend, true, setup)
            XCTAssertEqual(model.card?.optionsOpen, true, setup)
            try await Task.sleep(nanoseconds: 2_000_000_000)
            XCTAssertTrue(uploads.started.isEmpty, setup)
        }
    }

    /// F10: the site's Clean article under 150 words asks first; "Send anyway" sends it (x-cap "clean"); the mode is
    /// remembered for the site.
    @MainActor
    func testAThinCleanArticleAsksFirst() async throws {
        let (model, store, uploads) = try await makeModel(comfort: true, prefs: { p in p.setSendAs("clean", host: "example.com") })
        let lab: [String: Any] = ["cleanHtml": "<html><body><p>Page</p></body></html>", "words": NSNumber(value: 400),
                                  "article": ["html": "<article><p>Short</p></article>", "words": NSNumber(value: 90), "title": "Short"]]
        model.start(inputItems: [pageItem(url: "https://example.com/thin", title: "Thin", lab: lab)])
        try await waitFor("the card") { model.phase == .card }
        XCTAssertEqual(model.card?.sendAs, .clean)
        XCTAssertEqual(model.card?.content, .page(clean: true, selection: false))
        await model.sendFromCard()
        XCTAssertEqual(model.card?.thinWords, 90)
        XCTAssertTrue(uploads.started.isEmpty, "nothing goes before the answer")
        model.sendThinAnyway()
        try await waitFor("the upload") { !uploads.started.isEmpty }
        let all = await rows(store)
        let row = try XCTUnwrap(all.first)
        XCTAssertEqual(row.kind, .page)
        XCTAssertEqual(row.header.extras["x-cap"], "clean")
        let remembered = await AppModel.onStorage { LabPreferences(store: store).sendAs(host: "example.com") }
        XCTAssertEqual(remembered, "clean")
    }

    /// F10's Review: the page as it will go, its words and size; the edited title is the title sent.
    @MainActor
    func testReviewShowsThePageAndSendsTheEditedTitle() async throws {
        let (model, store, uploads) = try await makeModel(prefs: { p in p.reviewBeforeSending = true })
        let lab: [String: Any] = ["cleanHtml": "<html><body><p>Seen page</p></body></html>", "words": NSNumber(value: 640)]
        model.start(inputItems: [pageItem(url: "https://example.com/r", title: "Original", lab: lab)])
        try await waitFor("the card") { model.phase == .card }
        XCTAssertEqual(model.card?.waitsForSend, true, "Review means no countdown")
        await model.sendFromCard()
        let review = try XCTUnwrap(model.card?.review)
        XCTAssertEqual(review.html, "<html><body><p>Seen page</p></body></html>")
        XCTAssertTrue(review.stats.hasPrefix("640 words · about "), review.stats)
        XCTAssertEqual(review.title, "Original")
        XCTAssertTrue(uploads.started.isEmpty)
        model.setReviewTitle("Edited title")
        await model.sendFromCard()
        try await waitFor("the upload") { !uploads.started.isEmpty }
        let all = await rows(store)
        let row = try XCTUnwrap(all.first)
        XCTAssertEqual(row.title, "Edited title")
        XCTAssertEqual(row.header.extras["x-cap"], "seen")
    }

    /// F03.3: a share that brings only a link shows "Only the link came through …" once on this device, and the card
    /// waits so it can be read.
    @MainActor
    func testTheLinkOnlyLineShowsOnce() async throws {
        let (first, store, _) = try await makeModel(linkOnlyShown: false)
        first.start(inputItems: [linkItem("https://example.com/login-only")])
        try await waitFor("the card") { first.phase == .card }
        XCTAssertEqual(first.card?.hint, LabText["linkOnly.iphone"])
        XCTAssertEqual(first.card?.waitsForSend, true)
        let second = ShareExtensionModel(store: store)
        second.labFeatures = Self.all
        Self.fake(second, FakeUploads())
        second.start(inputItems: [linkItem("https://example.com/again")])
        try await waitFor("the card") { second.phase == .card }
        XCTAssertNil(second.card?.hint)
    }

    /// The paths are opt-in (W0's builds) and Lab off is v1.1: no card, nothing handed to the background session.
    @MainActor
    func testWithoutTheLabPathsTheCardIsV11() async throws {
        for (features, lab) in [(LabShareFeatures(), true), (Self.all, false)] {
            let (model, _, uploads) = try await makeModel(features, lab: lab)
            model.start(inputItems: [linkItem("https://example.com/v11")])
            try await waitFor("v1.1's card") {
                switch model.phase {
                case .reading: return false
                default: return true
                }
            }
            XCTAssertNotEqual(model.phase, .card)
            XCTAssertNil(model.card)
            XCTAssertTrue(uploads.started.isEmpty)
        }
    }

    // MARK: Review fixes (A3)

    /// F04: the share sheet hears its own uploads' answers while it still runs (a link's POST is usually answered
    /// within a second of the card closing): a 413 fails the row, posts "Couldn’t send …" and deletes the frame file
    /// (F04.6); a 2xx makes it sent. Each share has its own session, "com.daylight.share.bg.<attempt>".
    @MainActor
    func testTheShareSheetHearsItsOwnAnswers() async throws {
        let (model, store, uploads) = try await makeModel()
        var finished = false
        model.onFinish = { finished = true }
        model.start(inputItems: [linkItem("https://example.com/refused")])
        try await waitFor("the card to close", timeout: 4) { finished }
        let before = await rows(store)
        let row = try XCTUnwrap(before.first)
        let attempt = try XCTUnwrap(row.bgAttempt)
        XCTAssertEqual(uploads.attempts, [attempt], "the session is the share's own")
        let answer = try XCTUnwrap(uploads.answer)
        let upload = try XCTUnwrap(uploads.started.first)
        await answer(upload.description, 413, nil)
        let after = await rows(store)
        let failed = try XCTUnwrap(after.first)
        XCTAssertEqual(failed.status, .failed)
        XCTAssertEqual(failed.errorCode, "full")
        XCTAssertFalse(FileManager.default.fileExists(atPath: upload.file.path), "the frame file goes")
        XCTAssertEqual(center.posted.map(\.title),
                       [FailureNotices.failedTitle(title: failed.displayTitle, daylightName: "Test Daylight")])
        XCTAssertEqual(center.requests, 0, "the extension never asks for the permission")

        // Another share from the same process: another session; its 2xx makes the row sent.
        let next = ShareExtensionModel(store: store)
        next.labFeatures = Self.all
        next.noticeCenter = center
        let more = FakeUploads()
        Self.fake(next, more)
        var nextFinished = false
        next.onFinish = { nextFinished = true }
        next.start(inputItems: [linkItem("https://example.com/fine")])
        try await waitFor("the second card to close", timeout: 4) { nextFinished }
        XCTAssertEqual(more.attempts.count, 1)
        XCTAssertNotEqual(more.attempts, uploads.attempts)
        let answerNext = try XCTUnwrap(more.answer)
        let nextUpload = try XCTUnwrap(more.started.first)
        await answerNext(nextUpload.description, 200, nil)
        let all = await rows(store)
        XCTAssertEqual(all.first(where: { $0.url == "https://example.com/fine" })?.status, .sent)
    }

    /// F16 steps 1 and 2: text that holds a link (Notes, Messages) is read as text by normaliseShare's rules, not as
    /// v1.1's link and the words around it: the link keeps its ")" and the title loses a trailing ":" or quotes.
    @MainActor
    func testTextWithALinkIsReadAsText() async throws {
        let (model, _, _) = try await makeModel()
        let cases: [(text: String, title: String?, url: String, expectedTitle: String?)] = [
            ("Washington (state) https://en.wikipedia.org/wiki/Washington_(state)", nil,
             "https://en.wikipedia.org/wiki/Washington_(state)", "Washington (state)"),
            ("Read this: https://example.com/a", nil, "https://example.com/a", "Read this"),
            ("“A quoted headline” https://example.com/q", nil, "https://example.com/q", "A quoted headline"),
            ("https://example.com/only", "The item’s title", "https://example.com/only", "The item’s title"),
        ]
        for c in cases {
            let payload = try XCTUnwrap(SharePayloadReader.textPayload(c.text, title: c.title))
            guard case .link = payload else { return XCTFail("\(c.text): \(payload)") }
            let made = try await model.labInput(for: payload)
            XCTAssertEqual(made.input.kind, .url, c.text)
            XCTAssertEqual(made.input.url, c.url, c.text)
            XCTAssertEqual(made.input.title, c.expectedTitle, c.text)
        }
    }

    /// F11: the first excerpt (or note) sent from this device keeps the card open with "Excerpts wait for a tap on your
    /// Daylight for now."; later ones close as usual.
    @MainActor
    func testTheExcerptLineShowsOnce() async throws {
        let (model, store, uploads) = try await makeModel()
        var finished = false
        model.onFinish = { finished = true }
        let lab: [String: Any] = ["cleanHtml": "<html><body><p>Page</p></body></html>", "words": NSNumber(value: 300),
                                  "selectionText": "A passage worth keeping.", "selectionHtml": "<p>A passage worth keeping.</p>"]
        model.start(inputItems: [pageItem(url: "https://example.com/essay", title: "Essay", lab: lab)])
        try await waitFor("the card") { model.phase == .card }
        XCTAssertEqual(model.card?.sendAs, .selection)
        try await waitFor("the line", timeout: 4) { model.note != nil }
        XCTAssertEqual(model.note, LabText["excerpt.waitsOnce"])
        guard case .sent = model.phase else { return XCTFail("\(model.phase)") }
        XCTAssertFalse(finished, "the line stays until Done")
        let sent = await rows(store)
        let row = try XCTUnwrap(sent.first)
        XCTAssertEqual(row.header.extras["x-cap"], "excerpt")
        XCTAssertEqual(uploads.started.count, 1)

        let second = ShareExtensionModel(store: store)
        second.labFeatures = Self.all
        Self.fake(second, FakeUploads())
        var secondFinished = false
        second.onFinish = { secondFinished = true }
        second.start(inputItems: [pageItem(url: "https://example.com/essay2", title: "Essay 2", lab: lab)])
        try await waitFor("the second card to close", timeout: 4) { secondFinished }
        XCTAssertNil(second.note)
    }

    /// LAB-PROTOCOL 2.9.6: F04's Use switch off gates only closing before the item is sent (the card still offers
    /// Options and sends in the extension, nothing goes to a background session); F10's off keeps a Safari selection as
    /// an excerpt (F11's explicit path), with no Send as choice.
    @MainActor
    func testTheUseSwitchesGateOnlyTheirOwnParts() async throws {
        let lab: [String: Any] = ["cleanHtml": "<html><body><p>Page</p></body></html>", "words": NSNumber(value: 300),
                                  "selectionText": "A chosen passage.", "selectionHtml": ""]
        // F04 off: the card shows; when it sends, the item goes from here and the card says "Sent" (v1.1's card), with
        // nothing handed to a background session.
        let (f04, f04Store, f04Uploads) = try await makeModel(prefs: { p in p.setUse("F04", false) })
        f04.start(inputItems: [linkItem("https://example.com/f04-off")])
        try await waitFor("the card") { f04.phase == .card }
        await f04.sendFromCard()
        guard case let .sent(text) = f04.phase else { return XCTFail("\(f04.phase)") }
        XCTAssertEqual(text.label, "Sent · waiting for your Daylight")
        XCTAssertTrue(f04Uploads.started.isEmpty, "nothing in the background with F04's Use switch off")
        let f04Rows = await rows(f04Store)
        XCTAssertEqual(f04Rows.first?.status, .sent)
        XCTAssertNil(f04Rows.first?.bgAttempt)

        // F10 off: no Send as choice, but the selection goes as an excerpt.
        let (f10, store, uploads) = try await makeModel(comfort: true, prefs: { p in
            p.setUse("F10", false)
            p.setSendAs("clean", host: "example.com")
        })
        f10.start(inputItems: [pageItem(url: "https://example.com/f10-off", title: "Page", lab: lab)])
        try await waitFor("the card") { f10.phase == .card }
        XCTAssertEqual(f10.card?.sendAsOffered, false)
        XCTAssertEqual(f10.card?.sendAs, .selection)
        await f10.sendFromCard()
        try await waitFor("the upload") { !uploads.started.isEmpty }
        let f10Rows = await rows(store)
        let row = try XCTUnwrap(f10Rows.first)
        XCTAssertEqual(row.kind, .file)
        XCTAssertEqual(row.header.extras["x-cap"], "excerpt")

        // Without the card (a build with smart intake alone): the selection, then the site's mode while F10 is in use.
        let (plain, _, _) = try await makeModel(LabShareFeatures(smartIntake: true), prefs: { p in p.setSendAs("clean", host: "example.com") })
        let withArticle: [String: Any] = ["cleanHtml": "<html><body><p>Page</p></body></html>", "words": NSNumber(value: 900),
                                          "article": ["html": "<article><p>Long</p></article>", "words": NSNumber(value: 800), "title": "Long"]]
        let page = SharePayload.page(html: "<html></html>", url: "https://example.com/p", title: "P", lab: PageCapture.read(withArticle))
        let clean = try await plain.labInput(for: page)
        XCTAssertEqual(clean.input.extras["x-cap"], "clean", "the mode remembered for the site")
        let selected = SharePayload.page(html: "<html></html>", url: "https://example.com/p", title: "P", lab: PageCapture.read(lab))
        let excerpt = try await plain.labInput(for: selected)
        XCTAssertEqual(excerpt.input.extras["x-cap"], "excerpt", "a Safari selection is an excerpt")
    }

    /// Cancel stops the countdown: nothing goes after it, not even a late Send (review finding 10).
    @MainActor
    func testCancelStopsTheCountdown() async throws {
        let (model, _, uploads) = try await makeModel()
        var cancelled = false
        model.onCancel = { cancelled = true }
        model.start(inputItems: [linkItem("https://example.com/cancelled")])
        try await waitFor("the card") { model.phase == .card }
        model.cancel()
        XCTAssertTrue(cancelled)
        try await Task.sleep(nanoseconds: 2_200_000_000)
        await model.sendFromCard()
        XCTAssertTrue(uploads.started.isEmpty)
    }

    /// The F02 entry point (F02e.1): a file over 9 MB is refused with v1.1's sentence and, with Lab on, "Send files over
    /// 9 MB ›" under it; with Lab off the result is v1.1's.
    @MainActor
    func testATooBigFileOffersTheBigFilesEntry() async throws {
        let big = FileManager.default.temporaryDirectory.appendingPathComponent("dls-big-\(UUID().uuidString).pdf")
        XCTAssertTrue(FileManager.default.createFile(atPath: big.path, contents: Data()))
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: 14_000_000)
        try handle.close()
        defer { try? FileManager.default.removeItem(at: big) }
        for lab in [true, false] {
            let (model, _, uploads) = try await makeModel(lab: lab, comfort: true)
            let item = NSExtensionItem()
            item.attachments = [NSItemProvider(contentsOf: big)!]
            model.start(inputItems: [item])
            if lab {
                try await waitFor("the card") { model.phase == .card }
                await model.sendFromCard()
            }
            try await waitFor("the result (lab \(lab))", timeout: 10) {
                if case .result = model.phase { return true } else { return false }
            }
            guard case let .result(_, message) = model.phase else { return XCTFail("\(model.phase)") }
            XCTAssertTrue(message.hasPrefix("Too big to send."), message)
            XCTAssertTrue(model.refusedTooBig)
            XCTAssertEqual(model.showsBigFilesEntry, lab)
            XCTAssertTrue(uploads.started.isEmpty)
        }
    }
}
#endif
