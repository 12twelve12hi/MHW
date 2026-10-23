import UIKit
import XCTest

/// A text's contrast as its own pixels show it (`XCUIElement.screenshot()`), as the Mac's Lab audit measures it
/// (macOS/UITests/LabTests.swift): WCAG's ratio between its glyphs (the darkest 2% of its pixels) and its background
/// (its median pixel), from sRGB relative luminance. For dark text on a light background; light text on a dark one is
/// measured the other way round (the lightest 2%), and the larger ratio counts. nil for an element not wholly inside
/// the window (the audit measures hidden text where it is laid out).
///
/// `AccessibilityAuditTests.allowed(on:)` allows a contrast report on a text whose pixels measure at least `floor`
/// (WCAG's AAA level; the audit asks for 4.5:1): the iPhone's audit reported a history row's sentence, black on white,
/// as failing contrast now and then (runs 39840740946, 39855307203, 39861246341 and 39873980844, at 11 pt and at
/// 13 pt), and passed it in the runs between. Grey text (the system's secondary grey is about 3.5:1) is not allowed.
enum MeasuredContrast {
    /// The contrast WCAG asks of text at AAA, which a reported text's own pixels must reach to be allowed.
    static let floor = 7.0

    struct Result {
        let ratio: Double
        let glyphs: String
        let background: String
        var summary: String { String(format: "%.1f:1 (glyphs %@ on %@)", ratio, glyphs, background) }
    }

    struct Pixel {
        let lum: Double
        let r: UInt8, g: UInt8, b: UInt8
        var rgb: String { "(\(r), \(g), \(b))" }
    }

    static func of(_ element: XCUIElement) -> Result? {
        let window = XCUIApplication().windows.firstMatch.frame
        guard element.frame.width >= 4, element.frame.height >= 4,
              window.insetBy(dx: -1, dy: -1).contains(element.frame),
              let image = element.screenshot().image.cgImage,
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let w = image.width, h = image.height
        guard w * h >= 50 else { return nil }
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                          bytesPerRow: w * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        let table = (0..<256).map { channel(Double($0) / 255) }
        var pixels: [Pixel] = []
        pixels.reserveCapacity(w * h)
        for i in stride(from: 0, to: bytes.count, by: 4) {
            let r = bytes[i], g = bytes[i + 1], b = bytes[i + 2]
            let lum = 0.2126 * table[Int(r)] + 0.7152 * table[Int(g)] + 0.0722 * table[Int(b)]
            pixels.append(Pixel(lum: lum, r: r, g: g, b: b))
        }
        pixels.sort { $0.lum < $1.lum }
        let edge = pixels.count / 50
        let background = pixels[pixels.count / 2]
        let dark = pixels[edge], light = pixels[pixels.count - 1 - edge]
        let darkOnLight = (background.lum + 0.05) / (dark.lum + 0.05)
        let lightOnDark = (light.lum + 0.05) / (background.lum + 0.05)
        return darkOnLight >= lightOnDark
            ? Result(ratio: darkOnLight, glyphs: dark.rgb, background: background.rgb)
            : Result(ratio: lightOnDark, glyphs: light.rgb, background: background.rgb)
    }

    /// WCAG 2's linear value of an sRGB channel (0...1).
    static func channel(_ v: Double) -> Double {
        v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }
}
