// ============================================
// camera.js — iPhone camera access, frame
// capture, pixel sampling, exposure params
// ============================================

/**
 * Initialize the rear camera.
 * Tries ImageCapture API first, then MediaTrackSettings,
 * to read real exposureTime and ISO.
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

  // Method 1: ImageCapture.getPhotoSettings() — iOS may support this
  let exposureTime = null;
  let iso = null;
  let method = 'none';

  if (typeof ImageCapture !== 'undefined') {
    try {
      const capturer = new ImageCapture(track);
      const photoSettings = await capturer.getPhotoSettings();
      if (photoSettings) {
        exposureTime = photoSettings.exposureTime ?? null;
        iso = photoSettings.iso ?? null;
        if (exposureTime) method = 'ImageCapture';
      }
    } catch (e) {
      // ImageCapture not supported or threw
    }
  }

  // Method 2: MediaStreamTrack.getSettings() with polling
  if (!exposureTime) {
    let settings = track.getSettings();
    exposureTime = settings.exposureTime ?? null;
    iso = settings.iso ?? null;

    for (let i = 0; i < 5 && !exposureTime; i++) {
      await new Promise(r => setTimeout(r, 300));
      settings = track.getSettings();
      exposureTime = settings.exposureTime ?? null;
      iso = settings.iso ?? null;
    }
    if (exposureTime) method = 'getSettings';
  }

  return {
    stream,
    track,
    video: videoElement,
    exposureTime,
    iso,
    method,
  };
}

/**
 * Create an offscreen canvas for frame sampling.
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
 */
export function sampleRegion(video, ctx, canvas, cx, cy, radius) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const w = canvas.width, h = canvas.height;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(w, Math.ceil(cx + radius));
  const y1 = Math.min(h, Math.ceil(cy + radius));

  if (x1 <= x0 || y1 <= y0) return { avgLinearY: 0, avgSRGB: 0 };

  const imageData = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const data = imageData.data;

  let totalLinearY = 0, totalSRGB = 0, count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r8 = data[i], g8 = data[i + 1], b8 = data[i + 2];
    const r = srgbToLinear(r8 / 255);
    const g = srgbToLinear(g8 / 255);
    const b = srgbToLinear(b8 / 255);
    totalLinearY += 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
 */
export function sampleFullFrame(video, ctx, canvas) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let totalLinearY = 0, totalSRGB = 0, sampled = 0;
  const stride = 2;

  for (let i = 0; i < data.length; i += 4 * stride) {
    const r8 = data[i], g8 = data[i + 1], b8 = data[i + 2];
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

export function srgbToLinear(c) {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSRGB(c) {
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function readExposureParams(track) {
  const settings = track.getSettings();
  return {
    exposureTime: settings.exposureTime ?? null,
    iso: settings.iso ?? null,
  };
}

export function supportsExposureParams() {
  return 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

export function getCameraInfo(track) {
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const settings = track.getSettings();
  return {
    label: track.label || 'Unknown',
    exposureTime: settings.exposureTime,
    iso: settings.iso,
    exposureTimeRange: caps.exposureTime ? { min: caps.exposureTime.min, max: caps.exposureTime.max } : null,
    isoRange: caps.iso ? { min: caps.iso.min, max: caps.iso.max } : null,
  };
}
