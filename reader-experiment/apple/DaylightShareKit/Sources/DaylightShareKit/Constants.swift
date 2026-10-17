import Foundation

/// Protocol constants (PROTOCOL.md sections 2-4), the same values as the JavaScript reference.
public enum DLS {
    public static let protocolVersion = 1
    public static let defaultRelay = "https://ntfy.sh"
    public static let chunk = 12 * 1024 * 1024
    public static let maxParts = 16
    public static let maxEncoded = 64 * 1024 * 1024
    public static let maxPageHTML = 8 * 1024 * 1024
    public static let maxURL = 4096
    public static let maxTitle = 300
    public static let maxName = 60
    public static let maxAckIDs = 200
    public static let smallFrameBase64Max = 3800
    public static let resendAttachment: TimeInterval = 150 * 60
    public static let resendMessage: TimeInterval = 11 * 60 * 60
    public static let outboxExpiry: TimeInterval = 7 * 24 * 60 * 60
    public static let maxHeaderBytes = 64 * 1024

    static let labelKey = "dlshare/v1/key"
    static let labelInbox = "dlshare/v1/inbox"
    static let labelAck = "dlshare/v1/ack"
    static let pairScheme = "daylightshare"
}

/// An error with a short machine code (as in the JS `ShareError.code`), a user-facing message and, for pairing codes,
/// a reason: "format" (wrong length or characters) or "checksum" (well-formed, but the check byte is wrong).
public struct ShareError: Error, LocalizedError, Equatable, CustomStringConvertible {
    public let code: String
    public let message: String
    public let reason: String

    public init(_ code: String, _ message: String, reason: String = "") {
        self.code = code
        self.message = message
        self.reason = reason
    }

    public var errorDescription: String? { message }
    public var description: String { "ShareError(\(code)\(reason.isEmpty ? "" : "/" + reason)): \(message)" }

    public static let notPaired = ShareError("pairing", "Not paired with a Daylight yet.")
}
