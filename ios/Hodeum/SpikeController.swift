import Foundation
import UIKit

/// Ties the spike together: capture → OCR (looking for "Settings") → PiP guide with a ring → voice.
final class SpikeController: ObservableObject {
    /// The word this spike points at; the full app uses the Dark Mode pack's steps instead.
    static let demoTarget = "Settings"
    private static let tickInterval: TimeInterval = 0.5
    private static let ocrInterval: TimeInterval = 1.5

    let log = EventLog()
    @Published private(set) var counts = LatestFrame.Counts()
    @Published private(set) var broadcastFrames = 0
    @Published private(set) var lastRead: [String] = []
    @Published private(set) var targetFound = false

    private let frames = LatestFrame()
    private lazy var feed = ScreenFeed(frames: frames, log: log)
    private let broadcast = BroadcastCounter()
    lazy var pip = PiPGuide(log: log)
    private lazy var voice = HodeyVoice(log: log)
    private let renderer = GuideRenderer()
    private let work = DispatchQueue(label: "hodeum.guide", qos: .userInitiated)
    private var timer: DispatchSourceTimer?
    private var lastReadSequence = -1
    private var lastReadAt = Date.distantPast
    private var target: CGRect?
    private var announced = false
    private var backgrounded = false

    init() {
        broadcast.onChange = { [weak self] signal in self?.broadcastSignal(signal) }
    }

    func appeared() {
        voice.activateSession()
        pip.prepare()
        startLoop()
    }

    func startScreenCapture() { feed.start() }
    func startPiP() { pip.start() }
    func speakTest() { voice.say("Hi, I'm Hodey. I'll show you where to tap.") }

    func setBackgrounded(_ value: Bool) {
        frames.setBackgrounded(value)
        work.async { self.backgrounded = value }
        log.add(value ? "Hodeum went to the background" : "Hodeum is in front")
    }

    private func broadcastSignal(_ signal: String) {
        broadcastFrames = broadcast.frames
        if signal != BroadcastSignal.frame { log.add("ReplayKit: \(signal.components(separatedBy: ".").last ?? signal)") }
    }

    private func startLoop() {
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: work)
        timer.schedule(deadline: .now(), repeating: Self.tickInterval)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        self.timer = timer
    }

    /// Runs on `work`: read the screen now and then, and redraw the floating guide every tick.
    private func tick() {
        let counts = frames.currentCounts()
        DispatchQueue.main.async { self.counts = counts }
        guard let (frame, sequence) = frames.read() else { return }
        if sequence != lastReadSequence, Date().timeIntervalSince(lastReadAt) >= Self.ocrInterval {
            lastReadSequence = sequence
            lastReadAt = Date()
            readScreen(frame)
        }
        let caption = target == nil ? "Hodey is watching…" : "Tap \(Self.demoTarget)"
        if let guide = renderer.render(frame: frame, target: target, caption: caption) { pip.push(guide) }
    }

    private func readScreen(_ frame: CVPixelBuffer) {
        do {
            let result = try TextReader.read(frame, looking: Self.demoTarget)
            target = result.target
            let preview = result.lines.prefix(8).map(\.text)
            DispatchQueue.main.async {
                self.lastRead = preview
                self.targetFound = result.target != nil
            }
            if result.target != nil, backgrounded, !announced {
                announced = true
                DispatchQueue.main.async { self.voice.say("I can see \(Self.demoTarget). That's where you'd tap.") }
            }
        } catch {
            log.add("Reading the screen failed: \(ScreenFeed.describe(error))")
        }
    }
}
