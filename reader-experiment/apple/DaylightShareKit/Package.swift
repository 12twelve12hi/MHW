// swift-tools-version:5.9
// DaylightShareKit: the Daylight Share protocol v1 in Swift (see ../../share/PROTOCOL.md).
//
//   DaylightShareKit  pairing, crypto, frames, reassembly, ntfy relay client, outbox, shared storage (no UI)
//   DaylightShareUI   SwiftUI views and models shared by the iOS and macOS apps and extensions
//
// `swift test` (macOS) runs the cross-platform vectors in ../../share/vectors/test-vectors.json.
import PackageDescription

let package = Package(
    name: "DaylightShareKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "DaylightShareKit", targets: ["DaylightShareKit"]),
        .library(name: "DaylightShareUI", targets: ["DaylightShareUI"]),
    ],
    targets: [
        .target(name: "DaylightShareKit"),
        .target(name: "DaylightShareUI", dependencies: ["DaylightShareKit"]),
        // zlib, used only by the tests to check independently that Apple's Compression output is raw DEFLATE.
        .systemLibrary(name: "CZlib", path: "Sources/CZlib"),
        .testTarget(name: "DaylightShareKitTests", dependencies: ["DaylightShareKit", "DaylightShareUI", "CZlib"]),
    ]
)
