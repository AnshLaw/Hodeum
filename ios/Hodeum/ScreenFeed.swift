import CoreMedia
import ScreenCaptureKit

/// iOS 27 in-app screen capture: the learner picks "entire screen" in the system picker, and frames keep
/// arriving while Hodeum is in the background (UIBackgroundModes: screen-capture).
final class ScreenFeed: NSObject, SCContentSharingPickerObserver, SCStreamOutput, SCStreamDelegate {
    private let frames: LatestFrame
    private let log: EventLog
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "hodeum.capture", qos: .userInitiated)
    private var loggedFormat = false

    init(frames: LatestFrame, log: EventLog) {
        self.frames = frames
        self.log = log
    }

    func start() {
        let picker = SCContentSharingPicker.shared
        var configuration = SCContentSharingPickerConfiguration()
        configuration.showsMicrophoneControl = false
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        picker.present()
        log.add("ScreenCaptureKit: picker shown — choose your entire screen")
    }

    func stop() {
        guard let stream else { return }
        self.stream = nil
        Task {
            do { try await stream.stopCapture() } catch { self.log.add("ScreenCaptureKit stop failed: \(error.localizedDescription)") }
        }
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        log.add("ScreenCaptureKit: content picked, starting stream")
        let configuration = SCStreamConfiguration()
        let newStream = SCStream(filter: filter, configuration: configuration, delegate: self)
        do {
            try newStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        } catch {
            log.add("ScreenCaptureKit addStreamOutput failed: \(Self.describe(error))")
            return
        }
        Task {
            do {
                try await newStream.startCapture()
                self.stream = newStream
                self.log.add("ScreenCaptureKit: capturing")
            } catch {
                self.log.add("ScreenCaptureKit start failed: \(Self.describe(error))")
            }
        }
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        log.add("ScreenCaptureKit: picker cancelled")
    }

    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        log.add("ScreenCaptureKit picker failed: \(Self.describe(error))")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid, Self.isComplete(sampleBuffer), let frame = sampleBuffer.imageBuffer else { return }
        if !loggedFormat {
            loggedFormat = true
            log.add("First frame: \(CVPixelBufferGetWidth(frame))×\(CVPixelBufferGetHeight(frame)), format \(Self.fourCC(CVPixelBufferGetPixelFormatType(frame)))")
        }
        frames.store(frame)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        self.stream = nil
        log.add("ScreenCaptureKit stopped: \(Self.describe(error))")
    }

    /// Only complete frames carry new pixels; idle/blank ones repeat or drop the image.
    private static func isComplete(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: raw) else { return true }
        return status == .complete
    }

    static func describe(_ error: Error) -> String {
        let ns = error as NSError
        return "\(ns.domain) \(ns.code): \(ns.localizedDescription)"
    }

    private static func fourCC(_ code: OSType) -> String {
        let bytes = [24, 16, 8, 0].map { Character(UnicodeScalar(UInt8((code >> $0) & 0xFF))) }
        return String(bytes)
    }
}
