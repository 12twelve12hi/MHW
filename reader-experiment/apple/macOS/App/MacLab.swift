import DaylightShareKit
import DaylightShareUI
import SwiftUI

// Lab on the Mac (LAB-PLAN 1, F00 and F17; card A2): the Lab section at the top of Settings (the main window's sheet
// and the Settings window), What's in Lab with the ad-hoc build's closing line, and the Daylight server section. The
// pieces are the kit's (`LabSettingsSection`, `WhatsInLabView`, `ServerSettingsView`, `LabFirstRunNote`); this file
// puts them in the Mac's settings. The Share menu card's own Lab switch (ad-hoc builds) is in the kit's
// `ShareExtensionView`. With Lab off only the switch shows, so the Lab-off screens stay the P0 baselines' (F00.2).

enum MacLab {
    /// `LAB_NOTE_ENABLED` (LAB-PLAN 1.2): the one-time note ("Lab is on. …", 1.6) shows only in builds whose app has
    /// F01 or F04. The Mac's W0 build has neither; A5 (F01, F04) turns it on.
    static let noteEnabled = false

    /// What's in Lab's closing line (1.4): only where the app keeps its own storage, with no App Group, as the released
    /// ad-hoc build does (and the Developer ID dry run, whose self-signed signature carries no team). There Share ›
    /// Daylight is an app of its own, with its own pairing and Lab switch, and its sends don't show here. A build signed
    /// with a team (the Developer ID path) shares the App Group with the Share menu item, and the line does not show;
    /// nor while storage is still being resolved (at most 2 s; the list follows when it settles).
    static func whatsInLabFooter(_ storage: SharedStore.State) -> String? {
        if case .appPrivate = storage { return LabText.adHocMac }
        return nil
    }
}

/// Settings in a navigation stack, for the Lab section's rows "What’s in Lab ›" and "Daylight server ›" (LAB-PLAN 1.1).
/// The main window's Settings sheet and the Settings window (⌘,) both show it.
struct MacSettingsStack: View {
    var body: some View {
        NavigationStack {
            MacSettingsView()
        }
        // A navigation stack takes the height it is given: without one, a sheet would size it to almost nothing.
        .frame(minHeight: 420, idealHeight: 600)
    }
}

/// A page the Lab section opens (What's in Lab, Daylight server): its own Back button and title above it. A Mac sheet
/// has no toolbar for a navigation stack's own back button and title, so the page shows them itself (the system's back
/// button is hidden, so the Settings window does not show two).
struct MacLabPage<Content: View>: View {
    /// The Back button's words (the app's own, like the JS apps' "‹ Back").
    static var back: String { "Back" }

    let title: String
    let content: Content
    @Environment(\.dismiss) private var dismiss

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Button { dismiss() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").accessibilityHidden(true)
                        Text(Self.back).wrapping(Self.back)
                    }
                    .comfortTarget()
                }
                .buttonStyle(.borderless)
                .keyboardShortcut("[", modifiers: .command)
                .accessibilityLabel(Self.back)
                .comfortBorder()
                Text(title).dlsFont(.title3, weight: .semibold).wrapping(title)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            content
        }
        .navigationBarBackButtonHidden(true)
    }
}

/// What's in Lab (1.4) on the Mac: the kit's list, ending with the ad-hoc line when this build has no App Group
/// (`MacLab.whatsInLabFooter`). It follows storage as it settles.
struct MacWhatsInLab: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        WhatsInLabView(lab: model.lab, footer: MacLab.whatsInLabFooter(model.storage))
            .listStyle(.inset)
            // The list is a group for VoiceOver; it needs a name (F27.2), as the History list has one.
            .accessibilityLabel(LabText.whatsInLab)
    }
}

/// The Daylight server section (2.6) on the Mac: the kit's, as a grouped form like Settings.
struct MacServerSection: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ServerSettingsView(lab: model.lab)
            .formStyle(.grouped)
    }
}

/// The Lab section, first in Settings (1.1): the switch with its footer and, while Lab is on, "What’s in Lab ›" and
/// "Daylight server ›" (subtitled "Optional · {short state}"), and the re-pairing follow-up when there is one.
struct MacLabSection: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        LabSettingsSection(lab: model.lab, whatsInLab: {
            MacLabPage(title: LabText.whatsInLab) { MacWhatsInLab() }
        }, server: {
            MacLabPage(title: LabText.serverRow) { MacServerSection() }
        })
    }
}
