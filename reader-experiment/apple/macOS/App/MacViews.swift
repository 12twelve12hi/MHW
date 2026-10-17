import AppKit
import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UniformTypeIdentifiers

struct MacRootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack(alignment: .bottom) {
            if model.isPaired {
                MacHomeView()
            } else {
                MacPairView()
            }
            if let banner = model.banner {
                BannerView(banner: banner).onTapGesture { model.banner = nil }
            }
        }
        .frame(minWidth: 440, minHeight: 480)
        .animation(.default, value: model.banner)
    }
}

struct MacPairView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Image(systemName: "paperplane.circle.fill").font(.system(size: 44)).foregroundColor(.accentColor)
                    Text("Pair with your Daylight").font(.title2.weight(.semibold))
                }
                Text("Send articles, web pages and PDFs from this Mac to your Daylight: drop them on this window or the Dock icon, use the Share menu in Safari, Finder or Preview, or the Safari extension.")
                    .fixedSize(horizontal: false, vertical: true)
                PairingHelp()
                Text("Type or paste the code (or a daylightshare:// link):").font(.headline)
                PairingForm { model.pair($0) }
                Button("Paste from the clipboard and pair") {
                    let s = NSPasteboard.general.string(forType: .string) ?? ""
                    if let error = model.pair(s) { model.show(error, error: true) }
                }
            }
            .padding(24)
        }
    }
}

struct MacHomeView: View {
    @EnvironmentObject var model: AppModel
    @State private var link = ""
    @State private var targeted = false
    @State private var showSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Sending to \(model.daylightName)").font(.headline)
                Spacer()
                if model.sendingCount > 0 { ProgressView().controlSize(.small) }
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .buttonStyle(.borderless)
                    .help("Settings")
            }

            dropZone

            HStack {
                TextField("Paste or type a link", text: $link)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(sendLink)
                Button("Send", action: sendLink)
                    .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }

            HStack {
                Text("History").font(.headline)
                Spacer()
                Button("Check now") { Task { await model.refresh() } }.buttonStyle(.borderless)
            }
            List {
                if model.rows.isEmpty {
                    Text("Nothing sent yet.").foregroundColor(.secondary)
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
                            Button("Remove from History") { model.delete(row) }
                        }
                }
            }
            .listStyle(.inset)
        }
        .padding(18)
        .sheet(isPresented: $showSettings) {
            VStack(spacing: 0) {
                MacSettingsView()
                HStack {
                    Spacer()
                    Button("Done") { showSettings = false }.keyboardShortcut(.defaultAction)
                }
                .padding()
            }
            .frame(width: 460)
            .environmentObject(model)
        }
    }

    private var dropZone: some View {
        VStack(spacing: 10) {
            Image(systemName: "tray.and.arrow.down").font(.system(size: 30)).foregroundColor(.secondary)
            Text("Drop a PDF, document or link here").font(.title3)
            HStack {
                Button("Choose File…") { MacFilePicker.pickAndSend(model) }
                Button("Send Clipboard Link") { Task { await model.sendClipboardLink() } }
            }
        }
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

    private func sendLink() {
        let text = link
        Task {
            if await model.sendLink(text) { link = "" }
        }
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
    @EnvironmentObject var model: AppModel
    @State private var deviceName = ""
    @State private var relay = ""
    @State private var relayError: String?
    @State private var confirmUnpair = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Daylight", value: model.isPaired ? model.daylightName : "Not paired")
                TextField("Relay", text: $relay)
                    .onSubmit { relayError = saveRelay() }
                if let relayError { Text(relayError).font(.footnote).foregroundColor(.red) }
                if model.isPaired {
                    Button("Unpair…", role: .destructive) { confirmUnpair = true }
                }
            } header: {
                Text("Your Daylight")
            }
            Section {
                TextField("This Mac’s name", text: $deviceName, prompt: Text(model.defaultDeviceName))
                    .onSubmit { model.setDeviceName(deviceName) }
                Text("Shown on the Daylight as who sent each item.").font(.footnote).foregroundColor(.secondary)
            } header: {
                Text("This Mac")
            }
            ExtensionsSection()
            Section {
                Button("Clear Delivered and Expired") { model.clearFinished() }
                LabeledContent("Shared with the extensions", value: model.store.isShared ? "Yes" : "No (pair them separately)")
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
            } header: {
                Text("History and app")
            }
        }
        .formStyle(.grouped)
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
