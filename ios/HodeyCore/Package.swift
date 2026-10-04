// swift-tools-version:5.10
import PackageDescription

/// Pure teaching logic shared by the Hodeum iPhone app. Tested with `swift test` on the Mac host,
/// because ScreenCaptureKit (in the app target) doesn't build for the Simulator.
let package = Package(
    name: "HodeyCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "HodeyCore", targets: ["HodeyCore"])],
    targets: [
        .target(name: "HodeyCore"),
        .testTarget(name: "HodeyCoreTests", dependencies: ["HodeyCore"]),
    ]
)
