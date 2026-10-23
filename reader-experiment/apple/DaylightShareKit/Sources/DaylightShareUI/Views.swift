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

/// One history row: its title, where it is from and when, its label, its sentence when it has one, and the one button
/// the shared copy offers for it ("Retry now" or "Try again"); removing is in the row's menu or swipe actions. Nothing
/// in it is cut short at any text size, and nothing in it changes by itself.
public struct HistoryRowView: View {
    let row: OutboxRow
    let onRetry: () -> Void
    /// Lab's words for the row (F01, `LabRowText`), or nil for v1.1's (`RowText`): with nil the row is exactly v1.1's.
    let lab: LabRowText?
    /// Whether the sentence and the step line show (2.5: on the newest row and on every row that is not final); with
    /// v1.1's words the sentence always shows.
    let showsDetail: Bool
    @Environment(\.comfort) private var comfort
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The accessibility identifier of a row's time ("Today at 1:05 PM"): the UI tests' Lab-off walk writes its words
    /// as "<when>" (`AXTree.rowTimeID`), since they depend on when the test runs.
    public static let timeID = "history-row-time"

    /// The name the truncation audit knows a row's time by: its words depend on when it is measured, so the probe takes
    /// a fixed name, one per row.
    public static func timeProbe(_ row: OutboxRow) -> String { "the time of row \(row.id)" }

    /// When a row was shared, in the system's words: "Today at 1:05 PM", "Yesterday at 9:12 AM", "10/14/26, 6:30 PM". It
    /// never changes on screen. (1.1 showed `Text(date, style: .relative)`, "10 min, 13 sec", a count that ran on every
    /// second: motion, which Comfort leaves out (F27), and a row that changed under VoiceOver and the audits.)
    public static func when(_ created: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        formatter.doesRelativeDateFormatting = true
        return formatter.string(from: created)
    }

    /// Where a row is from: a link's or a page's site ("example.com"; the whole address is long, cut short in a row and
    /// not something to listen to), or a file's name and size.
    public static func source(_ row: OutboxRow) -> String {
        switch row.kind {
        case .url, .page:
            guard let host = URL(string: row.url)?.host, !host.isEmpty else { return row.kind == .page ? "Web page" : "" }
            return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        case .file:
            return row.displaySubtitle
        }
    }

    /// The style of where a row is from: 12 pt on both platforms (the iPhone's caption at the default size; on the Mac,
    /// whose caption is 10 pt, the callout). A short 10 pt text such as "example.com" only "nearly passed" the Mac's
    /// contrast audit, which holds small text to a higher contrast.
    #if os(macOS)
    static let sourceStyle: Font.TextStyle = .callout
    #else
    static let sourceStyle: Font.TextStyle = .caption
    #endif

    /// The style of a row's time: the caption at 11 pt on iPhone and iPad; on the Mac the callout (12 pt), like where a
    /// row is from. At 10 pt the Mac's contrast audit said "nearly passed" for some times and not others (it measures
    /// the drawn strokes, so "10/14/26, 4:47 PM" failed where "10/14/26, 4:04 PM" passed): a result that depended on
    /// the time of day the test ran.
    #if os(macOS)
    static let timeStyle: Font.TextStyle = .callout
    #else
    static let timeStyle: Font.TextStyle = .caption2
    #endif

    /// The accessibility identifier of a row's words as one element on iPhone and iPad (`spokenLabel`, with the row's
    /// time as its value): the UI tests' walk writes that value as "<when>" (`AXTree.rowID`).
    public static let rowID = "history-row"

    /// What VoiceOver says for a row on iPhone and iPad, where its words are one element: its title, where it is from,
    /// its label and its sentence. "A long read, example.com, Waiting to send. Couldn’t send right now. It will try
    /// again by itself." The row's time follows as the element's value.
    public static func spokenLabel(_ row: OutboxRow, now: Date = Date()) -> String {
        let source = Self.source(row)
        let title = row.displayTitle
        return [title, title.localizedCaseInsensitiveContains(source) ? "" : source, RowText(row: row, now: now).message]
            .filter { !$0.isEmpty }.joined(separator: ", ")
    }

    public init(row: OutboxRow, onRetry: @escaping () -> Void) {
        self.row = row
        self.onRetry = onRetry
        lab = nil
        showsDetail = true
    }

    /// A row with Lab's timeline words (LAB-PLAN F01, 2.5; `LabModel.rowText`): its label (with the state's glyph), and,
    /// when `showsDetail` (`TimelineRow.showsDetail`: the newest row, and rows that are not final), its sentence and its
    /// step line ("Sent ✓ · On your Daylight ✓ · In the Reader …", hidden from VoiceOver, which hears "{label}.
    /// {sentence}" whether the sentence shows or not). Rows the Lab rules leave as v1.1's read exactly as v1.1's.
    public init(row: OutboxRow, lab: LabRowText, showsDetail: Bool, onRetry: @escaping () -> Void) {
        self.row = row
        self.onRetry = onRetry
        self.lab = lab
        self.showsDetail = showsDetail
    }

    /// What VoiceOver says for a row with Lab's words: its title, where it is from, and "{label}. {sentence}" (2.5).
    public static func spokenLabel(_ row: OutboxRow, lab: LabRowText) -> String {
        let source = Self.source(row)
        let title = row.displayTitle
        return [title, title.localizedCaseInsensitiveContains(source) ? "" : source, lab.a11yLabel]
            .filter { !$0.isEmpty }.joined(separator: ", ")
    }

    @ViewBuilder private var statusLabel: some View {
        if let lab {
            let label = lab.label
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: TimelineRow.glyph(row, lab))
                    .foregroundColor(StatusLabel.color(row))
                    .accessibilityHidden(true)
                Text(label).listRowText(label)
            }
            .dlsFont(.caption, weight: .medium)
        } else {
            StatusLabel(row: row)
        }
    }

    public var body: some View {
        let text = lab.map { RowText(label: $0.label, sentence: $0.sentence, action: $0.action) } ?? RowText(row: row)
        let source = Self.source(row)
        let when = Self.when(row.created)
        // On the Mac, and at accessibility text sizes and in Comfort, the button goes under the text, which keeps the
        // window's width. (Beside the button, a title narrowed to its left failed the Mac's contrast audit, where the
        // same title at the row's full width passes; the Mac has room for the extra line.)
        #if os(macOS)
        let stacked = true
        #else
        let stacked = comfort || typeSize.isAccessibilitySize
        #endif
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        layout {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: StatusLabel.symbol(row))
                    .foregroundColor(.secondary)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.displayTitle).listRowText(row.displayTitle)
                    if !source.isEmpty {
                        Text(source).dlsFont(Self.sourceStyle).dlsSecondary().listRowText(source)
                    }
                    // The label and the time side by side, or one under the other where they do not fit on a line
                    // (never a word broken in two).
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            statusLabel
                            time(when)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            statusLabel
                            time(when)
                        }
                    }
                    if showsDetail, let sentence = text.sentence {
                        // In the primary colour: what to know or do about the row, in small text (the iPhone's
                        // contrast audit failed it now and then at 72%).
                        Text(sentence).dlsFont(.caption2).listRowText(sentence)
                    }
                    if showsDetail, let steps = lab?.stepLine {
                        // The label says it (2.5): hidden from VoiceOver. Words and glyphs, never colour alone.
                        Text(steps).dlsFont(.caption2).dlsSecondary().listRowText(steps)
                            .accessibilityHidden(true)
                    }
                }
                #if os(iOS)
                // On iPhone and iPad the row's words are one VoiceOver element. The row's swipe action (Remove) is
                // offered on each of its elements, which makes each line of small text a target of its own, too small
                // to hit (F27.2's hit-region audit); as one element the row is also read in one go. The button stays an
                // element of its own. On the Mac each text stays an element, as VoiceOver reads a table row's cells.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(lab.map { Self.spokenLabel(row, lab: $0) } ?? Self.spokenLabel(row))
                .accessibilityValue(when)
                .accessibilityIdentifier(Self.rowID)
                #endif
            }
            if !stacked { Spacer(minLength: 4) }
            if let title = text.buttonTitle {
                // The window's control size: regular, or large in Comfort (`ComfortModifier`); never small, which is
                // too small a target.
                Button(action: onRetry) {
                    Text(title).listRowText(title).comfortTarget()
                }
                .buttonStyle(.bordered)
                .comfortBorder()
            }
        }
        .padding(.vertical, 2)
    }

    private func time(_ when: String) -> some View {
        Text(when).dlsFont(Self.timeStyle).dlsSecondary()
            .accessibilityIdentifier(Self.timeID)
            .wrapping(Self.timeProbe(row))
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
/// one waits (PROTOCOL 1.3), otherwise `model.sheet`, otherwise the re-pairing follow-up (LAB-PLAN 2.6, while Lab is
/// on). SwiftUI shows one sheet at a time, and a sheet presented from a view that already shows one does not appear;
/// with a single `sheet(item:)`, a pairing link that arrives while Settings, the file picker or the scanner is open
/// replaces it with the question.
struct AppSheets<SheetContent: View>: ViewModifier {
    @ObservedObject var model: AppModel
    /// Observed too: the follow-up `model.presented` shows is `lab.repaired`.
    @ObservedObject var lab: LabModel
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
                case let .repaired(r):
                    LabRepairedSheet(repaired: r) { model.dismissRepaired() }
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
        modifier(AppSheets(model: model, lab: model.lab, sheetContent: content))
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
