import AppKit
import SafariServices
import SwiftUI

/// Settings section: is the Safari extension on, and shortcuts to where the Safari extension and the Share menu item
/// are turned on.
struct ExtensionsSection: View {
    @State private var safariEnabled: Bool?

    static var safariExtensionID: String { (Bundle.main.bundleIdentifier ?? "com.daylight.share.mac") + ".SafariExtension" }

    var body: some View {
        Section {
            LabeledContent("Safari extension", value: safariEnabled.map { $0 ? "On" : "Off" } ?? "Unknown")
            Button("Open Safari Extension Settings…") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: Self.safariExtensionID) { _ in }
            }
            Text("Unsigned builds: in Safari, turn on Develop › Allow Unsigned Extensions first (Safari › Settings › Advanced › Show features for web developers).")
                .font(.footnote)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Share Menu Settings…") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.ExtensionsPreferences") {
                    NSWorkspace.shared.open(url)
                }
            }
        } header: {
            Text("Safari and the Share menu")
        }
        .onAppear(perform: refresh)
    }

    private func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: Self.safariExtensionID) { state, _ in
            let enabled = state?.isEnabled
            Task { @MainActor in safariEnabled = enabled }
        }
    }
}
