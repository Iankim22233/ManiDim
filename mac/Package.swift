// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ManiDim",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "ManiDim",
            path: "Sources/ManiDim"
        )
    ]
)
