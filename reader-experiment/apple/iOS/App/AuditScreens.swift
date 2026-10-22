#if DEBUG
import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UIKit

/// The truncation audit (LAB-PLAN F27.4), run by `SendToDaylightTests-iOS`: each main screen with sample data, hosted
/// at the narrowest width the app runs at (an iPad's one-third split, 320 pt) with Comfort on and text at
/// accessibility3, and every probed text's frame compared with the size it needs (`TruncationRecorder`). Debug builds
/// only.
@MainActor
enum AuditScreens {
    struct Report {
        let screen: String
        let measured: Int
        let problems: [String]
    }

    static let narrowestWidth: CGFloat = 320

    /// Home (with a history row in every state), Settings and the pairing screen.
    static func reports(shots: URL?) async -> [Report] {
        let paired = await sampleModel(paired: true)
        let unpaired = await sampleModel(paired: false)
        var out: [Report] = []
        out.append(await measure("home", AnyView(HomeView().environmentObject(paired)), height: 6000, shots: shots))
        out.append(await measure("settings", AnyView(SettingsView().environmentObject(paired)), height: 3000, shots: shots))
        out.append(await measure("pair", AnyView(PairView().environmentObject(unpaired)), height: 3000, shots: shots))
        return out
    }

    /// The audit's own check: a text squeezed into too little height is reported, and the same text left to wrap is
    /// not.
    static func selfCheck() async -> (cut: Report, wrapped: Report) {
        let text = "A sentence long enough to need several lines at this width and this text size."
        let cut = await measure("self-check-cut", AnyView(
            Text(text).truncationProbe(text).frame(width: 200, height: 30).frame(maxWidth: .infinity, maxHeight: .infinity)
        ), height: 600, shots: nil)
        let wrapped = await measure("self-check-wrapped", AnyView(
            Text(text).wrapping(text).frame(width: 200).frame(maxWidth: .infinity, maxHeight: .infinity)
        ), height: 600, shots: nil)
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

    /// Hosts `view` in a window `narrowestWidth` wide with Comfort on and text at accessibility3, lets it settle, and
    /// reports the probed texts that are cut. Writes a screenshot to `shots` when given.
    static func measure(_ screen: String, _ view: AnyView, height: CGFloat, shots: URL?) async -> Report {
        let recorder = TruncationRecorder(width: narrowestWidth)
        let root = view
            .comfort(true)
            .dynamicTypeSize(.accessibility3)
            .environment(\.truncationRecorder, recorder)
        let host = UIHostingController(rootView: root)
        let window: UIWindow
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow()
        }
        window.frame = CGRect(x: 0, y: 0, width: narrowestWidth, height: height)
        window.rootViewController = host
        window.isHidden = false
        for _ in 0..<20 {
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if let shots {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
                _ = host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
            }
            try? FileManager.default.createDirectory(at: shots, withIntermediateDirectories: true)
            try? image.pngData()?.write(to: shots.appendingPathComponent("truncation-ios-\(screen).png"))
        }
        let report = Report(screen: screen, measured: recorder.measured, problems: recorder.problems)
        window.isHidden = true
        window.rootViewController = nil
        return report
    }
}
#endif
