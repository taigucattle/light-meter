import AVFoundation
import CoreImage
import SwiftUI

/// Manages the camera: live preview, real exposure params, frame sampling.
class CameraManager: NSObject, ObservableObject {
    // Published: real camera parameters (updated ~10 Hz)
    @Published var exposureDuration: CMTime = .invalid
    @Published var iso: Float = 0
    @Published var aperture: Float = 0       // lens aperture (f-number)
    @Published var isRunning = false
    @Published var errorMessage: String?

    // Full-frame average luminance (linear, 0–1)
    @Published var fullFrameLuminance: Float = 0.18

    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "camera.lightmeter", qos: .userInteractive)

    // For pixel sampling from video frames
    private var ciContext = CIContext()
    private var lastSampleTime: TimeInterval = 0
    private let sampleInterval: TimeInterval = 0.1 // 10 Hz

    override init() {
        super.init()
        output.setSampleBufferDelegate(self, queue: queue)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    }

    func start() {
        checkPermission { granted in
            guard granted else {
                DispatchQueue.main.async { self.errorMessage = "需要摄像头权限" }
                return
            }
            self.configureSession()
            DispatchQueue.global(qos: .userInitiated).async {
                self.session.startRunning()
                DispatchQueue.main.async { self.isRunning = true }
            }
        }
    }

    func stop() {
        session.stopRunning()
        DispatchQueue.main.async { self.isRunning = false }
    }

    private func checkPermission(completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video, completionHandler: completion)
        default: completion(false)
        }
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video)
        else {
            session.commitConfiguration()
            errorMessage = "无法访问后置摄像头"
            return
        }

        // Configure for auto-exposure
        try? device.lockForConfiguration()
        device.focusMode = .continuousAutoFocus
        device.exposureMode = .continuousAutoExposure
        device.unlockForConfiguration()

        guard let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else {
            session.commitConfiguration()
            errorMessage = "无法添加摄像头输入"
            return
        }
        session.addInput(input)
        session.commitConfiguration()
    }

    /// Read the latest exposure params from the active camera device.
    func refreshExposureParams() {
        guard let device = (session.inputs.first as? AVCaptureDeviceInput)?.device else { return }
        DispatchQueue.main.async {
            self.exposureDuration = device.exposureDuration
            self.iso = device.iso
            self.aperture = device.lensAperture
        }
    }
}

// MARK: - Video frame processing
extension CameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastSampleTime >= sampleInterval else { return }
        lastSampleTime = now

        // Refresh device exposure params each frame
        refreshExposureParams()

        // Sample pixel luminance from frame
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let luminance = averageLuminance(from: pixelBuffer)
        DispatchQueue.main.async {
            self.fullFrameLuminance = luminance
        }
    }

    /// Compute the average linear luminance of a CVPixelBuffer.
    private func averageLuminance(from pixelBuffer: CVPixelBuffer) -> Float {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer)?
            .assumingMemoryBound(to: UInt8.self)
        else { return 0.18 }

        var totalLuminance: Float = 0
        var samples = 0
        let step = 4 // sample every 4th pixel for performance

        for y in stride(from: 0, to: height, by: step) {
            for x in stride(from: 0, to: width, by: step) {
                let offset = y * bytesPerRow + x * 4
                let b = base[offset]
                let g = base[offset + 1]
                let r = base[offset + 2]

                // sRGB → linear, BT.709 weights
                let rLin = srgbToLinear(Float(r) / 255)
                let gLin = srgbToLinear(Float(g) / 255)
                let bLin = srgbToLinear(Float(b) / 255)
                totalLuminance += 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin
                samples += 1
            }
        }

        return samples > 0 ? totalLuminance / Float(samples) : 0.18
    }

    private func srgbToLinear(_ c: Float) -> Float {
        c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
}
