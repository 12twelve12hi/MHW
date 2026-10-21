import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UniformTypeIdentifiers

/// Paired: send a link or a file, and the history.
struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @State private var link = ""
    @FocusState private var linkFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("Paste or type a link", text: $link)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($linkFocused)
                            .submitLabel(.send)
                            .onSubmit(sendLink)
                        PasteButton(payloadType: String.self) { strings in
                            guard let s = strings.first else { return }
                            Task { @MainActor in link = s.trimmingCharacters(in: .whitespacesAndNewlines) }
                        }
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.capsule)
                    }
                    Button(action: sendLink) {
                        Label("Send the link", systemImage: "paperplane")
                    }
                    .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button {
                        model.sheet = .files
                    } label: {
                        Label("Send a file…", systemImage: "doc.badge.plus")
                    }
                } header: {
                    Text("Send to \(model.daylightName)")
                } footer: {
                    Text("Tip: in Safari or any app, tap Share › Send to Daylight. Safari sends the page as you see it, so paywalled and logged-in articles work.")
                }

                Section {
                    if model.rows.isEmpty {
                        Text("Nothing sent yet.").foregroundColor(.secondary)
                    }
                    ForEach(model.rows) { row in
                        HistoryRowView(row: row) { Task { await model.retry(row) } }
                            .swipeActions {
                                Button(role: .destructive) { model.delete(row) } label: { Label("Remove", systemImage: "trash") }
                            }
                    }
                } header: {
                    HStack {
                        Text("History")
                        Spacer()
                        if model.sendingCount > 0 { ProgressView() }
                    }
                }
            }
            .navigationTitle("Send to Daylight")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { model.sheet = .settings } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            // Settings and the file picker are presented by RootView (`appSheets`), with the pairing question.
        }
    }

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
        linkFocused = false
        Task {
            if await model.sendLink(text) { link = "" }
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
                Section("Your Daylight") {
                    LabeledContent("Name", value: model.daylightName)
                    VStack(alignment: .leading) {
                        TextField("Relay", text: $relay)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .onSubmit(saveRelay)
                        if let relayError { Text(relayError).font(.footnote).foregroundColor(.red) }
                    }
                    Button("Unpair", role: .destructive) { confirmUnpair = true }
                }
                Section {
                    TextField(model.defaultDeviceName, text: $deviceName)
                        .onSubmit { model.setDeviceName(deviceName) }
                } header: {
                    Text("This device’s name")
                } footer: {
                    Text("Shown on the Daylight as who sent each item.")
                }
                Section("History") {
                    Button("Clear delivered and expired") { model.clearFinished() }
                }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
                    LabeledContent("Shared with the share extension", value: model.storageSummary)
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
