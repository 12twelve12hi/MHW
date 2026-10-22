#if DEBUG
import AppKit
import DaylightShareKit
import DaylightShareUI
import SwiftUI

/// The truncation audit (LAB-PLAN F27.4), run by `SendToDaylightTests-macOS`: each main screen with sample data, and
/// the Share menu's card in each of its states (`ShareCardSample`), hosted at its narrowest width (the window's
/// minimum, 440 pt; the Settings sheet, 460 pt; the card, 360 pt) with Comfort on (larger text on the Mac) and
/// accessibility3, and every probed text's frame compared with the size it needs (`TruncationRecorder`). Debug builds
/// only. The menu bar item's menu is drawn by the system at the width its items need, so it is not measured here.
@MainActor
enum AuditScreens {
    struct Report {
        let screen: String
        let measured: Int
        let problems: [String]
    }

    static var shareCardNames: [String] { ShareCardSample.allCases.map { "share-\($0.rawValue)" } }

    /// The main window (with a history row in every state), Settings, the pairing screen and the Share menu's card in
    /// each state (the card applies its model's Comfort itself, so its model has Comfort on).
    static func reports(shots: URL?) async -> [Report] {
        let paired = await sampleModel(paired: true)
        let unpaired = await sampleModel(paired: false)
        var out: [Report] = []
        out.append(await measure("main", AnyView(MacHomeView().environmentObject(paired)),
                                 width: MacRootView.minWidth, height: 2400, shots: shots))
        out.append(await measure("settings", AnyView(MacSettingsView().environmentObject(paired)),
                                 width: MacRootView.settingsWidth, height: 2000, shots: shots))
        out.append(await measure("pair", AnyView(MacPairView().environmentObject(unpaired)),
                                 width: MacRootView.minWidth, height: 1400, shots: shots))
        for sample in ShareCardSample.allCases {
            out.append(await measure("share-\(sample.rawValue)", AnyView(ShareExtensionView(model: sample.model(comfort: true))),
                                     width: MacRootView.shareCardWidth, height: 1600, shots: shots))
        }
        return out
    }

    /// The audit's own check: a text squeezed into too little height is reported, and the same text left to wrap is
    /// not.
    static func selfCheck() async -> (cut: Report, wrapped: Report) {
        let text = "A sentence long enough to need several lines at this width and this text size."
        let cut = await measure("self-check-cut", AnyView(
            Text(text).truncationProbe(text).frame(width: 200, height: 20).frame(maxWidth: .infinity, maxHeight: .infinity)
        ), width: 440, height: 400, shots: nil)
        let wrapped = await measure("self-check-wrapped", AnyView(
            Text(text).wrapping(text).frame(width: 200).frame(maxWidth: .infinity, maxHeight: .infinity)
        ), width: 440, height: 400, shots: nil)
        return (cut, wrapped)
    }

    /// A model on its own storage: paired with a long-named Daylight and a history row in every state, or not paired.
    static func sampleModel(paired: Bool) async -> AppModel {
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dls-audit-\(id)", isDirectory: true)
        let defaults = UserDefaults(suiteName: "dls-audit-\(id)") ?? .standard
        let store = SharedStore(defaults: defaults, directory: directory)
        if paired {
            if let pairing = try? Pairing(secret: Data(repeating: 7, count: 16), relay: "http://127.0.0.1:9",
                                          name: "The Daylight in the reading room upstairs") {
                await store.pair(pairing)
            }
            let outbox = OutboxStore(store: store)
            for row in sampleRows() { outbox.save(row) }
        }
        let model = AppModel(store: store, arguments: [])
        await model.reloadNow()
        return model
    }

    /// One row per kind of label, sentence and button (CHANGES-v1.1 2.5), with a long title and link.
    static func sampleRows(now: Date = Date()) -> [OutboxRow] {
        let title = "A very long article title that goes on for a while, to see that it wraps instead of being cut short"
        let url = "https://example.com/a/very/long/path/that-keeps-going/and-going?with=a&query=string&that=is-long"
        let cases: [(OutboxRow.Status, String, TimeInterval)] = [
            (.sending, "", 0),
            (.sent, "", 2 * 86_400),
            (.delivered, "", 3_600),
            (.failed, "network", 600),
            (.expired, "", 8 * 86_400),
            (.expired, "too-large", 600),
        ]
        return cases.enumerated().map { i, c in
            let id = String(format: "%032x", i + 1)
            let header = ItemHeader(id: id, kind: .url, url: url, title: title, sent: "")
            return OutboxRow(id: id, kind: .url, title: title, url: url, size: 14_200_000, header: header,
                             created: now.addingTimeInterval(-c.2), status: c.0, errorCode: c.1)
        }
    }

    /// Hosts `view` in a window `width` wide with Comfort on and accessibility3, lets it settle, and reports the
    /// probed texts that are cut. Writes a screenshot to `shots` when given.
    static func measure(_ screen: String, _ view: AnyView, width: CGFloat, height: CGFloat, shots: URL?) async -> Report {
        let recorder = TruncationRecorder(width: width)
        let root = view
            .comfort(true)
            .dynamicTypeSize(.accessibility3)
            .environment(\.truncationRecorder, recorder)
            .frame(width: width, height: height)
        let host = NSHostingView(rootView: root)
        host.frame = NSRect(x: 0, y: 0, width: width, height: height)
        let window = NSWindow(contentRect: host.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.orderFrontRegardless()
        for _ in 0..<20 {
            host.layoutSubtreeIfNeeded()
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if let shots, let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
            host.cacheDisplay(in: host.bounds, to: rep)
            try? FileManager.default.createDirectory(at: shots, withIntermediateDirectories: true)
            try? rep.representation(using: .png, properties: [:])?.write(to: shots.appendingPathComponent("truncation-mac-\(screen).png"))
        }
        let report = Report(screen: screen, measured: recorder.measured, problems: recorder.problems)
        window.orderOut(nil)
        window.contentView = nil
        return report
    }
}
#endif
