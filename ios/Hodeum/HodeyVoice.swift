import AVFoundation

/// Hodey's spoken instructions, on the phone's own voices. One audio session is shared with PiP.
final class HodeyVoice {
    private let synthesizer = AVSpeechSynthesizer()
    private let log: EventLog

    init(log: EventLog) {
        self.log = log
    }

    /// Spoken audio that keeps playing in the background and lets PiP run alongside it.
    func activateSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            log.add("Audio session active")
        } catch {
            log.add("Audio session failed: \(ScreenFeed.describe(error))")
        }
    }

    func say(_ text: String) {
        synthesizer.stopSpeaking(at: .immediate)
        synthesizer.speak(AVSpeechUtterance(string: text))
        log.add("Hodey says: \(text)")
    }
}
