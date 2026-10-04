import CoreGraphics

/// Where the floating guide window looks: a zoomed crop around the target, the shape of the window.
public enum GuideGeometry {
    /// A crop of `aspect` (width / height) centred on `target`, about `padding` times the target's
    /// size, never larger than the frame allows and always inside it.
    public static func focusCrop(target: CGRect, frame: CGSize, aspect: CGFloat, padding: CGFloat) -> CGRect {
        let maxSize = largest(aspect: aspect, within: frame)
        var width = max(target.width * padding, target.height * padding * aspect)
        width = min(width, maxSize.width)
        let size = CGSize(width: width, height: width / aspect)
        let origin = CGPoint(
            x: clamp(target.midX - size.width / 2, lower: 0, upper: frame.width - size.width),
            y: clamp(target.midY - size.height / 2, lower: 0, upper: frame.height - size.height)
        )
        return CGRect(origin: origin, size: size)
    }

    /// `rect` (frame pixels) as seen inside `crop` once the crop is scaled to `output`.
    public static func map(_ rect: CGRect, from crop: CGRect, to output: CGSize) -> CGRect {
        let sx = output.width / crop.width
        let sy = output.height / crop.height
        return CGRect(x: (rect.minX - crop.minX) * sx, y: (rect.minY - crop.minY) * sy, width: rect.width * sx, height: rect.height * sy)
    }

    private static func largest(aspect: CGFloat, within frame: CGSize) -> CGSize {
        frame.width / frame.height > aspect
            ? CGSize(width: frame.height * aspect, height: frame.height)
            : CGSize(width: frame.width, height: frame.width / aspect)
    }

    private static func clamp(_ value: CGFloat, lower: CGFloat, upper: CGFloat) -> CGFloat {
        min(max(value, lower), max(lower, upper))
    }
}
