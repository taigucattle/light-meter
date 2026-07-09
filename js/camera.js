// ============================================
// camera.js — Camera access, frame sampling,
// exposure params via EXIF from takePhoto()
// ============================================

import { readExifFromCamera } from './exif.js';

/**
 * Initialize rear camera. Reads exposure params from
 * JPEG EXIF (100% reliable on iOS) as primary method.
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

  // Primary: read EXIF from a captured photo (100% reliable on iOS)
  let exposureTime = null, iso = null, method = 'none';

  try {
    const exif = await readExifFromCamera(track);
    if (exif && exif.exposureTime) {
      exposureTime = exif.exposureTime;
      iso = exif.iso;
      method = 'EXIF';
    }
  } catch (e) { /* EXIF capture failed */ }

  // Fallback: getSettings() polling
  if (!exposureTime) {
    for (let i = 0; i < 5 && !exposureTime; i++) {
      await new Promise(r => setTimeout(r, 300));
      const s = track.getSettings();
      exposureTime = s.exposureTime ?? null;
      iso = s.iso ?? null;
    }
    if (exposureTime) method = 'getSettings';
  }

  return { stream, track, video: videoElement, exposureTime, iso, method };
}

export function createSamplingCanvas(width = 160, height = 120) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) };
}

export function sampleRegion(video, ctx, canvas, cx, cy, radius) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const w = canvas.width, h = canvas.height;
  const x0 = Math.max(0, Math.floor(cx - radius)), y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(w, Math.ceil(cx + radius)), y1 = Math.min(h, Math.ceil(cy + radius));
  if (x1 <= x0 || y1 <= y0) return { avgLinearY: 0, avgSRGB: 0 };
  const id = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = id.data;
  let ly = 0, sr = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = srgbToLinear(d[i] / 255), g = srgbToLinear(d[i + 1] / 255), b = srgbToLinear(d[i + 2] / 255);
    ly += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sr += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++;
  }
  return { avgLinearY: n ? ly / n : 0, avgSRGB: n ? sr / n : 0 };
}

export function sampleFullFrame(video, ctx, canvas) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height), d = id.data;
  let ly = 0, n = 0;
  for (let i = 0; i < d.length; i += 8) {
    ly += 0.2126 * srgbToLinear(d[i] / 255) + 0.7152 * srgbToLinear(d[i + 1] / 255) + 0.0722 * srgbToLinear(d[i + 2] / 255);
    n++;
  }
  return { avgLinearY: n ? ly / n : 0, avgSRGB: 0 };
}

export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

export function readExposureParams(track) {
  const s = track.getSettings();
  return { exposureTime: s.exposureTime ?? null, iso: s.iso ?? null };
}

export function stopCamera(stream) { if (stream) stream.getTracks().forEach(t => t.stop()); }
