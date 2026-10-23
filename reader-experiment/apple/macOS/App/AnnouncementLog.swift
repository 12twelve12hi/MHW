import DaylightShareUI
import SwiftUI

#if DEBUG
/// `-DLSShowAnnouncements` (Debug builds, the UI tests; LAB-PLAN F00.3 "a screen reader announces the sentence", F27):
/// every VoiceOver announcement the app makes (`Announcer.post`) is also listed at the foot of the main window, one text
/// per announcement (identifier `AnnouncementLog.textID`), so a UI test can read what VoiceOver was told. The
/// announcement itself is posted as always (the kit's macOS branch: `NSAccessibility.post(… .announcementRequested …)`).
///
/// The iPhone's tests read a file the app appends to (`-DLSAnnounceLog`). A Mac UI test cannot: the sandboxed app writes
/// only inside its own container, and a test runner reading another app's container brings up macOS's "would like to
/// access data from other apps" prompt (macOS 14 and later), which nobody answers on CI. The accessibility tree is what
/// the runner reads anyway. Without the launch argument nothing changes, so the walks and audits never see the list.
enum AnnouncementLog {
    static let argument = "-DLSShowAnnouncements"
    /// The identifier of each announcement's text.
    static let textID = "dls-announced"

    /// Asked for at launch.
    static var isRequested: Bool { ProcessInfo.processInfo.arguments.contains(argument) }

    /// Called once at launch, before the first window: from then on each announcement is posted, then listed.
    @MainActor
    static func start() {
        guard isRequested, !AnnouncementList.shared.started else { return }
        AnnouncementList.shared.started = true
        let post = Announcer.post
        Announcer.post = { text in
            post(text)
            AnnouncementList.shared.said.append(text)
        }
    }
}

/// What was announced since launch, in order.
@MainActor
final class AnnouncementList: ObservableObject {
    static let shared = AnnouncementList()
    @Published var said: [String] = []
    var started = false
}

/// The list at the foot of the main window (only with `-DLSShowAnnouncements`).
struct AnnouncementLogView: View {
    @ObservedObject var list = AnnouncementList.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(list.said.suffix(20).enumerated()), id: \.offset) { _, text in
                Text(text)
                    .font(.caption2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(AnnouncementLog.textID)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, list.said.isEmpty ? 0 : 4)
    }
}
#endif

extension View {
    /// The UI tests' list of announcements at the foot of the main window: Debug builds with `-DLSShowAnnouncements`
    /// only (`AnnouncementLog`); otherwise the view as it is.
    @ViewBuilder
    func announcementLog() -> some View {
        #if DEBUG
        if AnnouncementLog.isRequested {
            safeAreaInset(edge: .bottom, spacing: 0) { AnnouncementLogView() }
        } else {
            self
        }
        #else
        self
        #endif
    }
}
