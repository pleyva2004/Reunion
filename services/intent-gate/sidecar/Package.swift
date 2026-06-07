// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "intent-sidecar",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "intent-sidecar",
            path: "Sources/intent-sidecar"
        )
    ]
)
