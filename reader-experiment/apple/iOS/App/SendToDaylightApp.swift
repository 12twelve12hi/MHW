import BackgroundTasks
import DaylightShareKit
import DaylightShareUI
import SwiftUI

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
                .task { await model.handleLaunchArguments() }
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
            if let sender = try? DaylightShare.sender() {
                _ = await sender.tick()
                if sender.hasPending { Self.scheduleRefresh() }
            }
        }
    }

    /// Asks iOS for a background refresh in about 15 minutes when something still waits for an ack or a re-send.
    nonisolated static func scheduleRefresh() {
        guard let sender = try? DaylightShare.sender(), sender.hasPending else { return }
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack(alignment: .bottom) {
            if model.isPaired {
                HomeView()
            } else {
                PairView()
            }
            if let banner = model.banner {
                BannerView(banner: banner).onTapGesture { model.banner = nil }
            }
        }
        .animation(.default, value: model.banner)
        .animation(.default, value: model.isPaired)
    }
}
