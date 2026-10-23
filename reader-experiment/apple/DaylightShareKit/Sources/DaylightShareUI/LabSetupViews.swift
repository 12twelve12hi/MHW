import DaylightShareKit
import Foundation
import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// Lab W1's shared screens for the apps (LAB-PLAN F07, F26, F33; card A3): the queue, Setup check with its activity log
// and diagnostics, and the copied-link chip. The iPhone and Mac lanes (A4, A5) place them, with Lab on only.

// MARK: The queue (F07)

/// "Waiting to send ({n})" (F07, Lab on): the rows that wait for the network (shared while offline, or failed for the
/// network), oldest first, each with Cancel, which removes it. Nothing shows while none waits.
public struct QueueSection: View {
    let rows: [OutboxRow]
    let onCancel: (OutboxRow) -> Void

    public init(rows: [OutboxRow], onCancel: @escaping (OutboxRow) -> Void) {
        self.rows = rows
        self.onCancel = onCancel
    }

    public static let id = "lab-queue"
    public static func cancelID(_ row: OutboxRow) -> String { "lab-queue-cancel-\(row.id)" }

    /// The rows waiting for the network, oldest first (what the next pass sends first).
    public static func waiting(_ rows: [OutboxRow]) -> [OutboxRow] {
        rows.filter { $0.status == .failed && $0.errorCode == "network" }.sorted { $0.created < $1.created }
    }

    /// "Waiting to send ({n})".
    public static func heading(_ count: Int) -> String { LabText.fill(LabText["queue.heading"], ["n": String(count)]) }

    public var body: some View {
        let waiting = Self.waiting(rows)
        if !waiting.isEmpty {
            let heading = Self.heading(waiting.count)
            Section {
                ForEach(waiting, id: \.id) { row in
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            title(row)
                            Spacer(minLength: 8)
                            cancel(row)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            title(row)
                            cancel(row)
                        }
                    }
                }
            } header: {
                Text(heading).listRowText(heading).accessibilityAddTraits(.isHeader)
            }
            .accessibilityIdentifier(Self.id)
        }
    }

    private func title(_ row: OutboxRow) -> some View {
        let t = row.displayTitle
        return Text(t).lineLimit(2).listRowText(t)
    }

    private func cancel(_ row: OutboxRow) -> some View {
        Button(role: .destructive) { onCancel(row) } label: {
            Text(LabText["queue.cancel"]).wrapping(LabText["queue.cancel"]).comfortTarget()
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("\(LabText["queue.cancel"]), \(row.displayTitle)")
        .accessibilityIdentifier(Self.cancelID(row))
    }
}

// MARK: Setup check (F26)

/// One line of Setup check (F26): "✓ {check}" or "! {check}". An unmet line has a button that opens the right settings
/// screen (`button`, `action`), or Show steps when the place cannot be opened from here (`steps`).
public struct SetupCheckLine: Identifiable {
    /// The check's id in `setup.checks` (paired, shareItem, safariExtension, notifications, backgroundRefresh, shareMenu,
    /// loginItem, printMenu, …).
    public let id: String
    public var ok: Bool
    /// The steps Show steps shows (default: `setup.steps.<id>` when there is one).
    public var steps: String?
    /// The button that fixes it from here ("Open Settings"), with its action.
    public var button: String?
    public var action: (() -> Void)?

    public init(id: String, ok: Bool, steps: String? = nil, button: String? = nil, action: (() -> Void)? = nil) {
        self.id = id
        self.ok = ok
        let defaultSteps = LabText["setup.steps.\(id)"]
        self.steps = steps ?? (defaultSteps.isEmpty ? nil : defaultSteps)
        self.button = button
        self.action = action
    }

    /// The check's name ("Pairing", "Daylight in the share sheet", …).
    public var name: String { LabText["setup.checks.\(id)"] }
    /// "✓ {check}" or "! {check}".
    public var text: String { LabText.fill(LabText[ok ? "setup.ok" : "setup.notOk"], ["check": name]) }
}

/// Setup check (F26, Lab on): the checks this app gives (`lines`; each unmet one with its button or steps), the hints
/// that showed once (F03's link-only line on the iPhone), "Send a test article" with its footer and its way along the
/// timeline ("✓ Delivered", "✓ In your Reader", and the row's Lab label, "Waiting for a tap on your Daylight" while the
/// Inbox waits), the activity log and "Copy diagnostics" (redacted).
public struct SetupCheckView: View {
    @ObservedObject var app: AppModel
    @ObservedObject var lab: LabModel
    let lines: [SetupCheckLine]
    let appName: String
    let version: String
    let platform: String
    @State private var testID: String?
    @State private var stepsShown: Set<String> = []
    @State private var log: [String] = []
    @State private var hints: [String] = []
    @State private var copied = false

    public init(app: AppModel, lines: [SetupCheckLine], appName: String, version: String,
                platform: String = LabText.platform) {
        self.app = app
        lab = app.lab
        self.lines = lines
        self.appName = appName
        self.version = version
        self.platform = platform
    }

    public static let testButtonID = "lab-setup-test"
    public static let copyID = "lab-setup-copy"
    public static func lineID(_ id: String) -> String { "lab-setup-\(id)" }

    /// The test article along its way (F26.1).
    public struct TestProgress: Equatable {
        /// The row's Lab label ("Sent · waiting for your Daylight", "Waiting for a tap on your Daylight", …).
        public let label: String
        public let delivered: Bool
        public let inReader: Bool

        /// "✓ Delivered" or "Delivered", then "✓ In your Reader" or "In your Reader".
        public var lines: [String] {
            [Self.line(delivered, LabText["setup.delivered"]), Self.line(inReader, LabText["setup.inReader"])]
        }

        static func line(_ ok: Bool, _ name: String) -> String { ok ? LabText.fill(LabText["setup.ok"], ["check": name]) : name }
    }

    /// Where the test article is: delivered when its row is; in the Reader when the ledger also says `reader`.
    @MainActor
    public static func progress(_ row: OutboxRow?, lab: LabModel) -> TestProgress? {
        guard let row else { return nil }
        let delivered = row.status == .delivered
        return TestProgress(label: lab.rowText(row).label, delivered: delivered,
                            inReader: delivered && lab.ledger.state(row.id)?.s == "reader")
    }

    public var body: some View {
        List {
            Section {
                ForEach(lines) { line in lineView(line) }
            }
            if !hints.isEmpty {
                Section {
                    ForEach(hints, id: \.self) { h in Text(h).dlsFont(.footnote).listRowText(h) }
                }
            }
            Section {
                Button { Task { await sendTest() } } label: {
                    Text(LabText["setup.testSend"]).listRowText(LabText["setup.testSend"])
                }
                .disabled(!app.isPaired)
                .accessibilityIdentifier(Self.testButtonID)
                if let p = Self.progress(app.rows.first(where: { $0.id == testID }), lab: lab) {
                    Text(p.label).dlsFont(.footnote).dlsSecondary().listRowText(p.label)
                    ForEach(p.lines, id: \.self) { l in Text(l).listRowText(l) }
                }
            } footer: {
                Text(LabText["setup.testFooter"]).dlsFont(.footnote).listRowText(LabText["setup.testFooter"])
            }
            Section {
                DisclosureGroup {
                    ActivityLogView(lines: log)
                } label: {
                    Text(LabText["setup.activity"]).listRowText(LabText["setup.activity"])
                }
                let copy = copied ? LabText["setup.copied"] : LabText["setup.copyDiagnostics"]
                Button { Task { await copyDiagnostics() } } label: { Text(copy).listRowText(copy) }
                    .accessibilityIdentifier(Self.copyID)
            }
        }
        .navigationTitle(LabText["setup.title"])
        .task { await reload() }
        .onChange(of: app.rows) { _ in Task { await reloadLog() } }
    }

    @ViewBuilder private func lineView(_ line: SetupCheckLine) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(line.text).listRowText(line.text)
            if !line.ok {
                if let button = line.button, let action = line.action {
                    Button(action: action) { Text(button).wrapping(button).comfortTarget() }
                        .buttonStyle(.bordered)
                        .comfortBorder()
                } else if line.steps != nil {
                    Button {
                        if stepsShown.contains(line.id) { stepsShown.remove(line.id) } else { stepsShown.insert(line.id) }
                    } label: {
                        Text(LabText["setup.showSteps"]).wrapping(LabText["setup.showSteps"]).comfortTarget()
                    }
                    .buttonStyle(.bordered)
                    .comfortBorder()
                }
                if let steps = line.steps, stepsShown.contains(line.id) {
                    Text(steps).dlsFont(.footnote).listRowText(steps)
                }
            }
        }
        .accessibilityIdentifier(Self.lineID(line.id))
    }

    private func reload() async {
        let store = app.store
        let read = await AppModel.onStorage { () -> (id: String?, linkOnly: Bool) in
            let p = LabPreferences(store: store)
            return (p.testArticleID, p.linkOnlyShown)
        }
        if testID == nil { testID = read.id }
        #if os(iOS)
        hints = read.linkOnly ? [LabText["linkOnly.iphone"]] : []
        #endif
        await reloadLog()
    }

    private func reloadLog() async {
        let lines = await app.activityLines()
        if lines != log { log = lines }
    }

    private func sendTest() async {
        if let row = await app.sendTestArticle() { testID = row.id }
        await reloadLog()
    }

    private func copyDiagnostics() async {
        let text = await app.diagnostics(app: appName, version: version, platform: platform)
        Self.copy(text)
        copied = true
        Announcer.announce(LabText["setup.copied"])
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        copied = false
    }

    /// Puts text on the clipboard.
    public static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

/// Setup check's activity log (F26): the last 200 events, newest first, one line each, "{time} {type} {id8} {kind}
/// {status} {http}" (no URL, title or name is ever logged).
public struct ActivityLogView: View {
    let lines: [String]

    public init(lines: [String]) {
        self.lines = lines
    }

    public static let id = "lab-activity"

    public var body: some View {
        if lines.isEmpty {
            Text(LabText["diagnostics.noEvents"]).dlsSecondary().listRowText(LabText["diagnostics.noEvents"])
                .accessibilityIdentifier(Self.id)
        } else {
            ForEach(Array(lines.reversed().enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(.footnote, design: .monospaced)).listRowText(line)
            }
        }
    }
}

// MARK: The copied link (F33)

/// "Send {host} to {name}?" with Send and Cancel (F33): shown before a copied link goes, so a stale clipboard is never
/// sent unseen (the iPhone's chip, the Mac window's Send copied link button).
public struct CopiedLinkConfirm: View {
    let host: String
    let name: String
    let onSend: () -> Void
    let onCancel: () -> Void

    public init(host: String, name: String, onSend: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.host = host
        self.name = name
        self.onSend = onSend
        self.onCancel = onCancel
    }

    public static let sendID = "lab-copied-send"

    /// "Send {host} to {name}?"
    public static func text(host: String, name: String) -> String {
        let n = ShareText.cleanName(name)
        return LabText.fill(LabText["copiedLink.confirm"], ["host": host, "name": n.isEmpty ? LabText["shareInPlace.yourDaylight"] : n])
    }

    public var body: some View {
        let question = Self.text(host: host, name: name)
        VStack(alignment: .leading, spacing: 8) {
            Text(question).listRowText(question)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { buttons }
                VStack(alignment: .leading, spacing: 8) { buttons }
            }
        }
    }

    @ViewBuilder private var buttons: some View {
        Button(action: onSend) {
            Text(LabText["shareInPlace.send"]).wrapping(LabText["shareInPlace.send"]).comfortTarget()
        }
        .buttonStyle(.borderedProminent)
        .comfortBorder()
        .accessibilityIdentifier(Self.sendID)
        Button(role: .cancel, action: onCancel) {
            Text(LabText["automation.cancel"]).wrapping(LabText["automation.cancel"]).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
    }
}

#if os(iOS)
/// The copied-link chip (F33, iPhone, Lab on and F33 in use): shown while the pasteboard holds a URL
/// (`UIPasteboard.hasURLs`, which reads nothing and raises no paste alert). It is "Send copied link" beside the
/// system's `PasteButton(payloadType: URL.self)` (iOS draws that button's own label), which reads the link only when
/// tapped; then "Send {host} to {name}?" with Send and Cancel. The link goes through `normaliseShare`
/// (`AppModel.copiedLink`).
public struct PasteChip: View {
    @ObservedObject var app: AppModel
    @State private var hasURL = false
    @State private var pending: PendingLink?
    @Environment(\.scenePhase) private var scenePhase

    struct PendingLink {
        let input: ItemInput
        let host: String
    }

    public init(app: AppModel) {
        self.app = app
    }

    public static let id = "lab-paste-chip"

    public var body: some View {
        Group {
            if let p = pending {
                CopiedLinkConfirm(host: p.host, name: app.daylightName, onSend: {
                    pending = nil
                    Task { await app.send(p.input) }
                }, onCancel: { pending = nil })
            } else if hasURL {
                HStack(spacing: 10) {
                    Text(LabText["copiedLink.chip"]).listRowText(LabText["copiedLink.chip"])
                    Spacer(minLength: 8)
                    PasteButton(payloadType: URL.self) { urls in
                        let text = urls.first?.absoluteString ?? ""
                        Task { @MainActor in read(text) }
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier(Self.id)
                }
            }
        }
        .onAppear { check() }
        .onChange(of: scenePhase) { phase in if phase == .active { check() } }
    }

    private func check() {
        hasURL = UIPasteboard.general.hasURLs
    }

    private func read(_ text: String) {
        if let link = app.copiedLink(text) {
            pending = PendingLink(input: link.input, host: link.host)
        } else {
            app.show(LabText["copiedLink.noLink"], error: true)
        }
    }
}
#endif
