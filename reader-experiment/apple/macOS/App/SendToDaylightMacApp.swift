import AppKit
import DaylightShareKit
import DaylightShareUI
import SwiftUI

@main
struct SendToDaylightMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel.shared

    var body: some Scene {
        MenuBarExtra("Send to Daylight", systemImage: "paperplane") {
            MenuBarContent().environmentObject(model)
        }
        Settings {
            MacSettingsView().environmentObject(model).frame(width: MacRootView.settingsWidth).comfort(model.comfort)
        }
    }
}

/// Opens files and links dropped on the Dock icon or sent with "Open With", and `daylightshare://` pairing links.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        MainWindow.shared.show()
        AppModel.shared.startAutoRefresh()
        Task {
            await AppModel.shared.handleLaunchArguments(sampleHistory: Self.sampleHistory)
            await AppModel.shared.refresh()
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

    /// Files, links and `daylightshare://` links (which ask in the main window before they pair).
    func application(_ application: NSApplication, open urls: [URL]) {
        MainWindow.shared.show()
        Task { await AppModel.shared.handleOpen(urls) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { MainWindow.shared.show() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationDidBecomeActive(_ notification: Notification) {
        AppModel.shared.reload()
        // Clicking the Dock icon (or Cmd-Tab) with no window open brings the main window back.
        if !NSApp.windows.contains(where: { $0.isVisible && $0.canBecomeMain }) { MainWindow.shared.show() }
    }
}

/// The main window, kept by AppKit so the Dock icon, the menu bar item and opened links can always bring it back.
@MainActor
final class MainWindow {
    static let shared = MainWindow()
    private var window: NSWindow?

    func show() {
        if window == nil {
            let host = NSHostingController(rootView: MacRootView().environmentObject(AppModel.shared))
            let w = NSWindow(contentViewController: host)
            w.title = "Send to Daylight"
            w.setContentSize(NSSize(width: 520, height: 620))
            w.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            w.isReleasedWhenClosed = false
            w.setFrameAutosaveName("SendToDaylightMain")
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}

/// The menu bar item.
struct MenuBarContent: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        if model.isPaired {
            Text("Sending to \(model.daylightName)")
            Button("Send Clipboard Link") { Task { await model.sendClipboardLink() } }
                .keyboardShortcut("l", modifiers: [.command, .shift])
            Button("Send a File…") { MacFilePicker.pickAndSend(model) }
            if !model.rows.isEmpty {
                Divider()
                ForEach(model.rows.prefix(6)) { row in
                    let text = RowText(row: row)
                    Button("\(text.label) · \(String(row.displayTitle.prefix(48)))") {
                        // A row whose shared copy offers "Retry now" or "Try again" does that; any other opens the window.
                        if text.action != nil { Task { await model.retry(row) } } else { MainWindow.shared.show() }
                    }
                }
            }
        } else {
            Text("Not paired yet")
        }
        Divider()
        Button("Open Send to Daylight") { MainWindow.shared.show() }
        Button("Quit Send to Daylight") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}

enum MacFilePicker {
    @MainActor
    static func pickAndSend(_ model: AppModel) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = "Choose PDFs, EPUBs, documents or web pages to send to \(model.daylightName)."
        panel.prompt = "Send"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        Task { await model.sendFiles(urls) }
    }
}

extension AppModel {
    /// "Send clipboard link": the first web address on the clipboard.
    func sendClipboardLink() async {
        let pb = NSPasteboard.general
        var text = pb.string(forType: .string) ?? ""
        if let url = (pb.readObjects(forClasses: [NSURL.self]) as? [URL])?.first, !url.isFileURL {
            text = url.absoluteString
        }
        guard !text.isEmpty else {
            show("The clipboard has no link.", error: true)
            return
        }
        await sendLink(text)
    }
}
