import ReplayKit

/// Fallback capture (ReplayKit broadcast). In this spike it only proves frames from other apps arrive:
/// it tells the app "a frame came in" at most twice a second.
final class SampleHandler: RPBroadcastSampleHandler {
    private var lastPost = Date.distantPast

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        BroadcastSignal.post(BroadcastSignal.started)
    }

    override func broadcastFinished() {
        BroadcastSignal.post(BroadcastSignal.finished)
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }
        let now = Date()
        guard now.timeIntervalSince(lastPost) >= BroadcastSignal.minFrameInterval else { return }
        lastPost = now
        BroadcastSignal.post(BroadcastSignal.frame)
    }
}
