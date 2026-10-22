import AppKit
import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UniformTypeIdentifiers

struct MacRootView: View {
    @EnvironmentObject var model: AppModel

    /// The window's narrowest width, and the Settings sheet's width (the truncation audit measures at these, F27.4).
    static let minWidth: CGFloat = 440
    static let settingsWidth: CGFloat = 460

    /// The Share menu's card is this wide (`ShareViewController`).
    static let shareCardWidth: CGFloat = 360

    var body: some View {
        #if DEBUG
        // `-DLSShareCard <name>` (Debug builds, the UI tests' walk of the Share menu card): the card in one of its
        // states (`ShareCardSample`), as wide as in the Share menu, in place of the window's content.
        if let card = ShareCardSample.launchModel {
            ShareExtensionView(model: card)
                .frame(width: MacRootView.shareCardWidth)
                .frame(minHeight: 260)
        } else {
            window
        }
        #else
        window
        #endif
    }

    private var window: some View {
        ZStack(alignment: .bottom) {
            if model.isPaired {
                MacHomeView()
            } else if !model.isStorageReady || !model.isLoaded {
                // At most SharedStore.resolutionTimeout (2 s), usually a few milliseconds: rather than flash the
                // pairing screen while the App Group is being found and storage is read (off the main thread), show
                // nothing much.
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                MacPairView()
            }
            if let banner = model.banner {
                BannerView(banner: banner).onTapGesture { model.banner = nil }
            }
        }
        .frame(minWidth: MacRootView.minWidth, minHeight: 480)
        // The window's content is one group for VoiceOver; it needs a name (F27.2), and so does the AppKit view that
        // hosts it.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Send to Daylight")
        .background(HostingViewLabel(label: "Send to Daylight"))
        // No motion in Comfort (F27); `comfort(_:)` also stops animations when Reduce Motion is on.
        .animation(model.comfort ? nil : .default, value: model.banner)
        .comfort(model.comfort)
        // Every sheet of the window comes from here: Settings, and the pairing question, which replaces Settings when
        // a daylightshare:// link arrives while it is open.
        .appSheets(model) { sheet in
            if sheet == .settings {
                VStack(spacing: 0) {
                    // In a navigation stack: the Lab section's rows open What's in Lab and Daylight server in it.
                    MacSettingsStack()
                    HStack {
                        Spacer()
                        Button { model.sheet = nil } label: {
                            Text("Done").wrapping("Done").comfortTarget()
                        }
                        .keyboardShortcut(.defaultAction)
                        .comfortBorder()
                    }
                    .padding()
                }
                .frame(width: MacRootView.settingsWidth)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Settings")
                .background(HostingViewLabel(label: "Settings"))
                .environmentObject(model)
            }
        }
        .onAppear { model.noteRendered() }
    }
}

struct MacPairView: View {
    @EnvironmentObject var model: AppModel

    static let intro = "Send articles, web pages and PDFs from this Mac to your Daylight: drop them on this window or the Dock icon, use the Share menu in Safari, Finder or Preview, or the Safari extension."
    static let typeTheCode = "Type or paste the code (or a daylightshare:// link):"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Image(systemName: "paperplane.circle.fill").font(.system(size: 44)).foregroundColor(.accentColor)
                        .accessibilityHidden(true)
                    Text("Pair with your Daylight").dlsFont(.title2, weight: .semibold).wrapping("Pair with your Daylight")
                        .accessibilityAddTraits(.isHeader)
                }
                Text(Self.intro).wrapping(Self.intro)
                PairingHelp()
                // Typing or pasting the code is how the Mac pairs (F27: typed-code pairing is always available).
                Text(Self.typeTheCode).dlsFont(.headline).wrapping(Self.typeTheCode)
                PairingForm { model.pair($0) }
                Button {
                    let s = NSPasteboard.general.string(forType: .string) ?? ""
                    if let error = model.pair(s) { model.show(error, error: true) }
                } label: {
                    Text("Paste from the clipboard and pair").wrapping("Paste from the clipboard and pair").comfortTarget()
                }
                .comfortBorder()
            }
            .padding(24)
        }
    }
}

struct MacHomeView: View {
    @EnvironmentObject var model: AppModel
    @State private var link = ""
    @State private var targeted = false

    /// The history's "something is on its way" (the shared copy's `sending` label).
    static let sending = RowText(status: .sending, errorCode: "", size: 0, created: Date()).label

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // The one-time Lab note (LAB-PLAN 1.6), only in builds with F01 or F04 (`MacLab.noteEnabled`): never in W0.
            LabFirstRunNote(lab: model.lab)
            HStack {
                Text("Sending to \(model.daylightName)").dlsFont(.headline).wrapping("Sending to \(model.daylightName)")
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if model.sendingCount > 0 {
                    // In Comfort, words instead of a spinner (no motion).
                    if model.comfort {
                        Text(Self.sending).wrapping(Self.sending)
                    } else {
                        ProgressView().controlSize(.small).accessibilityLabel(Self.sending)
                    }
                }
                Button { model.sheet = .settings } label: {
                    Image(systemName: "gearshape").comfortTarget()
                }
                .buttonStyle(.borderless)
                .help("Settings")
                .accessibilityLabel("Settings")
            }

            dropZone

            HStack {
                TextField("Paste or type a link", text: $link)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(sendLink)
                    .accessibilityLabel("Paste or type a link")
                    .comfortBorder(radius: 6)
                // Never greyed out: an empty link does nothing.
                Button(action: sendLink) {
                    Text("Send").wrapping("Send").comfortTarget()
                }
                .keyboardShortcut(.defaultAction)
                .comfortBorder()
            }

            HStack {
                Text("History").dlsFont(.headline).wrapping("History")
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button { Task { await model.refresh() } } label: {
                    Text("Check now").wrapping("Check now").comfortTarget()
                }
                .buttonStyle(.borderless)
            }
            List {
                if model.rows.isEmpty {
                    Text("Nothing sent yet.").dlsSecondary().wrapping("Nothing sent yet.")
                }
                ForEach(model.rows) { row in
                    HistoryRowView(row: row) { Task { await model.retry(row) } }
                        .contextMenu {
                            if !row.url.isEmpty {
                                Button("Copy Link") {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(row.url, forType: .string)
                                }
                            }
                            Button("Remove") { model.delete(row) }
                        }
                }
            }
            .listStyle(.inset)
            .accessibilityLabel("History")
        }
        .padding(18)
        // Settings opens as a sheet of MacRootView (`appSheets`).
    }

    private var dropZone: some View {
        VStack(spacing: 10) {
            Image(systemName: "tray.and.arrow.down").font(.system(size: 30)).foregroundColor(.secondary)
                .accessibilityHidden(true)
            Text("Drop a PDF, document or link here").dlsFont(.title3).multilineTextAlignment(.center)
                .wrapping("Drop a PDF, document or link here")
            ViewThatFits(in: .horizontal) {
                HStack { dropZoneButtons }
                VStack { dropZoneButtons }
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 150)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
                .foregroundColor(targeted ? Color.accentColor : Color.secondary.opacity(0.5))
        )
        .background(RoundedRectangle(cornerRadius: 14).fill(targeted ? Color.accentColor.opacity(0.08) : Color.clear))
        .onDrop(of: [UTType.fileURL, UTType.url, UTType.plainText], isTargeted: $targeted) { providers in
            Task { await DropHandler.handle(providers, model: model) }
            return true
        }
    }

    @ViewBuilder private var dropZoneButtons: some View {
        Button { MacFilePicker.pickAndSend(model) } label: {
            Text("Choose File…").wrapping("Choose File…").comfortTarget()
        }
        .comfortBorder()
        Button { Task { await model.sendClipboardLink() } } label: {
            Text("Send Clipboard Link").wrapping("Send Clipboard Link").comfortTarget()
        }
        .comfortBorder()
    }

    private func sendLink() {
        let text = link
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            if await model.sendLink(text) { link = "" }
        }
    }
}

/// Names the AppKit view that hosts a window's (or a sheet's) SwiftUI content: VoiceOver sees it as a group, and the
/// accessibility audit wants every group described (F27.2).
struct HostingViewLabel: NSViewRepresentable {
    let label: String

    final class Probe: NSView {
        var label = ""

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            window?.contentView?.setAccessibilityLabel(label)
        }
    }

    func makeNSView(context: Context) -> Probe {
        let view = Probe()
        view.label = label
        view.setAccessibilityElement(false)
        return view
    }

    func updateNSView(_ view: Probe, context: Context) {
        view.label = label
        view.window?.contentView?.setAccessibilityLabel(label)
    }
}

/// Files, links and text dropped on the window.
enum DropHandler {
    @MainActor
    static func handle(_ providers: [NSItemProvider], model: AppModel) async {
        var files: [URL] = []
        var links: [String] = []
        for p in providers {
            if p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = await loadURL(p, UTType.fileURL.identifier), url.isFileURL {
                files.append(url)
            } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                      let url = await loadURL(p, UTType.url.identifier) {
                if url.isFileURL { files.append(url) } else { links.append(url.absoluteString) }
            } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let text = await loadString(p) {
                links.append(text)
            }
        }
        await model.sendFiles(files)
        for l in links { await model.sendLink(l) }
    }

    static func loadURL(_ p: NSItemProvider, _ type: String) async -> URL? {
        await withCheckedContinuation { (cont: CheckedContinuation<URL?, Never>) in
            p.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                if let d = value as? Data {
                    cont.resume(returning: URL(dataRepresentation: d, relativeTo: nil))
                } else if let u = value as? URL {
                    cont.resume(returning: u)
                } else if let s = value as? String {
                    cont.resume(returning: URL(string: s))
                } else {
                    cont.resume(returning: nil)
                }
            }
        }
    }

    static func loadString(_ p: NSItemProvider) async -> String? {
        await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { value, _ in
                if let s = value as? String {
                    cont.resume(returning: s)
                } else if let d = value as? Data {
                    cont.resume(returning: String(data: d, encoding: .utf8))
                } else {
                    cont.resume(returning: nil)
                }
            }
        }
    }
}

struct MacSettingsView: View {
    static let nameFooter = "Shown on the Daylight as who sent each item."
    static let noAppGroup = "This build isn’t signed with a developer team, so it has no App Group: the Share menu asks for the pairing code once, and the Safari extension pairs in its own popup."

    @EnvironmentObject var model: AppModel
    @State private var deviceName = ""
    @State private var relay = ""
    @State private var relayError: String?
    @State private var confirmUnpair = false

    var body: some View {
        Form {
            // Lab first (LAB-PLAN 1.1): with Lab off only its switch and footer show.
            MacLabSection()
            Section {
                InfoRow("Daylight", value: model.isPaired ? model.daylightName : "Not paired")
                TextField("Relay", text: $relay)
                    .onSubmit { relayError = saveRelay() }
                    .accessibilityLabel("Relay")
                if let relayError {
                    Label {
                        Text(relayError).dlsFont(.footnote).wrapping(relayError)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange).accessibilityHidden(true)
                    }
                }
                if model.isPaired {
                    Button(role: .destructive) { confirmUnpair = true } label: {
                        Text("Unpair…").foregroundColor(Comfort.destructive).wrapping("Unpair…").comfortTarget()
                    }
                }
            } header: {
                Text("Your Daylight").wrapping("Your Daylight")
            }
            // The accessibility baseline (F27), not Lab: on or off, with Lab on or off.
            Section {
                Toggle(isOn: Binding(get: { model.comfort }, set: { model.setComfort($0) })) {
                    Text(Comfort.title).wrapping(Comfort.title)
                }
                // The Form puts the words and the switch apart; the switch needs its own name (F27: every control
                // labelled).
                .accessibilityLabel(Comfort.title)
                .accessibilityIdentifier("comfort")
            } footer: {
                Text(Comfort.footer).dlsFont(.callout).dlsSecondary().wrapping(Comfort.footer)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Section {
                TextField("This Mac’s name", text: $deviceName, prompt: Text(model.defaultDeviceName))
                    .onSubmit { model.setDeviceName(deviceName) }
                    .accessibilityLabel("This Mac’s name")
                Text(Self.nameFooter).dlsFont(.footnote).dlsSecondary().wrapping(Self.nameFooter)
            } header: {
                Text("This Mac").wrapping("This Mac")
            }
            ExtensionsSection()
            Section {
                Button { model.clearFinished() } label: {
                    Text("Clear Delivered and Expired").wrapping("Clear Delivered and Expired").comfortTarget()
                }
                InfoRow("Shared with the extensions", value: model.storageSummary)
                if case .appPrivate = model.storage {
                    Text(Self.noAppGroup).dlsFont(.footnote).dlsSecondary().wrapping(Self.noAppGroup)
                }
                InfoRow("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
            } header: {
                Text("History and app").wrapping("History and app")
            }
        }
        .formStyle(.grouped)
        .accessibilityLabel("Settings")
        .onAppear {
            deviceName = model.deviceName
            relay = model.pairing?.relay ?? DLS.defaultRelay
        }
        .onDisappear {
            model.setDeviceName(deviceName)
            _ = saveRelay()
        }
        .confirmationDialog("Unpair from \(model.daylightName)?", isPresented: $confirmUnpair) {
            Button("Unpair", role: .destructive) { model.unpair() }
        } message: {
            Text("Items not delivered yet are dropped. You can pair again with the code on your Daylight.")
        }
    }

    private func saveRelay() -> String? {
        guard let current = model.pairing?.relay else { return nil }
        let normalized = (try? ShareText.normalizeRelay(relay)) ?? relay
        if normalized == current { return nil }
        return model.setRelay(relay)
    }
}
