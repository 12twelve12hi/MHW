import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto // swift-crypto, for building the package on Linux
#endif

/// SHA-256, AES-256-GCM and random bytes (CryptoKit).
public enum DLSCrypto {
    public static func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }

    public static func sha256Hex(_ data: Data) -> String { Hex.encode(SHA256.hash(data: data)) }

    /// SHA-256 of a label's UTF-8 bytes followed by `data`.
    static func sha256(label: String, _ data: Data) -> Data {
        var h = SHA256()
        h.update(data: Data(label.utf8))
        h.update(data: data)
        return Data(h.finalize())
    }

    /// SHA-256 over data given in parts (F04's `FrameFileBuilder` hashes a file chunk by chunk).
    public struct SHA256Stream {
        private var hasher = SHA256()

        public init() {}

        public mutating func update(_ data: Data) { hasher.update(data: data) }

        /// The lowercase hex digest.
        public func finalizeHex() -> String { Hex.encode(hasher.finalize()) }
    }

    /// Cryptographically secure random bytes.
    public static func randomBytes(_ count: Int) -> Data {
        var g = SystemRandomNumberGenerator()
        var out = Data(count: count)
        var i = 0
        while i < count {
            var word = g.next()
            for _ in 0..<8 where i < count {
                out[i] = UInt8(truncatingIfNeeded: word)
                word >>= 8
                i += 1
            }
        }
        return out
    }

    /// AES-256-GCM: returns ciphertext || 16-byte tag.
    static func seal(key: Data, nonce: Data, plaintext: Data, aad: Data) throws -> Data {
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce),
                                   authenticating: aad)
        var out = Data(capacity: box.ciphertext.count + box.tag.count)
        out.append(box.ciphertext)
        out.append(box.tag)
        return out
    }

    /// AES-256-GCM: opens ciphertext || 16-byte tag; throws when the tag does not verify.
    static func open(key: Data, nonce: Data, sealed: Data, aad: Data) throws -> Data {
        guard sealed.count >= 16 else { throw ShareError("frame", "too short") }
        let ct = sealed.prefix(sealed.count - 16)
        let tag = sealed.suffix(16)
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: ct, tag: tag)
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
    }
}
