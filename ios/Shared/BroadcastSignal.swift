import Foundation

/// The ReplayKit extension and the app talk through Darwin notifications: no App Group needed,
/// which keeps the app signable with a free Apple ID. Notifications carry no data, only "it happened".
enum BroadcastSignal {
    static let started = "com.anshlaw.hodeum.broadcast.started"
    static let frame = "com.anshlaw.hodeum.broadcast.frame"
    static let finished = "com.anshlaw.hodeum.broadcast.finished"
    /// The extension reports at most this often, so counting never floods the app.
    static let minFrameInterval: TimeInterval = 0.5

    static func post(_ name: String) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
    }
}
