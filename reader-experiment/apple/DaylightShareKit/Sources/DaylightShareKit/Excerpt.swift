import Foundation

/// A selection sent as an excerpt (LAB-PLAN F11; LAB-PROTOCOL 2.9.3): the JavaScript `excerptItem`, `excerptHtml`,
/// `excerptMarkdown`, `excerptFileName`, `excerptTitle`, `textFragment`, `excerptDate`, `sanitizeExcerptHtml` and
/// `excerptTextHtml`, pinned by lab-vectors.json › labExcerpt.
///
/// Excerpts are documents (the Reader would take a page for its article and drop it as a duplicate): with a source URL
/// an HTML file whose `url` carries a text fragment, without one a Markdown note. Both carry `x-cap: "excerpt"`. Text
/// becomes an excerpt only from an explicit selection (6.5 Q1 = b, `ShareNormaliser`); text with no link at all is a
/// note (LAB-DECISIONS, Oct 23).
public enum Excerpt {
    public static let maxChars = 50_000
    public static let lineMax = 100
    public static let nameWords = 6
    public static let textFragmentWords = 8

    /// The tags an excerpt keeps; `href` only on `a`, and only http(s).
    public static let tags = ["p", "br", "b", "strong", "i", "em", "u", "s", "sub", "sup", "a", "ul", "ol", "li",
                              "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]
    /// Block tags an excerpt keeps as paragraphs, so that their text does not run together.
    public static let asParagraph = ["address", "article", "aside", "caption", "center", "dd", "details", "div", "dt",
                                     "figcaption", "figure", "footer", "header", "main", "section", "summary", "tr"]
    /// Elements an excerpt drops with everything inside them.
    public static let dropped = ["script", "style", "template", "noscript", "iframe", "object", "textarea", "select",
                                 "title", "head", "svg", "math", "canvas", "video", "audio", "button"]

    /// An excerpt ready to send: a file, `text/html` (with a source URL, `url` set) or `text/markdown` (a note, `url`
    /// nil), with its name, title, content and `x-cap: "excerpt"`.
    public struct Item: Equatable, Sendable {
        public let mime: String
        public let name: String
        public let url: String?
        public let title: String
        public let content: String
        public let extras: [String: String]

        /// What `ShareSender.send` takes (with Lab on, the extras become the item's Lab header fields).
        public var input: ItemInput {
            var i = ItemInput.file(Data(content.utf8), name: name, mime: mime, title: title, sourceURL: url)
            i.extras = extras
            return i
        }
    }

    /// `sanitize`'s answer: the HTML, and whether text was cut at the limit.
    public struct HTML: Equatable, Sendable {
        public let html: String
        public let trimmed: Bool
    }

    typealias Scalars = JSText.Scalars

    // MARK: Names, titles, fragments, dates

    /// "Excerpt - {first 6 words}.html", or with `note` "Note - {first 6 words}.md" (through `ShareText.safeFileName`).
    public static func fileName(_ text: String?, note: Bool = false) -> String {
        let bare = LabText[note ? "excerpt.noteNameBare" : "excerpt.fileNameBare"]
        let w = JSText.words(text).prefix(nameWords).joined(separator: " ")
        guard !w.isEmpty else { return bare }
        return ShareText.safeFileName(LabText.fill(LabText[note ? "excerpt.noteName" : "excerpt.fileName"], ["words": w]),
                                      fallback: bare)
    }

    /// The excerpt's first line: the first line with text, whitespace collapsed, cut to 100 characters with "…".
    public static func firstLine(_ text: String?) -> String {
        let line = JSText.lines(text ?? "").lazy.map { JSText.trim(JSText.collapse($0)) }.first { !$0.isEmpty } ?? ""
        let cps = JSText.scalars(line)
        guard cps.count > lineMax else { return line }
        return JSText.trimEnd(JSText.string(cps.prefix(lineMax))) + "…"
    }

    /// "“{first line}” · {page title}" ("“{first line}”" without one; the page title alone without a line), through
    /// `ShareText.cleanTitle`.
    public static func title(_ text: String?, pageTitle: String? = "") -> String {
        let line = firstLine(text)
        let page = ShareText.cleanTitle(pageTitle)
        if line.isEmpty { return page }
        return ShareText.cleanTitle(page.isEmpty ? LabText.fill(LabText["excerpt.titleBare"], ["line": line])
                                        : LabText.fill(LabText["excerpt.title"], ["line": line, "page": page]))
    }

    /// The source URL plus a text fragment of the first 8 words: the URL without its fragment, then "#:~:text=" and the
    /// words joined with one space, UTF-8 percent-encoded except `A-Z a-z 0-9 _ . ! ~ * ' ( )` (so `-`, `,` and `&` are
    /// encoded). The URL unchanged when there are no words, or the result is over 4,096 characters or fails the web URL
    /// rule. nil when the URL fails the web URL rule.
    public static func textFragment(_ url: String?, text: String?) -> String? {
        guard let u = ShareText.webURL(url) else { return nil }
        let w = JSText.words(text).prefix(textFragmentWords)
        guard !w.isEmpty else { return u }
        let enc = JSText.encodeURIComponent(w.joined(separator: " ")).replacingOccurrences(of: "-", with: "%2D")
        let s = JSText.scalars(u)
        let base = JSText.index(of: "#", in: s).map { JSText.string(s[..<$0]) } ?? u
        let out = base + "#:~:text=" + enc
        guard out.utf16.count <= DLS.maxURL, let checked = ShareText.webURL(out), JSText.same(checked, out) else { return u }
        return out
    }

    /// "22 October 2026": from "YYYY-MM-DD" (its fields checked as rule D checks them), or from a `Date` (or ms since
    /// 1970, an `NSNumber`) as a date in `timeZone`. "" for anything else.
    public static func date(_ value: Any?, timeZone: TimeZone = .current) -> String {
        var y = 0, m = 0, d = 0
        if let s = value as? String {
            let u = Array(s.utf8)
            guard u.count == 10, u[4] == 0x2D, u[7] == 0x2D else { return "" }
            func digits(_ r: Range<Int>) -> Int? {
                var n = 0
                for k in r {
                    guard u[k] >= 0x30 && u[k] <= 0x39 else { return nil }
                    n = n * 10 + Int(u[k] - 0x30)
                }
                return n
            }
            guard let yy = digits(0..<4), let mm = digits(5..<7), let dd = digits(8..<10) else { return "" }
            guard (1...12).contains(mm), dd >= 1, dd <= Int(Lab.monthDays(Int64(yy), Int64(mm))) else { return "" }
            (y, m, d) = (yy, mm, dd)
        } else {
            let when: Date
            if let date = value as? Date {
                when = date
            } else if let ms = milliseconds(value), ms.isFinite, abs(ms) <= 8.64e15 {
                when = Date(timeIntervalSince1970: ms / 1000)
            } else {
                return ""
            }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = timeZone
            let c = calendar.dateComponents([.year, .month, .day], from: when)
            guard let yy = c.year, let mm = c.month, let dd = c.day else { return "" }
            (y, m, d) = (yy, mm, dd)
        }
        let months = LabText.list("excerpt.months")
        guard m >= 1, m <= months.count else { return "" }
        return LabText.fill(LabText["excerpt.date"], ["d": String(d), "month": months[m - 1], "y": String(y)])
    }

    /// A number (ms since 1970) as JavaScript's `typeof date === 'number'` sees one: never a boolean.
    static func milliseconds(_ v: Any?) -> Double? {
        guard let v else { return nil }
        #if canImport(ObjectiveC)
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
        #else
        if v is Bool { return nil }
        if let i = v as? Int { return Double(i) }
        if let i = v as? Int64 { return Double(i) }
        if let d = v as? Double { return d }
        return (v as? NSNumber)?.doubleValue
        #endif
    }

    // MARK: Sanitising (2.9.3)

    /// Removes comments (`<!--` to the first `-->` after it, or to the end), then every other `<!…>` and `<?…>` (to
    /// the next `>`, or the end).
    static func dropMarkup(_ s: Scalars) -> Scalars {
        var a: Scalars = []
        a.reserveCapacity(s.count)
        var i = 0
        while i < s.count {
            if JSText.has(s, at: i, "<!--") {
                guard let close = JSText.index(of: "-->", in: s, from: i + 4) else { break }
                i = close + 3
            } else {
                a.append(s[i])
                i += 1
            }
        }
        var out: Scalars = []
        out.reserveCapacity(a.count)
        i = 0
        while i < a.count {
            if a[i] == "<" && i + 1 < a.count && (a[i + 1] == "!" || a[i + 1] == "?") {
                guard let gt = JSText.index(of: ">", in: a, from: i + 2) else { break }
                i = gt + 1
            } else {
                out.append(a[i])
                i += 1
            }
        }
        return out
    }

    /// Step 2 for one name, in one pass: each `<name` followed by whitespace, `/` or `>` (any ASCII case), up to the next
    /// `>`, and everything after it to the first `</name` + optional whitespace + `>` (or to the end), is removed. An
    /// opening tag with no `>` after it stays, and so does everything after it.
    static func dropElement(_ s: Scalars, _ name: String) -> Scalars {
        let n = name.unicodeScalars.count
        func opens(at i: Int) -> Bool {
            s[i] == "<" && JSText.hasCI(s, at: i + 1, name) && i + 1 + n < s.count
                && (JSText.isWS(s[i + 1 + n]) || s[i + 1 + n] == "/" || s[i + 1 + n] == ">")
        }
        func closes(from: Int) -> (start: Int, end: Int)? {
            var i = from
            while let lt = JSText.index(of: "<", in: s, from: i) {
                if lt + 1 < s.count, s[lt + 1] == "/", JSText.hasCI(s, at: lt + 2, name) {
                    var k = lt + 2 + n
                    while k < s.count && JSText.isWS(s[k]) { k += 1 }
                    if k < s.count && s[k] == ">" { return (lt, k + 1) }
                }
                i = lt + 1
            }
            return nil
        }
        var out: Scalars = []
        var from = 0
        var i = 0
        while i < s.count {
            guard opens(at: i) else {
                i += 1
                continue
            }
            // No > after this one means none after any later one either.
            guard let gt = JSText.index(of: ">", in: s, from: i + 1 + n) else { break }
            out.append(contentsOf: s[from..<i])
            guard let c = closes(from: gt + 1) else { return out }
            from = c.end
            i = c.end
        }
        out.append(contentsOf: s[from...])
        return out
    }

    /// The character reference at `i` (`&name;` of a letter and up to 31 letters or digits, `&#digits;` of 1-7,
    /// `&#xhex;` of 1-6, within `end`), as its length in scalars, or nil.
    static func referenceLength(_ s: Scalars, at i: Int, end: Int) -> Int? {
        guard s[i] == "&", i + 1 < end else { return nil }
        var j = i + 1
        if JSText.isASCIILetter(s[j]) {
            j += 1
            while j < end && JSText.isASCIIAlnum(s[j]) { j += 1 }
            guard j - (i + 1) <= 32, j < end, s[j] == ";" else { return nil }
            return j + 1 - i
        }
        guard s[j] == "#" else { return nil }
        j += 1
        var start = j
        while j < end && JSText.isDigit(s[j]) { j += 1 }
        if j > start {
            guard j - start <= 7, j < end, s[j] == ";" else { return nil }
            return j + 1 - i
        }
        guard j < end, s[j] == "x" || s[j] == "X" else { return nil }
        j += 1
        start = j
        while j < end && JSText.isHex(s[j]) { j += 1 }
        guard j > start, j - start <= 6, j < end, s[j] == ";" else { return nil }
        return j + 1 - i
    }

    /// An excerpt's selection HTML, sanitised (LAB-PROTOCOL 2.9.3): comments and other markup removed, `dropped`
    /// elements removed with their content, then text escaped and tags kept only from `tags` (`asParagraph` as `p`),
    /// with no attributes but an `a`'s http(s) `href`; a closing tag closes what it opened, and everything open is closed
    /// at the end. Text past `maxChars` characters (a character reference counts as one) is cut, and `trimmed` says so.
    public static func sanitize(_ html: String?, maxChars: Int = Excerpt.maxChars) -> HTML {
        var s = dropMarkup(JSText.scalars(html))
        for name in dropped { s = dropElement(s, name) }
        var out = String.UnicodeScalarView()
        var count = 0
        var trimmed = false
        var stack: [String] = []
        func append(_ t: String) { out.append(contentsOf: t.unicodeScalars) }
        /// Copies the text between tags; false once the limit cut it.
        func text(_ from: Int, _ to: Int) -> Bool {
            var i = from
            while i < to {
                if count >= maxChars {
                    trimmed = true
                    return false
                }
                let c = s[i]
                if c == "&" {
                    // The reference reads a reference within the next 40 UTF-16 units; one is at most 34 long.
                    if let len = referenceLength(s, at: i, end: min(to, i + 40)) {
                        out.append(contentsOf: s[i..<(i + len)])
                        i += len
                    } else {
                        append("&amp;")
                        i += 1
                    }
                } else if c == "<" {
                    append("&lt;")
                    i += 1
                } else if c == ">" {
                    append("&gt;")
                    i += 1
                } else {
                    out.append(c)
                    i += 1
                }
                count += 1
            }
            return true
        }
        var last = 0
        for tag in JSText.tags(s) {
            if !text(last, tag.start) { break }
            last = tag.end
            var name = tag.name.lowercased()
            if asParagraph.contains(name) { name = "p" }
            if !tags.contains(name) || (name == "br" && tag.closing) { continue }
            if tag.closing {
                if let k = stack.lastIndex(of: name) {
                    while stack.count > k { append("</\(stack.removeLast())>") }
                }
            } else if name == "br" {
                append("<br>")
            } else {
                let href = name == "a" ? JSText.attrValue(tag.attrs, "href") : nil
                if let href, let u = ShareText.webURL(JSText.decodeEntities(href)) {
                    append("<a href=\"\(JSText.escapeAttr(u))\">")
                } else {
                    append("<\(name)>")
                }
                stack.append(name)
            }
        }
        if !trimmed { _ = text(last, s.count) }
        while let open = stack.popLast() { append("</\(open)>") }
        return HTML(html: String(out), trimmed: trimmed)
    }

    /// Plain selection text as excerpt HTML: CRLF and CR as LF, cut to `maxChars` characters, then paragraphs (split at
    /// lines that are only whitespace) of escaped lines joined with `<br>`.
    public static func textHTML(_ text: String?, maxChars: Int = Excerpt.maxChars) -> HTML {
        var cps = JSText.scalars(JSText.lf(text ?? ""))
        let trimmed = cps.count > maxChars
        if trimmed { cps = Array(cps.prefix(maxChars)) }
        var paras: [[String]] = []
        var cur: [String] = []
        for line in cps.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.allSatisfy(JSText.isWS) {
                if !cur.isEmpty {
                    paras.append(cur)
                    cur = []
                }
            } else {
                cur.append(JSText.string(line))
            }
        }
        if !cur.isEmpty { paras.append(cur) }
        let html = paras.map { p in "<p>" + p.map(JSText.escapeText).joined(separator: "<br>") + "</p>" }.joined()
        return HTML(html: html, trimmed: trimmed)
    }

    // MARK: The documents

    /// The excerpt document, for a selection with a source URL (LAB-PROTOCOL 2.9.3): its title, then
    /// `<p><a href="{source}">{page title}</a> · {site} · {date}</p><blockquote>{selection}</blockquote>`. The source is
    /// `url` without its text fragment; the site is `site`, else the URL's host without "www.", left out when it equals
    /// the link's text; the date is `date(date)`. The selection is `sanitize(html)` when `html` has text, else
    /// `textHTML(text)`, with "(Excerpt trimmed to 50,000 characters.)" after it when cut.
    public static func html(text: String? = "", html: String? = "", url: String? = "", pageTitle: String? = "",
                            site: String? = "", date: Any? = nil, timeZone: TimeZone = .current) -> String {
        let src = (url ?? "").isEmpty ? nil : ShareText.webURL(url)
        let source = src.map { ShareNormaliser.withoutTextFragment($0) } ?? ""
        let body = JSText.trim(html ?? "").isEmpty ? textHTML(JSText.trim(text ?? "")) : sanitize(html)
        let quote = body.html + (body.trimmed ? "<p>\(JSText.escapeText(LabText["excerpt.trimmed"]))</p>" : "")
        let page = ShareText.cleanTitle(pageTitle)
        var host = source.isEmpty ? "" : JSText.urlParts(source).host
        if JSText.startsWith(host, "www.") { host = JSText.string(host.unicodeScalars.dropFirst(4)) }
        let siteName = ShareText.cleanTitle(site).isEmpty ? host : ShareText.cleanTitle(site)
        let linkText = page.isEmpty ? siteName : page
        var parts: [String] = []
        if !source.isEmpty {
            parts.append("<a href=\"\(JSText.escapeAttr(source))\">\(JSText.escapeText(linkText.isEmpty ? source : linkText))</a>")
        } else if !linkText.isEmpty {
            parts.append(JSText.escapeText(linkText))
        }
        if !siteName.isEmpty && !JSText.same(siteName, linkText) { parts.append(JSText.escapeText(siteName)) }
        let d = Self.date(date, timeZone: timeZone)
        if !d.isEmpty { parts.append(JSText.escapeText(d)) }
        let head = parts.isEmpty ? "" : "<p>\(parts.joined(separator: " · "))</p>"
        return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + JSText.escapeText(title(text, pageTitle: pageTitle))
            + "</title></head><body><article>\n" + head + "<blockquote>" + quote + "</blockquote></article></body></html>"
    }

    /// The note for text without a URL: the text (CRLF and CR as LF, trimmed; over 50,000 characters cut and followed by
    /// a blank line and "(Excerpt trimmed to 50,000 characters.)"), a blank line, "— shared from {app} on {date}" ("—
    /// shared on {date}" without an app, "— shared from {app}" without a date, nothing without either), and a final LF.
    public static func markdown(text: String? = "", app: String? = "", date: Any? = nil, timeZone: TimeZone = .current) -> String {
        let cps = JSText.scalars(JSText.trim(JSText.lf(text ?? "")))
        let body = cps.count > maxChars ? JSText.string(cps.prefix(maxChars)) + "\n\n" + LabText["excerpt.trimmed"]
            : JSText.string(cps)
        let a = ShareText.cleanName(app)
        let d = Self.date(date, timeZone: timeZone)
        let footer: String
        if !a.isEmpty && !d.isEmpty {
            footer = LabText.fill(LabText["excerpt.sharedFromOn"], ["app": a, "date": d])
        } else if !d.isEmpty {
            footer = LabText.fill(LabText["excerpt.sharedOn"], ["date": d])
        } else if !a.isEmpty {
            footer = LabText.fill(LabText["excerpt.sharedFrom"], ["app": a])
        } else {
            footer = ""
        }
        return footer.isEmpty ? body + "\n" : body + "\n\n" + footer + "\n"
    }

    /// The item for a selection, ready to send: with a source `url` (passing the web URL rule) an HTML document whose
    /// `url` is the source with a text fragment (kept as it is when it already has one); without one a Markdown note.
    /// nil when the text is empty. `date`: "YYYY-MM-DD", or a `Date` in `timeZone`; `app`: where a note came from
    /// ("Notes").
    public static func item(text: String? = "", html: String? = "", url: String? = "", pageTitle: String? = "",
                            site: String? = "", app: String? = "", date: Any? = nil,
                            timeZone: TimeZone = .current) -> Item? {
        let t = JSText.trim(text ?? "")
        guard !t.isEmpty else { return nil }
        let extras = ["x-cap": "excerpt"]
        if !(url ?? "").isEmpty, let src = ShareText.webURL(url) {
            return Item(mime: "text/html", name: fileName(t),
                        url: ShareNormaliser.hasTextFragment(src) ? src : textFragment(src, text: t),
                        title: title(t, pageTitle: pageTitle),
                        content: Self.html(text: t, html: html, url: src, pageTitle: pageTitle, site: site, date: date,
                                           timeZone: timeZone),
                        extras: extras)
        }
        return Item(mime: "text/markdown", name: fileName(t, note: true), url: nil, title: title(t),
                    content: markdown(text: t, app: app, date: date, timeZone: timeZone), extras: extras)
    }
}
