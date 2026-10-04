import CoreVideo
import Foundation

/// The newest screen frame and frame counts, shared between the capture queue and the guide loop.
/// ScreenCaptureKit sends nothing while the screen is still, so the last frame stays valid until replaced.
final class LatestFrame {
    struct Counts {
        var total = 0
        var whileBackgrounded = 0
    }

    private let lock = NSLock()
    private var buffer: CVPixelBuffer?
    private var sequence = 0
    private var counts = Counts()
    private var backgrounded = false

    func store(_ frame: CVPixelBuffer) {
        lock.lock()
        defer { lock.unlock() }
        buffer = frame
        sequence += 1
        counts.total += 1
        if backgrounded { counts.whileBackgrounded += 1 }
    }

    func read() -> (frame: CVPixelBuffer, sequence: Int)? {
        lock.lock()
        defer { lock.unlock() }
        return buffer.map { ($0, sequence) }
    }

    func setBackgrounded(_ value: Bool) {
        lock.lock()
        backgrounded = value
        lock.unlock()
    }

    func currentCounts() -> Counts {
        lock.lock()
        defer { lock.unlock() }
        return counts
    }
}
