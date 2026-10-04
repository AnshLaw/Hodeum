import CoreGraphics

/// Vision reports boxes normalized to 0–1 with the origin at the bottom-left; everything else in
/// Hodeum (frames, rings, crops) uses pixels with the origin at the top-left.
public enum VisionBox {
    public static func toPixels(normalized box: CGRect, imageSize size: CGSize) -> CGRect {
        CGRect(
            x: box.minX * size.width,
            y: (1 - box.maxY) * size.height,
            width: box.width * size.width,
            height: box.height * size.height
        )
    }
}
