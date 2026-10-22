import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UniformTypeIdentifiers

/// Paired: send a link or a file, and the history.
struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @State private var link = ""
    @State private var sendingLink = false
    @FocusState private var linkFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        // More lines rather than cut the link at large text sizes; Return sends.
                        TextField("Paste or type a link", text: $link, axis: .vertical)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($linkFocused)
                            .submitLabel(.send)
                            .onSubmit(sendLink)
                            .submitOnReturn($link, perform: sendLink)
                            .accessibilityLabel("Paste or type a link")
                        PasteButton(payloadType: String.self) { strings in
                            guard let s = strings.first else { return }
                            Task { @MainActor in link = s.trimmingCharacters(in: .whitespacesAndNewlines) }
                        }
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.capsule)
                    }
                    // Never greyed out (an empty link does nothing); the icon and words side by side, the words free to
                    // wrap at any text size.
                    Button(action: sendLink) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Image(systemName: "paperplane").accessibilityHidden(true)
                            Text("Send the link").listRowText("Send the link")
                        }
                        .comfortTarget()
                    }
                    Button {
                        model.sheet = .files
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Image(systemName: "doc.badge.plus").accessibilityHidden(true)
                            Text("Send a file…").listRowText("Send a file…")
                        }
                        .comfortTarget()
                    }
                } header: {
                    Text("Send to \(model.daylightName)").dlsSecondary().listRowText("Send to \(model.daylightName)")
                } footer: {
                    Text(Self.tip).dlsSecondary().listRowText(Self.tip)
                }

                Section {
                    if model.rows.isEmpty {
                        Text("Nothing sent yet.").dlsSecondary().listRowText("Nothing sent yet.")
                    }
                    ForEach(model.rows) { row in
                        HistoryRowView(row: row) { Task { await model.retry(row) } }
                            .swipeActions {
                                Button(role: .destructive) { model.delete(row) } label: { Label("Remove", systemImage: "trash") }
                            }
                    }
                } header: {
                    HStack {
                        Text("History").dlsSecondary().listRowText("History")
                        Spacer()
                        if model.sendingCount > 0 {
                            // In Comfort, words instead of a spinner (no motion).
                            if model.comfort {
                                Text(Self.sending).dlsSecondary().listRowText(Self.sending)
                            } else {
                                ProgressView().accessibilityLabel(Self.sending)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Send to Daylight")
            // In the bar: a large title is cut short at large text sizes.
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { model.sheet = .settings } label: {
                        Image(systemName: "gearshape").comfortTarget()
                    }
                    .accessibilityLabel("Settings")
                }
            }
            // Settings and the file picker are presented by RootView (`appSheets`), with the pairing question.
        }
    }

    static let tip = "Tip: in Safari or any app, tap Share › Send to Daylight. Safari sends the page as you see it, so paywalled and logged-in articles work."
    /// The history's "something is on its way" (the shared copy's `sending` label).
    static let sending = RowText(status: .sending, errorCode: "", size: 0, created: Date()).label

    static let fileTypes: [UTType] = {
        var types: [UTType] = [.pdf, .epub, .html, .plainText, .rtf]
        for id in ["org.openxmlformats.wordprocessingml.document", "com.microsoft.word.doc", "net.daringfireball.markdown"] {
            if let t = UTType(id) { types.append(t) }
        }
        types.append(.data)
        return types
    }()

    private func sendLink() {
        let text = link
        guard !sendingLink, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        sendingLink = true
        linkFocused = false
        Task {
            if await model.sendLink(text) { link = "" }
            sendingLink = false
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var deviceName = ""
    @State private var relay = ""
    @State private var relayError: String?
    @State private var confirmUnpair = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    InfoRow("Name", value: model.daylightName)
                    VStack(alignment: .leading) {
                        TextField("Relay", text: $relay, axis: .vertical)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .onSubmit(saveRelay)
                            .submitOnReturn($relay, perform: saveRelay)
                            .accessibilityLabel("Relay")
                        if let relayError {
                            Label {
                                Text(relayError).font(.footnote).listRowText(relayError)
                            } icon: {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    Button(role: .destructive) { confirmUnpair = true } label: {
                        Text("Unpair").foregroundColor(Comfort.destructive).listRowText("Unpair").comfortTarget()
                    }
                } header: {
                    Text("Your Daylight").dlsSecondary().listRowText("Your Daylight")
                }
                // The accessibility baseline (F27), not Lab: on or off, with Lab on or off.
                Section {
                    Toggle(isOn: Binding(get: { model.comfort }, set: { model.setComfort($0) })) {
                        Text(Comfort.title).listRowText(Comfort.title)
                    }
                    .accessibilityIdentifier("comfort")
                } footer: {
                    Text(Comfort.footer).dlsSecondary().listRowText(Comfort.footer)
                }
                Section {
                    TextField(model.defaultDeviceName, text: $deviceName, axis: .vertical)
                        .onSubmit { model.setDeviceName(deviceName) }
                        .submitOnReturn($deviceName) { model.setDeviceName(deviceName) }
                        .accessibilityLabel("This device’s name")
                } header: {
                    Text("This device’s name").dlsSecondary().listRowText("This device’s name")
                } footer: {
                    Text("Shown on the Daylight as who sent each item.").dlsSecondary()
                        .listRowText("Shown on the Daylight as who sent each item.")
                }
                Section {
                    Button { model.clearFinished() } label: {
                        Text("Clear delivered and expired").listRowText("Clear delivered and expired").comfortTarget()
                    }
                } header: {
                    Text("History").dlsSecondary().listRowText("History")
                }
                Section {
                    InfoRow("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
                    InfoRow("Shared with the share extension", value: model.storageSummary)
                } header: {
                    Text("About").dlsSecondary().listRowText("About")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        model.setDeviceName(deviceName)
                        saveRelay()
                        if relayError == nil { dismiss() }
                    }
                }
            }
            .onAppear {
                deviceName = model.deviceName
                relay = model.pairing?.relay ?? DLS.defaultRelay
            }
            .confirmationDialog("Unpair from \(model.daylightName)?", isPresented: $confirmUnpair, titleVisibility: .visible) {
                Button("Unpair", role: .destructive) {
                    model.unpair()
                    dismiss()
                }
            } message: {
                Text("Items not delivered yet are dropped. You can pair again with the code on your Daylight.")
            }
        }
    }

    private func saveRelay() {
        guard let current = model.pairing?.relay else { return }
        let normalized = (try? ShareText.normalizeRelay(relay)) ?? relay
        if normalized == current { relayError = nil; return }
        relayError = model.setRelay(relay)
    }
}
