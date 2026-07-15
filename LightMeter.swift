import SwiftUI
import AVFoundation

// ============================================
// 胶片测光表 — iPad Swift Playgrounds
// 直接读取: exposureDuration / ISO / lensAperture
// ===========================================

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

// MARK: - Camera Manager (device-only polling, no session)

class CameraManager: ObservableObject {
    @Published var exposureSeconds: Double = 1/120
    @Published var iso: Float = 200
    @Published var lensF: Float = 1.8
    @Published var isLive = false
    @Published var errorMsg: String?

    private var timer: Timer?
    private var device: AVCaptureDevice?

    func start() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized: activate()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                if ok { DispatchQueue.main.async { self.activate() } }
                else { DispatchQueue.main.async { self.errorMsg = "摄像头权限被拒" } }
            }
        case .denied, .restricted:
            errorMsg = "请在 设置→隐私→相机 中允许 Swift Playgrounds"
        @unknown default: break
        }
    }

    private func activate() {
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(for: .video)
        else { errorMsg = "未找到摄像头"; return }
        device = dev

        do {
            try dev.lockForConfiguration()
            if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
            if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
            dev.unlockForConfiguration()
        } catch {
            errorMsg = "摄像头配置失败: \(error.localizedDescription)"
            return
        }

        isLive = true
        poll()

        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    private func poll() {
        guard let dev = device else { return }
        exposureSeconds = dev.exposureDuration.seconds
        iso = dev.iso
        lensF = dev.lensAperture
    }

    func stop() { timer?.invalidate() }
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

// MARK: - Meter State

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
            // Top: exposure readout (no camera preview)
            VStack(spacing: 12) {
                if let err = cam.errorMsg {
                    Image(systemName: "camera.fill").font(.system(size: 40)).foregroundColor(.gray)
                    Text(err).foregroundColor(.gray).multilineTextAlignment(.center).padding()
                } else if cam.isLive {
                    VStack(spacing: 4) {
                        Text("📷 摄像头实时参数").font(.caption).foregroundColor(.gray)
                        HStack(spacing: 24) {
                            VStack {
                                Text("手机快门").font(.caption2).foregroundColor(.gray)
                                Text("1/\(Int(1/max(0.001, cam.exposureSeconds)))")
                                    .font(.system(size: 22, weight: .bold, design: .monospaced)).foregroundColor(.orange)
                            }
                            VStack {
                                Text("手机 ISO").font(.caption2).foregroundColor(.gray)
                                Text("\(Int(cam.iso))").font(.system(size: 22, weight: .bold, design: .monospaced)).foregroundColor(.green)
                            }
                            VStack {
                                Text("手机光圈").font(.caption2).foregroundColor(.gray)
                                Text("f/\(String(format: "%.1f", cam.lensF))").font(.system(size: 22, weight: .bold, design: .monospaced)).foregroundColor(.blue)
                            }
                        }
                    }
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity)
                    .background(Color.black)
                } else {
                    ProgressView().tint(.white)
                    Text("正在激活摄像头...").font(.caption).foregroundColor(.gray)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .background(Color.black)

            if cam.isLive {
                HStack {
                    ToolBtn("⊕", "添加测光点") { s.addPoint() }
                }.padding(.vertical, 6)
            }

            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    ParamBadge("胶片光圈", fmtAperture(s.aperture))
                    ParamBadge("胶片 ISO", "\(s.filmISO)")
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
                    Text(s.points.isEmpty ? "点「添加测光点」开始" : "拖动轨道调整 Zone")
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
