import Foundation

/// Counts frame signals from the ReplayKit extension (the fallback capture path).
final class BroadcastCounter {
    private(set) var frames = 0
    var onChange: (String) -> Void = { _ in }

    init() {
        for name in [BroadcastSignal.started, BroadcastSignal.frame, BroadcastSignal.finished] {
            observe(name)
        }
    }

    deinit {
        CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
    }

    private func observe(_ name: String) {
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), observer,
            { _, observer, name, _, _ in
                guard let observer, let name else { return }
                let counter = Unmanaged<BroadcastCounter>.fromOpaque(observer).takeUnretainedValue()
                let signal = name.rawValue as String
                DispatchQueue.main.async { counter.received(signal) }
            },
            name as CFString, nil, .deliverImmediately
        )
    }

    private func received(_ signal: String) {
        if signal == BroadcastSignal.frame { frames += 1 }
        onChange(signal)
    }
}
