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

    static let all = LabShareFeatures(smartIntake: true, shareInPlace: true, backgroundPublishing: true, linkOnlyHint: true)

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
        let model = ShareExtensionModel(store: store)
        model.labFeatures = features
        let uploads = FakeUploads()
        model.backgroundUploads = uploads
        model.pageFetch = { _ in nil }
        return (model, store, uploads)
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
    func waitFor(_ what: String, timeout: TimeInterval = 5, _ condition: () -> Bool) async throws {
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
        second.backgroundUploads = FakeUploads()
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
}
#endif
