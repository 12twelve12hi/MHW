import DaylightShareKit
import DaylightShareUI
import SwiftUI

/// First run: scan the Daylight's QR code, or type/paste its code.
struct PairView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Image(systemName: "paperplane.circle.fill")
                        .font(.system(size: 64))
                        .foregroundColor(.accentColor)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                        .accessibilityHidden(true)
                    Text("Pair with your Daylight").font(.title2.weight(.semibold)).wrapping("Pair with your Daylight")
                        .accessibilityAddTraits(.isHeader)
                    Text(Self.intro).font(.title3).wrapping(Self.intro)
                    PairingHelp()
                    Button {
                        model.sheet = .scanner
                    } label: {
                        Label {
                            Text("Scan the QR code").wrapping("Scan the QR code")
                        } icon: {
                            Image(systemName: "qrcode.viewfinder").accessibilityHidden(true)
                        }
                        .frame(maxWidth: .infinity)
                        .comfortTarget()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .comfortBorder()
                    // Typing the code is always offered, next to the camera (F27).
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Or type the code").font(.headline).wrapping("Or type the code")
                            .accessibilityAddTraits(.isHeader)
                        PairingForm { model.pair($0) }
                    }
                    Text(Self.linkNote).font(.footnote).dlsSecondary().wrapping(Self.linkNote)
                }
                .padding()
            }
            .navigationTitle("Send to Daylight")
            .navigationBarTitleDisplayMode(.inline)
            // The scanner is presented by RootView (`appSheets`); a code it reads that is not a pairing code shows
            // in the banner.
        }
    }

    static let intro = "Send articles, web pages and PDFs from this iPhone to your Daylight."
    static let linkNote = "Opening a daylightshare:// pairing link on this iPhone also pairs it, once you confirm."
}

/// The camera sheet.
struct ScannerSheet: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            QRScannerView(onFound: onCode)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Scan the pairing QR code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
        }
    }
}
