import SwiftUI

@main
struct HodeumApp: App {
    @StateObject private var spike = SpikeController()

    var body: some Scene {
        WindowGroup {
            ContentView(spike: spike, log: spike.log)
        }
    }
}
