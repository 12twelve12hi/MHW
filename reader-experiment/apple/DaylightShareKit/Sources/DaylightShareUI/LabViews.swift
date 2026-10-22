import DaylightShareKit
import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// The Lab screens' building blocks (LAB-PLAN 1.1, 1.4, 1.5, 2.5, 2.6), shared by the iPhone and Mac apps: the Lab
// settings section, What's in Lab, the Daylight server section, the needs-setup note, a gated control and the timeline's
// row text. Every word is LAB_TEXT's (`LabText`), the server module's (`ServerMessages`) or the protocol's (`RowText`).
// With Lab off nothing here shows but the switch itself (`LabSettingsSection`), so the apps' Lab-off screens stay the
// P0 baselines' (F00.2).

/// The accessibility identifiers of the Lab screens (UI tests).
public enum LabIDs {
    /// The Lab switch itself, and nothing else (`AXTree.labSwitchID` in the UI tests' walk).
    public static let labSwitch = "lab-switch"
    public static let whatsInLab = "lab-whats-in-lab"
    public static let serverRow = "lab-server"
    /// The needs-setup note under a tapped control.
    public static let note = "lab-note"
    /// A feature's row in What's in Lab: "lab-feature-F37".
    public static func feature(_ id: String) -> String { "lab-feature-\(id)" }
    public static let serverCode = "lab-server-code"
    public static let copyServerCode = "lab-server-copy"
    public static let setupField = "lab-setup-field"
    public static let setupButton = "lab-setup-button"
    public static let addressField = "lab-address-field"
    /// The re-pairing follow-up (`LabRepairedNote`), its Server code and its Copy button.
    public static let repaired = "lab-repaired"
    public static let repairedServerCode = "lab-repaired-server-code"
    public static let repairedCopy = "lab-repaired-copy"
}

/// Puts text on the clipboard (Copy, Copy Server code).
public enum LabClipboard {
    public static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }

    /// Where "Open Settings" goes: this app's page in Settings (iPhone), or System Settings › Notifications (Mac).
    public static var settingsURL: URL? {
        #if os(macOS)
        return URL(string: "x-apple.systempreferences:com.apple.preference.notifications")
        #else
        return URL(string: "app-settings:") // UIApplication.openSettingsURLString, which extensions cannot name
        #endif
    }
}

// MARK: The Lab section of Settings (1.1)

/// The first section of an app's settings (1.1): the Lab switch, its footer and, while Lab is on, the re-pairing
/// follow-up when there is one (`LabRepairedNote`, 2.6) and the rows "What’s in Lab ›" and "Daylight server ›"
/// (subtitled "Optional · {short state}"). With Lab off only the switch (and its footer) shows. The rows are navigation
/// links: put the settings in a `NavigationStack`. Give it the destinations, or use `LabSettingsSection(lab:)` for
/// `WhatsInLabView` and `ServerSettingsView`.
public struct LabSettingsSection<WhatsIn: View, Server: View>: View {
    @ObservedObject var lab: LabModel
    let whatsInLab: () -> WhatsIn
    let server: () -> Server

    public init(lab: LabModel, @ViewBuilder whatsInLab: @escaping () -> WhatsIn, @ViewBuilder server: @escaping () -> Server) {
        self.lab = lab
        self.whatsInLab = whatsInLab
        self.server = server
    }

    public var body: some View {
        Section {
            Toggle(isOn: Binding(get: { lab.isOn }, set: { lab.setOn($0) })) {
                Text(LabText.lab).listRowText(LabText.lab)
            }
            // The switch's own name (a Form can put the words and the switch apart), and the identifier the UI tests'
            // walk knows it by: on the switch itself and nothing else.
            .accessibilityLabel(LabText.lab)
            .accessibilityIdentifier(LabIDs.labSwitch)
            if lab.isOn {
                if let r = lab.repaired {
                    LabRepairedNote(repaired: r) { lab.dismissRepaired() }
                }
                NavigationLink {
                    whatsInLab()
                } label: {
                    Text(LabText.whatsInLab).listRowText(LabText.whatsInLab)
                }
                .accessibilityIdentifier(LabIDs.whatsInLab)
                NavigationLink {
                    server()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(LabText.serverRow).listRowText(LabText.serverRow)
                        if let subtitle = lab.serverRowSubtitle {
                            Text(subtitle).dlsFont(.caption).dlsSecondary().listRowText(subtitle)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                .accessibilityIdentifier(LabIDs.serverRow)
            }
        } header: {
            Text(LabText.lab).dlsSecondary().listRowText(LabText.lab)
        } footer: {
            Text(LabText.switchFooter).dlsSecondary().listRowText(LabText.switchFooter)
        }
        .task(id: lab.isOn) {
            if lab.isOn { await lab.refreshServerRow() }
        }
    }
}

extension LabSettingsSection where WhatsIn == WhatsInLabView, Server == ServerSettingsView {
    /// The section with the shared destinations.
    public init(lab: LabModel) {
        self.init(lab: lab, whatsInLab: { WhatsInLabView(lab: lab) }, server: { ServerSettingsView(lab: lab) })
    }
}

// MARK: After re-pairing (2.6, DESIGN 12.7)

/// After this device re-paired with another Daylight while it knew a Daylight server, which it locked first (2.6
/// "Re-pairing", DESIGN 3.4 and 12.7): "Daylight server" as its heading, the `locked` text, the new pairing's Server code
/// with Copy, the deploy's re-run help, and OK, which ends it (`LabModel.dismissRepaired`). The window presents it right
/// after the switch (`AppModel.presentsRepaired`, from `appSheets`), and Settings › Lab shows it (`LabSettingsSection`)
/// until OK or until the server answers ready. Only while Lab is on: `LabModel.repaired` is nil with Lab off.
public struct LabRepairedNote: View {
    let repaired: LabCenter.Repaired
    let onOK: () -> Void
    @State private var copied = false

    public init(repaired: LabCenter.Repaired, onOK: @escaping () -> Void) {
        self.repaired = repaired
        self.onOK = onOK
    }

    private var S: (String) -> String { { LabText["serverSection.\($0)"] } }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LabText.serverRow).dlsFont(.headline).wrapping(LabText.serverRow)
                .accessibilityAddTraits(.isHeader)
            Text(repaired.message).wrapping(repaired.message)
            VStack(alignment: .leading, spacing: 4) {
                Text(S("serverCode")).dlsFont(.footnote).dlsSecondary().wrapping(S("serverCode"))
                Text(repaired.serverCode).font(.body.monospaced()).wrapping(repaired.serverCode)
                    .textSelection(.enabled)
                    .accessibilityIdentifier(LabIDs.repairedServerCode)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { buttons }
                VStack(alignment: .leading, spacing: 8) { buttons }
            }
            if copied {
                Text(LabText["setup.copied"]).dlsFont(.footnote).wrapping(LabText["setup.copied"])
            }
            Text(repaired.rerun).dlsFont(.footnote).dlsSecondary().wrapping(repaired.rerun)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(LabIDs.repaired)
        .onAppear { Announcer.announce(repaired.message) }
    }

    @ViewBuilder private var buttons: some View {
        Button {
            LabClipboard.copy(repaired.serverCode)
            copied = true
            Announcer.announce(LabText["setup.copied"])
        } label: {
            Text(S("copy")).wrapping(S("copy")).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
        .accessibilityIdentifier(LabIDs.repairedCopy)
        Button(action: onOK) {
            Text(LabText.noteButton).wrapping(LabText.noteButton).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
    }
}

/// The re-pairing follow-up as the window presents it (`appSheets`): scrolls on the iPhone at large text sizes; on the
/// Mac, as wide as the pairing question.
struct LabRepairedSheet: View {
    let repaired: LabCenter.Repaired
    let onOK: () -> Void

    var body: some View {
        #if os(iOS)
        ScrollView {
            LabRepairedNote(repaired: repaired, onOK: onOK).padding(24)
        }
        #else
        LabRepairedNote(repaired: repaired, onOK: onOK)
            .padding(24)
            .frame(maxWidth: 420)
        #endif
    }
}

// MARK: The needs-setup note (1.5)

/// The inline note directly under a tapped control that is not ready (1.5): exactly one sentence, said to VoiceOver,
/// with OK and at most one button that fixes it from here ("Open Settings", "Open setting", "Copy Server code"). It
/// stays until OK, another control is tapped or the screen is left; it never dismisses itself. While a server feature's
/// gate waits on the server it says "Checking your Daylight server…" (after 150 ms, for at most 5 s: `GateTap`,
/// `LabGate`).
public struct LabNote: View {
    let message: String
    let button: String?
    let onButton: (() -> Void)?
    let onOK: (() -> Void)?

    public init(_ message: String, button: String? = nil, onButton: (() -> Void)? = nil, onOK: (() -> Void)? = nil) {
        self.message = message
        self.button = button
        self.onButton = onButton
        self.onOK = onOK
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // The icon beside the sentence, not a Label: the iPhone's audit measured a Label's text against the Label's
            // wider frame and reported it clipped. The note sits in a list row, which sizes the text (`listRowText`).
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "info.circle").accessibilityHidden(true)
                Text(message).dlsFont(.callout).listRowText(message)
            }
            if button != nil || onOK != nil {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { buttons }
                    VStack(alignment: .leading, spacing: 8) { buttons }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        // An outline, not a grey fill: the buttons' tinted words on that fill only "nearly passed" the contrast audit.
        .overlay {
            RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.5), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(LabIDs.note)
        .onAppear { Announcer.announce(message) }
        .onChange(of: message) { Announcer.announce($0) }
    }

    @ViewBuilder private var buttons: some View {
        if let button, let onButton {
            Button(action: onButton) {
                Text(button).listRowText(button).comfortTarget()
            }
            .buttonStyle(.bordered)
            .comfortBorder()
        }
        if let onOK {
            Button(action: onOK) {
                Text(LabText.noteButton).listRowText(LabText.noteButton).comfortTarget()
            }
            .buttonStyle(.bordered)
            .comfortBorder()
        }
    }
}

/// What a gated control shows under itself: nothing, "Checking your Daylight server…", or the gate's note.
enum NoteState: Equatable {
    case hidden
    case checking
    case note(LabGate.Result)
}

/// A tap on a gated control (1.5). A local or cached answer shows its note at once, with nothing said before it;
/// "Checking your Daylight server…" covers only a server wait: it shows for a server feature (`Lab.isServerFeature`)
/// whose gate has not answered within 150 ms, as in the JS and Windows ports. A local gate (`needs-pairing`,
/// `needs-inbox`, W1's `needs-notifications`) never says server words.
enum GateTap {
    /// How long a server feature's gate may take before its note says "Checking your Daylight server…".
    static let checkingAfterNs: UInt64 = 150_000_000

    /// Runs the gate; calls `checking` (once, on the main actor) when `feature` is a server feature and its gate is
    /// still waiting after `delayNs` (`checkingAfterNs`).
    @MainActor
    static func run(_ feature: String, after delayNs: UInt64 = GateTap.checkingAfterNs,
                    gate: () async -> LabGate.Result, checking: @escaping @MainActor () -> Void) async -> LabGate.Result {
        var timer: Task<Void, Never>?
        if Lab.isServerFeature(feature) {
            timer = Task { @MainActor in
                try? await Task.sleep(nanoseconds: delayNs)
                if !Task.isCancelled { checking() }
            }
        }
        let r = await gate()
        timer?.cancel()
        return r
    }
}

/// Runs a feature's gate when tapped and shows its note under the control (1.5): never greyed out, never locked. When
/// the gate says ready, `onReady` runs (the feature opens). The note's button copies the Server code (needs-server),
/// opens Settings (an OS permission) or calls `onOpenSetting` (a setting in this app).
struct GatedNote: View {
    @ObservedObject var lab: LabModel
    let state: NoteState
    let onOpenSetting: (() -> Void)?
    let onDismiss: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var copied = false

    var body: some View {
        switch state {
        case .hidden:
            EmptyView()
        case .checking:
            LabNote(LabText.checking)
        case let .note(r):
            LabNote(r.message ?? "", button: r.button.map { copied && r.state == "needs-server" ? LabText["setup.copied"] : $0 },
                    onButton: r.button == nil ? nil : { fix(r) }, onOK: onDismiss)
        }
    }

    private func fix(_ r: LabGate.Result) {
        switch r.state {
        case "needs-server":
            Task {
                if let code = await lab.serverCode() {
                    LabClipboard.copy(code)
                    copied = true
                }
            }
        case "needs-notifications":
            if let url = LabClipboard.settingsURL { openURL(url) }
        case "needs-quick-sends":
            onOpenSetting?()
        default:
            break
        }
    }
}

/// A control that runs its feature's gate first (1.5): `label` looks and acts like any enabled control; a tap shows the
/// note under it when the feature is not ready, or runs `action` when it is.
public struct LabGateButton<Content: View>: View {
    @ObservedObject var lab: LabModel
    let feature: String
    let action: () -> Void
    let onOpenSetting: (() -> Void)?
    let label: () -> Content
    @State private var note: NoteState = .hidden
    /// Counts taps: an answer for an earlier tap is dropped, and each tap's note is a new view (said again).
    @State private var taps = 0

    public init(lab: LabModel, feature: String, onOpenSetting: (() -> Void)? = nil, action: @escaping () -> Void,
                @ViewBuilder label: @escaping () -> Content) {
        self.lab = lab
        self.feature = feature
        self.action = action
        self.onOpenSetting = onOpenSetting
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await tap() }
            } label: {
                label()
            }
            GatedNote(lab: lab, state: note, onOpenSetting: onOpenSetting) { note = .hidden }
                .id(taps)
        }
        .onDisappear { note = .hidden }
    }

    @MainActor private func tap() async {
        taps += 1
        let tap = taps
        note = .hidden
        let feature = self.feature
        let lab = self.lab
        let r = await GateTap.run(feature, gate: { await lab.gate(feature) }) {
            if taps == tap { note = .checking }
        }
        guard taps == tap else { return } // tapped again meanwhile
        if r.ready {
            note = .hidden
            action()
        } else {
            note = .note(r)
        }
    }
}

// MARK: What's in Lab (1.4)

/// What's in Lab (1.4): the Inbox's Lab state as the header line ("Your Daylight: Lab on · checked in 4 min ago"), one
/// row per Lab feature this app has in this build (its name, one sentence and its short state), then the server group
/// "With your Daylight server (optional)" with the server's short state under the heading and each server feature,
/// whose own short state shows only where it differs. Nothing spells out setup steps until a row is tapped: a tap runs
/// the feature's gate and shows its one sentence under the row (`LabNote`), or opens the feature. The server features
/// are always listed, and never look unavailable.
///
/// `footer`: a line at the end (the ad-hoc Mac's `LabText.adHocMac`). `useSwitch`: a feature's Use switch (W1, 6.5 Q5),
/// or nil for none. `onOpen`: opens a feature that is ready. `onOpenSetting`: opens a setting of this app ("Open
/// setting").
public struct WhatsInLabView: View {
    @ObservedObject var lab: LabModel
    let footer: String?
    let useSwitch: ((String) -> Binding<Bool>?)?
    let onOpen: ((String) -> Void)?
    let onOpenSetting: (() -> Void)?
    @State private var tapped: String?
    @State private var note: NoteState = .hidden
    /// Counts taps: an answer for an earlier tap is dropped, and each tap's note is a new view (said again).
    @State private var taps = 0

    public init(lab: LabModel, footer: String? = nil, useSwitch: ((String) -> Binding<Bool>?)? = nil,
                onOpen: ((String) -> Void)? = nil, onOpenSetting: (() -> Void)? = nil) {
        self.lab = lab
        self.footer = footer
        self.useSwitch = useSwitch
        self.onOpen = onOpen
        self.onOpenSetting = onOpenSetting
    }

    public var body: some View {
        let o = lab.overview
        let header = o?.header ?? LabText.inboxLabText(inboxLab: lab.ledger.inboxLab, checkedIn: lab.ledger.checkedIn,
                                                      now: Int64((Date().timeIntervalSince1970 * 1000).rounded()))
        List {
            Section {
                Text(header).listRowText(header)
            }
            if let features = o?.features, !features.isEmpty {
                Section {
                    ForEach(features) { row in featureRow(row) }
                }
            }
            Section {
                let short = o?.serverShort ?? LabText.checking
                Text(short).dlsSecondary().listRowText(short)
                ForEach(serverRows(o)) { row in featureRow(row) }
            } header: {
                Text(LabText.serverHeading).dlsSecondary().listRowText(LabText.serverHeading)
            }
            if let footer {
                // Callout, not footnote: the Mac's 10 pt footnote fails the contrast audit as a paragraph of its own.
                Section {
                    Text(footer).dlsFont(.callout).dlsSecondary().listRowText(footer)
                }
            }
        }
        .navigationTitle(LabText.whatsInLab)
        // The cached states at once, then the server's and the Daylight's answers (1.5).
        .task { await lab.openOverview() }
        .onDisappear {
            tapped = nil
            note = .hidden
        }
    }

    /// The server group's rows: the overview's, or, before it is known, the features with no short state yet.
    private func serverRows(_ o: LabCenter.Overview?) -> [LabCenter.Row] {
        if let rows = o?.serverRows { return rows }
        return lab.center.serverFeatures.map { id in
            LabCenter.Row(id: id, name: LabText.featureName(id), sentence: LabText.featureSentence(id), short: nil)
        }
    }

    @ViewBuilder private func featureRow(_ row: LabCenter.Row) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await tap(row.id) }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name).dlsFont(.body, weight: .semibold).listRowText(row.name)
                    Text(row.sentence).dlsFont(.footnote).dlsSecondary().listRowText(row.sentence)
                    if let short = row.short {
                        Text(short).dlsFont(.footnote, weight: .medium).listRowText(short)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier(LabIDs.feature(row.id))
            if let use = useSwitch?(row.id) {
                Toggle(isOn: use) {
                    Text(LabText.useLabel).listRowText(LabText.useLabel)
                }
                .accessibilityLabel(LabText.useA11y(row.id))
                if let f = LabText.useFooter(row.id) {
                    Text(f).dlsFont(.footnote).dlsSecondary().listRowText(f)
                }
            }
            if tapped == row.id {
                GatedNote(lab: lab, state: note, onOpenSetting: onOpenSetting) {
                    tapped = nil
                    note = .hidden
                }
                .id(taps)
            }
        }
    }

    @MainActor private func tap(_ feature: String) async {
        taps += 1
        let tap = taps
        tapped = feature
        note = .hidden
        let lab = self.lab
        let r = await GateTap.run(feature, gate: { await lab.gate(feature) }) {
            if taps == tap { note = .checking }
        }
        guard taps == tap, tapped == feature else { return } // another row (or this one again) was tapped meanwhile
        if r.ready {
            tapped = nil
            note = .hidden
            onOpen?(feature)
        } else {
            note = .note(r)
        }
    }
}

// MARK: The Daylight server section (2.6)

/// The Daylight server section (2.6), where setup happens, so it carries the long texts: the state ("Ready" or its long
/// message, with the exact secret names); Set up with a link (first while the state says to paste a new setup link,
/// else last); while the server is not set up, the steps to turn it on; the move question; "Your server" with its host
/// and fingerprint; the delivery mode (with the v1 notice); the Server code with Copy; the Lab Inbox and AI lines; the
/// optional Server address; and the deploy's re-run help.
public struct ServerSettingsView: View {
    @ObservedObject var lab: LabModel
    @State private var setupLink = ""
    @State private var setupConfirm: String?
    @State private var setupSaid: String?
    @State private var setupWorking = false
    @State private var address = ""
    @State private var addressSaid: String?
    @State private var codeCopied = false
    @State private var movedDismissed = false

    public init(lab: LabModel) {
        self.lab = lab
    }

    public var body: some View {
        Form {
            if let v = lab.serverView {
                content(v)
            } else {
                Section {
                    Text(LabText.checking).listRowText(LabText.checking)
                }
            }
        }
        .navigationTitle(LabText.serverRow)
        .task {
            await lab.loadServerView()
            address = lab.serverView?.manualUrl ?? ""
        }
    }

    private var S: (String) -> String { { LabText["serverSection.\($0)"] } }

    @ViewBuilder private func content(_ v: LabCenter.ServerView) -> some View {
        Section {
            // The icon beside the text, not a Label (whose wider frame the iPhone's audit measured the text against).
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: v.state == "ready" ? "checkmark.circle.fill" : "info.circle").accessibilityHidden(true)
                Text(v.message).listRowText(v.message)
            }
        }
        if !v.paired {
            Section {
                Text(v.rerun).dlsFont(.footnote).dlsSecondary().listRowText(v.rerun)
            }
        } else {
            if v.setupFirst { setupSection }
            if v.showSteps { stepsSection }
            if let moved = v.moved, !movedDismissed {
                Section {
                    Text(moved).listRowText(moved)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { moveButtons }
                        VStack(alignment: .leading, spacing: 8) { moveButtons }
                    }
                }
            }
            if !v.hostLine.isEmpty {
                Section {
                    Text(v.hostLine).listRowText(v.hostLine).textSelection(.enabled)
                } header: {
                    Text(S("hostLabel")).dlsSecondary().listRowText(S("hostLabel"))
                }
            }
            if let delivery = v.delivery {
                let line = delivery == "v1" ? S("deliveryV1") : S("deliveryLab")
                Section {
                    Text(line).listRowText(line)
                    if let notice = v.v1Notice {
                        Text(notice).dlsFont(.footnote).listRowText(notice)
                    }
                } header: {
                    Text(S("deliveryLabel")).dlsSecondary().listRowText(S("deliveryLabel"))
                }
            }
            Section {
                Text(v.serverCode).font(.body.monospaced()).listRowText(v.serverCode).textSelection(.enabled)
                    .accessibilityIdentifier(LabIDs.serverCode)
                Button {
                    LabClipboard.copy(v.serverCode)
                    codeCopied = true
                    Announcer.announce(LabText["setup.copied"])
                } label: {
                    Text(S("copy")).listRowText(S("copy")).comfortTarget()
                }
                .accessibilityIdentifier(LabIDs.copyServerCode)
                if codeCopied {
                    Text(LabText["setup.copied"]).dlsFont(.footnote).listRowText(LabText["setup.copied"])
                }
            } header: {
                Text(S("serverCode")).dlsSecondary().listRowText(S("serverCode"))
            }
            if v.labInbox != nil || v.aiToday != nil {
                Section {
                    if let line = v.labInbox { Text(line).listRowText(line) }
                    if let line = v.aiToday { Text(line).listRowText(line) }
                }
            }
            addressSection
            if !v.setupFirst { setupSection }
            Section {
                Text(v.rerun).dlsFont(.footnote).dlsSecondary().listRowText(v.rerun)
            }
        }
    }

    @ViewBuilder private var moveButtons: some View {
        Button {
            Task { await lab.confirmMove() }
        } label: {
            Text(S("setupConfirm")).wrapping(S("setupConfirm")).comfortTarget()
        }
        .buttonStyle(.borderedProminent)
        .comfortBorder()
        Button {
            movedDismissed = true
        } label: {
            Text(S("setupCancel")).wrapping(S("setupCancel")).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
    }

    @ViewBuilder private var stepsSection: some View {
        Section {
            ForEach(Array(LabText.serverSteps.enumerated()), id: \.offset) { i, step in
                let line = "\(i + 1). \(step)"
                #if os(macOS)
                // Not selectable on the Mac, where the accessibility audit reads selectable 13 pt text in a form as
                // failing contrast (black on white: runs 39844619890 and 39848557119); the plain text passes.
                Text(line).listRowText(line)
                #else
                Text(line).listRowText(line).textSelection(.enabled)
                #endif
            }
            Text(S("stepsMore")).dlsFont(.footnote).dlsSecondary().listRowText(S("stepsMore"))
        } header: {
            Text(S("stepsHeading")).dlsSecondary().listRowText(S("stepsHeading"))
        }
    }

    @ViewBuilder private var setupSection: some View {
        Section {
            field(S("setupPlaceholder"), text: $setupLink, label: S("setupRow"), id: LabIDs.setupField) {
                if !setupWorking { checkSetupLink() }
            }
            if let confirm = setupConfirm {
                VStack(alignment: .leading, spacing: 8) {
                    Text(S("setupConfirmTitle")).dlsFont(.headline).wrapping(S("setupConfirmTitle"))
                        .accessibilityAddTraits(.isHeader)
                    Text(confirm).wrapping(confirm)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { setupConfirmButtons }
                        VStack(alignment: .leading, spacing: 8) { setupConfirmButtons }
                    }
                }
                .onAppear { Announcer.announce(confirm) }
            } else {
                Button {
                    checkSetupLink()
                } label: {
                    Text(S("setupButton")).listRowText(S("setupButton")).comfortTarget()
                }
                .disabled(setupWorking)
                .accessibilityIdentifier(LabIDs.setupButton)
            }
            if setupWorking {
                Text(S("setupWorking")).listRowText(S("setupWorking"))
            } else if let said = setupSaid {
                Text(said).listRowText(said)
            }
        } header: {
            Text(S("setupRow")).dlsSecondary().listRowText(S("setupRow"))
        } footer: {
            Text(S("setupFooter")).dlsSecondary().listRowText(S("setupFooter"))
        }
    }

    @ViewBuilder private var setupConfirmButtons: some View {
        Button {
            Task { await runSetup() }
        } label: {
            Text(S("setupConfirm")).wrapping(S("setupConfirm")).comfortTarget()
        }
        .buttonStyle(.borderedProminent)
        .comfortBorder()
        Button {
            setupConfirm = nil
        } label: {
            Text(S("setupCancel")).wrapping(S("setupCancel")).comfortTarget()
        }
        .buttonStyle(.bordered)
        .comfortBorder()
    }

    private func checkSetupLink() {
        let r = LabCenter.checkSetupLink(setupLink)
        setupSaid = r.error
        setupConfirm = r.confirm
        if let e = r.error { Announcer.announce(e) }
    }

    @MainActor private func runSetup() async {
        setupConfirm = nil
        setupWorking = true
        Announcer.announce(S("setupWorking"))
        let error = await lab.setup(link: setupLink)
        setupWorking = false
        setupSaid = error ?? S("setupDone")
        if error == nil { setupLink = "" }
        Announcer.announce(setupSaid ?? "")
    }

    @ViewBuilder private var addressSection: some View {
        Section {
            field(S("addressPlaceholder"), text: $address, label: S("serverAddress"), id: LabIDs.addressField) {
                saveAddress()
            }
            Button {
                saveAddress()
            } label: {
                Text(S("addressSave")).listRowText(S("addressSave")).comfortTarget()
            }
            if let said = addressSaid {
                Label {
                    Text(said).dlsFont(.footnote).listRowText(said)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange).accessibilityHidden(true)
                }
            }
        } header: {
            Text(S("serverAddress")).dlsSecondary().listRowText(S("serverAddress"))
        } footer: {
            Text(S("addressFooter")).dlsSecondary().listRowText(S("addressFooter"))
        }
    }

    private func saveAddress() {
        let text = address
        Task { @MainActor in
            addressSaid = await lab.saveServerAddress(text)
            if let said = addressSaid { Announcer.announce(said) }
        }
    }

    @ViewBuilder private func field(_ placeholder: String, text: Binding<String>, label: String, id: String,
                                    submit: @escaping () -> Void) -> some View {
        #if os(iOS)
        TextField(placeholder, text: text, axis: .vertical)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitOnReturn(text, perform: submit)
            .accessibilityLabel(label)
            .accessibilityIdentifier(id)
        #else
        // A Mac form shows a text field's title as a label beside it and leaves the field itself empty and borderless:
        // here the placeholder goes inside a field with a border, and the title only names it for VoiceOver.
        TextField(label, text: text, prompt: Text(placeholder))
            .labelsHidden()
            .textFieldStyle(.roundedBorder)
            .autocorrectionDisabled()
            .onSubmit(submit)
            .accessibilityLabel(label)
            .accessibilityIdentifier(id)
        #endif
    }
}

// MARK: The timeline's row text (2.5; W0: label and sentence only)

/// A history row's label and sentence as the Lab timeline words them (2.5): "In your Reader ✓", "Saved in the Daylight
/// Reader.", after a glyph for the state (words and a glyph, never colour alone). With Lab off, or a v1.1 Inbox, it is
/// exactly `RowText`'s. W0 shows the label and the sentence only; the step line and the check-in header come with F01
/// (W1, A3). Its accessibility label is `LabRowText.a11yLabel`.
public struct TimelineRow: View {
    let row: OutboxRow
    let text: LabRowText
    let showsSentence: Bool

    public init(row: OutboxRow, text: LabRowText, showsSentence: Bool = true) {
        self.row = row
        self.text = text
        self.showsSentence = showsSentence
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: Self.glyph(row, text)).accessibilityHidden(true)
                Text(text.label).dlsFont(.caption, weight: .medium).listRowText(text.label)
            }
            if showsSentence, let sentence = text.sentence {
                Text(sentence).dlsFont(.caption2).listRowText(sentence)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text.a11yLabel)
    }

    /// The state's glyph: the row's status glyph (`StatusLabel`) until it is delivered; then the Reader's step: in the
    /// Reader (a check), handed to it (an arrow), waiting on the Daylight (a hand, a tray), or stopped (a warning).
    public static func glyph(_ row: OutboxRow, _ text: LabRowText) -> String {
        guard row.status == .delivered, text.stepLine != nil else { return StatusLabel.glyph(row) }
        let rows = { (key: String) in LabText["rows.\(key).label"] }
        switch text.label {
        case rows("reader"), rows("queued"): return "checkmark.circle.fill"
        case rows("handedFile"): return "arrow.right.circle"
        case rows("waiting"): return "hand.tap"
        case rows("held"), rows("inbox"): return "tray"
        case rows("failed"): return "exclamationmark.triangle"
        default: return "checkmark.circle"
        }
    }
}

/// The one-time note (1.6), at the top of the main screen in builds whose app has F01 or F04 (`LabModel.noteEnabled`;
/// W0: never): "Lab is on. New features to try are in Settings › Lab, where you can turn it off." with OK.
public struct LabFirstRunNote: View {
    @ObservedObject var lab: LabModel

    public init(lab: LabModel) {
        self.lab = lab
    }

    public var body: some View {
        if lab.shouldShowNote {
            LabNote(LabText.note, onOK: { lab.dismissNote() })
        }
    }
}
