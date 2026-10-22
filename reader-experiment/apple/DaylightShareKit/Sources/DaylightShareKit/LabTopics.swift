import Foundation

/// The Lab lanes' topics (LAB-PROTOCOL 2.4), derived now and used from W2 (the return lane) and W3 (the control lane):
/// "dls-" + the first 32 hex digits of SHA-256(label + 0x00 + secret). Their frames are sealed with the pairing key and
/// the AAD of their `FramePurpose`. Pinned by lab-vectors.json › labTopics.
public struct LabTopics: Equatable {
    public let returnTopic: String
    public let returnAckTopic: String
    public let controlTopic: String
    public let controlAckTopic: String

    /// -> the four topics of a 16-byte pairing secret, or ShareError("secret").
    public static func derive(secret: Data) throws -> LabTopics {
        guard secret.count == 16 else { throw ShareError("secret", "secret must be 16 bytes") }
        func topic(_ name: String) -> String {
            "dls-" + String(Hex.encode(DLSCrypto.sha256(label: "dlshare/v1/\(name)\u{0}", secret)).prefix(32))
        }
        return LabTopics(returnTopic: topic("lab-return"), returnAckTopic: topic("lab-return-ack"),
                         controlTopic: topic("lab-control"), controlAckTopic: topic("lab-control-ack"))
    }
}
