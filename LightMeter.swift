import SwiftUI
import AVFoundation
import CoreImage

// ============================================
// 胶片测光表 — iPad Swift Playgrounds
// 参照 Apple CapturingPhotos 示例的架构
// ===========================================

// MARK: - App

@main
struct LightMeterApp: App {
    @StateObject private var cam = CameraManager()
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(cam).preferredColorScheme(.dark)
        }
    }
}

// MARK: - Camera Manager (Apple sample pattern)

final class CameraManager: NSObject, ObservableObject, @unchecked Sendable {
    @Published var exposureSeconds: Double = 1/120
    @Published var iso: Float = 200
    @Published var lensF: Float = 1.8
    @Published var isRunning = false
    @Published var errorMsg: String?
    @Published var previewImage: CGImage?

    private let session = AVCaptureSession()
    private var deviceInput: AVCaptureDeviceInput?
    private var photoOutput: AVCapturePhotoOutput?
    private var videoOutput: AVCaptureVideoDataOutput?
    private let sessionQueue = DispatchQueue(label: "camera.session")
    private var isConfigured = false

    private var addToPreview: ((CIImage) -> Void)?
    lazy var previewStream: AsyncStream<CIImage> = {
        AsyncStream { c in self.addToPreview = { c.yield($0) } }
    }()

    func start() {
        Task {
            let ok = await checkPermission()
            guard ok else {
                await MainActor.run { errorMsg = "摄像头权限未授权" }
                return
            }
            await configureAndStart()
        }
    }

    private func checkPermission() async -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    private func configureAndStart() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            sessionQueue.async { [weak self] in
                guard let self else { c.resume(); return }

                if self.isConfigured {
                    if !self.session.isRunning { self.session.startRunning() }
                    c.resume(); return
                }

                self.session.beginConfiguration()
                self.session.sessionPreset = .photo

                guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                        ?? AVCaptureDevice.default(for: .video),
                      let input = try? AVCaptureDeviceInput(device: dev)
                else {
                    self.session.commitConfiguration()
                    Task { @MainActor in self.errorMsg = "无法访问摄像头" }
                    c.resume(); return
                }

                try? dev.lockForConfiguration()
                if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
                if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
                dev.unlockForConfiguration()

                guard self.session.canAddInput(input) else {
                    self.session.commitConfiguration()
                    c.resume(); return
                }
                self.session.addInput(input)
                self.deviceInput = input

                let photoOut = AVCapturePhotoOutput()
                let videoOut = AVCaptureVideoDataOutput()
                videoOut.setSampleBufferDelegate(self, queue: DispatchQueue(label: "video.out"))

                guard self.session.canAddOutput(photoOut), self.session.canAddOutput(videoOut) else {
                    self.session.commitConfiguration()
                    c.resume(); return
                }
                self.session.addOutput(photoOut)
                self.session.addOutput(videoOut)
                self.photoOutput = photoOut
                self.videoOutput = videoOut

                if let vc = videoOut.connection(with: .video), vc.isVideoMirroringSupported {
                    vc.isVideoMirrored = false
                }

                self.session.commitConfiguration()
                self.isConfigured = true
                self.session.startRunning()

                Task { @MainActor in self.isRunning = true }
                c.resume()
            }
        }

        // Start param polling
        startPolling()
    }

    private func startPolling() {
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, let dev = self.deviceInput?.device else { return }
            Task { @MainActor in
                self.exposureSeconds = dev.exposureDuration.seconds
                self.iso = dev.iso
                self.lensF = dev.lensAperture
            }
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }
}

// MARK: - Video frame delegate

extension CameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ out: AVCaptureOutput, didOutput buf: CMSampleBuffer, from conn: AVCaptureConnection) {
        guard let px = CMSampleBufferGetImageBuffer(buf) else { return }
        addToPreview?(CIImage(cvPixelBuffer: px))
    }
}

// MARK: - Light Meter Engine

let APERTURES: [Double] = [1.0,1.1,1.2,1.4,1.6,1.8,2.0,2.2,2.5,2.8,3.2,3.5,4.0,4.5,5.0,5.6,6.3,7.1,8.0,9.0,10,11,13,14,16,18,20,22,25,29,32,36,40,45,51,57,64]
let SHUTTERS: [Double] = [1/8000,1/6400,1/5000,1/4000,1/3200,1/2500,1/2000,1/1600,1/1250,1/1000,1/800,1/640,1/500,1/400,1/320,1/250,1/200,1/160,1/125,1/100,1/80,1/60,1/50,1/40,1/30,1/25,1/20,1/15,1/13,1/10,1/8,1/6,1/5,1/4,1/3,0.5,0.6,0.8,1,1.3,1.6,2,2.5,3,4,5,6,8,10,13,15,20,25,30]
let ZONES = ["0","I","II","III","IV","V","VI","VII","VIII","IX","X"]

func refShutter(phoneT: Double, phoneISO: Float, phoneF: Float, filmA: Double, filmISO: Int) -> Double {
    guard phoneT > 0 else {
        let r = Double(filmISO)/100
        return (filmA*filmA)/(32768*r)
    }
    let ratio = filmA / Double(phoneF)
    return phoneT * ratio*ratio * (Double(phoneISO)/Double(filmISO))
}

func rndNearest(_ v: Double, _ seq: [Double]) -> (val: Double, delta: Double) {
    var best = seq[0], bestD = Double.infinity
    for s in seq { let d = abs(log2(v/s)); if d < bestD { bestD = d; best = s } }
    return (best, log2(v/best))
}

func fmtShutter(_ s: Double) -> String {
    if s >= 1 {
        let i = s.truncatingRemainder(dividingBy:1) == 0 ? String(Int(s)) : String(format:"%.1f",s)
        return i + "\""
    }
    return "1/\(Int(round(1/s)))"
}

func fmtAperture(_ a: Double) -> String {
    let i = a.truncatingRemainder(dividingBy:1) == 0 ? String(Int(a)) : String(format:"%.1f",a)
    return "f/\(i)"
}

// MARK: - State

class MeterState: ObservableObject {
    @Published var filmISO = 400
    @Published var aperture: Double = 8
    @Published var points: [(x: CGFloat, y: CGFloat)] = []
    @Published var offsets: [Double] = []
    @Published var shift: Double = 0
    @Published var shutter = "--"
    @Published var comp = ""

    func refresh(_ cam: CameraManager) {
        let t = refShutter(phoneT: cam.exposureSeconds, phoneISO: cam.iso,
                           phoneF: cam.lensF, filmA: aperture, filmISO: filmISO) * pow(2, shift)
        let r = rndNearest(t, SHUTTERS)
        shutter = fmtShutter(r.val)
        var c: [String] = []
        if shift != 0 { c.append("偏移 \(shift>0 ? "+" : "")\(String(format:"%.1f",shift))档") }
        if abs(r.delta) > 0.03 { c.append("靠档 \(r.delta>0 ? "+" : "")\(String(format:"%.2f",r.delta))EV") }
        comp = c.joined(separator: " · ")
    }

    func addPoint() { points.append((0.5, 0.5)); if points.count == 1 { offsets = [0]; shift = 0 } }
    func removeLast() { if !points.isEmpty { points.removeLast(); if points.isEmpty { offsets.removeAll() } } }
    func clear() { points.removeAll(); offsets.removeAll(); shift = 0 }

    func clampShift(_ v: Double) -> Double {
        guard !offsets.isEmpty else { return max(-5, min(5, v)) }
        var lo = -Double.infinity, hi = Double.infinity
        for o in offsets { lo = max(lo, -5-o); hi = min(hi, 5-o) }
        return max(lo, min(hi, v))
    }
}

// MARK: - UI

struct ContentView: View {
    @EnvironmentObject var cam: CameraManager
    @StateObject private var s = MeterState()
    @State private var geoW: CGFloat = 400

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                ZStack {
                    if let err = cam.errorMsg {
                        Color.black
                        VStack(spacing: 12) {
                            Image(systemName: "camera.fill").font(.largeTitle).foregroundColor(.gray)
                            Text(err).foregroundColor(.gray).multilineTextAlignment(.center)
                        }.padding()
                    } else if cam.isRunning {
                        CamPreview(stream: cam.previewStream)
                    } else {
                        Color.black; ProgressView().tint(.white)
                    }
                    Rectangle().strokeBorder(.white.opacity(0.5), lineWidth: 2).padding(30)
                    ForEach(Array(s.points.enumerated()), id: \.offset) { i, pt in
                        Circle().strokeBorder(.white, lineWidth: 2)
                            .background(Circle().fill(.orange.opacity(0.5))).frame(width: 16, height: 16)
                            .overlay(alignment: .top) {
                                Text("P\(i+1)").font(.system(size:9)).foregroundColor(.white)
                                    .padding(.horizontal,3).padding(.vertical,1)
                                    .background(.black.opacity(0.7)).cornerRadius(4).offset(y: -14)
                            }
                            .position(x: pt.x * geo.size.width, y: pt.y * geo.size.height)
                    }
                }
                .onTapGesture { loc in
                    s.addPoint()
                }
                .onAppear { geoW = geo.size.width }
            }
            .layoutPriority(1)

            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    ParamBadge("光圈", fmtAperture(s.aperture))
                    ParamBadge("ISO", "\(s.filmISO)")
                    ParamBadge("📷", "1/\(Int(1/max(0.001,cam.exposureSeconds))) ISO\(Int(cam.iso))")
                }
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        ForEach(Array(ZONES.enumerated()), id:\.offset) { i,z in
                            Text(z).font(.system(size:9,design:.monospaced))
                                .foregroundColor(i==5 ? .orange : .gray).frame(maxWidth:.infinity)
                        }
                    }
                    ZStack {
                        HStack(spacing:1) {
                            ForEach(0..<11, id:\.self) { i in
                                Color.gray.opacity(0.25+Double(abs(i-5))*0.05).frame(maxWidth:.infinity)
                            }
                        }.frame(height:34).cornerRadius(6)
                        Rectangle().fill(.orange).frame(width:2,height:34)
                        ForEach(Array(s.offsets.enumerated()), id:\.offset) { i,o in
                            let ez = o + s.shift
                            let sn = max(0, min(10, round(5+ez)))
                            Text("P\(i+1)").font(.system(size:8,weight:.bold))
                                .foregroundColor(.black).padding(.horizontal,5).padding(.vertical,2)
                                .background(Capsule().fill(.orange))
                                .position(x: (sn + 0.5) / 11 * geoW, y: 17)
                        }
                    }.frame(height:34).cornerRadius(6)
                    .gesture(DragGesture().onChanged { g in
                        s.shift = s.clampShift(s.shift + g.translation.width * (10 / max(1, geoW)))
                    })
                    Text(s.points.isEmpty ? "点击取景画面" : "拖动轨道")
                        .font(.system(size:10)).foregroundColor(.orange)
                }
                HStack {
                    Text("快门").font(.caption).foregroundColor(.gray)
                    Text(s.shutter).font(.system(size:34,weight:.bold,design:.monospaced)).foregroundColor(.orange)
                    if !s.comp.isEmpty { Text(s.comp).font(.caption2).foregroundColor(.gray) }
                    Spacer()
                }.padding(.vertical, 2)
                HStack(spacing: 6) {
                    ToolBtn("✕", "清除") { s.clear() }
                    ToolBtn("↩", "撤销") { s.removeLast() }
                    Picker("", selection: $s.aperture) {
                        ForEach(APERTURES, id:\.self) { a in Text(fmtAperture(a)).tag(a) }
                    }.pickerStyle(.menu)
                    HStack(spacing:2) {
                        Button { s.filmISO = max(25,s.filmISO/2) } label: { Image(systemName:"minus").font(.caption) }
                        Text("ISO\(s.filmISO)").font(.system(size:10,design:.monospaced))
                        Button { s.filmISO = min(25600,s.filmISO*2) } label: { Image(systemName:"plus").font(.caption) }
                    }.padding(.horizontal,6).padding(.vertical,3).background(Color.gray.opacity(0.2)).cornerRadius(6)
                }
            }
            .padding(.horizontal, 10)
            .background(Color.black.opacity(0.95))
        }
        .ignoresSafeArea(edges: [.bottom])
        .onAppear { cam.start() }
        .onChange(of: cam.exposureSeconds) { _, _ in s.refresh(cam) }
    }
}

// MARK: - Camera Preview (AsyncStream-based)

struct CamPreview: View {
    let stream: AsyncStream<CIImage>
    @State private var image: CGImage?

    var body: some View {
        Group {
            if let img = image {
                Image(decorative: img, scale: 1.0).resizable().aspectRatio(contentMode: .fill)
            } else { Color.black }
        }
        .task {
            for await ci in stream {
                let ctx = CIContext()
                if let cg = ctx.createCGImage(ci, from: ci.extent) {
                    await MainActor.run { image = cg }
                }
            }
        }
    }
}

struct ParamBadge: View {
    let label: String; let value: String
    init(_ l: String, _ v: String) { label = l; value = v }
    var body: some View {
        VStack(spacing:1) { Text(label).font(.system(size:9)).foregroundColor(.gray); Text(value).font(.system(size:12,design:.monospaced)) }
            .frame(maxWidth:.infinity).padding(.vertical,3).background(Color.gray.opacity(0.2)).cornerRadius(6)
    }
}

struct ToolBtn: View {
    let icon: String; let label: String; let action: () -> Void
    init(_ i: String, _ l: String, _ a: @escaping () -> Void) { icon = i; label = l; action = a }
    var body: some View {
        Button(action: action) { VStack(spacing:0) { Text(icon).font(.system(size:16)); Text(label).font(.system(size:8)) } }
            .padding(.horizontal,8).padding(.vertical,2).background(Color.gray.opacity(0.2)).cornerRadius(6)
    }
}
