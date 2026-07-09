// ============================================
// app.js — Main controller
// Uses camera's REAL exposure params as global
// reference. Zone scale shows shutter per zone.
// ============================================

import * as Camera from './camera.js';
import * as LM from './lightmeter.js';
import * as UI from './ui.js';
import { getFilm } from './films.js';

// ── Application State ──
const state = {
  // Camera
  stream: null,
  track: null,
  video: null,
  sampleCanvas: null,
  sampleCtx: null,
  cameraReady: false,

  // REAL exposure params from camera (updated every frame)
  cameraExposureTime: null,    // e.g., 1/120
  cameraISO: null,             // e.g., 200

  // Full frame average luminance
  fullFrameAvgY: 0,

  // User settings
  format: '135',
  focalMm: 50,
  filmId: 'hp5',
  aperture: 8,
  iso: 400,
  filterId: 'none',
  filterStops: 0,

  // Metering points
  points: [],            // [{ xRatio, yRatio, avgLinearY, avgSRGB }]
  pointAnalyses: [],     // [{ zoneOffset, relativeEV, luminanceRatio }]

  // Zone scale shift (user-controlled via drag)
  shiftStops: 0,

  // UI toggles
  previewEnabled: false,
  zebraEnabled: true,

  // Calibration: stores the phone's effective aperture constant.
  // Default is f/1.8 (typical iPhone main camera).
  // phoneFNumber = 1.8 means the calibration assumes iPhone f/1.8.
  phoneFNumber: 1.8,
  calibrated: false,
  calibrationDate: null,

  // Metering loop
  meteringInterval: null,
};

// ── DOM refs ──
const dom = {
  viewfinder: document.getElementById('viewfinder'),
  cameraPreview: document.getElementById('camera-preview'),
  frameLines: document.getElementById('frame-lines'),
  meteringPoints: document.getElementById('metering-points'),
  zebraOverlay: document.getElementById('zebra-overlay'),
  zebraCtx: null,
  zoneMarkers: document.getElementById('zone-markers'),
  zoneInfo: document.getElementById('zone-info'),
  zoneTrack: document.getElementById('zone-track'),
};

// ── Init ──
async function init() {
  UI.populateSettings();
  dom.zebraCtx = dom.zebraOverlay.getContext('2d');
  bindEvents();

  try { await startCamera(); }
  catch (err) {
    console.error('Camera failed:', err);
    document.getElementById('viewfinder-hint').textContent = '摄像头不可用: ' + err.message;
    // Continue anyway — UI works without camera
  }

  loadCalibration();
  applyFilmSelection();

  // Show initial shutter tape immediately
  const initRef = computeReferenceShutter();
  UI.renderShutterTape(initRef);

  startMeteringLoop();
  UI.drawFrameLines(dom.frameLines, state.format, state.focalMm);
  registerSW();
}

// ── Camera ──
async function startCamera() {
  const cam = await Camera.initCamera(dom.cameraPreview);
  state.stream = cam.stream;
  state.track = cam.track;
  state.video = cam.video;
  state.cameraExposureTime = cam.exposureTime;
  state.cameraISO = cam.iso;
  const { canvas, ctx } = Camera.createSamplingCanvas(320, 240);
  state.sampleCanvas = canvas;
  state.sampleCtx = ctx;
  state.cameraReady = true;

  console.log('Camera:', {
    exposureTime: cam.exposureTime,
    iso: cam.iso,
    label: cam.track.label,
  });

  if (cam.exposureTime) {
    UI.showViewfinderHint('曝光参数已读取 ✓ · 点击画面测光', 2500);
  } else {
    UI.showViewfinderHint('未读到曝光参数 · 请先校准 ⚙', 0);
  }
}

// ── Metering loop (5 Hz) ──
function startMeteringLoop() {
  state.meteringInterval = setInterval(() => {
    // Camera-dependent operations (skip if no camera)
    if (state.cameraReady) {
      const params = Camera.readExposureParams(state.track);
      if (params.exposureTime) state.cameraExposureTime = params.exposureTime;
      if (params.iso) state.cameraISO = params.iso;

      const fullFrame = Camera.sampleFullFrame(state.video, state.sampleCtx, state.sampleCanvas);
      state.fullFrameAvgY = fullFrame.avgLinearY;

      for (const pt of state.points) {
        const w = state.sampleCanvas.width, h = state.sampleCanvas.height;
        const cx = pt.xRatio * w, cy = pt.yRatio * h;
        const radius = Math.min(w, h) * 0.04;
        const r = Camera.sampleRegion(state.video, state.sampleCtx, state.sampleCanvas, cx, cy, radius);
        pt.avgLinearY = r.avgLinearY;
        pt.avgSRGB = r.avgSRGB;
      }

      if (state.points.length > 0 && state.fullFrameAvgY > 0) {
        state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
      } else {
        state.pointAnalyses = [];
      }
    }

    // Always update display (works with or without camera)
    const refShutter = computeReferenceShutter();

    // Shutter tape is fixed; only re-render when refShutter changes
    if (refShutter !== state._lastRefShutter) {
      UI.renderShutterTape(refShutter);
      state._lastRefShutter = refShutter;
    }

    // Tape slides with shiftStops
    UI.updateTapeTranslation(state.shiftStops);

    // Markers are on the tape, positioned by brightness only
    UI.renderZoneScale(dom.zoneMarkers, state.pointAnalyses, state.shiftStops, dom.zoneInfo);

    updateMainShutterDisplay(refShutter);

    // Zebra only with camera
    if (state.cameraReady && state.zebraEnabled && state.points.length > 0) {
      updateZebra();
    } else if (!state.cameraReady || !state.zebraEnabled) {
      UI.clearZebra(dom.zebraCtx, dom.zebraOverlay.width, dom.zebraOverlay.height);
    }

    if (state.previewEnabled) {
      UI.updateExposurePreview(dom.cameraPreview, state.shiftStops);
    }
  }, 200);
}

// ── Reference shutter: camera's AE choice, adjusted for film ──

/**
 * Compute the reference shutter speed (seconds) that places the
 * full-frame average at Zone V, converted to the user's film settings.
 *
 * Camera AE chooses (exposureTime, ISO_phone) for aperture f_phone.
 * We want shutter for user's (aperture, film_ISO).
 *
 * Light per unit area: ∝ t / f² * ISO
 * For same scene luminance:
 *   film_shutter / film_aperture² * film_ISO = phone_shutter / phone_f² * phone_ISO
 *
 * film_shutter = phone_shutter * (film_aperture² / phone_f²) * (phone_ISO / film_ISO)
 *
 * We store phoneFNumber (default 1.8 = iPhone main lens).
 */
function computeReferenceShutter() {
  // Use camera exposure params if available.
  // Without camera, use Sunny 16 reference: EV 15 at ISO 100
  if (!state.cameraExposureTime || state.cameraExposureTime <= 0) {
    // Sunny 16: EV = 15 at ISO 100
    // t = N² / (2^EV * ISO/100) = N² / (2^15 * isoRel)
    const isoRel = state.iso / 100;
    return (state.aperture * state.aperture) / (32768 * isoRel);
  }

  const phoneT = state.cameraExposureTime;
  const phoneISO = state.cameraISO || 100;
  const filmISO = state.iso;

  // film_shutter = phoneT * (film_N/phone_N)² * (phoneISO/filmISO)
  const ratio = state.aperture / state.phoneFNumber;
  let filmShutter = phoneT * (ratio * ratio) * (phoneISO / filmISO);

  // Clamp to reasonable range
  filmShutter = Math.max(1 / 32000, Math.min(120, filmShutter));

  return filmShutter;
}

// ── Main shutter display ──

function updateMainShutterDisplay(refShutter) {
  if (!refShutter || refShutter <= 0) {
    UI.updateShutterDisplay('--', '等待曝光参数...');
    return;
  }

  // Apply user's zone shift: the shutter for Zone V
  const zoneVShutter = refShutter * Math.pow(2, state.shiftStops);

  // Apply filter compensation only (reciprocity removed as requested)
  const filterStops = state.filterStops;
  let finalShutter = zoneVShutter * Math.pow(2, filterStops);

  // Round to nearest standard stop (always)
  const rounded = LM.roundToNearest(finalShutter, LM.SHUTTER_SPEEDS);
  const shutterStr = LM.formatShutter(rounded.value);

  // Build info
  const parts = [];
  if (state.shiftStops !== 0) {
    parts.push(`偏移 ${state.shiftStops > 0 ? '+' : ''}${state.shiftStops.toFixed(1)} 档`);
  }
  if (filterStops > 0) parts.push(`滤镜 +${filterStops.toFixed(1)} 档`);
  if (Math.abs(rounded.deltaStops) > 0.03) {
    parts.push(`靠档 ${rounded.deltaStops > 0 ? '+' : ''}${rounded.deltaStops.toFixed(2)} EV`);
  }
  const compStr = parts.join(' · ') || null;

  UI.updateShutterDisplay(shutterStr, compStr || '');
}

// ── Zebra ──

function updateZebra() {
  const film = getFilm(state.filmId);
  const filmDR = film ? film.dynamicRange : 10;

  const ctx = state.sampleCtx;
  const canvas = state.sampleCanvas;
  ctx.drawImage(state.video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const vfRect = dom.viewfinder.getBoundingClientRect();
  dom.zebraOverlay.width = vfRect.width;
  dom.zebraOverlay.height = vfRect.height;
  const zebraCtx = dom.zebraCtx;
  zebraCtx.clearRect(0, 0, dom.zebraOverlay.width, dom.zebraOverlay.height);

  if (!state.pointAnalyses || state.pointAnalyses.length === 0) return;

  const data = imageData.data;
  const srcW = canvas.width;
  const srcH = canvas.height;
  const dstW = dom.zebraOverlay.width;
  const dstH = dom.zebraOverlay.height;
  const scaleX = dstW / srcW;
  const scaleY = dstH / srcH;

  const halfDR = filmDR / 2;
  const thresholdLow = -halfDR + state.shiftStops;
  const thresholdHigh = halfDR + state.shiftStops;

  for (let sy = 0; sy < srcH; sy += 4) {
    for (let sx = 0; sx < srcW; sx += 4) {
      const idx = (sy * srcW + sx) * 4;
      if (idx >= data.length) continue;

      const r8 = data[idx], g8 = data[idx + 1], b8 = data[idx + 2];
      const linearY = Camera.srgbToLinear(r8 / 255) * 0.2126
        + Camera.srgbToLinear(g8 / 255) * 0.7152
        + Camera.srgbToLinear(b8 / 255) * 0.0722;

      const relativeEV = Math.log2(Math.max(0.001, linearY / Math.max(0.001, state.fullFrameAvgY)));

      if (relativeEV < thresholdLow) {
        if ((sx + sy) % 8 < 4) {
          zebraCtx.fillStyle = 'rgba(30, 80, 255, 0.6)';
          zebraCtx.fillRect(sx * scaleX, sy * scaleY, 4 * scaleX, 4 * scaleY);
        }
      } else if (relativeEV > thresholdHigh) {
        if ((sx - sy) % 8 < 4) {
          zebraCtx.fillStyle = 'rgba(255, 40, 0, 0.6)';
          zebraCtx.fillRect(sx * scaleX, sy * scaleY, 4 * scaleX, 4 * scaleY);
        }
      }
    }
  }
}

// ── Zone scale dragging ──

/**
 * Compute the allowed range for shiftStops.
 * All metering points must stay within Zone 0 to Zone X after shift.
 */
function getShiftLimits() {
  if (!state.pointAnalyses || state.pointAnalyses.length === 0) {
    return { min: -5, max: 5 };
  }
  let minShift = -Infinity;
  let maxShift = Infinity;
  for (const pt of state.pointAnalyses) {
    // 0 ≤ 5 + zoneOffset + shift ≤ 10
    // → -5 - zoneOffset ≤ shift ≤ 5 - zoneOffset
    const lo = -5 - pt.zoneOffset;
    const hi = 5 - pt.zoneOffset;
    minShift = Math.max(minShift, lo);
    maxShift = Math.min(maxShift, hi);
  }
  return { min: minShift, max: maxShift };
}

function clampShift(value) {
  const limits = getShiftLimits();
  return Math.max(limits.min, Math.min(limits.max, value));
}

function bindZoneScaleDrag() {
  const track = dom.zoneTrack;
  let dragging = false;
  let startX = 0, startShift = 0;

  function onStart(e) {
    if (state.points.length === 0) return;
    dragging = true;
    startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    startShift = state.shiftStops;
    track.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const deltaX = clientX - startX;
    const trackW = track.getBoundingClientRect().width;
    const stopsPerPixel = 10 / trackW;
    state.shiftStops = clampShift(startShift + deltaX * stopsPerPixel);
  }

  function onEnd() {
    dragging = false;
    track.style.cursor = state.points.length > 0 ? 'grab' : '';
  }

  track.addEventListener('pointerdown', onStart);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onEnd);
  track.addEventListener('pointerleave', onEnd);
  track.addEventListener('pointercancel', onEnd);
  track.addEventListener('touchstart', (e) => {
    if (state.points.length > 0) e.preventDefault();
  }, { passive: false });
}

// ── Viewfinder tap → metering point ──

function bindViewfinderTap() {
  dom.viewfinder.addEventListener('click', (e) => {
    if (e.target.closest('.metering-point')) return;

    const rect = dom.viewfinder.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;

    const sampleW = state.sampleCanvas.width;
    const sampleH = state.sampleCanvas.height;
    const cx = xRatio * sampleW;
    const cy = yRatio * sampleH;
    const radius = Math.min(sampleW, sampleH) * 0.04;
    const sample = Camera.sampleRegion(state.video, state.sampleCtx, state.sampleCanvas, cx, cy, radius);

    const point = { xRatio, yRatio, avgLinearY: sample.avgLinearY, avgSRGB: sample.avgSRGB };
    state.points.push(point);
    const idx = state.points.length - 1;
    UI.addMeteringPoint(dom.meteringPoints, xRatio, yRatio, idx);

    if (state.fullFrameAvgY > 0) {
      state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
    }

    UI.showViewfinderHint(`P${idx + 1} 已添加 · ${state.points.length} 个测光点`, 2000);

    // First point: auto-center it on Zone V (within limits)
    if (state.points.length === 1 && state.pointAnalyses.length > 0) {
      state.shiftStops = clampShift(-state.pointAnalyses[0].zoneOffset);
    }
  });

  // Long press → remove point
  dom.meteringPoints.addEventListener('longpress', (e) => {
    const wrapper = e.target.closest('.metering-point');
    if (!wrapper) return;
    const index = parseInt(wrapper.dataset.index);
    if (isNaN(index) || index < 0 || index >= state.points.length) return;

    state.points.splice(index, 1);
    UI.removeMeteringPoint(dom.meteringPoints, wrapper);

    const allMarkers = dom.meteringPoints.querySelectorAll('.metering-point');
    allMarkers.forEach((m, i) => {
      m.dataset.index = i;
      const label = m.querySelector('.metering-point-label');
      if (label) label.textContent = 'P' + (i + 1);
    });

    if (state.points.length > 0 && state.fullFrameAvgY > 0) {
      state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
      state.shiftStops = clampShift(state.shiftStops);
    } else {
      state.pointAnalyses = [];
      state.shiftStops = 0;
    }
    UI.showViewfinderHint(`已删除 · 剩 ${state.points.length} 点`, 1500);
  });
}

// ── Button handlers ──

function bindButtonEvents() {
  document.getElementById('btn-preview').addEventListener('click', () => {
    state.previewEnabled = !state.previewEnabled;
    document.getElementById('btn-preview').classList.toggle('active', state.previewEnabled);
    if (!state.previewEnabled) UI.clearExposurePreview(dom.cameraPreview);
  });

  document.getElementById('btn-zebra').addEventListener('click', () => {
    state.zebraEnabled = !state.zebraEnabled;
    document.getElementById('btn-zebra').classList.toggle('active', state.zebraEnabled);
    if (!state.zebraEnabled) UI.clearZebra(dom.zebraCtx, dom.zebraOverlay.width, dom.zebraOverlay.height);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    state.points = [];
    state.pointAnalyses = [];
    state.shiftStops = clampShift(0);
    UI.clearMeteringPoints(dom.meteringPoints);
    UI.clearZebra(dom.zebraCtx, dom.zebraOverlay.width, dom.zebraOverlay.height);
    UI.clearZoneScale(dom.zoneMarkers, dom.zoneInfo);
    UI.clearTapeTranslation();
    UI.updateShutterDisplay('--', '');
    UI.showViewfinderHint('已清除所有测光点', 1500);
  });

  document.getElementById('btn-undo').addEventListener('click', () => {
    if (state.points.length === 0) return;
    const removedIndex = state.points.length - 1;
    state.points.pop();
    const marker = dom.meteringPoints.querySelector(`.metering-point[data-index="${removedIndex}"]`);
    if (marker) marker.remove();
    if (state.points.length > 0 && state.fullFrameAvgY > 0) {
      state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
      state.shiftStops = clampShift(state.shiftStops);
    } else {
      state.pointAnalyses = [];
      state.shiftStops = 0;
    }
    UI.showViewfinderHint('已撤销 · 剩 ' + state.points.length + ' 点', 1500);
  });

  // Calibration
  document.getElementById('btn-calibrate').addEventListener('click', () => {
    document.getElementById('calibration-modal').classList.remove('hidden');
    updateCalibrationUI();
  });
  document.getElementById('btn-cal-close').addEventListener('click', () => {
    document.getElementById('calibration-modal').classList.add('hidden');
  });
  document.getElementById('btn-cal-do').addEventListener('click', () => doCalibrate(15));
  document.getElementById('btn-cal-manual').addEventListener('click', () => {
    document.getElementById('cal-manual-input').classList.toggle('hidden');
  });
  document.getElementById('btn-cal-manual-do').addEventListener('click', () => {
    const ev = parseFloat(document.getElementById('input-ref-ev').value);
    if (!isNaN(ev) && ev >= -10 && ev <= 25) doCalibrate(ev);
  });
}

// ── Settings change handlers ──

function bindSettingsEvents() {
  document.getElementById('select-format').addEventListener('change', (e) => {
    state.format = e.target.value;
    UI.drawFrameLines(dom.frameLines, state.format, state.focalMm);
  });

  document.getElementById('select-focal').addEventListener('change', (e) => {
    state.focalMm = parseInt(e.target.value);
    UI.drawFrameLines(dom.frameLines, state.format, state.focalMm);
  });

  document.getElementById('select-film').addEventListener('change', (e) => {
    state.filmId = e.target.value;
    applyFilmSelection();
  });

  document.getElementById('select-aperture').addEventListener('change', (e) => {
    state.aperture = parseFloat(e.target.value);
  });

  document.getElementById('input-iso').addEventListener('change', (e) => {
    const v = parseInt(e.target.value);
    if (!isNaN(v) && v >= 6 && v <= 25600) state.iso = v;
  });

  document.getElementById('select-filter').addEventListener('change', (e) => {
    state.filterId = e.target.value;
    const filter = LM.FILTERS.find(f => f.id === e.target.value);
    state.filterStops = filter ? filter.stops : 0;
  });
}

function applyFilmSelection() {
  const film = getFilm(state.filmId);
  if (film) {
    state.iso = film.iso;
    document.getElementById('input-iso').value = film.iso;
  }
}

// ── Calibration ──

/**
 * Calibrate: user provides reference EV (e.g., 15 for Sunny 16).
 * We solve for the phone's effective f-number:
 *   phone_F² = phone_exposureTime * phone_ISO * 2^EV_ref / 100
 */
function doCalibrate(refEV) {
  if (!state.cameraExposureTime) {
    alert('无法读取摄像头曝光参数。请确保已授权摄像头访问。');
    return;
  }

  const N = state.aperture;
  const filmISO = state.iso;
  const tCam = state.cameraExposureTime;
  const isoCam = state.cameraISO || 100;

  // Formula: film_shutter = phoneT * (film_N/phone_N)² * (phoneISO/filmISO)
  // At calibration: film_shutter should = N² / (2^EV_ref * ISO_film/100)
  // Solve for phone_N:
  //   phone_N² = phoneT * phoneISO * 2^EV_ref / 100
  const phoneNSq = tCam * isoCam * Math.pow(2, refEV) / 100;
  const phoneF = Math.sqrt(phoneNSq);

  if (phoneF <= 0.5 || phoneF > 32) {
    alert(`校准异常 (phone_f=${phoneF.toFixed(2)})。请确认:\n- 光圈: f/${N}\n- ISO: ${filmISO}\n- 参考EV: ${refEV}\n- 摄像头快门: ${LM.formatShutter(tCam)}`);
    return;
  }

  state.phoneFNumber = phoneF;
  state.calibrated = true;
  state.calibrationDate = new Date().toISOString();

  saveCalibration();
  updateCalibrationUI();
  document.getElementById('calibration-modal').classList.add('hidden');

  const tUser = (N * N) / (Math.pow(2, refEV) * (filmISO / 100));
  UI.showViewfinderHint(
    `校准完成: EV ${refEV} · 手机光圈 f/${phoneF.toFixed(1)} · 参考快门 ${LM.formatShutter(tUser)}`,
    4000
  );
}

function saveCalibration() {
  try {
    localStorage.setItem('lightmeter_cal3', JSON.stringify({
      phoneFNumber: state.phoneFNumber,
      date: state.calibrationDate,
    }));
  } catch (e) { /* ignore */ }
}

function loadCalibration() {
  try {
    const raw = localStorage.getItem('lightmeter_cal3');
    if (raw) {
      const data = JSON.parse(raw);
      if (data.phoneFNumber) state.phoneFNumber = data.phoneFNumber;
      state.calibrated = true;
      state.calibrationDate = data.date;
    }
  } catch (e) { /* ignore */ }
}

function updateCalibrationUI() {
  const el = document.getElementById('calibration-status');
  if (state.calibrated) {
    el.textContent = `已校准 · 手机光圈 f/${state.phoneFNumber.toFixed(1)} · ${state.calibrationDate || ''}`;
  } else {
    el.textContent = `尚未校准（默认手机光圈 f/${state.phoneFNumber.toFixed(1)}）`;
  }
}

// ── Service Worker ──

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── Bind all events ──

function bindEvents() {
  bindZoneScaleDrag();
  bindViewfinderTap();
  bindButtonEvents();
  bindSettingsEvents();

  window.addEventListener('resize', () => {
    UI.drawFrameLines(dom.frameLines, state.format, state.focalMm);
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => UI.drawFrameLines(dom.frameLines, state.format, state.focalMm), 300);
  });
}

// ── Start ──
init().catch(err => {
  console.error('Init error:', err);
  document.getElementById('viewfinder-hint').textContent = '初始化失败: ' + err.message;
});
