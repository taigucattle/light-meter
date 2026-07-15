// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LightMeter",
    platforms: [.iOS("17.0")],
    targets: [
        .executableTarget(name: "LightMeter", path: ".")
    ]
)
