import Foundation

/// Protocol constants (PROTOCOL.md sections 2-4, revision 1.1; CHANGES-v1.1 2.1), the same values as the JavaScript
/// reference. Sizes are in bytes, times in seconds.
public enum DLS {
    public static let protocolVersion = 1
    public static let defaultRelay = "https://ntfy.sh"

    /// The chunk every sender cuts content into: 29 × 64 KiB, so a frame is at most chunk + 65,536 + 36 = 1,966,116
    /// bytes, under ntfy.sh's 2 MB per attachment.
    public static let chunk = 1_900_544
    /// The largest content (`size`, before compression) a sender sends: "Files can be up to 9 MB".
    public static let maxItem = 9_000_000
    /// The largest file `size` a receiver accepts (a page's `size` must be at most `maxPageHTML`).
    public static let maxDecoded = 268_435_456
    /// Attachment downloads (v1.0 senders' 12 MiB chunks + 128 KiB), for inbox and ack frames.
    public static let maxAttachment = 12_713_984
    /// A poll answer.
    public static let maxPollResponse = 64 << 20
    public static let maxParts = 16
    public static let maxPageHTML = 8 * 1024 * 1024
    public static let maxURL = 4096
    public static let maxTitle = 300
    public static let maxName = 60
    /// Ids per ack frame: every ack frame stays a small frame (a message), whatever `from`.
    public static let maxAckIDs = 70
    public static let smallFrameBase64Max = 3800
    /// Header JSON; a sender never seals a longer header and a receiver ignores one.
    public static let maxHeaderBytes = 64 * 1024

    /// Both cursors (inbox and ack) go back this far from the newest time they saw (PROTOCOL 3.2).
    public static let cursorOverlap = 1800
    /// A sent item whose frames are all messages is re-sent after this (ntfy.sh keeps messages 12 hours).
    public static let resendMessage: TimeInterval = 11 * 60 * 60
    /// The re-send wait of an item with an attachment frame while `lastPublish - created < resendFastWindow`, and the
    /// wait after `full` or `refused` (ntfy.sh keeps attachments 3 hours).
    public static let attachmentWait: TimeInterval = 185 * 60
    public static let resendFastWindow: TimeInterval = 6 * 60 * 60
    /// The re-send wait of an item with an attachment frame after its fast phase.
    public static let resendSlow: TimeInterval = 12 * 60 * 60
    /// The third `full`/`refused` attempt in a row makes the row `expired`.
    public static let slowFailLimit = 3
    /// A `sending` row is taken over this long after its attempt last made progress.
    public static let sendingStale: TimeInterval = 15 * 60
    public static let outboxExpiry: TimeInterval = 7 * 24 * 60 * 60
    /// An expired row's content is kept until this long after `created` ("Try again" works meanwhile).
    public static let contentKeep: TimeInterval = 14 * 24 * 60 * 60
    /// Finished rows (`delivered`, `expired`) kept in the history; pending rows are never dropped.
    public static let outboxMaxRows = 200

    static let labelKey = "dlshare/v1/key"
    static let labelInbox = "dlshare/v1/inbox"
    static let labelAck = "dlshare/v1/ack"
    static let pairScheme = "daylightshare"
}

/// An error with a short machine code (as in the JS `ShareError.code`), a user-facing message, a reason (for pairing
/// codes "format" or "checksum"; for publish errors "network", "rate-limited", "full", "refused" or "server") and,
/// for relay answers, the HTTP status (0 when there was no answer).
///
/// Publish errors (PROTOCOL 3.1): `network` (no answer, 408, 429, 5xx), `full` (413) or `refused` (any other 4xx).
public struct ShareError: Error, LocalizedError, Equatable, CustomStringConvertible {
    public let code: String
    public let message: String
    public let reason: String
    public let status: Int

    public init(_ code: String, _ message: String, reason: String = "", status: Int = 0) {
        self.code = code
        self.message = message
        self.reason = reason
        self.status = status
    }

    public var errorDescription: String? { message }
    public var description: String {
        "ShareError(\(code)\(reason.isEmpty ? "" : "/" + reason)\(status == 0 ? "" : " \(status)")): \(message)"
    }

    public static let notPaired = ShareError("pairing", "Not paired with a Daylight yet.")
    /// The share-time message when the content cannot be copied into the outbox (CHANGES-v1.1 2.5).
    public static let outOfSpace = ShareError("space", "This device is out of space, so it can’t send this.")

    /// "Too big to send. Files can be up to 9 MB; this one is 14.2 MB." for content of `size` bytes.
    public static func tooLarge(_ size: Int) -> ShareError { ShareError("too-large", ShareText.tooBigMessage(size)) }
}
