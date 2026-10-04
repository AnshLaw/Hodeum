import Foundation

/// What the spike saw, newest first, shown on screen so a sideloaded build can be debugged without a Mac.
final class EventLog: ObservableObject {
    private static let maxLines = 80
    @Published private(set) var lines: [String] = []
    private let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    func add(_ text: String) {
        let line = "\(clock.string(from: Date()))  \(text)"
        print("[Hodeum] \(text)")
        DispatchQueue.main.async {
            self.lines.insert(line, at: 0)
            if self.lines.count > Self.maxLines { self.lines.removeLast() }
        }
    }
}
