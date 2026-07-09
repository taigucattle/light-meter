// ============================================
// camera.js — iPhone camera access, frame
// capture, pixel sampling, exposure params
// ============================================

/**
 * Initialize the rear camera and return the stream + video element.
 * Reads real exposure params (exposureTime, ISO) from MediaTrackSettings.
 */
export async function initCamera(videoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });

  videoElement.srcObject = stream;
  await videoElement.play();

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();

  return {
    stream,
    track,
    video: videoElement,
    settings,
    exposureTime: settings.exposureTime ?? null,
    iso: settings.iso ?? null,
  };
}

/**
 * Create an offscreen canvas for frame sampling.
 * Returns the canvas + 2D context.
 */
export function createSamplingCanvas(width = 160, height = 120) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

/**
 * Sample a circular region from the current video frame.
 * Returns { avgLinearY, avgSRGB } representing the region's luminance.
 * - avgLinearY: average in linear space (0-1), used for EV calculations
 * - avgSRGB: average 8-bit sRGB value (0-255), for display
 */
export function sampleRegion(video, ctx, canvas, cx, cy, radius) {
  // Draw current frame (downscaled)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const w = canvas.width;
  const h = canvas.height;

  // Define sampling bounds within the canvas
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(w, Math.ceil(cx + radius));
  const y1 = Math.min(h, Math.ceil(cy + radius));

  if (x1 <= x0 || y1 <= y0) return { avgLinearY: 0, avgSRGB: 0 };

  const imageData = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const data = imageData.data;

  let totalLinearY = 0;
  let totalSRGB = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r8 = data[i];
    const g8 = data[i + 1];
    const b8 = data[i + 2];

    // Linearize sRGB
    const r = srgbToLinear(r8 / 255);
    const g = srgbToLinear(g8 / 255);
    const b = srgbToLinear(b8 / 255);

    // BT.709 relative luminance
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    totalLinearY += Y;

    // Simple sRGB luminance approximation for display
    totalSRGB += 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8;

    count++;
  }

  return {
    avgLinearY: count ? totalLinearY / count : 0,
    avgSRGB: count ? totalSRGB / count : 0,
  };
}

/**
 * Sample the full frame average luminance.
 * Used as the reference point for the camera's auto-exposure target.
 */
export function sampleFullFrame(video, ctx, canvas) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let totalLinearY = 0;
  let totalSRGB = 0;
  const pixelCount = data.length / 4;

  // Sample at stride for performance (every 2nd pixel)
  const stride = 2;
  let sampled = 0;

  for (let i = 0; i < data.length; i += 4 * stride) {
    const r8 = data[i];
    const g8 = data[i + 1];
    const b8 = data[i + 2];

    const r = srgbToLinear(r8 / 255);
    const g = srgbToLinear(g8 / 255);
    const b = srgbToLinear(b8 / 255);

    totalLinearY += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    totalSRGB += 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8;
    sampled++;
  }

  return {
    avgLinearY: sampled ? totalLinearY / sampled : 0,
    avgSRGB: sampled ? totalSRGB / sampled : 0,
  };
}

/**
 * Convert 8-bit sRGB component to linear space.
 * Uses the sRGB piecewise transfer function (IEC 61966-2-1).
 */
export function srgbToLinear(c) {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert linear value back to sRGB for display.
 */
export function linearToSRGB(c) {
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Read current exposure parameters from the camera track.
 * Returns { exposureTime, iso } or nulls if unavailable.
 */
export function readExposureParams(track) {
  const settings = track.getSettings();
  return {
    exposureTime: settings.exposureTime ?? null,
    iso: settings.iso ?? null,
  };
}

/**
 * Check if the browser supports reading exposure settings.
 * iOS Safari 16+ supports this.
 */
export function supportsExposureParams() {
  return 'mediaDevices' in navigator
    && 'getUserMedia' in navigator.mediaDevices;
}

/**
 * Stop the camera stream and release resources.
 */
export function stopCamera(stream) {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
}

/**
 * Get the device's camera capabilities for display.
 * Useful for showing what the camera reports.
 */
export function getCameraInfo(track) {
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const settings = track.getSettings();
  return {
    label: track.label || 'Unknown',
    exposureTime: settings.exposureTime,
    iso: settings.iso,
    exposureTimeRange: caps.exposureTime
      ? { min: caps.exposureTime.min, max: caps.exposureTime.max }
      : null,
    isoRange: caps.iso
      ? { min: caps.iso.min, max: caps.iso.max }
      : null,
  };
}
