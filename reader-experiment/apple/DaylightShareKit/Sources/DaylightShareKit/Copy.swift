import Foundation

/// What every surface shows for an outbox row (CHANGES-v1.1 2.5; vectors > statusText): the same words as the
/// JavaScript `describeRow` and Kotlin `RowText.of`. `sentence` is nil or one sentence to show under the label;
/// `action` is the one button the row offers, if any. Every row can also be removed.
public struct RowText: Equatable {
    public enum Action: String {
        /// "Retry now": a network failure, which also retries by itself.
        case retryNow = "retry-now"
        /// "Try again": an expired row; starts its 7 days over.
        case tryAgain = "try-again"
    }

    public let label: String
    public let sentence: String?
    public let action: Action?

    public init(label: String, sentence: String? = nil, action: Action? = nil) {
        self.label = label
        self.sentence = sentence
        self.action = action
    }

    public init(row: OutboxRow, now: Date = Date()) {
        self.init(status: row.status, errorCode: row.errorCode, size: row.size, created: row.created, now: now)
    }

    public init(status: OutboxRow.Status, errorCode: String, size: Int, created: Date, now: Date = Date()) {
        switch status {
        case .sending:
            self.init(label: "Sending…")
        case .sent:
            self.init(label: "Sent · waiting for your Daylight",
                      sentence: now.timeIntervalSince(created) < 24 * 3600 ? nil
                          : "Your Daylight hasn’t picked this up yet. It is sent again twice a day.")
        case .delivered:
            self.init(label: "Delivered ✓", sentence: "Saved on your Daylight.")
        case .failed:
            switch errorCode {
            case "full":
                self.init(label: "Waiting to send", sentence: "A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.")
            case "refused":
                self.init(label: "Waiting to send", sentence: "The relay set on your Daylight turned this down. It will try again in about 3 hours.")
            default:
                self.init(label: "Waiting to send", sentence: "Couldn’t send right now. It will try again by itself.",
                          action: .retryNow)
            }
        case .expired:
            switch errorCode {
            case "full":
                self.init(label: "Not delivered", sentence: "Too much was sent from this network for hours, so it stopped trying. Try again later.",
                          action: .tryAgain)
            case "refused":
                self.init(label: "Not delivered", sentence: "The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.",
                          action: .tryAgain)
            case "too-large":
                self.init(label: "Not delivered", sentence: ShareText.tooBigMessage(size))
            case "gone":
                self.init(label: "Not delivered", sentence: "This is no longer stored on this device. Share it again.")
            default:
                self.init(label: "Not delivered", sentence: "Your Daylight didn’t pick this up within a week. Is it on and online?",
                          action: .tryAgain)
            }
        }
    }

    /// The button's words: "Retry now", "Try again", or nil for no button.
    public var buttonTitle: String? {
        switch action {
        case .retryNow: return "Retry now"
        case .tryAgain: return "Try again"
        case nil: return nil
        }
    }

    /// The label, then the sentence if there is one ("Waiting to send. Couldn’t send right now. …"): what a banner or
    /// a share sheet says after a share.
    public var message: String {
        guard let sentence else { return label }
        let ends = label.last.map { ".…✓!?".contains($0) } ?? false
        return label + (ends ? " " : ". ") + sentence
    }

    /// Whether the row needs the user's attention (an error colour): failed or expired.
    public static func isTrouble(_ status: OutboxRow.Status) -> Bool { status == .failed || status == .expired }
}

/// What an app does with a pairing that arrives (PROTOCOL 1.3 "Confirmation"; vectors > pairingConfirmation), as the
/// JavaScript `pairingConfirmation`. When `ask`, show `title` and `lines` with the buttons `button` and "Cancel", and
/// pair only on `button`; otherwise pair at once and show `notice` when it is not nil.
public struct PairingConfirmation: Equatable {
    public enum Source: String {
        /// From outside the app: a QR code scanned with the system camera, a tapped `daylightshare://` link, a link
        /// shared to the share extension.
        case link
        /// Typed, pasted or scanned on the app's (or an extension's) own pairing screen.
        case app
    }

    public let ask: Bool
    public let title: String?
    public let lines: [String]
    public let button: String?
    public let notice: String?

    public init(ask: Bool, title: String? = nil, lines: [String] = [], button: String? = nil, notice: String? = nil) {
        self.ask = ask
        self.title = title
        self.lines = lines
        self.button = button
        self.notice = notice
    }

    /// `current`: the pairing in use, or nil. `next`: the parsed pairing (relays are normalised by `Pairing`).
    /// Secrets are compared on all 16 bytes; a relay is named by `ShareText.relayHost` (host and port).
    public init(current: Pairing?, next: Pairing, source: Source) {
        let nextHost = (try? ShareText.relayHost(next.relay)) ?? next.relay
        if let current, current.secret == next.secret {
            let moved = ((try? ShareText.normalizeRelay(current.relay)) ?? current.relay) != next.relay
            self.init(ask: false, notice: moved ? "Pairing updated: now sending through \(nextHost)." : "Pairing updated.")
            return
        }
        let replaces = current != nil
        if source == .app && !replaces {
            self.init(ask: false)
            return
        }
        var lines = ["Code starts \(next.compactCode.prefix(4)). Check it matches the code on your Daylight."]
        if next.relay != DLS.defaultRelay { lines.append("Sends through \(nextHost).") }
        if let current {
            let name = ShareText.cleanName(current.name)
            lines.append("This replaces \(name.isEmpty ? "your current Daylight" : name). Items not yet delivered to it will not be sent.")
        }
        let name = ShareText.cleanName(next.name)
        self.init(ask: true, title: "Pair with \(name.isEmpty ? "a Daylight" : name)?", lines: lines,
                  button: replaces ? "Switch" : "Pair")
    }
}
