import AppKit
import DaylightShareUI
import SafariServices
import SwiftUI

/// Settings section: is the Safari extension on, and shortcuts to where the Safari extension and the Share menu item
/// are turned on.
struct ExtensionsSection: View {
    @State private var safariEnabled: Bool?

    static let unsignedNote = "Unsigned builds: in Safari, turn on Develop › Allow Unsigned Extensions first (Safari › Settings › Advanced › Show features for web developers)."

    static var safariExtensionID: String { (Bundle.main.bundleIdentifier ?? "com.daylight.share.mac") + ".SafariExtension" }

    var body: some View {
        Section {
            InfoRow("Safari extension", value: safariEnabled.map { $0 ? "On" : "Off" } ?? "Unknown")
            Button {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: Self.safariExtensionID) { _ in }
            } label: {
                Text("Open Safari Extension Settings…").wrapping("Open Safari Extension Settings…").comfortTarget()
            }
            Text(Self.unsignedNote).dlsFont(.footnote).dlsSecondary().wrapping(Self.unsignedNote)
            Button {
                if let url = URL(string: "x-apple.systempreferences:com.apple.ExtensionsPreferences") {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Text("Open Share Menu Settings…").wrapping("Open Share Menu Settings…").comfortTarget()
            }
        } header: {
            Text("Safari and the Share menu").wrapping("Safari and the Share menu")
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
