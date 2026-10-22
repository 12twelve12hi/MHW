import DaylightShareKit
import SwiftUI

/// Typing or pasting the pairing code (or a `daylightshare://` link). Every pairing screen offers it, next to the QR
/// code where there is one (F27: typed-code pairing is always available).
public struct PairingForm: View {
    let onPair: (String) -> String?
    @State private var code = ""
    @State private var error: String?
    @Environment(\.comfort) private var comfort
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The text field's label and placeholder.
    public static let fieldTitle = "Pairing code, e.g. ABCD-EFGH-…"

    /// `onPair` returns an error message, or nil when pairing worked.
    public init(onPair: @escaping (String) -> String?) {
        self.onPair = onPair
    }

    public var body: some View {
        // Side by side, or one under the other at accessibility text sizes and in Comfort, so no label is cut.
        let stacked = comfort || typeSize.isAccessibilitySize
        let buttons = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(spacing: 8))
        VStack(alignment: .leading, spacing: 10) {
            field
                .textFieldStyle(.roundedBorder)
                .font(Comfort.font(.body, comfort: comfort).monospaced())
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                .keyboardType(.asciiCapable)
                #endif
                .onSubmit(submit)
                .submitOnReturn($code, perform: submit)
                .accessibilityLabel(Self.fieldTitle)
                .comfortBorder()
            buttons {
                Button(action: submit) {
                    Text("Pair").wrapping("Pair").comfortTarget()
                }
                .buttonStyle(.borderedProminent)
                .comfortBorder()
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
                // An error: the words say so, with a glyph; not colour alone.
                Label {
                    Text(error).dlsFont(.footnote).wrapping(error)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange).accessibilityHidden(true)
                }
            }
        }
    }

    /// On iPhone and iPad the field grows to more lines rather than cut the code at large text sizes.
    @ViewBuilder private var field: some View {
        #if os(iOS)
        TextField(Self.fieldTitle, text: $code, axis: .vertical)
        #else
        TextField(Self.fieldTitle, text: $code)
        #endif
    }

    private func submit() {
        let input = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
        error = onPair(input)
        if error == nil { code = "" }
    }
}

/// A row's label from the shared copy ("Sending…", "Sent · waiting for your Daylight", "Delivered ✓", "Waiting to
/// send", "Not delivered"; CHANGES-v1.1 2.5), after a glyph for the state: in words and a glyph, never colour alone
/// (F27). The words wrap at large text sizes.
public struct StatusLabel: View {
    let row: OutboxRow

    public init(row: OutboxRow) {
        self.row = row
    }

    public var body: some View {
        let text = Self.text(row)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: Self.glyph(row))
                .foregroundColor(Self.color(row))
                .accessibilityHidden(true)
            Text(text).listRowText(text)
        }
        .dlsFont(.caption, weight: .medium)
    }

    public static func text(_ row: OutboxRow) -> String { RowText(row: row).label }

    /// The state's glyph: sending ↑, sent (a paper plane), delivered ✓, waiting to send (a clock that goes round), not
    /// delivered (a warning).
    public static func glyph(_ row: OutboxRow) -> String {
        switch row.status {
        case .sending: return "arrow.up.circle"
        case .sent: return "paperplane"
        case .delivered: return "checkmark.circle.fill"
        case .failed: return "clock.arrow.circlepath"
        case .expired: return "exclamationmark.triangle"
        }
    }

    /// The glyph's colour (the words stay in the primary colour, for contrast).
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
    @Environment(\.comfort) private var comfort
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(row: OutboxRow, onRetry: @escaping () -> Void) {
        self.row = row
        self.onRetry = onRetry
    }

    public var body: some View {
        let text = RowText(row: row)
        // At accessibility text sizes and in Comfort the button goes under the text, and nothing is cut short.
        let stacked = comfort || typeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        layout {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: StatusLabel.symbol(row))
                    .foregroundColor(.secondary)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.displayTitle).lineLimit(stacked ? nil : 2).truncationProbe(row.displayTitle)
                    Text(row.displaySubtitle).dlsFont(.caption).dlsSecondary().lineLimit(stacked ? nil : 1)
                        .truncationProbe(row.displaySubtitle)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        StatusLabel(row: row)
                        Text(row.created, style: .relative).dlsFont(.caption2).dlsSecondary()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let sentence = text.sentence {
                        Text(sentence).dlsFont(.caption2).dlsSecondary().listRowText(sentence)
                    }
                }
            }
            if !stacked { Spacer(minLength: 4) }
            if let title = text.buttonTitle {
                Button(action: onRetry) {
                    Text(title).listRowText(title).comfortTarget()
                }
                .buttonStyle(.bordered)
                .controlSize(comfort ? .large : .small)
                .comfortBorder()
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
        let title = confirmation.title ?? "Pair with a Daylight?"
        let button = confirmation.button ?? "Pair"
        VStack(alignment: .leading, spacing: 14) {
            Text(title).dlsFont(.title3, weight: .semibold).wrapping(title)
                .accessibilityAddTraits(.isHeader)
            ForEach(confirmation.lines, id: \.self) { line in
                Text(line).wrapping(line)
            }
            ViewThatFits(in: .horizontal) {
                HStack {
                    Spacer()
                    cancelButton
                    confirmButton(button)
                }
                VStack(alignment: .trailing, spacing: 10) {
                    confirmButton(button)
                    cancelButton
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
    }

    private var cancelButton: some View {
        Button(role: .cancel, action: onCancel) {
            Text("Cancel").wrapping("Cancel").comfortTarget()
        }
        .keyboardShortcut(.cancelAction)
    }

    private func confirmButton(_ title: String) -> some View {
        Button(action: onConfirm) {
            Text(title).wrapping(title).comfortTarget()
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .comfortBorder()
    }
}

/// Every sheet of an app window, from one presentation point: `model.presented`, which is the pairing question when
/// one waits (PROTOCOL 1.3) and otherwise `model.sheet`. SwiftUI shows one sheet at a time, and a sheet presented from
/// a view that already shows one does not appear; with a single `sheet(item:)`, a pairing link that arrives while
/// Settings, the file picker or the scanner is open replaces it with the question.
struct AppSheets<SheetContent: View>: ViewModifier {
    @ObservedObject var model: AppModel
    let sheetContent: (AppModel.Sheet) -> SheetContent

    func body(content: Content) -> some View {
        content.sheet(item: $model.presented) { presented in
            Group {
                switch presented {
                case let .pairing(pending):
                    // Answered only with its buttons ("Cancel" also on Escape): a swipe cannot leave it half decided.
                    PairingConfirmationView(confirmation: pending.confirmation, onConfirm: { model.confirmPairing() },
                                            onCancel: { model.cancelPairing() })
                        .interactiveDismissDisabled()
                case let .sheet(sheet):
                    sheetContent(sheet)
                }
            }
            // A sheet is its own presentation: it gets Comfort from the model, like the window.
            .comfort(model.comfort)
        }
    }
}

extension View {
    /// Presents the app's sheets (`model.sheet`, built by `content`) and the question before a pairing takes effect,
    /// all from this one view: attach it to the window's root view only, and open sheets by setting `model.sheet`.
    public func appSheets<S: View>(_ model: AppModel, @ViewBuilder content: @escaping (AppModel.Sheet) -> S) -> some View {
        modifier(AppSheets(model: model, sheetContent: content))
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
                .accessibilityHidden(true)
            Text(banner.text).dlsFont(.callout).wrapping(banner.text)
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
                .wrapping("On your Daylight, open Daylight Share and choose This is my Daylight.")
            Text("Everything you send is end-to-end encrypted with a key from that code. Items travel through the free ntfy.sh relay (or your own), which only sees ciphertext.")
                .dlsSecondary()
                .wrapping("Everything you send is end-to-end encrypted with a key from that code.")
        }
        .dlsFont(.callout)
    }
}
