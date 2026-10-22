import BackgroundTasks
import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main
struct SendToDaylightApp: App {
    nonisolated static let refreshTask = "com.daylight.share.refresh"

    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { url in Task { await model.handleOpen([url]) } }
                .task { await model.handleLaunchArguments(sampleHistory: Self.sampleHistory) }
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                model.reload()
                model.startAutoRefresh()
                Task { await model.refresh() }
            case .background:
                model.stopAutoRefresh()
                Self.scheduleRefresh()
            default:
                break
            }
        }
        // PROTOCOL 3.3: read acks and re-send in the background while items wait.
        .backgroundTask(.appRefresh(Self.refreshTask)) {
            await SharedStore.shared.ready()
            if let sender = await AppModel.backgroundSender() {
                _ = await sender.tick()
                Self.scheduleRefresh()
            }
        }
    }

    /// `-DLSSampleHistory` with `-DLSTestStorage` (Debug builds only, for the UI tests' walks and audits): the history
    /// shows `HistorySample`'s rows, a row in every state, and keeps them as they are.
    nonisolated static var sampleHistory: Bool {
        #if DEBUG
        return HistorySample.isRequested()
        #else
        return false
        #endif
    }

    /// Asks iOS for a background refresh in about 15 minutes when something still waits for an ack or a re-send.
    /// Reads the outbox on a background queue (never on the main thread).
    nonisolated static func scheduleRefresh() {
        DispatchQueue.global(qos: .utility).async {
            guard let sender = try? DaylightShare.sender(), sender.hasPending else { return }
            let request = BGAppRefreshTaskRequest(identifier: refreshTask)
            request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
            try? BGTaskScheduler.shared.submit(request)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        #if DEBUG
        // `-DLSShareCard <name>` (Debug builds, the UI tests' walk of the share card): the share sheet's card in one of
        // its states (`ShareCardSample`) in place of the app.
        if let card = ShareCardSample.launchModel {
            ShareExtensionView(model: card)
        } else {
            app
        }
        #else
        app
        #endif
    }

    private var app: some View {
        ZStack(alignment: .bottom) {
            if model.isPaired {
                HomeView()
            } else if !model.isStorageReady || !model.isLoaded {
                // At most SharedStore.resolutionTimeout, usually a few milliseconds (finding the App Group and
                // reading storage, off the main thread).
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                PairView()
            }
            if let banner = model.banner {
                BannerView(banner: banner).onTapGesture { model.banner = nil }
            }
        }
        // No motion in Comfort (F27); `comfort(_:)` also stops animations when Reduce Motion is on.
        .animation(model.comfort ? nil : .default, value: model.banner)
        .animation(model.comfort ? nil : .default, value: model.isPaired)
        .comfort(model.comfort)
        // Every sheet comes from here (Settings, the file picker, the scanner, and the pairing question, which
        // replaces whichever is open when a daylightshare:// link arrives).
        .appSheets(model) { sheet in
            switch sheet {
            case .settings:
                SettingsView().environmentObject(model)
            case .files:
                DocumentPicker(types: HomeView.fileTypes) { urls in
                    model.sheet = nil
                    if !urls.isEmpty { Task { await model.sendFiles(urls) } }
                }
                .ignoresSafeArea()
            case .scanner:
                ScannerSheet { value in
                    model.sheet = nil
                    if let error = model.pair(value) { model.show(error, error: true) }
                }
            }
        }
        .onAppear { model.noteRendered() }
    }
}

/// "Send a file…": the system document picker, presented as one of the app's sheets. It hands over copies of the
/// chosen files (readable without security-scoped access); `onPick` gets them, or no URLs on Cancel.
struct DocumentPicker: UIViewControllerRepresentable {
    let types: [UTType]
    let onPick: ([URL]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: ([URL]) -> Void

        init(onPick: @escaping ([URL]) -> Void) {
            self.onPick = onPick
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onPick(urls)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            onPick([])
        }
    }
}
