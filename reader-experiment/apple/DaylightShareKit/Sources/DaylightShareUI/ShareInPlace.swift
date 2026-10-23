import DaylightShareKit
import Foundation
import SwiftUI
#if canImport(WebKit)
import WebKit
#endif
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// Lab W1 in the share sheet (LAB-PLAN F03, F04, F10, F11, F16; card A3): the paths the iPhone and Mac lanes turn on
// (`ShareExtensionModel.labFeatures`), the share-in-place card with its Options, Review and the thin-page check. With
// Lab off none of it runs and the card is v1.1's.

/// Which Lab paths a build's share sheet takes (A4 and A5 turn them on; all off by default).
public struct LabShareFeatures: Equatable, Sendable {
    /// F03, F10, F11 (rule 3), F16: with Lab on a Safari page goes as GetPage.js's clean copy (x-cap "seen"), links and
    /// text go through smart intake (cleaned links with x-orig, Apple News resolved, text with no link as a note).
    public var smartIntake: Bool
    /// F04: the share-in-place card, "Sending to {name}" with Options for 1.5 s (with Lab on and F04's Use switch on).
    public var shareInPlace: Bool
    /// F04 with an App Group: the card closes once the uploads are handed to the background session
    /// (`BackgroundPublisher`); without it the card waits until the item is sent (the ad-hoc Mac, 1.1).
    public var backgroundPublishing: Bool
    /// F03.3: "Only the link came through …" once on this device when a share carries only a link (iPhone).
    public var linkOnlyHint: Bool

    public init(smartIntake: Bool = false, shareInPlace: Bool = false, backgroundPublishing: Bool = false,
                linkOnlyHint: Bool = false) {
        self.smartIntake = smartIntake
        self.shareInPlace = shareInPlace
        self.backgroundPublishing = backgroundPublishing
        self.linkOnlyHint = linkOnlyHint
    }
}

/// What the share-in-place card shows (F04) and what its Options hold (F10, F11).
public struct ShareInPlaceCard: Equatable {
    /// What was shared, for the choices Options offers.
    public enum Content: Equatable {
        /// A Safari page: Send as (Clean article when Readability found one, Selection when text is selected).
        case page(clean: Bool, selection: Bool)
        /// Text that holds a link: "Send as excerpt" or "Send link" (F11's explicit choice).
        case textWithLink
        /// A link, a file, text without a link, several items: no choices.
        case other
    }

    /// Review (F10): the page as it will be sent, its words and size, and the title, which can be changed.
    public struct Review: Equatable {
        public var html: String
        public var stats: String
        public var title: String
    }

    /// "Sending to {name}".
    public var title: String
    /// No countdown (WCAG 2.2.1): Comfort, VoiceOver or Switch Control, "Always show Options before sending", Review, or
    /// a line to read first; the card shows the choices and Send, and nothing goes until Send.
    public var waitsForSend: Bool
    public var optionsOpen: Bool
    public var content: Content
    /// F10's mode for a page (Page as you see it unless the site or a selection says otherwise).
    public var sendAs: LabShare.SendAs
    /// Whether Send as, Review and the thin check are in use (F10's Use switch).
    public var sendAsOffered: Bool
    /// F11: send the text as an excerpt rather than its link.
    public var asExcerpt: Bool
    /// "Send the link instead" (a page without Send as).
    public var linkInstead: Bool
    /// F10's thin check: the article's words, while "This page looks thin ({n} words)…" waits for an answer.
    public var thinWords: Int?
    /// The thin check was answered "Send anyway".
    public var thinAccepted: Bool
    /// Review, while it shows.
    public var review: Review?
    /// A line shown once on this device (F03's "Only the link came through …").
    public var hint: String?
    /// Send was tapped (or the countdown ended): the item is on its way.
    public var sending: Bool
}

/// F04's timing and its accessibility rule.
public enum ShareInPlace {
    /// How long Options is offered before the card sends by itself.
    public static let countdown: TimeInterval = 1.5
    /// Tests stub whether VoiceOver or Switch Control is on; nil asks the system.
    @MainActor public static var assistiveOverride: Bool?

    /// Whether VoiceOver or Switch Control is on (iPhone: `UIAccessibility`; Mac: `NSWorkspace`).
    @MainActor
    public static var assistiveTechnologyRunning: Bool {
        if let assistiveOverride { return assistiveOverride }
        #if os(iOS)
        return UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
        #elseif os(macOS)
        return NSWorkspace.shared.isVoiceOverEnabled || NSWorkspace.shared.isSwitchControlEnabled
        #else
        return false
        #endif
    }

    /// No countdown for people who need more time (F04, F27.5): Comfort, a screen reader or switch access, or "Always
    /// show Options before sending".
    @MainActor
    public static func waitsForSend(comfort: Bool, alwaysShowOptions: Bool) -> Bool {
        comfort || alwaysShowOptions || assistiveTechnologyRunning
    }
}

extension ShareExtensionModel {
    // MARK: Beginning

    /// The items are read and the pairing is there: the share-in-place card (Lab, F04 in use, `labFeatures.shareInPlace`),
    /// else the card that sends at once (v1.1, or Lab's smart intake with `labFeatures.smartIntake`).
    func begin() async {
        let store = self.store
        var f04 = false
        if lab && labFeatures.shareInPlace {
            f04 = await AppModel.onStorage { LabPreferences(store: store).inUse("F04") }
        }
        if f04 {
            await presentCard()
        } else {
            await send()
        }
    }

    /// What one payload sends with Lab on (F03, F16, F11 rule 3), and the line to show with it. Reads files and may fetch
    /// an Apple News page: off the main thread. Throws as `input(for:)`.
    func labInput(for payload: SharePayload, mode: LabShare.SendAs? = nil) async throws -> (input: ItemInput, note: String?) {
        let store = self.store
        let fetch = pageFetch
        let clean = await AppModel.onStorage { LabPreferences(store: store).inUse("F16") }
        switch payload {
        case let .page(html, url, title, lab):
            guard let c = lab else {
                // GetPage.js gave nothing for Lab (an older copy): the page as v1.1 sends it.
                let input = try Self.input(for: payload)
                return (input, Self.note(for: [payload]))
            }
            return LabShare.pageInput(html: html, url: url, title: title, capture: c, mode: mode ?? .page)
        case let .link(url, title, text):
            let input = await LabShare.linkInput(url: url, title: title, text: text, clean: clean, fetch: fetch)
            return (input, nil)
        case let .text(text):
            guard let input = await LabShare.textInput(text, clean: clean, fetch: fetch) else {
                throw ShareError("content", "There’s nothing here Send to Daylight can send.")
            }
            return (input, nil)
        default:
            let input = try await AppModel.onStorage { Result { try Self.input(for: payload) } }.get()
            return (input, nil)
        }
    }

    /// A line to show once on this device after a Lab share (F03.3's "Only the link came through …" for a share that
    /// carried only a link, `labFeatures.linkOnlyHint`), or nil. Marks it shown.
    func labOnceNote() async -> String? {
        guard labFeatures.linkOnlyHint, payloads.count == 1, case .link = payloads[0] else { return nil }
        let store = self.store
        return await AppModel.onStorage { () -> String? in
            let p = LabPreferences(store: store)
            guard p.inUse("F03"), !p.linkOnlyShown else { return nil }
            p.linkOnlyShown = true
            return LabText["linkOnly.iphone"]
        }
    }

    // MARK: The card (F04)

    /// Shows "Sending to {name}" with Options, and starts the 1.5 s countdown unless the card waits for Send.
    func presentCard() async {
        let store = self.store
        var host: String?
        if case let .page(_, url, _, _)? = payloads.first { host = URL(string: url)?.host }
        let wantedHost = host
        let read = await AppModel.onStorage { () -> (always: Bool, review: Bool, f10: Bool, remembered: String?) in
            let p = LabPreferences(store: store)
            return (p.alwaysShowOptions, p.reviewBeforeSending, p.inUse("F10"), wantedHost.flatMap { p.sendAs(host: $0) })
        }
        var content = ShareInPlaceCard.Content.other
        var capture: PageCapture?
        if payloads.count == 1 {
            switch payloads[0] {
            case let .page(_, _, _, c):
                capture = c
                content = .page(clean: c?.article != nil, selection: c?.hasSelection ?? false)
            case let .text(t):
                if ShareNormaliser.findShareURL(t) != nil { content = .textWithLink }
            default:
                break
            }
        }
        // F03.3's line, once on this device: the card waits so it can be read. A page too big to clean goes as its link
        // ("This page can’t be read here, so its link will be sent.").
        let once = await labOnceNote()
        var hint = once
        if hint == nil, let capture, capture.cleanHTML == nil, capture.article == nil, !capture.hasSelection { hint = LabText["shareInPlace.linkOnlyCard"] }
        let isPage: Bool
        if case .page = content { isPage = true } else { isPage = false }
        let sendAs = read.f10 ? LabShare.defaultMode(capture: capture, remembered: read.remembered) : .page
        let waits = ShareInPlace.waitsForSend(comfort: comfort, alwaysShowOptions: read.always)
            || (isPage && read.f10 && read.review) || once != nil
        let name = ShareText.cleanName(daylightName)
        card = ShareInPlaceCard(
            title: LabText.fill(LabText["shareInPlace.card"], ["name": name.isEmpty ? LabText["shareInPlace.yourDaylight"] : name]),
            waitsForSend: waits, optionsOpen: waits, content: content, sendAs: sendAs, sendAsOffered: read.f10,
            asExcerpt: false, linkInstead: false, thinWords: nil, thinAccepted: false, review: nil, hint: hint, sending: false)
        phase = .card
        guard !waits else { return }
        countdown?.cancel()
        countdown = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(ShareInPlace.countdown * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.sendFromCard()
        }
    }

    /// Options: stops the countdown and shows the choices and Send.
    public func openOptions() {
        countdown?.cancel()
        countdown = nil
        card?.optionsOpen = true
    }

    public func chooseSendAs(_ mode: LabShare.SendAs) {
        card?.sendAs = mode
        card?.thinWords = nil
        card?.thinAccepted = false
    }

    public func setAsExcerpt(_ on: Bool) { card?.asExcerpt = on }

    public func setLinkInstead(_ on: Bool) { card?.linkInstead = on }

    /// The thin check's "Send full page": the page as it is, now.
    public func sendFullPage() {
        card?.sendAs = .page
        card?.thinWords = nil
        Task { await sendFromCard() }
    }

    /// The thin check's "Send anyway": Clean article as it is, now.
    public func sendThinAnyway() {
        card?.thinWords = nil
        card?.thinAccepted = true
        Task { await sendFromCard() }
    }

    /// Review's title field.
    public func setReviewTitle(_ title: String) { card?.review?.title = title }

    /// Review's Cancel: back to Options.
    public func cancelReview() {
        card?.review = nil
        card?.optionsOpen = true
    }

    /// Send (or the end of the countdown): the thin check and Review first when they apply, then the items go.
    public func sendFromCard() async {
        countdown?.cancel()
        countdown = nil
        guard var c = card, !c.sending else { return }
        var capture: PageCapture?
        var pageURL: String?
        if payloads.count == 1, case let .page(_, url, _, cap) = payloads[0] {
            capture = cap
            pageURL = url
        }
        let usesSendAs = c.sendAsOffered && pageURL != nil
        // F10's thin check: Clean article under 150 words asks first.
        if usesSendAs, c.sendAs == .clean, !c.thinAccepted, let a = capture?.article, a.words < LabShare.thinWords {
            c.thinWords = a.words
            c.optionsOpen = true
            card = c
            return
        }
        // F10's Review, when it is on: the page as it will go, before it goes.
        if usesSendAs, c.review == nil, c.sendAs == .page || c.sendAs == .clean {
            let store = self.store
            let review = await AppModel.onStorage { LabPreferences(store: store).reviewBeforeSending }
            if review, let cap = capture {
                let html = c.sendAs == .clean ? (cap.article?.html ?? cap.cleanHTML ?? "") : (cap.cleanHTML ?? "")
                let words = c.sendAs == .clean ? (cap.article?.words ?? cap.words) : cap.words
                var title = summary
                if case let .page(_, _, t, _) = payloads[0] { title = t ?? summary }
                c.review = ShareInPlaceCard.Review(html: html, stats: LabShare.reviewStats(words: words, html: html), title: title)
                c.optionsOpen = false
                card = c
                return
            }
        }
        c.sending = true
        card = c
        await commit(c, pageHost: pageURL.flatMap { URL(string: $0)?.host })
    }

    /// Makes the items the card chose and sends them: handed to the background session and closed (an App Group
    /// build), or sent here with v1.1's card until "Sent" (the ad-hoc Mac).
    private func commit(_ c: ShareInPlaceCard, pageHost: String?) async {
        let store = self.store
        var made: [Result<ItemInput, Error>] = []
        var files: [URL?] = []
        var lines: [String] = []
        for payload in payloads {
            do {
                var mode: LabShare.SendAs? = c.sendAsOffered ? c.sendAs : .page
                if c.linkInstead { mode = .link }
                var input: ItemInput
                switch payload {
                case let .text(text) where c.asExcerpt:
                    let r = ShareNormaliser.normalise(text: text, source: ShareNormaliser.sourceSelection)
                    guard let item = LabShare.excerptInput(text: r.excerpt ?? text, url: r.url, pageTitle: nil) else {
                        throw ShareError("content", "There’s nothing here Send to Daylight can send.")
                    }
                    input = item
                case let .file(url, name) where labFeatures.backgroundPublishing && store.isShared:
                    // Streamed from the file by the frame builder (never all of it in memory).
                    if let link = AppModel.linkInShortcutFile(url) {
                        input = .link(link, title: (name as NSString).deletingPathExtension)
                    } else {
                        if let size = SharePayloadReader.fileSize(url), size > DLS.maxItem { throw ShareError.tooLarge(size) }
                        input = ItemInput(kind: .file, name: name, mime: ShareText.mimeType(forFileName: name))
                        files.append(url)
                        made.append(.success(input))
                        continue
                    }
                default:
                    let r = try await labInput(for: payload, mode: mode)
                    input = r.input
                    if let n = r.note { lines.append(n) }
                }
                if let review = c.review, input.kind == .page { input.title = review.title }
                made.append(.success(input))
                files.append(nil)
            } catch {
                made.append(.failure(error))
                files.append(nil)
            }
        }
        if c.sendAsOffered, let host = pageHost, c.sendAs != .selection {
            let mode = c.sendAs.rawValue
            await AppModel.onStorage { LabPreferences(store: store).setSendAs(mode, host: host) }
        }
        if labFeatures.backgroundPublishing, store.isShared, let uploads = backgroundUploads ?? Self.systemUploads(store) {
            await publishInBackground(made, files: files, uploads: uploads)
        } else {
            await send(prepared: made, preparedNote: lines.first)
        }
    }

    /// The system's background session for this App Group (nil where there is none).
    static func systemUploads(_ store: SharedStore) -> BackgroundUploads? {
        #if canImport(ObjectiveC)
        return BackgroundUploadSession(appGroup: store.appGroup)
        #else
        return nil
        #endif
    }

    /// F04 with an App Group: builds each item's frames, starts their uploads and closes; the app reads the answers
    /// (`BackgroundPublisher.complete`) and posts the notice when one fails. Anything refused here (too big, not a web
    /// address) shows on the card, as v1.1 shows it.
    private func publishInBackground(_ made: [Result<ItemInput, Error>], files: [URL?], uploads: BackgroundUploads) async {
        let store = self.store
        phase = .sending
        let problems = await AppModel.onStorage { () -> [String] in
            guard let pairing = store.pairing else { return [ShareError.notPaired.message] }
            let publisher = BackgroundPublisher(outbox: OutboxStore(store: store), uploads: uploads)
            var out: [String] = []
            var started: [OutboxRow] = []
            for (k, r) in made.enumerated() {
                do {
                    started.append(try publisher.start(try r.get(), file: files[k], pairing: pairing,
                                                       from: DaylightShare.deviceName(store: store),
                                                       app: DaylightShare.appIdentifier))
                } catch {
                    out.append((error as? ShareError)?.message ?? error.localizedDescription)
                }
            }
            if !started.isEmpty {
                let prefs = LabPreferences(store: store)
                prefs.shareInPlaceUsed = true
                prefs.shareSheetUsed = true
                ActivityLog(store: store).add(type: "send", rows: started)
            }
            return out
        }
        if problems.isEmpty {
            done()
        } else {
            phase = .result(title: problems.count == made.count ? "Not sent" : "Not everything was sent",
                            message: problems.joined(separator: " "))
        }
    }
}

// MARK: The card's views

/// The share-in-place card (F04): "Sending to {name}", what is sent, and Options (for 1.5 s, unless it waits for Send);
/// with Options open, the choices (`OptionsSheet`) and Send; Review when it shows (`ReviewView`).
public struct ShareInPlaceCardView: View {
    @ObservedObject var model: ShareExtensionModel
    let card: ShareInPlaceCard

    public init(model: ShareExtensionModel, card: ShareInPlaceCard) {
        self.model = model
        self.card = card
    }

    public static let optionsID = "share-options"
    public static let sendID = "share-send"

    public var body: some View {
        VStack(spacing: 14) {
            if let review = card.review {
                ReviewView(review: review, onTitle: { model.setReviewTitle($0) }, onSend: { Task { await model.sendFromCard() } },
                           onCancel: { model.cancelReview() })
            } else {
                Text(card.title).dlsFont(.headline).multilineTextAlignment(.center).wrapping(card.title)
                    .accessibilityAddTraits(.isHeader)
                if !model.summary.isEmpty {
                    Text(model.summary).dlsFont(.callout).dlsSecondary().lineLimit(model.comfort ? nil : 2)
                        .multilineTextAlignment(.center).truncationProbe(model.summary)
                }
                if let hint = card.hint {
                    Text(hint).dlsFont(.callout).multilineTextAlignment(.center).wrapping(hint)
                }
                if card.sending {
                    if model.comfort {
                        let label = RowText(status: .sending, errorCode: "", size: 0, created: Date()).label
                        Text(label).dlsFont(.callout).wrapping(label)
                    } else {
                        ProgressView().accessibilityHidden(true)
                    }
                } else if card.optionsOpen {
                    OptionsSheet(model: model, card: card)
                } else {
                    Button { model.openOptions() } label: {
                        Text(LabText["shareInPlace.options"]).wrapping(LabText["shareInPlace.options"]).comfortTarget()
                    }
                    .buttonStyle(.bordered)
                    .comfortBorder()
                    .accessibilityIdentifier(Self.optionsID)
                }
            }
        }
    }
}

/// Options (F04, F10, F11): Send as for a page (Page as you see it, Clean article, Link only, Selection), with the thin
/// check; "Send as excerpt" for text with a link; "Send the link instead" for a page without Send as; then Send. Shown
/// at once, with no countdown, for people who need more time (F04's accessibility rule).
public struct OptionsSheet: View {
    @ObservedObject var model: ShareExtensionModel
    let card: ShareInPlaceCard

    public init(model: ShareExtensionModel, card: ShareInPlaceCard) {
        self.model = model
        self.card = card
    }

    private var modes: [LabShare.SendAs] {
        guard case let .page(clean, selection) = card.content else { return [] }
        return LabShare.SendAs.allCases.filter { m in
            switch m {
            case .page, .link: return true
            case .clean: return clean
            case .selection: return selection
            }
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if card.sendAsOffered, !modes.isEmpty {
                let line = LabText.fill(LabText["sendAs.line"], ["mode": card.sendAs.shortTitle])
                Picker(selection: Binding(get: { card.sendAs }, set: { model.chooseSendAs($0) })) {
                    ForEach(modes, id: \.self) { m in Text(m.menuTitle).tag(m) }
                } label: {
                    Text(line).wrapping(line)
                }
                .pickerStyle(.menu)
                .accessibilityLabel(line)
            } else if case .page = card.content {
                Toggle(isOn: Binding(get: { card.linkInstead }, set: { model.setLinkInstead($0) })) {
                    Text(LabText["shareInPlace.sendLinkInstead"]).wrapping(LabText["shareInPlace.sendLinkInstead"])
                }
            }
            if case .textWithLink = card.content {
                Picker(selection: Binding(get: { card.asExcerpt }, set: { model.setAsExcerpt($0) })) {
                    Text(LabText["shareInPlace.sendLink"]).tag(false)
                    Text(LabText["shareInPlace.sendAsExcerpt"]).tag(true)
                } label: {
                    Text(LabText["shareInPlace.sendAsExcerpt"]).wrapping(LabText["shareInPlace.sendAsExcerpt"])
                }
                .pickerStyle(.inline)
            }
            if let words = card.thinWords {
                let thin = LabShare.thinText(words: words)
                LabNote(thin)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { thinButtons }
                    VStack(alignment: .leading, spacing: 8) { thinButtons }
                }
            } else {
                Button { Task { await model.sendFromCard() } } label: {
                    Text(LabText["shareInPlace.send"]).wrapping(LabText["shareInPlace.send"]).comfortTarget()
                }
                .buttonStyle(.borderedProminent)
                .comfortBorder()
                .accessibilityIdentifier(ShareInPlaceCardView.sendID)
            }
            Button(role: .cancel) { model.cancel() } label: {
                Text(LabText["automation.cancel"]).wrapping(LabText["automation.cancel"]).comfortTarget()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var thinButtons: some View {
        Button { model.sendFullPage() } label: {
            Text(LabText["sendAs.sendFull"]).wrapping(LabText["sendAs.sendFull"]).comfortTarget()
        }
        .buttonStyle(.borderedProminent)
        .comfortBorder()
        Button { model.sendThinAnyway() } label: {
            Text(LabText["sendAs.sendAnyway"]).wrapping(LabText["sendAs.sendAnyway"]).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
    }
}

/// Review (F10, "Review before sending"): the page as it will be sent, with JavaScript off and in grey (`filter:
/// grayscale(1)`), its words and size ("{n} words · about {mb} MB"), the title (which can be changed: the edited title
/// is the title sent), Send and Cancel.
public struct ReviewView: View {
    let review: ShareInPlaceCard.Review
    let onTitle: (String) -> Void
    let onSend: () -> Void
    let onCancel: () -> Void
    @State private var title = ""

    public init(review: ShareInPlaceCard.Review, onTitle: @escaping (String) -> Void, onSend: @escaping () -> Void,
                onCancel: @escaping () -> Void) {
        self.review = review
        self.onTitle = onTitle
        self.onSend = onSend
        self.onCancel = onCancel
    }

    public static let titleFieldID = "review-title"

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LabText["sendAs.reviewTitle"]).dlsFont(.headline).wrapping(LabText["sendAs.reviewTitle"])
                .accessibilityAddTraits(.isHeader)
            TextField(LabText["shareInPlace.title"], text: $title)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(LabText["shareInPlace.title"])
                .accessibilityIdentifier(Self.titleFieldID)
                .comfortBorder()
                .onChange(of: title) { onTitle($0) }
            Text(review.stats).dlsFont(.footnote).dlsSecondary().wrapping(review.stats)
            WebPreview(html: review.html)
                .frame(minHeight: 220, maxHeight: 420)
                .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.4), lineWidth: 1) }
                .accessibilityLabel(review.title)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { buttons }
                VStack(alignment: .leading, spacing: 8) { buttons }
            }
        }
        .onAppear { title = review.title }
    }

    @ViewBuilder private var buttons: some View {
        Button(action: onSend) {
            Text(LabText["shareInPlace.send"]).wrapping(LabText["shareInPlace.send"]).comfortTarget()
        }
        .buttonStyle(.borderedProminent)
        .comfortBorder()
        Button(role: .cancel, action: onCancel) {
            Text(LabText["automation.cancel"]).wrapping(LabText["automation.cancel"]).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
    }
}

#if canImport(WebKit)
/// A page shown with JavaScript off and in grey (F10's Review): nothing in it runs.
struct WebPreview {
    let html: String

    /// The page with a grey filter in front of its own styles.
    static func greyed(_ html: String) -> String {
        "<style>html{filter:grayscale(1)}</style>" + html
    }

    static func makeView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        return WKWebView(frame: .zero, configuration: config)
    }
}

#if os(iOS)
extension WebPreview: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { Self.makeView() }
    func updateUIView(_ view: WKWebView, context: Context) { view.loadHTMLString(Self.greyed(html), baseURL: nil) }
}
#elseif os(macOS)
extension WebPreview: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { Self.makeView() }
    func updateNSView(_ view: WKWebView, context: Context) { view.loadHTMLString(Self.greyed(html), baseURL: nil) }
}
#endif
#else
struct WebPreview: View {
    let html: String
    var body: some View { Text(html).lineLimit(20) }
}
#endif
