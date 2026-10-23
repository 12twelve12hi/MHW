import DaylightShareKit
import Foundation
import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// The accessibility baseline (LAB-PLAN F27; not a Lab feature): Comfort, announcements, and the measuring that the
// truncation audit (F27.4) uses. Every app and extension uses these pieces, with Lab on or off.

// MARK: Comfort

/// Comfort: larger text and buttons, more contrast, no motion. A switch in Settings, outside Lab, off by default
/// (`SharedStore.comfort`). Apply it once at each window's root with `.comfort(_:)`.
public enum Comfort {
    /// The switch (LAB_TEXT.comfort).
    public static let title = "Comfort"
    /// The switch's footer (LAB_TEXT.comfortFooter).
    public static let footer = "Larger text and buttons, more contrast, no motion."
    /// The smallest hit target of a control in Comfort, in points.
    public static let minTarget: CGFloat = 52
    /// The border Comfort draws around standalone controls, in points.
    public static let borderWidth: CGFloat = 2
    /// The text sizes Comfort allows on iPhone and iPad: never smaller than xxLarge, never larger than accessibility3.
    public static let typeSizes: ClosedRange<DynamicTypeSize> = DynamicTypeSize.xxLarge ... DynamicTypeSize.accessibility3

    /// The tint of buttons and links: a blue with at least 4.5:1 contrast both as text on the background and behind white
    /// text (#0058CC, 6.4:1 on white), lighter in dark mode (#4DA3FF, 8:1 on black). The system blue is 4:1 on white.
    public static let accent: Color = adaptive(light: (0x00, 0x58, 0xCC), dark: (0x4D, 0xA3, 0xFF))

    /// Destructive buttons (Unpair): a red with at least 4.5:1 contrast (#C01010, 6.3:1 on white; #FF6B6B in dark
    /// mode, 7.6:1 on black). The system red is 3.6:1 on white.
    public static let destructive: Color = adaptive(light: (0xC0, 0x10, 0x10), dark: (0xFF, 0x6B, 0x6B))

    /// Secondary text: on iPhone and iPad the primary colour at 72% (about 9:1 on the background), where the system's
    /// secondary grey is about 3.5:1 and fails the contrast audit; on the Mac, whose small text sizes the audit holds to
    /// a higher contrast, the primary colour. Comfort uses the primary colour everywhere.
    #if os(macOS)
    public static let secondaryText = Color.primary
    #else
    public static let secondaryText = Color.primary.opacity(0.72)
    #endif

    static func adaptive(light: (Int, Int, Int), dark: (Int, Int, Int)) -> Color {
        func rgb(_ c: (Int, Int, Int)) -> (CGFloat, CGFloat, CGFloat) {
            (CGFloat(c.0) / 255, CGFloat(c.1) / 255, CGFloat(c.2) / 255)
        }
        let (lr, lg, lb) = rgb(light)
        let (dr, dg, db) = rgb(dark)
        #if os(iOS)
        return Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(red: dr, green: dg, blue: db, alpha: 1)
                : UIColor(red: lr, green: lg, blue: lb, alpha: 1)
        })
        #elseif os(macOS)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: dr, green: dg, blue: db, alpha: 1) : NSColor(srgbRed: lr, green: lg, blue: lb, alpha: 1)
        })
        #else
        return Color(red: Double(lr), green: Double(lg), blue: Double(lb))
        #endif
    }

    /// The test hook `-DLSComfort 0|1` (LAB-PLAN 1.7): true or false when it is given, else nil.
    public static func launchValue(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool? {
        guard let i = arguments.firstIndex(of: "-DLSComfort"), i + 1 < arguments.count else { return nil }
        switch arguments[i + 1].lowercased() {
        case "1", "yes", "true", "on": return true
        case "0", "no", "false", "off": return false
        default: return nil
        }
    }

    /// The Mac's text sizes in Comfort (macOS text styles do not follow Dynamic Type): about 30% larger.
    static func macSize(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: return 34
        case .title: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline: return 17
        case .body: return 17
        case .callout: return 16
        case .subheadline: return 15
        case .footnote: return 15
        case .caption: return 14
        case .caption2: return 14
        default: return 17
        }
    }

    /// The text style's font (and weight); in Comfort on the Mac, the larger size of `macSize`.
    public static func font(_ style: Font.TextStyle, weight: Font.Weight? = nil, comfort: Bool) -> Font {
        #if os(macOS)
        if comfort {
            return .system(size: macSize(style), weight: weight ?? (style == .headline ? .bold : .regular))
        }
        #endif
        let font = standard(style)
        if let weight { return font.weight(weight) }
        return font
    }

    static func standard(_ style: Font.TextStyle) -> Font {
        switch style {
        case .largeTitle: return .largeTitle
        case .title: return .title
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .subheadline: return .subheadline
        case .callout: return .callout
        case .footnote: return .footnote
        case .caption: return .caption
        case .caption2: return .caption2
        default: return .body
        }
    }
}

private struct ComfortKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Whether Comfort is on for this window (set by `.comfort(_:)`).
    public var comfort: Bool {
        get { self[ComfortKey.self] }
        set { self[ComfortKey.self] = newValue }
    }
}

/// Comfort at a window's root (LAB-PLAN F27, Apple): text from xxLarge to accessibility3 (on the Mac, larger fixed
/// sizes), large controls, primary text instead of secondary (`dlsSecondary`), 2 pt borders around standalone controls
/// (`comfortBorder`), 52 pt hit targets (`comfortTarget`) and no animations. Comfort on or off, it sets the baseline's
/// tint (`Comfort.accent`, enough contrast for text and behind white text), and stops animations when the system's
/// Reduce Motion is on. The view's structure is the same either way, so turning Comfort on or off keeps every view's
/// state.
public struct ComfortModifier: ViewModifier {
    public let isOn: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(isOn: Bool) {
        self.isOn = isOn
    }

    @ViewBuilder
    public func body(content: Content) -> some View {
        let still = isOn || reduceMotion
        content
            .environment(\.comfort, isOn)
            .tint(Comfort.accent)
            // Only with Comfort on is the text size held in Comfort's range; otherwise the system's size goes through
            // untouched, so text follows a change of size at once (as the Dynamic Type audit checks).
            .transformEnvironment(\.dynamicTypeSize) { size in
                if isOn { size = min(max(size, Comfort.typeSizes.lowerBound), Comfort.typeSizes.upperBound) }
            }
            .controlSize(isOn ? .large : .regular)
            #if os(macOS)
            .font(isOn ? Comfort.font(.body, comfort: true) : nil)
            #endif
            .transaction { t in
                if still {
                    t.animation = nil
                    t.disablesAnimations = true
                }
            }
    }
}

/// The text style's font, larger on the Mac in Comfort (`Comfort.font`).
struct ComfortFontModifier: ViewModifier {
    let style: Font.TextStyle
    let weight: Font.Weight?
    @Environment(\.comfort) private var comfort

    func body(content: Content) -> some View {
        content.font(Comfort.font(style, weight: weight, comfort: comfort))
    }
}

/// Secondary text with enough contrast (`Comfort.secondaryText`), primary in Comfort.
struct SecondaryTextModifier: ViewModifier {
    @Environment(\.comfort) private var comfort

    func body(content: Content) -> some View {
        content.foregroundColor(comfort ? .primary : Comfort.secondaryText)
    }
}

/// A control's label: at least 52 × 52 pt in Comfort, all of it hittable.
struct ComfortTargetModifier: ViewModifier {
    @Environment(\.comfort) private var comfort

    func body(content: Content) -> some View {
        content
            .frame(minWidth: comfort ? Comfort.minTarget : nil, minHeight: comfort ? Comfort.minTarget : nil)
            .contentShape(Rectangle())
    }
}

/// A 2 pt primary border around a standalone control in Comfort (not drawn otherwise).
struct ComfortBorderModifier: ViewModifier {
    let radius: CGFloat
    @Environment(\.comfort) private var comfort

    func body(content: Content) -> some View {
        content.overlay {
            RoundedRectangle(cornerRadius: radius)
                .strokeBorder(Color.primary, lineWidth: Comfort.borderWidth)
                .opacity(comfort ? 1 : 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

extension View {
    /// Comfort for everything inside (LAB-PLAN F27): apply once at each window's root, and at a sheet's root where the
    /// sheet is its own window (the Mac's Settings scene).
    public func comfort(_ isOn: Bool) -> some View {
        modifier(ComfortModifier(isOn: isOn))
    }

    /// The text style's font; larger on the Mac in Comfort (on iPhone and iPad, Dynamic Type does that).
    public func dlsFont(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> some View {
        modifier(ComfortFontModifier(style: style, weight: weight))
    }

    /// Secondary text with enough contrast, primary in Comfort. Use it on section headers and footers too: the
    /// system's own grey there fails the contrast audit.
    public func dlsSecondary() -> some View {
        modifier(SecondaryTextModifier())
    }

    /// For a control's label: at least 52 × 52 pt in Comfort, and hittable all over.
    public func comfortTarget() -> some View {
        modifier(ComfortTargetModifier())
    }

    /// A 2 pt border around a standalone control (a bordered button, a text field) in Comfort.
    public func comfortBorder(radius: CGFloat = 8) -> some View {
        modifier(ComfortBorderModifier(radius: radius))
    }

    /// Text that wraps instead of being cut: it takes the height it needs at its width, and reports both sizes to the
    /// truncation audit's recorder when a test sets one (F27.4).
    public func wrapping(_ text: String) -> some View {
        truncationProbe(text).fixedSize(horizontal: false, vertical: true)
    }

    /// Text in a List or Form row (and its section headers and footers): on iPhone and iPad the row gives it the height
    /// it needs, and a forced height there can clip it at large sizes, so it only reports to the truncation audit; on
    /// the Mac it wraps like `wrapping(_:)`.
    @ViewBuilder
    public func listRowText(_ text: String) -> some View {
        #if os(iOS)
        truncationProbe(text)
        #else
        wrapping(text)
        #endif
    }

    /// For a text field that grows to more lines (`axis: .vertical`, so long text wraps instead of being cut at large
    /// sizes): Return runs `action` instead of starting a new line.
    public func submitOnReturn(_ text: Binding<String>, perform action: @escaping () -> Void) -> some View {
        onChange(of: text.wrappedValue) { value in
            guard value.contains("\n") else { return }
            text.wrappedValue = value.replacingOccurrences(of: "\n", with: "")
            action()
        }
    }
}

// MARK: Announcements

/// Says a status change out loud to VoiceOver (LAB-PLAN F27: "Delivered", and the banners after pairing and sending).
@MainActor
public enum Announcer {
    /// Posts the announcement; tests replace it to collect what would be said.
    public static var post: (String) -> Void = { text in
        #if os(iOS)
        UIAccessibility.post(notification: .announcement, argument: text)
        #elseif os(macOS)
        if let app = NSApp {
            NSAccessibility.post(element: app, notification: .announcementRequested,
                                 userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        }
        #endif
    }

    public static func announce(_ text: String) {
        guard !text.isEmpty else { return }
        post(text)
    }

    /// The rows the Lab ledger has just confirmed in the Reader (F27's "In your Reader", F01): delivered rows whose
    /// state is `reader` in `new` and was not in `old`, from a Lab Inbox. Say them as `readerAnnouncement`.
    public nonisolated static func readerChanges(from old: LabLedger.Snapshot, to new: LabLedger.Snapshot,
                                                 rows: [OutboxRow]) -> [OutboxRow] {
        guard new.inboxLab else { return [] }
        return rows.filter { row in
            row.status == .delivered && new.state(row.id)?.s == "reader" && old.state(row.id)?.s != "reader"
        }
    }

    /// "In your Reader ✓, An article" for each row, as one announcement.
    public nonisolated static func readerAnnouncement(_ rows: [OutboxRow]) -> String {
        rows.map { "\(LabText["rows.reader.label"]), \($0.displayTitle)" }.joined(separator: ". ")
    }

    /// What to announce when the history changes: each row that has become delivered or not delivered since `old`
    /// (the row's label and its title, "Delivered ✓, An article"). Rows new to the history are announced by the
    /// banner that follows a share, not here.
    ///
    /// F27's "In your Reader" comes from the Lab ledger, which v1.1 rows do not have: `readerChanges` (A3), which
    /// `AppModel` says when the ledger changes with Lab on ("In your Reader ✓, <title>"); A4 and A5 check it in the apps.
    public nonisolated static func changes(from old: [OutboxRow], to new: [OutboxRow], now: Date = Date()) -> [String] {
        let before = Dictionary(old.map { ($0.id, $0.status) }, uniquingKeysWith: { a, _ in a })
        return new.compactMap { row in
            guard let was = before[row.id], was != row.status,
                  row.status == .delivered || row.status == .expired else { return nil }
            return "\(RowText(row: row, now: now).label), \(row.displayTitle)"
        }
    }
}

// MARK: Truncation audit (F27.4)

/// Collects, for each text that carries a `truncationProbe`, the frame it was laid out in and the size it needs at that
/// width. Set one in a test with `.environment(\.truncationRecorder, recorder)`; without one the probes do nothing.
///
/// A text is cut when it got less height (or width) than it needs, or when it runs past the left or right edge of the
/// window (`width`). A probe sees the text it is attached to: put it on the `Text` itself, outside any `lineLimit`.
public final class TruncationRecorder {
    struct Entry {
        var text: String
        var frame: CGRect?
        var needed: CGSize?
    }

    /// The window's width: a text that reaches past it is cut at the edge. nil: not checked.
    public var width: CGFloat?
    private var entries: [String: Entry] = [:]
    private var order: [String] = []

    public init(width: CGFloat? = nil) {
        self.width = width
    }

    func laid(_ key: String, _ text: String, _ frame: CGRect) {
        if entries[key] == nil { order.append(key) }
        entries[key, default: Entry(text: text)].frame = frame
    }

    func needed(_ key: String, _ text: String, _ size: CGSize) {
        if entries[key] == nil { order.append(key) }
        entries[key, default: Entry(text: text)].needed = size
    }

    /// How many texts reported both their frame and what they need.
    public var measured: Int { entries.values.filter { $0.frame != nil && $0.needed != nil }.count }

    /// The size each text needs, by its words (the first text with those words), for comparing the same screen at two
    /// text sizes.
    public var neededSizes: [String: CGSize] {
        var out: [String: CGSize] = [:]
        for key in order {
            guard let e = entries[key], let needed = e.needed, out[e.text] == nil else { continue }
            out[e.text] = needed
        }
        return out
    }

    /// Every text that is cut, in the order they were first seen (half a point of slack): "“Delivered ✓” has
    /// 120×17, needs 120×34", or "“…” runs past the edge (12…340 of 320)".
    public var problems: [String] {
        order.compactMap { key -> String? in
            guard let e = entries[key], let frame = e.frame, let needed = e.needed else { return nil }
            guard frame.width > 0 || frame.height > 0 else { return nil } // not on screen
            func n(_ v: CGFloat) -> Int { Int(v.rounded()) }
            if needed.height > frame.height + 0.5 || needed.width > frame.width + 0.5 {
                return "“\(e.text)” has \(n(frame.width))×\(n(frame.height)), needs \(n(needed.width))×\(n(needed.height))"
            }
            if let width, frame.minX < -0.5 || frame.maxX > width + 0.5 {
                return "“\(e.text)” runs past the edge (\(n(frame.minX))…\(n(frame.maxX)) of \(n(width)))"
            }
            return nil
        }
    }
}

private struct TruncationRecorderKey: EnvironmentKey {
    static let defaultValue: TruncationRecorder? = nil
}

extension EnvironmentValues {
    /// The truncation audit's recorder (tests only).
    public var truncationRecorder: TruncationRecorder? {
        get { self[TruncationRecorderKey.self] }
        set { self[TruncationRecorderKey.self] = newValue }
    }
}

/// Measures a text: the frame it was laid out in (window coordinates), and the size a hidden copy of it takes when it
/// may be as tall as it likes at that width. A copy that needs more than the original got means the original is
/// truncated or clipped.
struct TruncationProbe: ViewModifier {
    let text: String
    @Environment(\.truncationRecorder) private var recorder
    @State private var key = UUID().uuidString

    @ViewBuilder
    func body(content: Content) -> some View {
        if let recorder {
            content
                .background(GeometryReader { g in
                    Color.clear
                        .onAppear { recorder.laid(key, text, g.frame(in: .global)) }
                        .onChange(of: g.frame(in: .global)) { recorder.laid(key, text, $0) }
                })
                .background(alignment: .topLeading) {
                    content
                        .fixedSize(horizontal: false, vertical: true)
                        .hidden()
                        .background(GeometryReader { g in
                            Color.clear
                                .onAppear { recorder.needed(key, text, g.size) }
                                .onChange(of: g.size) { recorder.needed(key, text, $0) }
                        })
                        .accessibilityHidden(true)
                }
        } else {
            content
        }
    }
}

extension View {
    /// Reports this text's frame and the size it needs to the truncation audit (F27.4) when a test sets a recorder.
    public func truncationProbe(_ text: String) -> some View {
        modifier(TruncationProbe(text: text))
    }
}

// MARK: Rows of information

/// "Name  Anjan’s Daylight": a label and its value side by side, or the value under the label at accessibility text
/// sizes and in Comfort, so neither is cut. Read as one element.
public struct InfoRow: View {
    let label: String
    let value: String
    @Environment(\.comfort) private var comfort
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(_ label: String, value: String) {
        self.label = label
        self.value = value
    }

    public var body: some View {
        let stacked = comfort || typeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            Text(label).listRowText(label)
            if !stacked { Spacer(minLength: 8) }
            Text(value)
                .dlsSecondary()
                .multilineTextAlignment(stacked ? .leading : .trailing)
                .listRowText(value)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
