#if DEBUG
import AppKit
import DaylightShareKit
import DaylightShareUI
import SwiftUI

/// The truncation audit (LAB-PLAN F27.4), run by `SendToDaylightTests-macOS`: each main screen with sample data (Lab on,
/// as on a first start: Settings with its Lab section, and the two pages that section opens, What's in Lab and the
/// Daylight server section), and the Share menu's card in each of its states (`ShareCardSample`; its own Lab switch
/// on), hosted at its narrowest width (the window's minimum, 440 pt; the Settings sheet, 460 pt; the card, 360 pt) with
/// Comfort on (larger text on the Mac) and accessibility3, and every probed text's frame compared with the size it
/// needs (`TruncationRecorder`). Debug builds only. The menu bar item's menu is drawn by the system at the width its
/// items need, so it is not measured here.
@MainActor
enum AuditScreens {
    struct Report {
        let screen: String
        let measured: Int
        let problems: [String]
    }

    static var shareCardNames: [String] { ShareCardSample.allCases.map { "share-\($0.rawValue)" } }

    /// The main window (with a history row in every state), Settings (Lab on), What's in Lab (with the ad-hoc line: the
    /// sample model keeps its own storage) and the Daylight server section, the pairing screen and the Share menu's card
    /// in each state (the card applies its model's Comfort itself, so its model has Comfort on).
    static func reports(shots: URL?) async -> [Report] {
        let paired = await sampleModel(paired: true)
        let unpaired = await sampleModel(paired: false)
        // What the two Lab pages show once asked (the relay nobody listens on: the server is OFFLINE), so they are
        // measured with their content, not "Checking your Daylight server…".
        await paired.lab.loadOverview(refresh: true)
        await paired.lab.loadServerView()
        var out: [Report] = []
        out.append(await measure("main", AnyView(MacHomeView().environmentObject(paired)),
                                 width: MacRootView.minWidth, height: 2400, shots: shots))
        out.append(await measure("settings", AnyView(MacSettingsView().environmentObject(paired)),
                                 width: MacRootView.settingsWidth, height: 2000, shots: shots))
        out.append(await measure("whats-in-lab",
                                 AnyView(MacLabPage(title: LabText.whatsInLab) { MacWhatsInLab() }.environmentObject(paired)),
                                 width: MacRootView.settingsWidth, height: 2400, shots: shots))
        out.append(await measure("server",
                                 AnyView(MacLabPage(title: LabText.serverRow) { MacServerSection() }.environmentObject(paired)),
                                 width: MacRootView.settingsWidth, height: 3200, shots: shots))
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

    /// A model on its own storage: paired with a long-named Daylight and a history row in every state (`HistorySample`,
    /// the rows the UI tests show with `-DLSSampleHistory`), or not paired.
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
            for row in HistorySample.rows() { outbox.save(row) }
        }
        let model = AppModel(store: store, arguments: [])
        await model.reloadNow()
        return model
    }

    /// LAB-PLAN 1.4: What's in Lab's closing line about what an ad-hoc build lacks (`LabText.adHocMac`).
    static var adHocLine: String { LabText.adHocMac }
    /// What's in Lab's server heading (1.4), which every version of the list shows.
    static var serverHeading: String { LabText.serverHeading }

    /// The texts What's in Lab shows, paired, for a build whose storage is the App Group `appGroup` (the Developer ID
    /// build: `<TEAMID>.com.daylight.share`) or, with nil, its own (the ad-hoc build): its words, as the truncation
    /// probes report them.
    static func whatsInLabTexts(appGroup: String?) async -> [String] {
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dls-lab-\(id)", isDirectory: true)
        let defaults = UserDefaults(suiteName: "dls-lab-\(id)") ?? .standard
        let store = SharedStore(defaults: defaults, directory: directory, appGroup: appGroup)
        if let pairing = try? Pairing(secret: Data(repeating: 7, count: 16), relay: "http://127.0.0.1:9", name: "Test Daylight") {
            await store.pair(pairing)
        }
        let model = AppModel(store: store, arguments: [])
        await model.reloadNow()
        await model.lab.loadOverview(refresh: false)
        let recorder = await render(AnyView(MacWhatsInLab().environmentObject(model)), width: MacRootView.settingsWidth,
                                    height: 2400, comfort: false, shots: nil, name: "whats-in-lab-\(appGroup ?? "own-storage")")
        return Array(recorder.neededSizes.keys)
    }

    /// Hosts `view` in a window `width` wide with Comfort on and accessibility3, lets it settle, and reports the
    /// probed texts that are cut. Writes a screenshot to `shots` when given.
    static func measure(_ screen: String, _ view: AnyView, width: CGFloat, height: CGFloat, shots: URL?) async -> Report {
        let recorder = await render(view, width: width, height: height, comfort: true, shots: shots, name: screen)
        return Report(screen: screen, measured: recorder.measured, problems: recorder.problems)
    }

    /// Hosts `view` in a window `width` wide (with Comfort and accessibility3 when `comfort`), lets it settle for two
    /// seconds and returns what its probed texts reported. Writes a screenshot to `shots` when given.
    static func render(_ view: AnyView, width: CGFloat, height: CGFloat, comfort: Bool, shots: URL?,
                     name screen: String) async -> TruncationRecorder {
        let recorder = TruncationRecorder(width: width)
        let root = view
            .comfort(comfort)
            .dynamicTypeSize(comfort ? .accessibility3 : .large)
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
        window.orderOut(nil)
        window.contentView = nil
        return recorder
    }
}
#endif
