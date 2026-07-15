import Foundation

// MARK: - Standard Stop Sequences (1/3 stop)

let apertures: [Double] = [
    1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8,
    3.2, 3.5, 4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0,
    9.0, 10, 11, 13, 14, 16, 18, 20, 22,
    25, 29, 32, 36, 40, 45, 51, 57, 64,
]

let shutterSpeeds: [Double] = [
    1/8000, 1/6400, 1/5000, 1/4000, 1/3200, 1/2500, 1/2000, 1/1600,
    1/1250, 1/1000, 1/800, 1/640, 1/500, 1/400, 1/320, 1/250,
    1/200, 1/160, 1/125, 1/100, 1/80, 1/60, 1/50, 1/40,
    1/30, 1/25, 1/20, 1/15, 1/13, 1/10, 1/8, 1/6, 1/5, 1/4,
    1/3, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3, 4, 5, 6,
    8, 10, 13, 15, 20, 25, 30,
]

let zones = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

// MARK: - Exposure Math

/// Compute EV (at ISO 100) from aperture, shutter speed.
func evFromApertureShutter(_ aperture: Double, _ shutterSeconds: Double) -> Double {
    log2((aperture * aperture) / shutterSeconds)
}

/// Compute shutter speed from EV, aperture, ISO.
func shutterFromEV(_ ev: Double, aperture: Double, iso: Double) -> Double {
    let evISO = ev + log2(iso / 100)
    return (aperture * aperture) / pow(2, evISO)
}

/// Round value to nearest in sequence. Returns (value, deltaStops).
func roundToNearest(_ value: Double, in sequence: [Double]) -> (value: Double, delta: Double) {
    var best = sequence[0], bestDist = Double.infinity
    for v in sequence {
        let dist = abs(log2(value / v))
        if dist < bestDist { bestDist = dist; best = v }
    }
    return (best, log2(value / best))
}

/// Format shutter speed for display.
func formatShutter(_ seconds: Double) -> String {
    if seconds >= 1 {
        let n = seconds.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(seconds))
            : String(format: "%.1f", seconds)
        return n + "\""
    }
    let inv = 1 / seconds
    let rounded = Int(round(inv))
    if abs(seconds - 1 / Double(rounded)) < 0.001 { return "1/\(rounded)" }
    return "1/\(Int(round(inv)))"
}

/// Format aperture for display.
func formatAperture(_ aperture: Double) -> String {
    aperture >= 2
        ? "f/" + (aperture.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(aperture))
            : String(format: "%.1f", aperture))
        : "f/" + String(format: "%.1f", aperture)
}

// MARK: - Zone System

/// Given a set of metering points (each with luminance ratio to full-frame avg),
/// compute each point's zoneOffset (stops from Zone V).
func analyzePoints(pointLuminances: [Float], fullFrameLuminance: Float) -> [Double] {
    guard fullFrameLuminance > 0 else { return pointLuminances.map { _ in 0 } }
    return pointLuminances.map { pt in
        let ratio = Double(pt) / Double(fullFrameLuminance)
        return log2(max(1.0 / 1024, min(1024, ratio)))
    }
}

/// Compute the reference shutter (Zone V) from camera exposure params
/// converted to user's film settings.
func referenceShutter(phoneExposureSeconds: Double,
                      phoneISO: Float,
                      phoneAperture: Float,
                      filmAperture: Double,
                      filmISO: Int) -> Double {
    guard phoneExposureSeconds > 0 else {
        // Sunny 16 fallback
        let isoRel = Double(filmISO) / 100
        return (filmAperture * filmAperture) / (32768 * isoRel)
    }
    let ratio = filmAperture / Double(phoneAperture)
    return phoneExposureSeconds * (ratio * ratio) * (Double(phoneISO) / Double(filmISO))
}

// MARK: - Metering Point Model

struct MeteringPoint: Identifiable {
    let id = UUID()
    var xRatio: CGFloat  // 0–1 position in viewfinder
    var yRatio: CGFloat
    var luminance: Float // avg linear Y in sampled region
}
