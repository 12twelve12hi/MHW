import DaylightShareKit
import SwiftUI

/// Typing or pasting the pairing code (or a `daylightshare://` link).
public struct PairingForm: View {
    let onPair: (String) -> String?
    @State private var code = ""
    @State private var error: String?

    /// `onPair` returns an error message, or nil when pairing worked.
    public init(onPair: @escaping (String) -> String?) {
        self.onPair = onPair
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Pairing code, e.g. ABCD-EFGH-…", text: $code)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                .keyboardType(.asciiCapable)
                #endif
                .onSubmit(submit)
            HStack {
                Button("Pair", action: submit)
                    .buttonStyle(.borderedProminent)
                    .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                #if os(iOS)
                PasteButton(payloadType: String.self) { strings in
                    guard let s = strings.first else { return }
                    Task { @MainActor in
                        code = s.trimmingCharacters(in: .whitespacesAndNewlines)
                        submit()
                    }
                }
                .labelStyle(.titleAndIcon)
                #endif
            }
            if let error {
                Text(error).font(.footnote).foregroundColor(.red).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func submit() {
        let input = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
        error = onPair(input)
        if error == nil { code = "" }
    }
}

/// A row's label from the shared copy ("Sending…", "Sent · waiting for your Daylight", "Delivered ✓", "Waiting to
/// send", "Not delivered"; CHANGES-v1.1 2.5).
public struct StatusLabel: View {
    let row: OutboxRow

    public init(row: OutboxRow) {
        self.row = row
    }

    public var body: some View {
        Text(Self.text(row)).font(.caption.weight(.medium)).foregroundColor(Self.color(row))
    }

    public static func text(_ row: OutboxRow) -> String { RowText(row: row).label }

    public static func color(_ row: OutboxRow) -> Color {
        switch row.status {
        case .sending, .sent: return .secondary
        case .delivered: return .green
        case .failed, .expired: return .orange
        }
    }

    public static func symbol(_ row: OutboxRow) -> String {
        switch row.kind {
        case .url: return "link"
        case .page: return "doc.richtext"
        case .file: return row.mime == "application/pdf" ? "doc.text" : "doc"
        }
    }
}

/// One history row: its label, its sentence when it has one, and the one button the shared copy offers for it
/// ("Retry now" or "Try again"); removing is in the row's menu or swipe actions.
public struct HistoryRowView: View {
    let row: OutboxRow
    let onRetry: () -> Void

    public init(row: OutboxRow, onRetry: @escaping () -> Void) {
        self.row = row
        self.onRetry = onRetry
    }

    public var body: some View {
        let text = RowText(row: row)
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: StatusLabel.symbol(row))
                .foregroundColor(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.displayTitle).lineLimit(2)
                Text(row.displaySubtitle).font(.caption).foregroundColor(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    StatusLabel(row: row)
                    Text(row.created, style: .relative).font(.caption2).foregroundColor(.secondary)
                }
                if let sentence = text.sentence {
                    Text(sentence).font(.caption2).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 4)
            if let title = text.buttonTitle {
                Button(title, action: onRetry)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
    }
}

/// The question before a pairing takes effect (PROTOCOL 1.3): "Pair with Anjan’s Daylight?", "Code starts E4AY. …",
/// the relay when it is not ntfy.sh, and "This replaces …" when it replaces another Daylight; "Pair" or "Switch",
/// and "Cancel".
public struct PairingConfirmationView: View {
    let confirmation: PairingConfirmation
    let onConfirm: () -> Void
    let onCancel: () -> Void

    public init(confirmation: PairingConfirmation, onConfirm: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.confirmation = confirmation
        self.onConfirm = onConfirm
        self.onCancel = onCancel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(confirmation.title ?? "Pair with a Daylight?").font(.title3.weight(.semibold))
            ForEach(confirmation.lines, id: \.self) { line in
                Text(line).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button(confirmation.button ?? "Pair", action: onConfirm)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
    }
}

/// Shows the app model's pending pairing question as a sheet (dismissing it cancels).
struct PairingConfirmationSheet: ViewModifier {
    @ObservedObject var model: AppModel

    func body(content: Content) -> some View {
        content.sheet(item: $model.pendingPairing) { pending in
            PairingConfirmationView(confirmation: pending.confirmation, onConfirm: { model.confirmPairing() },
                                    onCancel: { model.cancelPairing() })
        }
    }
}

extension View {
    /// Asks before a pairing takes effect, whenever `model.pendingPairing` is set (PROTOCOL 1.3).
    public func pairingConfirmation(_ model: AppModel) -> some View {
        modifier(PairingConfirmationSheet(model: model))
    }
}

/// The transient banner at the bottom of the apps' windows.
public struct BannerView: View {
    let banner: AppModel.Banner

    public init(banner: AppModel.Banner) {
        self.banner = banner
    }

    public var body: some View {
        HStack(spacing: 8) {
            Image(systemName: banner.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundColor(banner.isError ? .orange : .green)
            Text(banner.text).font(.callout).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .shadow(radius: 4)
        .padding()
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// How pairing works, for the pairing screens.
public struct PairingHelp: View {
    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("On your Daylight, open **Daylight Share** and choose **This is my Daylight**. It shows a QR code and a 28-character pairing code.")
            Text("Everything you send is end-to-end encrypted with a key from that code. Items travel through the free ntfy.sh relay (or your own), which only sees ciphertext.")
                .foregroundColor(.secondary)
        }
        .font(.callout)
        .fixedSize(horizontal: false, vertical: true)
    }
}
