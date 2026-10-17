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

    /// Prefers the page (it carries the link too), then links, then files, then text; drops duplicates.
    static func best(_ all: [SharePayload]) -> [SharePayload] {
        if let page = all.first(where: { if case .page = $0 { return true } else { return false } }) { return [page] }
        let files = all.filter { if case .file = $0 { return true } else { return false } }
        if !files.isEmpty { return Array(files.prefix(20)) }
        if let link = all.first(where: { if case .link = $0 { return true } else { return false } }) {
            // A shared text with a title and a link (common from apps) is just the link.
            return [link]
        }
        if let text = all.first(where: { if case .text = $0 { return true } else { return false } }) { return [text] }
        return []
    }

    static func read(_ provider: NSItemProvider, itemTitle: String?) async -> SharePayload? {
        let types = provider.registeredTypeIdentifiers
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
        // 2. Files.
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
           let url = await loadURL(provider, UTType.fileURL.identifier), url.isFileURL,
           let copy = copyToTemporary(url, suggestedName: provider.suggestedName) {
            return .file(url: copy, name: copy.lastPathComponent)
        }
        // 3. Web links.
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = await loadURL(provider, UTType.url.identifier) {
            if url.isFileURL, let copy = copyToTemporary(url, suggestedName: provider.suggestedName) {
                return .file(url: copy, name: copy.lastPathComponent)
            }
            if let link = ShareText.webURL(url.absoluteString) { return .link(url: link, title: itemTitle) }
        }
        // 4. Documents given as data (Files, Mail, Books, …), by their most specific type.
        let docType = types.first { id in
            guard let t = UTType(id) else { return false }
            return !t.conforms(to: .url) && (t.conforms(to: .data) || t.conforms(to: .content))
                && !(t.conforms(to: .plainText) && types.contains(UTType.url.identifier))
        }
        if let docType, let file = await loadFile(provider, docType) { return .file(url: file, name: file.lastPathComponent) }
        // 5. Plain text.
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let value = await loadItem(provider, UTType.plainText.identifier)
            if let s = value as? String { return textPayload(s, title: itemTitle) }
            if let a = value as? NSAttributedString { return textPayload(a.string, title: itemTitle) }
            if let d = value as? Data, let s = String(data: d, encoding: .utf8) { return textPayload(s, title: itemTitle) }
            if let u = value as? URL, u.isFileURL, let copy = copyToTemporary(u, suggestedName: provider.suggestedName) {
                return .file(url: copy, name: copy.lastPathComponent)
            }
        }
        return nil
    }

    /// Short text that holds a link is the link; anything else is sent as a text file.
    static func textPayload(_ s: String, title: String?) -> SharePayload? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
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

    /// The provider's file representation, copied out before the system deletes it.
    static func loadFile(_ provider: NSItemProvider, _ type: String) async -> URL? {
        let suggested = provider.suggestedName
        return await withCheckedContinuation { (cont: CheckedContinuation<URL?, Never>) in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                var name = suggested
                if let n = name, (n as NSString).pathExtension.isEmpty,
                   let ext = UTType(type)?.preferredFilenameExtension { name = "\(n).\(ext)" }
                cont.resume(returning: url.flatMap { copyToTemporary($0, suggestedName: name) })
            }
        }
    }

    static func copyToTemporary(_ url: URL, suggestedName: String?) -> URL? {
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
            return nil
        }
    }
}

/// The share extensions' logic: read the input, pair if needed, send, report, finish.
@MainActor
public final class ShareExtensionModel: ObservableObject {
    public enum Phase: Equatable {
        case reading
        case needsPairing
        case sending
        case sent
        case failed(String)
        case nothing
    }

    @Published public private(set) var phase: Phase = .reading
    @Published public private(set) var summary = ""
    /// Called when the extension should close (`completeRequest`).
    public var onFinish: () -> Void = {}
    /// Called on Cancel (`cancelRequest`).
    public var onCancel: () -> Void = {}

    let store: SharedStore
    private var payloads: [SharePayload] = []
    private var started = false

    public init(store: SharedStore = .shared) {
        self.store = store
    }

    public var daylightName: String { store.pairing?.displayName ?? "your Daylight" }

    public func start(inputItems: [Any]) {
        guard !started else { return }
        started = true
        Task {
            payloads = await SharePayloadReader.read(inputItems)
            summary = Self.describe(payloads)
            if payloads.isEmpty {
                phase = .nothing
            } else if store.pairing == nil {
                phase = .needsPairing
            } else {
                await send()
            }
        }
    }

    /// From the pairing form: returns an error message or nil.
    public func pair(_ input: String) -> String? {
        do {
            store.pair(try Pairing.parse(input))
            Task { await send() }
            return nil
        } catch {
            return (error as? ShareError)?.message ?? error.localizedDescription
        }
    }

    func send() async {
        guard let sender = try? DaylightShare.sender(store: store) else {
            phase = .needsPairing
            return
        }
        phase = .sending
        var failures: [String] = []
        for payload in payloads {
            do {
                let row = try await sender.send(Self.input(for: payload))
                if row.status == .failed { failures.append(row.error) }
            } catch {
                failures.append((error as? ShareError)?.message ?? error.localizedDescription)
            }
        }
        cleanUpTemporaryFiles()
        if failures.isEmpty {
            phase = .sent
            // PROTOCOL 3.3: check for acks right after sending (the Daylight may be online and quick).
            _ = try? await sender.checkAcks()
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            onFinish()
        } else {
            phase = .failed(failures.joined(separator: " "))
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

    static func input(for payload: SharePayload) throws -> ItemInput {
        switch payload {
        case let .page(html, url, title):
            // Larger pages than the Reader takes go as a link (PROTOCOL 2.2).
            if html.utf8.count > DLS.maxPageHTML { return .link(url, title: title) }
            return .page(html: html, url: url, title: title)
        case let .link(url, title):
            return .link(url, title: title)
        case let .file(url, name):
            if let link = AppModel.linkInShortcutFile(url) { return .link(link, title: (name as NSString).deletingPathExtension) }
            return .file(try Data(contentsOf: url, options: .alwaysMapped), name: name)
        case let .text(text):
            let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? "Text"
            let name = ShareText.safeFileName(String(firstLine.prefix(40)), fallback: "Text") + ".txt"
            return .file(Data(text.utf8), name: name, mime: "text/plain", title: String(firstLine.prefix(120)))
        }
    }

    static func describe(_ payloads: [SharePayload]) -> String {
        guard let first = payloads.first else { return "" }
        if payloads.count > 1 { return "\(payloads.count) files" }
        switch first {
        case let .page(_, url, title): return title ?? url
        case let .link(url, title): return title ?? url
        case let .file(_, name): return name
        case let .text(t): return String(t.prefix(80))
        }
    }
}

/// The share extensions' small UI: "Sending to <Daylight>… → Sent ✓", or the pairing form when not paired yet.
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
            case .sent:
                Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundColor(.green)
                Text("Sent ✓").font(.headline)
                summaryText
            case let .failed(message):
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundColor(.orange)
                Text("Not sent yet").font(.headline)
                Text(message).font(.callout).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Text("Send to Daylight will retry it when you open the app.").font(.footnote).foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Button("Done") { model.done() }.buttonStyle(.borderedProminent)
            case .nothing:
                Image(systemName: "questionmark.circle").font(.system(size: 40)).foregroundColor(.secondary)
                Text("There’s nothing here Send to Daylight can send.").multilineTextAlignment(.center)
                Button("Done") { model.done() }.buttonStyle(.borderedProminent)
            case .needsPairing:
                Text("Pair with your Daylight").font(.headline)
                PairingHelp()
                PairingForm { model.pair($0) }
                Button("Cancel", role: .cancel) { model.cancel() }
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private var summaryText: some View {
        if !model.summary.isEmpty {
            Text(model.summary).font(.callout).foregroundColor(.secondary).lineLimit(2).multilineTextAlignment(.center)
        }
    }
}
