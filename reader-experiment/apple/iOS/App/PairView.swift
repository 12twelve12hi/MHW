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
                    Text("Pair with your Daylight").font(.title2.weight(.semibold))
                    Text("Send articles, web pages and PDFs from this iPhone to your Daylight.")
                        .font(.title3)
                        .fixedSize(horizontal: false, vertical: true)
                    PairingHelp()
                    Button {
                        model.sheet = .scanner
                    } label: {
                        Label("Scan the QR code", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Or type the code").font(.headline)
                        PairingForm { model.pair($0) }
                    }
                    Text("Opening a daylightshare:// pairing link on this iPhone also pairs it, once you confirm.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
                .padding()
            }
            .navigationTitle("Send to Daylight")
            .navigationBarTitleDisplayMode(.inline)
            // The scanner is presented by RootView (`appSheets`); a code it reads that is not a pairing code shows
            // in the banner.
        }
    }
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
