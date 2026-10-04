import ReplayKit
import SwiftUI

/// The spike's single screen: what to tap, what Hodeum sees, and a log to report back.
struct ContentView: View {
    @ObservedObject var spike: SpikeController
    @ObservedObject var log: EventLog
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            List {
                Section("1 · Let Hodey see your screen") {
                    Button("Start screen capture (iOS 27)") { spike.startScreenCapture() }
                    HStack {
                        Text("Or ReplayKit broadcast:")
                        Spacer()
                        BroadcastButton().frame(width: 44, height: 44)
                    }
                }
                Section("2 · Floating guide") {
                    PiPHost(view: spike.pip.hostView).frame(width: 180, height: 240).frame(maxWidth: .infinity)
                    Button("Start floating window now") { spike.startPiP() }
                    Button("Speak test") { spike.speakTest() }
                }
                Section("What Hodeum sees") {
                    LabeledContent("Frames (all)", value: "\(spike.counts.total)")
                    LabeledContent("Frames in background", value: "\(spike.counts.whileBackgrounded)")
                    LabeledContent("ReplayKit frames", value: "\(spike.broadcastFrames)")
                    LabeledContent("\"\(SpikeController.demoTarget)\" found", value: spike.targetFound ? "Yes" : "No")
                    ForEach(Array(spike.lastRead.enumerated()), id: \.offset) { Text($0.element).font(.caption) }
                }
                Section("Log") {
                    ForEach(Array(log.lines.enumerated()), id: \.offset) { Text($0.element).font(.caption2.monospaced()) }
                }
            }
            .navigationTitle("Hodeum · iPhone test")
        }
        .onAppear { spike.appeared() }
        .onChange(of: scenePhase) { _, phase in spike.setBackgrounded(phase == .background) }
    }
}

/// Hosts the PiP layer's view; it must be on screen for PiP to be possible.
private struct PiPHost: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

/// The system ReplayKit picker, preset to Hodeum's own broadcast extension (whatever its signed bundle ID).
private struct BroadcastButton: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        picker.preferredExtension = Self.extensionIdentifier()
        picker.showsMicrophoneButton = false
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}

    private static func extensionIdentifier() -> String? {
        guard let plugins = Bundle.main.builtInPlugInsURL,
              let urls = try? FileManager.default.contentsOfDirectory(at: plugins, includingPropertiesForKeys: nil) else { return nil }
        return urls.first { $0.pathExtension == "appex" }.flatMap { Bundle(url: $0)?.bundleIdentifier }
    }
}
