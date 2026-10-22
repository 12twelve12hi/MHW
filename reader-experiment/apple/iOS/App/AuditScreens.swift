#if DEBUG
import DaylightShareKit
import DaylightShareUI
import SwiftUI
import UIKit

/// The truncation audit (LAB-PLAN F27.4), run by `SendToDaylightTests-iOS`: each main screen with sample data, and the
/// share sheet's card in each of its states (`ShareCardSample`), hosted at the narrowest width the app runs at (an
/// iPad's one-third split, 320 pt) with Comfort on and text at accessibility3, and every probed text's frame compared
/// with the size it needs (`TruncationRecorder`). Debug builds only.
@MainActor
enum AuditScreens {
    struct Report {
        let screen: String
        let measured: Int
        let problems: [String]
    }

    static let narrowestWidth: CGFloat = 320

    /// The share card's states, by the name of each report ("share-reading", …). The card applies its model's Comfort
    /// itself, so the model says whether it is on.
    static var shareCardNames: [String] { ShareCardSample.allCases.map { "share-\($0.rawValue)" } }

    static func shareCards(comfort: Bool) -> [(String, AnyView)] {
        ShareCardSample.allCases.map {
            ("share-\($0.rawValue)", AnyView(ShareExtensionView(model: $0.model(comfort: comfort))))
        }
    }

    /// The Lab screens (LAB-PLAN 1.4, 1.5, 2.6), by report name, after the main screens: What's in Lab, the Daylight
    /// server section and the needs-setup notes, each with the words a fresh install sees: no Daylight server yet
    /// (`labSampleModel`).
    static let labScreenNames = ["whats-in-lab", "server", "lab-notes"]

    static func labScreens(_ model: AppModel) -> [(String, AnyView)] {
        [
            ("whats-in-lab", AnyView(NavigationStack { WhatsInLabView(lab: model.lab) })),
            ("server", AnyView(NavigationStack { ServerSettingsView(lab: model.lab) })),
            ("lab-notes", AnyView(labNotes)),
        ]
    }

    /// The needs-setup notes (1.5) as they show under a tapped control: the longest (needs-server, with its button and
    /// OK), the server out of reach, not paired, and "Checking your Daylight server…".
    static var labNotes: some View {
        List {
            LabNote(LabText.needsMessage("needs-server", platform: "iphone") ?? "", button: LabText.button("needs-server"),
                    onButton: {}, onOK: {})
            LabNote(ServerMessages.localMessage("OFFLINE"), onOK: {})
            LabNote(LabText.needsMessage("needs-pairing", platform: "iphone") ?? "", onOK: {})
            LabNote(LabText.checking)
        }
    }

    /// Home (with a history row in every state), Settings (with Lab on, as a fresh install has it), the pairing screen,
    /// the Lab screens and the share card in each state.
    static func reports(shots: URL?) async -> [Report] {
        let paired = await sampleModel(paired: true)
        let unpaired = await sampleModel(paired: false)
        let lab = await labSampleModel()
        var out: [Report] = []
        out.append(await measure("home", AnyView(HomeView().environmentObject(paired)), height: 6000, shots: shots))
        out.append(await measure("settings", AnyView(SettingsView().environmentObject(paired)), height: 3000, shots: shots))
        out.append(await measure("pair", AnyView(PairView().environmentObject(unpaired)), height: 3000, shots: shots))
        for (name, view) in labScreens(lab) {
            out.append(await measure(name, view, height: 4000, shots: shots))
        }
        for (name, view) in shareCards(comfort: true) {
            out.append(await measure(name, view, height: 2400, shots: shots))
        }
        return out
    }

    struct Scaling {
        let screen: String
        /// The texts compared at both sizes.
        let measured: [String]
        /// The texts that need more height at accessibility3.
        let grown: [String]
        /// The texts that did not grow, each with its two heights.
        let problems: [String]
    }

    /// Dynamic Type: every probed text on each main screen (Home with history and without, Settings, the pairing
    /// screen) and on the share card needs more height at accessibility3 than at the default size (Comfort off), so it
    /// follows the text size.
    static func scaling() async -> [Scaling] {
        let paired = await sampleModel(paired: true)
        let empty = await sampleModel(paired: true, rows: false)
        let unpaired = await sampleModel(paired: false)
        let lab = await labSampleModel()
        let screens: [(String, AnyView)] = [
            ("home", AnyView(HomeView().environmentObject(paired))),
            ("home-empty", AnyView(HomeView().environmentObject(empty))),
            ("settings", AnyView(SettingsView().environmentObject(paired))),
            ("pair", AnyView(PairView().environmentObject(unpaired))),
        ] + labScreens(lab) + shareCards(comfort: false)
        var out: [Scaling] = []
        for (name, view) in screens {
            let small = await host(view, comfort: false, typeSize: .large, height: 6000).neededSizes
            let large = await host(view, comfort: false, typeSize: .accessibility3, height: 6000).neededSizes
            var grown: [String] = []
            var problems: [String] = []
            for (text, size) in small.sorted(by: { $0.key < $1.key }) {
                guard let bigger = large[text] else { continue }
                if bigger.height <= size.height {
                    problems.append("“\(text)” needs \(Int(size.height)) pt at the default size and \(Int(bigger.height)) pt at accessibility3")
                } else {
                    grown.append(text)
                }
            }
            out.append(Scaling(screen: name, measured: small.keys.filter { large[$0] != nil }.sorted(), grown: grown,
                               problems: problems))
        }
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

    /// A model on its own storage: paired with a long-named Daylight and (with `rows`) a history row in every state
    /// (`HistorySample`, the rows the UI tests show with `-DLSSampleHistory`), or not paired.
    static func sampleModel(paired: Bool, rows: Bool = true) async -> AppModel {
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
            for row in HistorySample.rows() where rows { outbox.save(row) }
        }
        let model = AppModel(store: store, arguments: [])
        await model.reloadNow()
        return model
    }

    /// A paired model whose Daylight server lookups answer as a relay with nothing on the server's config topic: no
    /// server deployed (needs-server), as on a fresh install, so the server section shows its longest form (the state's
    /// long text, Set up with a link, the steps). Nothing goes on the network for the server; What's in Lab and the
    /// section are worked out before the screens are hosted.
    static func labSampleModel() async -> AppModel {
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dls-audit-lab-\(id)", isDirectory: true)
        let defaults = UserDefaults(suiteName: "dls-audit-lab-\(id)") ?? .standard
        let store = SharedStore(defaults: defaults, directory: directory)
        if let pairing = try? Pairing(secret: Data(repeating: 7, count: 16), relay: "http://127.0.0.1:9",
                                      name: "The Daylight in the reading room upstairs") {
            _ = await store.pair(pairing)
        }
        let center = LabCenter(store: store, fetch: Self.noServer)
        let lab = LabModel(center: center, arguments: [])
        let model = AppModel(store: store, lab: lab, arguments: [])
        await model.reloadNow()
        await lab.reloadNow()
        await lab.openOverview()
        await lab.loadServerView()
        return model
    }

    /// The Daylight server's lookups when no server was deployed: every request answers 200 with nothing in it (the
    /// relay's config topic holds no message).
    static let noServer: DaylightServer.Fetch = { request in
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                                                    headerFields: ["Content-Type": "application/x-ndjson"]) else {
            throw URLError(.badURL)
        }
        return (Data(), response)
    }

    /// Hosts `view` in a window `narrowestWidth` wide with Comfort on and text at accessibility3, lets it settle, and
    /// reports the probed texts that are cut. Writes a screenshot to `shots` when given.
    static func measure(_ screen: String, _ view: AnyView, height: CGFloat, shots: URL?) async -> Report {
        let recorder = await host(view, comfort: true, typeSize: .accessibility3, height: height, shots: shots, name: screen)
        return Report(screen: screen, measured: recorder.measured, problems: recorder.problems)
    }

    /// Hosts `view` in a window `narrowestWidth` wide at `typeSize`, with Comfort on or off, lets it settle, and returns
    /// what its probed texts reported. Writes a screenshot to `shots` when given.
    static func host(_ view: AnyView, comfort: Bool, typeSize: DynamicTypeSize, height: CGFloat, shots: URL? = nil,
                     name: String = "") async -> TruncationRecorder {
        let recorder = TruncationRecorder(width: narrowestWidth)
        let root = view
            .comfort(comfort)
            .dynamicTypeSize(typeSize)
            .environment(\.truncationRecorder, recorder)
        let hosting = UIHostingController(rootView: root)
        let window: UIWindow
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow()
        }
        window.frame = CGRect(x: 0, y: 0, width: narrowestWidth, height: height)
        window.rootViewController = hosting
        window.isHidden = false
        for _ in 0..<20 {
            hosting.view.setNeedsLayout()
            hosting.view.layoutIfNeeded()
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if let shots {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let image = UIGraphicsImageRenderer(bounds: hosting.view.bounds, format: format).image { _ in
                _ = hosting.view.drawHierarchy(in: hosting.view.bounds, afterScreenUpdates: true)
            }
            try? FileManager.default.createDirectory(at: shots, withIntermediateDirectories: true)
            try? image.pngData()?.write(to: shots.appendingPathComponent("truncation-ios-\(name).png"))
        }
        window.isHidden = true
        window.rootViewController = nil
        return recorder
    }
}
#endif
