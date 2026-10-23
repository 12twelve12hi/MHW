import Foundation

/// What `GetPage.js` hands a Safari share besides v1.1's `html` (LAB-PLAN F03, F10, F11; `apple/Shared/ShareExtension`):
/// the page through clean-html.js, its words, Clean article and the selection. GetPage.js cannot read the Lab switch, so
/// it always makes these; the share extension uses them only with Lab on (`LabShare.pageInput`).
public struct PageCapture: Equatable, Sendable {
    /// Clean article (F10): the page that is sent (x-cap "clean"), its words, Readability's title, byline and site.
    public struct Article: Equatable, Sendable {
        public let html: String
        public let words: Int
        public let title: String
        public let byline: String
        public let site: String

        public init(html: String, words: Int, title: String = "", byline: String = "", site: String = "") {
            self.html = html
            self.words = words
            self.title = title
            self.byline = byline
            self.site = site
        }
    }

    /// The page as the user sees it through clean-html.js (no scripts but JSON-LD, no on* attributes, no form
    /// contents); nil when the page was over 8 MiB, or cleaning failed.
    public let cleanHTML: String?
    /// The page's visible text in words.
    public let words: Int
    /// Clean article; nil when the page was over 2 MiB or Readability found no article.
    public let article: Article?
    /// The selection as text and as markup; "" when nothing is selected.
    public let selectionText: String
    public let selectionHTML: String

    public init(cleanHTML: String?, words: Int = 0, article: Article? = nil, selectionText: String = "", selectionHTML: String = "") {
        self.cleanHTML = cleanHTML
        self.words = words
        self.article = article
        self.selectionText = selectionText
        self.selectionHTML = selectionHTML
    }

    /// Whether the user selected text on the page (F10's default: Selection; F11's explicit selection).
    public var hasSelection: Bool { !JSText.trim(selectionText).isEmpty }

    /// Reads GetPage.js's `lab` object (a dictionary from the JavaScript preprocessing results), or nil.
    public static func read(_ value: Any?) -> PageCapture? {
        guard let d = value as? [String: Any] else { return nil }
        func int(_ v: Any?) -> Int { (v as? NSNumber)?.intValue ?? (v as? Int) ?? 0 }
        var article: Article?
        if let a = d["article"] as? [String: Any], let html = a["html"] as? String, !html.isEmpty {
            article = Article(html: html, words: int(a["words"]), title: a["title"] as? String ?? "",
                              byline: a["byline"] as? String ?? "", site: a["site"] as? String ?? "")
        }
        let clean = (d["cleanHtml"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return PageCapture(cleanHTML: clean, words: int(d["words"]), article: article,
                           selectionText: d["selectionText"] as? String ?? "", selectionHTML: d["selectionHtml"] as? String ?? "")
    }
}

/// How a Lab share becomes an item (LAB-PLAN F03, F10, F11, F16), for the share sheet and the app's entry points. With
/// Lab off none of this runs: the share is v1.1's, byte for byte.
public enum LabShare {
    /// F10's modes: Page as you see it (the default), Clean article, Link only, Selection.
    public enum SendAs: String, CaseIterable, Sendable {
        case page, clean, link, selection

        /// "Page as you see it", "Clean article", "Link only", "Selection" (the menu's words).
        public var menuTitle: String { LabText["sendAs.menu.\(rawValue)"] }
        /// "Page", "Clean article", … (the line's words: "Send as: {mode} ▾").
        public var shortTitle: String { LabText["sendAs.short.\(rawValue)"] }
    }

    /// F10's thin check: an extraction under this many words asks "This page looks thin ({n} words). Send the full page
    /// instead?" (the Reader's `PaywallHint.BROWSER_RETRY_WORDS`).
    public static let thinWords = 150

    /// "This page looks thin ({n} words). Send the full page instead?"
    public static func thinText(words: Int) -> String { LabText.fill(LabText["sendAs.thin"], ["n": String(words)]) }

    /// "{n} words · about {mb} MB" (Review): the words and the size it is sent at (`formatMB` of the deflated size).
    public static func reviewStats(words: Int, html: String) -> String {
        let data = Data(html.utf8)
        #if canImport(Compression) || DLS_ZLIB
        let size = ((try? RawDeflate.compress(data)).map { min($0.count, data.count) }) ?? data.count
        #else
        let size = data.count
        #endif
        return LabText.fill(LabText["sendAs.reviewStats"], ["n": String(words), "mb": ShareText.formatMB(size)])
    }

    /// F10's default mode for a page: Selection when text is selected, then the mode last used on that site, then Page.
    /// (A PDF tab is a file, which the share sheet gives as one.)
    public static func defaultMode(capture: PageCapture?, remembered: String?) -> SendAs {
        if capture?.hasSelection == true { return .selection }
        if let r = remembered, let m = SendAs(rawValue: r), m != .selection { return m }
        return .page
    }

    /// A Safari page with Lab on (F03, F10, F11), as `mode` says:
    /// - page: the clean copy with x-cap "seen" (the link when there is none: a page over 8 MiB, as v1.1);
    /// - clean: Clean article with x-cap "clean" (the page when Readability found none);
    /// - link: the link alone;
    /// - selection: the selection as an excerpt (a document with x-cap "excerpt", F11's explicit path).
    /// The result's `note` is the line to show with it: v1.1's "…so its link was sent." when a page went as its link.
    public static func pageInput(html: String, url: String, title: String?, capture: PageCapture?, mode: SendAs = .page,
                                 date: Date = Date()) -> (input: ItemInput, note: String?) {
        let link = ItemInput.link(url, title: title)
        switch mode {
        case .link:
            return (link, nil)
        case .selection:
            if let c = capture, c.hasSelection,
               let excerpt = Excerpt.item(text: c.selectionText, html: c.selectionHTML, url: url, pageTitle: title, date: date) {
                return (excerpt.input, nil)
            }
            return pageInput(html: html, url: url, title: title, capture: capture, mode: .page, date: date)
        case .clean:
            if let a = capture?.article, a.html.utf8.count <= DLS.maxPageHTML {
                var i = ItemInput.page(html: a.html, url: url, title: title ?? a.title)
                i.extras = ["x-cap": "clean"]
                return (i, nil)
            }
            return pageInput(html: html, url: url, title: title, capture: capture, mode: .page, date: date)
        case .page:
            guard let clean = capture?.cleanHTML, clean.utf8.count <= DLS.maxPageHTML else {
                return (link, ShareText.pageSentAsLinkMessage)
            }
            var i = ItemInput.page(html: clean, url: url, title: title)
            i.extras = ["x-cap": "seen"]
            return (i, nil)
        }
    }

    /// A shared link with Lab on (F16): cleaned (unless F16's Use switch is off), an Apple News link resolved once, and
    /// `x-orig` when the cleaned URL differs. `text`: the text it was shared with, when there was any.
    public static func linkInput(url: String, title: String?, text: String? = nil, clean: Bool,
                                 fetch: @escaping ShareNormaliser.PageFetch = ShareNormaliser.ephemeralFetch) async -> ItemInput {
        let r = await ShareNormaliser.normaliseFetchingAppleNews(text: text ?? "", url: url, subject: title ?? "", clean: clean,
                                                                 fetch: fetch)
        guard r.kind == .link, let u = r.url else { return .link(url, title: title) }
        var i = ItemInput.link(u, title: r.title ?? title)
        i.extras = r.extras
        return i
    }

    /// Shared text with Lab on (F16, F11 rule 3): a link with its headline as the title when the text holds one (every
    /// "headline + link" share stays a link), else a Markdown note ("Note - ….md", x-cap "excerpt"): text with no link
    /// has nothing to fall back to, and the person chose it (LAB-DECISIONS, Oct 23). `title`: the share's subject (it
    /// wins over the text's words); `fallbackTitle`: the title when the text gives none (the share item's own title for
    /// text that is a link alone). `app`: where the text came from, when known. nil when there is nothing to send.
    public static func textInput(_ text: String, title: String? = nil, clean: Bool, fallbackTitle: String? = nil,
                                 app: String? = nil, date: Date = Date(),
                                 fetch: @escaping ShareNormaliser.PageFetch = ShareNormaliser.ephemeralFetch) async -> ItemInput? {
        let r = ShareNormaliser.normalise(text: text, subject: title ?? "", clean: clean)
        switch r.kind {
        case .link:
            guard let u = r.url else { return nil }
            return await linkInput(url: u, title: r.title ?? fallbackTitle, text: nil, clean: clean, fetch: fetch).withOrig(r.orig)
        case .note, .excerpt:
            return Excerpt.item(text: r.excerpt ?? text, app: app, date: date)?.input
        case .none:
            return nil
        }
    }

    /// The copied link (F33) as it would be sent, with its host for "Send {host} to {name}?": read through
    /// `normaliseShare` (cleaned unless F16's Use switch is off, `x-orig` when that changed it). nil when the clipboard
    /// holds no web link, or text that is not just a link.
    public static func copiedLink(_ text: String, clean: Bool) -> (input: ItemInput, host: String)? {
        let r = ShareNormaliser.normalise(text: text, clean: clean)
        guard r.kind == .link, let u = r.url, let host = URL(string: u)?.host, !host.isEmpty else { return nil }
        var i = ItemInput.link(u, title: r.title)
        i.extras = r.extras
        return (i, host)
    }

    /// An explicit selection with its page (F11: "Send as excerpt", a Safari selection): the excerpt document, or nil
    /// when the text is empty.
    public static func excerptInput(text: String, html: String = "", url: String?, pageTitle: String?, site: String? = nil,
                                    date: Date = Date()) -> ItemInput? {
        Excerpt.item(text: text, html: html, url: url ?? "", pageTitle: pageTitle ?? "", site: site ?? "", date: date)?.input
    }
}

extension ItemInput {
    /// Keeps the first `x-orig` (the URL as the user shared it) when a second cleaning step changed nothing more.
    func withOrig(_ orig: String?) -> ItemInput {
        guard let orig, extras["x-orig"] == nil, let u = url, !JSText.same(u, orig) else { return self }
        var i = self
        if orig.utf16.count <= ItemHeader.xOrigMax { i.extras["x-orig"] = orig }
        return i
    }
}
