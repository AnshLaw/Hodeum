import AVKit
import UIKit

/// The floating window over other apps: a Picture-in-Picture "video" whose frames Hodeum draws itself.
/// PiP can only start from the foreground or automatically as Hodeum goes to the background.
final class PiPGuide: NSObject, AVPictureInPictureSampleBufferPlaybackDelegate, AVPictureInPictureControllerDelegate {
    /// iOS sometimes fails the first PiP start (PGPegasusErrorDomain -1003); one retry usually works.
    private static let retryDelay: TimeInterval = 0.6

    let hostView = UIView(frame: CGRect(x: 0, y: 0, width: 180, height: 240))
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var controller: AVPictureInPictureController?
    private let log: EventLog
    private var retried = false

    init(log: EventLog) {
        self.log = log
        super.init()
        displayLayer.videoGravity = .resizeAspect
        displayLayer.frame = hostView.bounds
        hostView.layer.addSublayer(displayLayer)
        hostView.backgroundColor = .black
    }

    /// Call once the host view is on screen.
    func prepare() {
        guard controller == nil else { return }
        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            log.add("PiP isn't supported on this device")
            return
        }
        let source = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: displayLayer, playbackDelegate: self)
        let controller = AVPictureInPictureController(contentSource: source)
        controller.delegate = self
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.requiresLinearPlayback = true
        self.controller = controller
        log.add("PiP ready (starts automatically when you leave Hodeum)")
    }

    func start() {
        guard let controller else { return log.add("PiP isn't prepared yet") }
        if controller.isPictureInPicturePossible { controller.startPictureInPicture() } else { log.add("PiP not possible yet — wait for the first frame") }
    }

    /// Thread-safe: the renderer accepts buffers from any queue.
    func push(_ frame: CVPixelBuffer) {
        guard let sample = Self.sampleBuffer(for: frame) else { return }
        let renderer = displayLayer.sampleBufferRenderer
        if renderer.status == .failed { renderer.flush() }
        renderer.enqueue(sample)
    }

    private static func sampleBuffer(for frame: CVPixelBuffer) -> CMSampleBuffer? {
        var format: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: frame, formatDescriptionOut: &format)
        guard let format else { return nil }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: frame, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample)
        guard let sample, let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as NSArray?,
              let first = attachments.firstObject as? NSMutableDictionary else { return sample }
        first[kCMSampleAttachmentKey_DisplayImmediately] = true
        return sample
    }

    // MARK: AVPictureInPictureSampleBufferPlaybackDelegate — a live, never-paused stream.

    func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {}

    func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
    }

    func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool { false }

    func pictureInPictureController(_ controller: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}

    func pictureInPictureController(_ controller: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    func pictureInPictureControllerShouldProhibitBackgroundAudioPlayback(_ controller: AVPictureInPictureController) -> Bool { false }

    // MARK: AVPictureInPictureControllerDelegate

    func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        log.add("PiP started")
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        log.add("PiP stopped")
    }

    func pictureInPictureController(_ controller: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        log.add("PiP failed to start: \(ScreenFeed.describe(error))")
        guard !retried else { return }
        retried = true
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in self?.start() }
    }
}
