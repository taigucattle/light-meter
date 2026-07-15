import SwiftUI

@main
struct LightMeterApp: App {
    @StateObject private var camera = CameraManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(camera)
                .preferredColorScheme(.dark)
        }
    }
}
