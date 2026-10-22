import DaylightShareKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// One thing found in the share sheet's input.
public enum SharePayload: Equatable {
    /// A web page with its HTML (Safari's JavaScript preprocessing).
    case page(html: String, url: String, title: String?)
    case link(url: String, title: String?)
    /// A file copied to a temporary location.
    case file(url: URL, name: String)
    case text(String)
    /// A file over 9 MB: refused before it is read or copied (CHANGES-v1.1 2.2).
    case tooLarge(name: String, size: Int)
    /// A file that could not be copied out of the share sheet: `message` says why ("This device is out of space, so
    /// it can’t send this." when the disk is full).
    case unreadable(name: String, message: String)
    /// A `daylightshare://` pairing link (shared from the camera, Messages, …): it pairs, after the user confirms.
    case pairing(String)
}

/// Reads NSExtensionItems (iOS and macOS share extensions) into payloads.
public enum SharePayloadReader {
    static let propertyList = "com.apple.property-list"
    static let jsResultsKey = "NSExtensionJavaScriptPreprocessingResultsKey"

    public static func read(_ inputItems: [Any]) async -> [SharePayload] {
        var out: [SharePayload] = []
        for case let item as NSExtensionItem in inputItems {
            let itemTitle = item.attributedContentText?.string ?? item.attributedTitle?.string
            for provider in item.attachments ?? [] {
                if let p = await read(provider, itemTitle: itemTitle) { out.append(p) }
            }
        }
        return best(out)
    }

    /// Prefers a pairing link, then the page (it carries the link too), then files, then links, then text.
    static func best(_ all: [SharePayload]) -> [SharePayload] {
        if let pairing = all.first(where: { if case .pairing = $0 { return true } else { return false } }) { return [pairing] }
        if let page = all.first(where: { if case .page = $0 { return true } else { return false } }) { return [page] }
        let files = all.filter {
            switch $0 {
            case .file, .tooLarge, .unreadable: return true
            default: return false
            }
        }
        if !files.isEmpty { return Array(files.prefix(20)) }
        if let link = all.first(where: { if case .link = $0 { return true } else { return false } }) {
            // A shared text with a title and a link (common from apps) is just the link.
            return [link]
        }
        if let text = all.first(where: { if case .text = $0 { return true } else { return false } }) { return [text] }
        return []
    }

    /// A file that cannot be copied from one representation is tried in the next (a file URL the extension may not
    /// read can still come as data); only when none works is it reported as `.unreadable`, never dropped.
    static func read(_ provider: NSItemProvider, itemTitle: String?) async -> SharePayload? {
        let types = provider.registeredTypeIdentifiers
        var unreadable: SharePayload?
        /// The payload, or nil after noting an unreadable one (out of space is the reason worth keeping).
        func usable(_ p: SharePayload) -> SharePayload? {
            guard case let .unreadable(_, message) = p else { return p }
            if unreadable == nil || message == ShareError.outOfSpace.message { unreadable = p }
            return nil
        }
        // 1. Safari's JavaScript preprocessing results (GetPage.js).
        if provider.hasItemConformingToTypeIdentifier(propertyList),
           let dict = await loadItem(provider, propertyList) as? NSDictionary,
           let results = dict[jsResultsKey] as? [String: Any] {
            let url = ShareText.webURL(results["url"] as? String)
            let title = (results["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? itemTitle
            if let url, let html = results["html"] as? String, !html.isEmpty {
                return .page(html: html, url: url, title: title)
            }
            if let url { return .link(url: url, title: title) }
        }
        // 2. Files (their size is checked before they are copied).
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
           let url = await loadURL(provider, UTType.fileURL.identifier), url.isFileURL,
           let file = filePayload(url, suggestedName: provider.suggestedName).flatMap(usable) {
            return file
        }
        // 3. Web links (and pairing links).
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = await loadURL(provider, UTType.url.identifier) {
            if url.isFileURL {
                if let file = filePayload(url, suggestedName: provider.suggestedName).flatMap(usable) { return file }
            } else if url.scheme?.lowercased() == "daylightshare" {
                return .pairing(url.absoluteString)
            } else if let link = ShareText.webURL(url.absoluteString) {
                return .link(url: link, title: itemTitle)
            }
        }
        // 4. Documents given as data (Files, Mail, Books, …), by their most specific type.
        let docType = types.first { id in
            guard let t = UTType(id) else { return false }
            return !t.conforms(to: .url) && (t.conforms(to: .data) || t.conforms(to: .content))
                && !(t.conforms(to: .plainText) && types.contains(UTType.url.identifier))
        }
        if let docType, let file = (await loadFile(provider, docType)).flatMap(usable) { return file }
        // 5. Plain text.
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let value = await loadItem(provider, UTType.plainText.identifier)
            if let s = value as? String { return textPayload(s, title: itemTitle) }
            if let a = value as? NSAttributedString { return textPayload(a.string, title: itemTitle) }
            if let d = value as? Data, let s = String(data: d, encoding: .utf8) { return textPayload(s, title: itemTitle) }
            if let u = value as? URL, u.isFileURL, let file = filePayload(u, suggestedName: provider.suggestedName) {
                return file
            }
        }
        return unreadable
    }

    /// A pairing link is a pairing; short text that holds a link is the link; anything else is sent as a text file.
    static func textPayload(_ s: String, title: String?) -> SharePayload? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        if t.lowercased().hasPrefix("daylightshare:"), !t.contains(where: \.isWhitespace) { return .pairing(t) }
        if let url = ShareText.findURL(t), t.count <= url.count + 300 {
            let rest = t.replacingOccurrences(of: url, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            return .link(url: url, title: rest.isEmpty ? title : rest)
        }
        return .text(t)
    }

    // MARK: NSItemProvider helpers

    static func loadItem(_ provider: NSItemProvider, _ type: String) async -> Any? {
        await withCheckedContinuation { (cont: CheckedContinuation<Any?, Never>) in
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                cont.resume(returning: value as Any?)
            }
        }
    }

    static func loadURL(_ provider: NSItemProvider, _ type: String) async -> URL? {
        let value = await loadItem(provider, type)
        if let u = value as? URL { return u }
        if let u = value as? NSURL { return u as URL }
        if let d = value as? Data { return URL(dataRepresentation: d, relativeTo: nil) }
        if let s = value as? String { return URL(string: s) }
        return nil
    }

    /// The provider's file representation, copied out before the system deletes it (unless it is over 9 MB).
    static func loadFile(_ provider: NSItemProvider, _ type: String) async -> SharePayload? {
        let suggested = provider.suggestedName
        return await withCheckedContinuation { (cont: CheckedContinuation<SharePayload?, Never>) in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                var name = suggested
                if let n = name, (n as NSString).pathExtension.isEmpty,
                   let ext = UTType(type)?.preferredFilenameExtension { name = "\(n).\(ext)" }
                cont.resume(returning: url.flatMap { filePayload($0, suggestedName: name) })
            }
        }
    }

    /// The size of a file, read from its metadata (nil when unknown).
    static func fileSize(_ url: URL) -> Int? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
    }

    /// A file to send: refused up front when it is over `DLS.maxItem` (nothing is read or copied), else copied to a
    /// temporary location. A copy that fails is reported, never dropped: on a full disk with the shared sentence
    /// (CHANGES-v1.1 2.5, "This device is out of space, so it can’t send this.").
    static func filePayload(_ url: URL, suggestedName: String?) -> SharePayload? {
        let name = ShareText.safeFileName(url.lastPathComponent.isEmpty ? (suggestedName ?? "") : url.lastPathComponent)
        if let size = fileSize(url), size > DLS.maxItem {
            return .tooLarge(name: name, size: size)
        }
        do {
            let copy = try copyToTemporary(url, suggestedName: suggestedName)
            return .file(url: copy, name: copy.lastPathComponent)
        } catch {
            return .unreadable(name: name, message: isOutOfSpace(error) ? ShareError.outOfSpace.message
                                   : "Couldn’t read “\(name)”.")
        }
    }

    /// Whether a file error means the disk is full (Cocoa's out-of-space error, or ENOSPC underneath).
    static func isOutOfSpace(_ error: Error) -> Bool {
        let e = error as NSError
        if e.domain == NSCocoaErrorDomain && e.code == NSFileWriteOutOfSpaceError { return true }
        if e.domain == NSPOSIXErrorDomain && e.code == Int(ENOSPC) { return true }
        if let underlying = e.userInfo[NSUnderlyingErrorKey] as? Error { return isOutOfSpace(underlying) }
        return false
    }

    static func copyToTemporary(_ url: URL, suggestedName: String?) throws -> URL {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
        var name = url.lastPathComponent
        if name.isEmpty || name.hasPrefix(".") || name.hasPrefix("tmp") || name.hasPrefix("NSIRD"), let s = suggestedName, !s.isEmpty {
            name = s
        }
        if (name as NSString).pathExtension.isEmpty, !url.pathExtension.isEmpty { name += "." + url.pathExtension }
        let dest = dir.appendingPathComponent(ShareText.safeFileName(name))
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try fm.copyItem(at: url, to: dest)
            return dest
        } catch {
            try? fm.removeItem(at: dir)
            throw error
        }
    }
}

/// The share extensions' logic: read the input, pair if needed (asking first when the pairing comes from a link or
/// replaces another Daylight), send, report with the shared copy (CHANGES-v1.1 2.5), finish.
///
/// Storage (the pairing and the outbox) is read and written off the main thread, like the app does.
@MainActor
public final class ShareExtensionModel: ObservableObject {
    public enum Phase: Equatable {
        case reading
        case needsPairing
        /// A pairing waits for "Pair"/"Switch" or "Cancel" (PROTOCOL 1.3).
        case confirmPairing(PairingConfirmation)
        /// Paired from a shared link: the notice ("Paired with …", "Pairing updated: …").
        case paired(String)
        case sending
        /// Everything went: the row's label and sentence (CHANGES-v1.1 2.5), "Sent · waiting for your Daylight", or
        /// "Delivered ✓" when the Daylight acked it at once.
        case sent(RowText)
        /// Not everything went now: a title (the row's label, or "Not sent") and what to know (the row's sentence,
        /// or why it was refused).
        case result(title: String, message: String)
        case nothing
    }

    @Published public private(set) var phase: Phase = .reading
    @Published public private(set) var summary = ""
    /// A line about how something went, shown under the result: "The page is larger than 8 MB, so its link was
    /// sent." (CHANGES-v1.1 2.5) when a page went as its link.
    @Published public private(set) var note: String?
    @Published public private(set) var daylightName = "your Daylight"
    /// False when this extension keeps its own pairing (no App Group in this build: ad-hoc and unsigned Mac builds),
    /// so the pairing screen explains that the code is needed here once.
    @Published public private(set) var sharesPairingWithApp = true
    /// Called when the extension should close (`completeRequest`).
    public var onFinish: () -> Void = {}
    /// Called on Cancel (`cancelRequest`).
    public var onCancel: () -> Void = {}

    let store: SharedStore
    private var payloads: [SharePayload] = []
    private var started = false
    /// The pairing the confirmation is about, and whether the shared items are sent once it is applied.
    private var pending: (pairing: Pairing, thenSend: Bool)?

    public init(store: SharedStore = .shared) {
        self.store = store
    }

    public func start(inputItems: [Any]) {
        guard !started else { return }
        started = true
        let store = self.store
        Task {
            payloads = await SharePayloadReader.read(inputItems)
            summary = Self.describe(payloads)
            // The App Group is resolved in the background (never on this thread); wait for it before reading the pairing.
            await store.ready()
            sharesPairingWithApp = store.isShared
            let current = await AppModel.onStorage { store.pairing }
            daylightName = current?.displayName ?? "your Daylight"
            if case let .pairing(link)? = payloads.first {
                do {
                    try await offer(Pairing.parse(link), source: .link, thenSend: false)
                } catch {
                    phase = .result(title: "Not paired", message: (error as? ShareError)?.message ?? error.localizedDescription)
                }
            } else if payloads.isEmpty {
                phase = .nothing
            } else if current == nil {
                phase = .needsPairing
            } else {
                await send()
            }
        }
    }

    /// From the pairing form (typed or pasted here): returns an error message or nil.
    public func pair(_ input: String) -> String? {
        do {
            let p = try Pairing.parse(input)
            Task { await offer(p, source: .app, thenSend: true) }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    func offer(_ p: Pairing, source: PairingConfirmation.Source, thenSend: Bool) async {
        let store = self.store
        await store.ready()
        let current = await AppModel.onStorage { store.pairing }
        let c = PairingConfirmation(current: current, next: p, source: source)
        if c.ask {
            pending = (p, thenSend)
            phase = .confirmPairing(c)
        } else {
            await apply(p, notice: c.notice, thenSend: thenSend)
        }
    }

    /// "Pair" or "Switch".
    public func confirmPairing() {
        guard let pending else { return }
        self.pending = nil
        Task { await apply(pending.pairing, notice: nil, thenSend: pending.thenSend) }
    }

    /// "Cancel" on the question: back to the pairing form, or closed when the pairing came as a shared link.
    public func cancelPairing() {
        let wasForm = pending?.thenSend ?? false
        pending = nil
        if wasForm { phase = .needsPairing } else { cancel() }
    }

    private func apply(_ p: Pairing, notice: String?, thenSend: Bool) async {
        let store = self.store
        _ = await AppModel.offMain { await store.pair(p) }
        daylightName = p.displayName
        if thenSend {
            await send()
        } else {
            phase = .paired(notice ?? "Paired with \(p.displayName).")
        }
    }

    func send() async {
        let store = self.store
        await store.ready()
        guard let sender = await AppModel.onStorage({ try? DaylightShare.sender(store: store) }) else {
            phase = .needsPairing
            return
        }
        phase = .sending
        var problems: [(title: String, message: String)] = []
        var sent: [OutboxRow] = []
        for payload in payloads {
            do {
                let input = try await AppModel.onStorage { Result { try Self.input(for: payload) } }.get()
                let row = try await sender.send(input)
                if row.status != .sent && row.status != .delivered {
                    let text = RowText(row: row)
                    problems.append((text.label, text.sentence ?? ""))
                } else {
                    sent.append(row)
                }
            } catch {
                problems.append(("Not sent", (error as? ShareError)?.message ?? error.localizedDescription))
            }
        }
        cleanUpTemporaryFiles()
        note = Self.note(for: payloads)
        if problems.isEmpty, let first = sent.first {
            // The row's own words: it reached the relay and waits for the Daylight ("Sent · waiting for your
            // Daylight"), not that it arrived.
            phase = .sent(RowText(row: first))
            // PROTOCOL 3.3: check for acks right after sending (the Daylight may be online and quick).
            _ = try? await sender.checkAcks()
            let ids = sent.map(\.id)
            let outbox = sender.outbox
            let now = await AppModel.onStorage { ids.compactMap { outbox.row($0) } }
            if now.count == ids.count, now.allSatisfy({ $0.status == .delivered }), let row = now.first {
                phase = .sent(RowText(row: row))
            }
            // A note ("…so its link was sent.") stays until Done: there is more to read than the label.
            guard note == nil else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            onFinish()
        } else {
            let titles = Set(problems.map { $0.title })
            let title = titles.count == 1 ? problems[0].title : "Not everything was sent"
            phase = .result(title: title, message: problems.map { $0.message }.filter { !$0.isEmpty }.joined(separator: " "))
        }
    }

    public func cancel() {
        cleanUpTemporaryFiles()
        onCancel()
    }

    public func done() {
        cleanUpTemporaryFiles()
        onFinish()
    }

    private func cleanUpTemporaryFiles() {
        for case let .file(url, _) in payloads { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    }

    /// What one payload sends. Reads the file: call off the main thread. Throws the shared too-big sentence for a
    /// file over 9 MB.
    nonisolated static func input(for payload: SharePayload) throws -> ItemInput {
        switch payload {
        case let .page(html, url, title):
            // Larger pages than the Reader takes go as a link (PROTOCOL 2.2).
            if html.utf8.count > DLS.maxPageHTML { return .link(url, title: title) }
            return .page(html: html, url: url, title: title)
        case let .link(url, title):
            return .link(url, title: title)
        case let .file(url, name):
            if let link = AppModel.linkInShortcutFile(url) { return .link(link, title: (name as NSString).deletingPathExtension) }
            if let size = SharePayloadReader.fileSize(url), size > DLS.maxItem { throw ShareError.tooLarge(size) }
            return .file(try Data(contentsOf: url, options: .alwaysMapped), name: name)
        case let .text(text):
            let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? "Text"
            let name = ShareText.safeFileName(String(firstLine.prefix(40)), fallback: "Text") + ".txt"
            return .file(Data(text.utf8), name: name, mime: "text/plain", title: String(firstLine.prefix(120)))
        case let .tooLarge(_, size):
            throw ShareError.tooLarge(size)
        case let .unreadable(_, message):
            throw message == ShareError.outOfSpace.message ? ShareError.outOfSpace : ShareError("read", message)
        case .pairing:
            throw ShareError("pairing", "A pairing link isn’t something to send.")
        }
    }

    /// "The page is larger than 8 MB, so its link was sent." when a shared page is over `DLS.maxPageHTML` (it goes as
    /// its link, `input(for:)`), else nil.
    nonisolated static func note(for payloads: [SharePayload]) -> String? {
        let bigPage = payloads.contains { payload in
            if case let .page(html, _, _) = payload { return html.utf8.count > DLS.maxPageHTML }
            return false
        }
        return bigPage ? ShareText.pageSentAsLinkMessage : nil
    }

    static func describe(_ payloads: [SharePayload]) -> String {
        guard let first = payloads.first else { return "" }
        if payloads.count > 1 { return "\(payloads.count) files" }
        switch first {
        case let .page(_, url, title): return title ?? url
        case let .link(url, title): return title ?? url
        case let .file(_, name): return name
        case let .text(t): return String(t.prefix(80))
        case let .tooLarge(name, _): return name
        case let .unreadable(name, _): return name
        case .pairing: return ""
        }
    }
}

/// The share extensions' small UI: "Sending to <Daylight>…", then the row's label and sentence (CHANGES-v1.1 2.5:
/// "Sent · waiting for your Daylight", or why it did not go now), the pairing form when not paired yet, or the
/// question before a pairing takes effect.
public struct ShareExtensionView: View {
    @ObservedObject var model: ShareExtensionModel

    public init(model: ShareExtensionModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 14) {
            switch model.phase {
            case .reading, .sending:
                ProgressView()
                Text("Sending to \(model.daylightName)…").font(.headline)
                summaryText
            case let .sent(text):
                Image(systemName: text.label == "Delivered ✓" ? "checkmark.circle.fill" : "paperplane.circle.fill")
                    .font(.system(size: 44))
                    .foregroundColor(text.label == "Delivered ✓" ? .green : .accentColor)
                Text(text.label).font(.headline).multilineTextAlignment(.center)
                summaryText
                if let sentence = text.sentence {
                    Text(sentence).font(.callout).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
                noteText
                if model.note != nil {
                    Button("Done") { model.done() }.buttonStyle(.borderedProminent)
                }
            case let .result(title, message):
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundColor(.orange)
                Text(title).font(.headline).multilineTextAlignment(.center)
                summaryText
                if !message.isEmpty {
                    Text(message).font(.callout).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
                noteText
                Button("Done") { model.done() }.buttonStyle(.borderedProminent)
            case let .confirmPairing(confirmation):
                PairingConfirmationView(confirmation: confirmation, onConfirm: { model.confirmPairing() },
                                        onCancel: { model.cancelPairing() })
            case let .paired(notice):
                Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundColor(.green)
                Text(notice).font(.headline).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Button("Done") { model.done() }.buttonStyle(.borderedProminent)
            case .nothing:
                Image(systemName: "questionmark.circle").font(.system(size: 40)).foregroundColor(.secondary)
                Text("There’s nothing here Send to Daylight can send.").multilineTextAlignment(.center)
                Button("Done") { model.done() }.buttonStyle(.borderedProminent)
            case .needsPairing:
                Text("Pair with your Daylight").font(.headline)
                if !model.sharesPairingWithApp {
                    Text(Self.pasteOnceText)
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                }
                PairingHelp()
                PairingForm { model.pair($0) }
                Button("Cancel", role: .cancel) { model.cancel() }
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Shown when this build has no App Group, so the extension cannot read the app's pairing.
    static var pasteOnceText: String {
        #if os(macOS)
        return "This copy of Send to Daylight isn’t signed with a developer team, so the Share menu can’t read the app’s pairing. Paste your pairing code here once; the Share menu remembers it."
        #else
        return "This copy of Send to Daylight can’t share the app’s pairing with the share sheet. Paste your pairing code here once; it is remembered."
        #endif
    }

    @ViewBuilder private var noteText: some View {
        if let note = model.note {
            Text(note).font(.callout).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var summaryText: some View {
        if !model.summary.isEmpty {
            Text(model.summary).font(.callout).foregroundColor(.secondary).lineLimit(2).multilineTextAlignment(.center)
        }
    }
}
