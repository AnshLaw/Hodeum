import CoreImage
import HodeyCore
import UIKit

/// Draws what the floating window shows: a zoomed crop around the target with Hodey's ring, or the
/// whole screen with a banner when there is nothing to point at. Output is BGRA for the PiP layer.
final class GuideRenderer {
    static let outputSize = CGSize(width: 720, height: 960)
    private static let cropPadding: CGFloat = 3
    private static let ringInset: CGFloat = -16
    private static let ringCorner: CGFloat = 20
    private static let ringWidth: CGFloat = 9
    private static let ringColor = UIColor(red: 1, green: 0.72, blue: 0.2, alpha: 1)
    private static let bannerHeight: CGFloat = 88

    private let context = CIContext(options: [.cacheIntermediates: false])

    func render(frame: CVPixelBuffer, target: CGRect?, caption: String) -> CVPixelBuffer? {
        guard let output = Self.makeBuffer() else { return nil }
        let size = CGSize(width: CVPixelBufferGetWidth(frame), height: CVPixelBufferGetHeight(frame))
        let out = Self.outputSize
        let crop = target.map { GuideGeometry.focusCrop(target: $0, frame: size, aspect: out.width / out.height, padding: Self.cropPadding) }
        drawFrame(frame, crop: crop ?? CGRect(origin: .zero, size: size), frameHeight: size.height, into: output)
        var ring: CGRect?
        if let target, let crop { ring = GuideGeometry.map(target, from: crop, to: out) }
        Self.drawOverlay(on: output, ring: ring, caption: caption)
        return output
    }

    /// `crop` is in top-left pixels; Core Image works bottom-left, hence the flip.
    private func drawFrame(_ frame: CVPixelBuffer, crop: CGRect, frameHeight: CGFloat, into output: CVPixelBuffer) {
        let out = Self.outputSize
        let ciCrop = CGRect(x: crop.minX, y: frameHeight - crop.maxY, width: crop.width, height: crop.height)
        let scale = min(out.width / crop.width, out.height / crop.height)
        let offset = CGPoint(x: (out.width - crop.width * scale) / 2, y: (out.height - crop.height * scale) / 2)
        let image = CIImage(cvPixelBuffer: frame)
            .cropped(to: ciCrop)
            .transformed(by: CGAffineTransform(translationX: -ciCrop.minX, y: -ciCrop.minY))
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: offset.x, y: offset.y))
            .composited(over: CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: out)))
        context.render(image, to: output, bounds: CGRect(origin: .zero, size: out), colorSpace: CGColorSpaceCreateDeviceRGB())
    }

    private static func drawOverlay(on output: CVPixelBuffer, ring: CGRect?, caption: String) {
        CVPixelBufferLockBaseAddress(output, [])
        defer { CVPixelBufferUnlockBaseAddress(output, []) }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(output), width: Int(outputSize.width), height: Int(outputSize.height),
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(output), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return }
        context.translateBy(x: 0, y: outputSize.height)
        context.scaleBy(x: 1, y: -1)
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }
        if let ring {
            let path = UIBezierPath(roundedRect: ring.insetBy(dx: ringInset, dy: ringInset), cornerRadius: ringCorner)
            path.lineWidth = ringWidth
            ringColor.setStroke()
            path.stroke()
        }
        drawBanner(caption)
    }

    private static func drawBanner(_ caption: String) {
        let banner = CGRect(x: 0, y: outputSize.height - bannerHeight, width: outputSize.width, height: bannerHeight)
        UIColor(white: 0, alpha: 0.72).setFill()
        UIBezierPath(rect: banner).fill()
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 34, weight: .semibold),
            .foregroundColor: UIColor.white,
            .paragraphStyle: style,
        ]
        (caption as NSString).draw(in: banner.insetBy(dx: 20, dy: 20), withAttributes: attributes)
    }

    private static func makeBuffer() -> CVPixelBuffer? {
        let attributes: [CFString: Any] = [
            kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        ]
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(kCFAllocatorDefault, Int(outputSize.width), Int(outputSize.height), kCVPixelFormatType_32BGRA, attributes as CFDictionary, &buffer)
        return status == kCVReturnSuccess ? buffer : nil
    }
}
