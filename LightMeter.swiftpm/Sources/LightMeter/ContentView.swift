import SwiftUI
import AVFoundation

// MARK: - ContentView

struct ContentView: View {
    @EnvironmentObject var camera: CameraManager
    @StateObject private var state = MeterState()

    var body: some View {
        VStack(spacing: 0) {
            // Viewfinder
            ViewfinderView(camera: camera, state: state)

            // Control panel
            VStack(spacing: 6) {
                settingsRow
                zoneScaleRow
                shutterDisplayRow
                bottomToolbar
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(uiColor: .systemGray6))
        }
        .ignoresSafeArea(edges: [.bottom])
        .onAppear { camera.start() }
        .onDisappear { camera.stop() }
        .onChange(of: camera.exposureDuration) { _, _ in state.refresh(camera) }
    }
}

// MARK: - App State

class MeterState: ObservableObject {
    @Published var filmISO = 400
    @Published var aperture: Double = 8
    @Published var points: [MeteringPoint] = []
    @Published var pointAnalyses: [Double] = []
    @Published var shiftStops: Double = 0

    // Computed reference shutter
    @Published var refShutter: Double = 1/125
    @Published var displayShutter: String = "1/125"
    @Published var displayComp: String = ""

    func refresh(_ camera: CameraManager) {
        let phoneT = camera.exposureDuration.seconds
        let phoneISO = camera.iso
        let phoneF = camera.aperture > 0 ? camera.aperture : 1.8

        refShutter = referenceShutter(
            phoneExposureSeconds: phoneT,
            phoneISO: phoneISO,
            phoneAperture: phoneF,
            filmAperture: aperture,
            filmISO: filmISO
        )

        // Analyze points
        if !points.isEmpty {
            let lums = points.map { $0.luminance }
            pointAnalyses = analyzePoints(pointLuminances: lums, fullFrameLuminance: camera.fullFrameLuminance)
        } else {
            pointAnalyses = []
        }

        // Final display shutter (Zone V + shift)
        let t = refShutter * pow(2, shiftStops)
        let r = roundToNearest(t, in: shutterSpeeds)
        displayShutter = formatShutter(r.value)

        var comps: [String] = []
        if shiftStops != 0 {
            comps.append("偏移 \(shiftStops > 0 ? "+" : "")\(String(format: "%.1f", shiftStops))档")
        }
        if abs(r.delta) > 0.03 {
            comps.append("靠档 \(r.delta > 0 ? "+" : "")\(String(format: "%.2f", r.delta))EV")
        }
        displayComp = comps.joined(separator: " · ")
    }

    func addPoint(x: CGFloat, y: CGFloat, camera: CameraManager) {
        // Sample pixel luminance at tap point from camera's last frame average
        // In a full implementation, we'd sample the specific region.
        // For now, use the full-frame luminance as baseline.
        let pt = MeteringPoint(xRatio: x, yRatio: y, luminance: camera.fullFrameLuminance)
        points.append(pt)
        refresh(camera)
        if points.count == 1 && !pointAnalyses.isEmpty {
            shiftStops = clamp(-pointAnalyses[0])
        }
    }

    func removePoint(at index: Int) {
        guard index < points.count else { return }
        points.remove(at: index)
        pointAnalyses.removeAll()
    }

    func clearPoints() {
        points.removeAll()
        pointAnalyses.removeAll()
        shiftStops = 0
    }

    private func clamp(_ v: Double) -> Double {
        guard !pointAnalyses.isEmpty else { return max(-5, min(5, v)) }
        var lo = -Double.infinity, hi = Double.infinity
        for p in pointAnalyses {
            lo = max(lo, -5 - p)
            hi = min(hi, 5 - p)
        }
        return max(lo, min(hi, v))
    }
}

// MARK: - Viewfinder

struct ViewfinderView: View {
    @ObservedObject var camera: CameraManager
    @ObservedObject var state: MeterState

    var body: some View {
        ZStack {
            // Camera preview
            if camera.isRunning {
                CameraPreview(session: camera.session)
                    .ignoresSafeArea(edges: [.top])
            } else if let error = camera.errorMessage {
                Color.black
                Text(error).foregroundColor(.white)
            } else {
                Color.black
                ProgressView().tint(.white)
            }

            // Frame lines
            FrameLinesView()

            // Metering point dots
            ForEach(Array(state.points.enumerated()), id: \.element.id) { i, pt in
                MeteringDotView(index: i, point: pt)
            }

            // Tap to add point
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { loc in
                    // Use geometry reader to get tap location
                }
                .gesture(
                    SpatialTapGesture()
                        .onEnded { tap in
                            let size = UIScreen.main.bounds.size
                            // Approximate position
                            state.addPoint(
                                x: tap.location.x / size.width,
                                y: tap.location.y / size.height,
                                camera: camera
                            )
                        }
                )

            // Viewfinder info
            VStack {
                HStack {
                    Text("135")
                        .font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.ultraThinMaterial).cornerRadius(8)
                    Text("50mm")
                        .font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.ultraThinMaterial).cornerRadius(8)
                }
                .padding(.top, 8)
                Spacer()
            }

            // Hint
            if state.points.isEmpty {
                VStack {
                    Spacer()
                    Text("点击画面添加测光点")
                        .font(.caption)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(.ultraThinMaterial).cornerRadius(12)
                        .padding(.bottom, 16)
                }
            }
        }
        .frame(maxHeight: UIScreen.main.bounds.height * 0.55)
    }
}

struct FrameLinesView: View {
    var body: some View {
        Rectangle()
            .strokeBorder(.white.opacity(0.5), lineWidth: 2)
            .padding(30)
    }
}

struct MeteringDotView: View {
    let index: Int
    let point: MeteringPoint

    var body: some View {
        Circle()
            .strokeBorder(.white, lineWidth: 2)
            .background(Circle().fill(.orange.opacity(0.5)))
            .frame(width: 16, height: 16)
            .overlay(alignment: .top) {
                Text("P\(index + 1)")
                    .font(.system(size: 10))
                    .foregroundColor(.white)
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(.black.opacity(0.6))
                    .cornerRadius(6)
                    .offset(y: -16)
            }
            .position(x: point.xRatio * UIScreen.main.bounds.width,
                      y: point.yRatio * UIScreen.main.bounds.height * 0.55)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.6)
                    .onEnded { _ in /* remove point */ }
            )
    }
}

// MARK: - Settings Row

extension ContentView {
    var settingsRow: some View {
        HStack(spacing: 8) {
            settingField(label: "光圈", value: formatAperture(state.aperture))
            settingField(label: "ISO", value: "\(state.filmISO)")
            settingField(label: "手机", value: camera.isRunning
                         ? "1/\(Int(1 / max(0.001, camera.exposureDuration.seconds))) ISO\(Int(camera.iso))"
                         : "--")
        }
    }

    func settingField(label: String, value: String) -> some View {
        VStack(spacing: 1) {
            Text(label).font(.system(size: 10)).foregroundColor(.gray)
            Text(value).font(.system(size: 13, design: .monospaced))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(Color(uiColor: .systemGray5))
        .cornerRadius(8)
    }
}

// MARK: - Zone Scale

extension ContentView {
    var zoneScaleRow: some View {
        VStack(spacing: 2) {
            // Zone labels
            HStack(spacing: 0) {
                ForEach(Array(zones.enumerated()), id: \.offset) { i, z in
                    Text(z)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(i == 5 ? .orange : .gray)
                        .frame(maxWidth: .infinity)
                }
            }

            // Track with markers
            ZStack {
                // 11-bin track
                HStack(spacing: 1) {
                    ForEach(0..<11, id: \.self) { i in
                        Rectangle()
                            .fill(Color.gray.opacity(0.3 + Double(abs(i - 5)) * 0.04))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 36)
                .cornerRadius(6)

                // Zone V line
                Rectangle()
                    .fill(.orange)
                    .frame(width: 2, height: 36)
                    .position(x: UIScreen.main.bounds.width / 2, y: 18)

                // Markers
                ForEach(Array(state.pointAnalyses.enumerated()), id: \.offset) { i, offset in
                    let ez = offset + state.shiftStops
                    let snapped = max(0, min(10, round(5 + ez)))
                    let pct = (snapped + 0.5) / 11
                    let x = pct * (UIScreen.main.bounds.width - 24)

                    Text("P\(i + 1)")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(.black)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(.orange))
                        .position(x: x, y: 18)
                }

                // Drag gesture
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { g in
                                let w = UIScreen.main.bounds.width - 24
                                let stopsPerPoint = 10.0 / w
                                state.shiftStops += g.translation.width * stopsPerPoint
                            }
                    )
            }
            .frame(height: 36)
            .cornerRadius(6)

            // Info text
            Text(state.points.isEmpty ? "点击画面添加测光点" : "拖动轨道调整 · 场景反差 -- 档")
                .font(.system(size: 10))
                .foregroundColor(.orange)
                .frame(height: 16)
        }
    }
}

// MARK: - Shutter + Toolbar

extension ContentView {
    var shutterDisplayRow: some View {
        HStack {
            Text("快门")
                .font(.caption).foregroundColor(.gray)
            Text(state.displayShutter)
                .font(.system(size: 36, weight: .bold, design: .monospaced))
                .foregroundColor(.orange)
            if !state.displayComp.isEmpty {
                Text(state.displayComp)
                    .font(.caption2).foregroundColor(.gray)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    var bottomToolbar: some View {
        HStack(spacing: 8) {
            toolbarButton("👁", "预览") { }
            toolbarButton("🦓", "斑马") { }
            toolbarButton("✕", "清除") { state.clearPoints() }
            toolbarButton("↩", "撤销") {
                if !state.points.isEmpty {
                    state.removePoint(at: state.points.count - 1)
                }
            }
            aperturePicker
            isoStepper
        }
    }

    func toolbarButton(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(icon).font(.system(size: 18))
                Text(label).font(.system(size: 9))
            }
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(Color(uiColor: .systemGray5))
            .cornerRadius(8)
        }
    }

    var aperturePicker: some View {
        Picker("", selection: $state.aperture) {
            ForEach(apertures, id: \.self) { a in
                Text(formatAperture(a)).tag(a)
            }
        }
        .pickerStyle(.menu)
        .font(.caption)
    }

    var isoStepper: some View {
        HStack(spacing: 2) {
            Button(action: { state.filmISO = max(25, state.filmISO / 2) }) {
                Image(systemName: "minus").font(.caption)
            }
            Text("ISO \(state.filmISO)")
                .font(.system(size: 10, design: .monospaced))
            Button(action: { state.filmISO = min(25600, state.filmISO * 2) }) {
                Image(systemName: "plus").font(.caption)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(Color(uiColor: .systemGray5))
        .cornerRadius(8)
    }
}

// MARK: - Camera Preview (UIViewRepresentable)

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
