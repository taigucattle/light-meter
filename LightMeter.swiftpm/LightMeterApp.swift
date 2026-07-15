import SwiftUI
import AVFoundation

// ============================================
// 胶片测光表 — iPad Swift Playgrounds
// 直接读取摄像头: exposureDuration / ISO / lensAperture
// ============================================

// MARK: - App Entry

@main
struct LightMeterApp: App {
    @StateObject private var cam = CameraManager()
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(cam).preferredColorScheme(.dark)
        }
    }
}

// MARK: - Camera Manager

class CameraManager: NSObject, ObservableObject {
    @Published var exposureSeconds: Double = 1/60
    @Published var iso: Float = 200
    @Published var lensF: Float = 1.8
    @Published var fullFrameY: Float = 0.18
    @Published var isRunning = false

    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "cam", qos: .userInteractive)
    private var lastT: TimeInterval = 0

    override init() {
        super.init()
        output.setSampleBufferDelegate(self, queue: queue)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    }

    func start() {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized
            else { requestAndStart(); return }
        configureAndRun()
    }

    private func requestAndStart() {
        AVCaptureDevice.requestAccess(for: .video) { ok in
            if ok { self.configureAndRun() }
        }
    }

    private func configureAndRun() {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: dev),
              session.canAddInput(input)
        else { session.commitConfiguration(); return }
        try? dev.lockForConfiguration()
        dev.focusMode = .continuousAutoFocus
        dev.exposureMode = .continuousAutoExposure
        dev.unlockForConfiguration()
        session.addInput(input)
        session.commitConfiguration()
        DispatchQueue.global(qos: .userInitiated).async {
            self.session.startRunning()
            DispatchQueue.main.async { self.isRunning = true }
        }
    }

    private func refreshParams() {
        guard let dev = (session.inputs.first as? AVCaptureDeviceInput)?.device else { return }
        DispatchQueue.main.async {
            self.exposureSeconds = dev.exposureDuration.seconds
            self.iso = dev.iso
            self.lensF = dev.lensAperture
        }
    }

    private func avgLuminance(_ buf: CVPixelBuffer) -> Float {
        CVPixelBufferLockBaseAddress(buf, .readOnly); defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
        let w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf)
        let row = CVPixelBufferGetBytesPerRow(buf)
        guard let base = CVPixelBufferGetBaseAddress(buf)?.assumingMemoryBound(to: UInt8.self) else { return 0.18 }
        var total: Float = 0; var n = 0; let step = 4
        for y in stride(from: 0, to: h, by: step) {
            for x in stride(from: 0, to: w, by: step) {
                let o = y * row + x * 4
                let r = s2l(Float(base[o+2])/255)
                let g = s2l(Float(base[o+1])/255)
                let b = s2l(Float(base[o])/255)
                total += 0.2126*r + 0.7152*g + 0.0722*b; n += 1
            }
        }
        return n > 0 ? total / Float(n) : 0.18
    }
    private func s2l(_ c: Float) -> Float { c <= 0.04045 ? c/12.92 : pow((c+0.055)/1.055, 2.4) }
}

extension CameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ out: AVCaptureOutput, didOutput buf: CMSampleBuffer, from conn: AVCaptureConnection) {
        let t = CACurrentMediaTime()
        guard t - lastT >= 0.1 else { return }
        lastT = t
        refreshParams()
        if let px = CMSampleBufferGetImageBuffer(buf) {
            let y = avgLuminance(px)
            DispatchQueue.main.async { self.fullFrameY = y }
        }
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
    let inv = Int(round(1/s))
    return "1/\(inv)"
}

func fmtAperture(_ a: Double) -> String {
    let i = a.truncatingRemainder(dividingBy:1) == 0 ? String(Int(a)) : String(format:"%.1f",a)
    return "f/\(i)"
}

// MARK: - State

class MeterState: ObservableObject {
    @Published var filmISO = 400
    @Published var aperture: Double = 8
    @Published var points: [(x: CGFloat, y: CGFloat, yLin: Float)] = []
    @Published var offsets: [Double] = []
    @Published var shift: Double = 0
    @Published var shutter = "--"
    @Published var comp = ""
    var refS: Double = 1/125

    func refresh(_ cam: CameraManager) {
        refS = refShutter(phoneT: cam.exposureSeconds, phoneISO: cam.iso, phoneF: cam.lensF, filmA: aperture, filmISO: filmISO)
        if !points.isEmpty {
            let lums = points.map { $0.yLin }
            offsets = lums.map { p in
                let r = Double(p)/Double(cam.fullFrameY > 0 ? cam.fullFrameY : 0.18)
                return log2(max(1/1024, min(1024, r)))
            }
        } else { offsets = [] }
        let t = refS * pow(2, shift)
        let r = rndNearest(t, SHUTTERS)
        shutter = fmtShutter(r.val)
        var c: [String] = []
        if shift != 0 { c.append("偏移 \(shift>0 ? "+" : "")\(String(format:"%.1f",shift))档") }
        if abs(r.delta) > 0.03 { c.append("靠档 \(r.delta>0 ? "+" : "")\(String(format:"%.2f",r.delta))EV") }
        comp = c.joined(separator: " · ")
    }

    func add(_ x: CGFloat, _ y: CGFloat, _ cam: CameraManager) {
        points.append((x, y, cam.fullFrameY))
        refresh(cam)
        if points.count == 1 && !offsets.isEmpty { shift = clamp(-offsets[0]) }
    }

    func removeLast() { if !points.isEmpty { points.removeLast(); offsets.removeAll() } }
    func clear() { points.removeAll(); offsets.removeAll(); shift = 0 }

    private func clamp(_ v: Double) -> Double {
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
    @State private var geoW: CGFloat = 400; @State private var geoH: CGFloat = 300

    var body: some View {
        VStack(spacing: 0) {
            // Viewfinder
            GeometryReader { geo in
                ZStack {
                    if cam.isRunning {
                        CamPreview(session: cam.session)
                    } else { Color.black; ProgressView().tint(.white) }
                    Rectangle().strokeBorder(.white.opacity(0.5), lineWidth: 2).padding(30)
                    ForEach(Array(s.points.enumerated()), id: \.offset) { i, pt in
                        Circle().strokeBorder(.white, lineWidth: 2)
                            .background(Circle().fill(.orange.opacity(0.5)))
                            .frame(width: 16, height: 16)
                            .overlay(alignment: .top) {
                                Text("P\(i+1)").font(.system(size:9)).foregroundColor(.white)
                                    .padding(.horizontal,3).padding(.vertical,1)
                                    .background(.black.opacity(0.7)).cornerRadius(4)
                                    .offset(y: -14)
                            }
                            .position(x: pt.x * geo.size.width, y: pt.y * geo.size.height)
                    }
                    if s.points.isEmpty {
                        Text("点击画面添加测光点").font(.caption)
                            .padding(.horizontal,12).padding(.vertical,6)
                            .background(.ultraThinMaterial).cornerRadius(12)
                    }
                }
                .onTapGesture { loc in
                    s.add(loc.x / geo.size.width, loc.y / geo.size.height, cam)
                }
                .onAppear { geoW = geo.size.width; geoH = geo.size.height }
            }
            .frame(height: UIScreen.main.bounds.height * 0.52)

            // Controls
            VStack(spacing: 4) {
                // Params
                HStack(spacing: 6) {
                    ParamBadge("光圈", fmtAperture(s.aperture))
                    ParamBadge("ISO", "\(s.filmISO)")
                    ParamBadge("📷", "1/\(Int(1/max(0.001,cam.exposureSeconds))) ISO\(Int(cam.iso))")
                }

                // Zone scale
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
                            let pct = (sn + 0.5) / 11
                            Text("P\(i+1)").font(.system(size:8,weight:.bold))
                                .foregroundColor(.black).padding(.horizontal,5).padding(.vertical,2)
                                .background(Capsule().fill(.orange))
                                .position(x: pct * geoW, y: 17)
                        }
                    }.frame(height:34).cornerRadius(6)
                    .gesture(DragGesture().onChanged { g in
                        let w = max(1, geoW)
                        s.shift += g.translation.width * (10 / w)
                    })
                    Text(s.points.isEmpty ? "点击画面测光" : "拖动轨道")
                        .font(.system(size:10)).foregroundColor(.orange)
                }

                // Shutter
                HStack {
                    Text("快门").font(.caption).foregroundColor(.gray)
                    Text(s.shutter).font(.system(size:34,weight:.bold,design:.monospaced)).foregroundColor(.orange)
                    if !s.comp.isEmpty { Text(s.comp).font(.caption2).foregroundColor(.gray) }
                    Spacer()
                }
                .padding(.vertical, 2)

                // Toolbar
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

struct CamPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PrevView { let v = PrevView(); v.pl.session = session; v.pl.videoGravity = .resizeAspectFill; return v }
    func updateUIView(_: PrevView, context: Context) {}
    class PrevView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var pl: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
