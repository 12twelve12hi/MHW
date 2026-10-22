import DaylightShareKit
import Foundation

/// The history's sample rows, with fixed words: one for each kind of label, sentence and button the shared copy has
/// (CHANGES-v1.1 2.5), each a different age, so the history (newest first) always shows them in the same order.
///
/// The truncation audit (F27.4) hosts the screens with them. In the apps' Debug builds `-DLSSampleHistory`, together
/// with `-DLSTestStorage`, puts them in the history for the UI tests' Lab-off walks (F00.2, 1.7) and accessibility
/// audits (F27.2): `AppModel.handleLaunchArguments(_:sampleHistory:)` writes them after the launch's pairing, and the
/// model then reads no acks and re-sends nothing, so each row stays in its state.
public enum HistorySample {
    public static let title = "A very long article title that goes on for a while, to see that it wraps instead of being cut short"
    public static let url = "https://example.com/a/very/long/path/that-keeps-going/and-going?with=a&query=string&that=is-long"
    /// Each row's size (the "too large" row's sentence says it).
    public static let size = 14_200_000

    /// Status, error code and age in seconds, newest first.
    static let states: [(status: OutboxRow.Status, errorCode: String, age: TimeInterval)] = [
        (.sending, "", 0),
        (.failed, "network", 600),
        (.expired, "too-large", 1_200),
        (.delivered, "", 3_600),
        (.sent, "", 2 * 86_400),
        (.expired, "", 8 * 86_400),
    ]

    /// The rows, newest first: Sending…; Waiting to send with Retry now; Not delivered as too large; Delivered ✓;
    /// Sent · waiting for your Daylight, with the sentence of a row a day old; Not delivered within a week, with
    /// Try again.
    public static func rows(now: Date = Date()) -> [OutboxRow] {
        states.enumerated().map { i, state in
            let id = String(format: "%032x", i + 1)
            let header = ItemHeader(id: id, kind: .url, url: url, title: title, sent: "")
            return OutboxRow(id: id, kind: .url, title: title, url: url, size: size, header: header,
                             created: now.addingTimeInterval(-state.age), status: state.status,
                             errorCode: state.errorCode)
        }
    }

    /// `-DLSSampleHistory` with `-DLSTestStorage` (the UI tests' own storage, emptied at every launch): the sample
    /// never goes into a real history. The apps read it in Debug builds only.
    public static func isRequested(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        arguments.contains("-DLSSampleHistory") && arguments.contains("-DLSTestStorage")
    }
}
