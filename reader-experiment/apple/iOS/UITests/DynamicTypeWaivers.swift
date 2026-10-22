/// The iPhone texts whose Dynamic Type reports the accessibility audit may allow, by screen (F27.2,
/// `AccessibilityAuditTests`): at the largest size the audit loses them (they scroll off the screen) and reports that
/// they do not scale. Nothing else is allowed. Each one must be a text that
/// `TruncationAuditTests.testEveryTextGrowsWithTheTextSize` measures growing with the text size, which that test
/// checks: this file is compiled into both iPhone test targets.
///
/// A new report on any other text fails the audit: make the text follow Dynamic Type (a text style, not a fixed size;
/// `wrapping(_:)` or `listRowText(_:)` so the growth test measures it), and only then, if the audit still loses it at
/// the largest size, name it here.
enum DynamicTypeWaivers {
    static let texts: [String: [String]] = [
        // The last text on an empty Home, near the bottom at the default size. (Home with the sample history is
        // audited without Dynamic Type: AccessibilityAuditTests.withoutDynamicType says why.)
        "home-empty": ["Nothing sent yet."],
        // The device name's footer, the last text Settings shows at the default size.
        "settings": ["Shown on the Daylight as who sent each item."],
    ]
}
