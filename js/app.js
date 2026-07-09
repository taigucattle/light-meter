// ============================================
// app.js — Main controller
// Pure luminance calibration: no iOS exposure
// params needed. User calibrates at known EV.
// ============================================

import * as Camera from './camera.js';
import * as LM from './lightmeter.js';
import * as UI from './ui.js';
import { getFilm } from './films.js';

// ── State ──
const state = {
  stream: null, track: null, video: null,
  sampleCanvas: null, sampleCtx: null,
  cameraReady: false,

  // Luminance-based metering (no iOS exposure params needed)
  fullFrameAvgY: 0,

  // User settings
  format: '135', focalMm: 50, filmId: 'hp5',
  aperture: 8, iso: 400,
  filterId: 'none', filterStops: 0,

  // Metering points
  points: [],
  pointAnalyses: [],

  // Zone shift
  shiftStops: 0,

  // UI toggles
  previewEnabled: false, zebraEnabled: true,

  // CALIBRATION: stores fullFrameAvgY at known reference EV
  calibrated: false,
  refEV: 15,
  refLuminance: null,   // fullFrameAvgY at calibration
  calibrationDate: null,

  meteringInterval: null,
  _lastRefShutter: null,
};

// ── DOM ──
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
    document.getElementById('viewfinder-hint').textContent = '摄像头不可用: ' + err.message;
    return;
  }

  loadCalibration();
  applyFilmSelection();
  UI.renderShutterTape(computeReferenceShutter());
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
  const { canvas, ctx } = Camera.createSamplingCanvas(320, 240);
  state.sampleCanvas = canvas;
  state.sampleCtx = ctx;
  state.cameraReady = true;

  UI.showViewfinderHint('✓ 摄像头就绪 · 晴天请先校准 ⚙', 3000);
}

// ── Reference shutter (pure luminance, calibration-based) ──

function computeReferenceShutter() {
  // Without calibration: use Sunny 16 estimate
  if (!state.calibrated || !state.refLuminance || state.refLuminance <= 0) {
    return sunny16Estimate();
  }

  // With calibration: compare current luminance to reference
  if (state.fullFrameAvgY <= 0) return sunny16Estimate();

  // relativeEV measures how many stops the current scene differs from calibration
  const ratio = state.fullFrameAvgY / state.refLuminance;
  const relativeEV = Math.log2(Math.max(0.001, Math.min(1000, ratio)));
  const sceneEV = state.refEV + relativeEV;

  // Shutter for Zone V at this EV
  return (state.aperture * state.aperture) / (Math.pow(2, sceneEV) * state.iso / 100);
}

function sunny16Estimate() {
  const isoRel = state.iso / 100;
  return (state.aperture * state.aperture) / (32768 * isoRel);
}

// ── Metering loop ──
function startMeteringLoop() {
  state.meteringInterval = setInterval(() => {
    if (state.cameraReady) {
      const fullFrame = Camera.sampleFullFrame(state.video, state.sampleCtx, state.sampleCanvas);
      state.fullFrameAvgY = fullFrame.avgLinearY;

      for (const pt of state.points) {
        const w = state.sampleCanvas.width, h = state.sampleCanvas.height;
        const cx = pt.xRatio * w, cy = pt.yRatio * h;
        const r = Camera.sampleRegion(state.video, state.sampleCtx, state.sampleCanvas, cx, cy, Math.min(w, h) * 0.04);
        pt.avgLinearY = r.avgLinearY; pt.avgSRGB = r.avgSRGB;
      }

      if (state.points.length > 0 && state.fullFrameAvgY > 0) {
        state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
      } else {
        state.pointAnalyses = [];
      }
    }

    const refShutter = computeReferenceShutter();
    if (refShutter !== state._lastRefShutter) {
      UI.renderShutterTape(refShutter);
      state._lastRefShutter = refShutter;
    }
    UI.updateTapeTranslation(state.shiftStops);
    UI.renderZoneScale(dom.zoneMarkers, state.pointAnalyses, state.shiftStops, dom.zoneInfo);
    updateMainShutterDisplay(refShutter);

    if (state.cameraReady && state.zebraEnabled && state.points.length > 0) updateZebra();
    else UI.clearZebra(dom.zebraCtx, dom.zebraOverlay.width, dom.zebraOverlay.height);

    if (state.previewEnabled) UI.updateExposurePreview(dom.cameraPreview, state.shiftStops);
  }, 200);
}

// ── Main shutter display ──
function updateMainShutterDisplay(refShutter) {
  if (!refShutter || refShutter <= 0) {
    UI.updateShutterDisplay('--', '');
    return;
  }
  const zoneVShutter = refShutter * Math.pow(2, state.shiftStops);
  let finalShutter = zoneVShutter * Math.pow(2, state.filterStops);
  const rounded = LM.roundToNearest(finalShutter, LM.SHUTTER_SPEEDS);

  const parts = [];
  if (state.shiftStops !== 0) parts.push(`偏移 ${state.shiftStops > 0 ? '+' : ''}${state.shiftStops.toFixed(1)} 档`);
  if (state.filterStops > 0) parts.push(`滤镜 +${state.filterStops.toFixed(1)} 档`);
  if (Math.abs(rounded.deltaStops) > 0.03) parts.push(`靠档 ${rounded.deltaStops > 0 ? '+' : ''}${rounded.deltaStops.toFixed(2)} EV`);

  UI.updateShutterDisplay(LM.formatShutter(rounded.value), parts.join(' · '));
}

// ── Zebra ──
function updateZebra() {
  const film = getFilm(state.filmId);
  const filmDR = film ? film.dynamicRange : 10;
  const ctx = state.sampleCtx, canvas = state.sampleCanvas;
  ctx.drawImage(state.video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const vfRect = dom.viewfinder.getBoundingClientRect();
  dom.zebraOverlay.width = vfRect.width;
  dom.zebraOverlay.height = vfRect.height;
  dom.zebraCtx.clearRect(0, 0, dom.zebraOverlay.width, dom.zebraOverlay.height);
  if (!state.pointAnalyses || state.pointAnalyses.length === 0) return;

  const data = imageData.data;
  const srcW = canvas.width, srcH = canvas.height;
  const scaleX = dom.zebraOverlay.width / srcW, scaleY = dom.zebraOverlay.height / srcH;
  const halfDR = filmDR / 2;
  const tLow = -halfDR + state.shiftStops, tHigh = halfDR + state.shiftStops;

  for (let sy = 0; sy < srcH; sy += 4) {
    for (let sx = 0; sx < srcW; sx += 4) {
      const idx = (sy * srcW + sx) * 4;
      if (idx >= data.length) continue;
      const r8 = data[idx], g8 = data[idx+1], b8 = data[idx+2];
      const linearY = Camera.srgbToLinear(r8/255)*0.2126 + Camera.srgbToLinear(g8/255)*0.7152 + Camera.srgbToLinear(b8/255)*0.0722;
      const relEV = Math.log2(Math.max(0.001, linearY / Math.max(0.001, state.fullFrameAvgY)));
      if (relEV < tLow && (sx+sy)%8<4) {
        dom.zebraCtx.fillStyle = 'rgba(30,80,255,0.6)';
        dom.zebraCtx.fillRect(sx*scaleX, sy*scaleY, 4*scaleX, 4*scaleY);
      } else if (relEV > tHigh && (sx-sy)%8<4) {
        dom.zebraCtx.fillStyle = 'rgba(255,40,0,0.6)';
        dom.zebraCtx.fillRect(sx*scaleX, sy*scaleY, 4*scaleX, 4*scaleY);
      }
    }
  }
}

// ── Zone drag ──
function getShiftLimits() {
  if (!state.pointAnalyses || state.pointAnalyses.length === 0) return { min: -5, max: 5 };
  let minS = -Infinity, maxS = Infinity;
  for (const pt of state.pointAnalyses) {
    minS = Math.max(minS, -5 - pt.zoneOffset);
    maxS = Math.min(maxS, 5 - pt.zoneOffset);
  }
  return { min: minS, max: maxS };
}

function clampShift(v) {
  const lim = getShiftLimits();
  return Math.max(lim.min, Math.min(lim.max, v));
}

function bindZoneScaleDrag() {
  const track = dom.zoneTrack;
  let dragging = false, startX = 0, startShift = 0;
  track.addEventListener('pointerdown', e => {
    if (state.points.length === 0) return;
    dragging = true; startX = e.clientX || (e.touches&&e.touches[0].clientX)||0;
    startShift = state.shiftStops; track.style.cursor = 'grabbing'; e.preventDefault();
  });
  track.addEventListener('pointermove', e => {
    if (!dragging) return;
    const cx = e.clientX || (e.touches&&e.touches[0].clientX)||0;
    const stopsPerPixel = 10 / track.getBoundingClientRect().width;
    state.shiftStops = clampShift(startShift + (cx - startX) * stopsPerPixel);
  });
  const end = () => { dragging = false; track.style.cursor = state.points.length>0?'grab':''; };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointerleave', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('touchstart', e => { if(state.points.length>0)e.preventDefault(); }, {passive:false});
}

// ── Viewfinder tap ──
function bindViewfinderTap() {
  dom.viewfinder.addEventListener('click', e => {
    if (e.target.closest('.metering-point')) return;
    const rect = dom.viewfinder.getBoundingClientRect();
    const xr = (e.clientX - rect.left) / rect.width;
    const yr = (e.clientY - rect.top) / rect.height;

    const sw = state.sampleCanvas.width, sh = state.sampleCanvas.height;
    const sample = Camera.sampleRegion(state.video, state.sampleCtx, state.sampleCanvas, xr*sw, yr*sh, Math.min(sw,sh)*0.04);
    const pt = { xRatio: xr, yRatio: yr, avgLinearY: sample.avgLinearY, avgSRGB: sample.avgSRGB };
    state.points.push(pt);
    const idx = state.points.length - 1;
    UI.addMeteringPoint(dom.meteringPoints, xr, yr, idx);

    if (state.fullFrameAvgY > 0) state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
    if (state.points.length === 1 && state.pointAnalyses.length > 0)
      state.shiftStops = clampShift(-state.pointAnalyses[0].zoneOffset);

    UI.showViewfinderHint(`P${idx+1} 已添加 · ${state.points.length} 点`, 2000);
  });

  dom.meteringPoints.addEventListener('longpress', e => {
    const w = e.target.closest('.metering-point');
    if (!w) return;
    const idx = parseInt(w.dataset.index);
    if (isNaN(idx)||idx<0||idx>=state.points.length) return;
    state.points.splice(idx,1);
    UI.removeMeteringPoint(dom.meteringPoints, w);
    dom.meteringPoints.querySelectorAll('.metering-point').forEach((m,i)=>{m.dataset.index=i;const l=m.querySelector('.metering-point-label');if(l)l.textContent='P'+(i+1);});
    if (state.points.length>0&&state.fullFrameAvgY>0){state.pointAnalyses=LM.analyzePoints(state.points,state.fullFrameAvgY);state.shiftStops=clampShift(state.shiftStops);}
    else{state.pointAnalyses=[];state.shiftStops=0;}
    UI.showViewfinderHint(`已删除 · 剩${state.points.length}点`,1500);
  });
}

// ── Buttons ──
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
    state.points = []; state.pointAnalyses = []; state.shiftStops = clampShift(0);
    UI.clearMeteringPoints(dom.meteringPoints);
    UI.clearZebra(dom.zebraCtx, dom.zebraOverlay.width, dom.zebraOverlay.height);
    UI.clearZoneScale(dom.zoneMarkers, dom.zoneInfo);
    UI.clearTapeTranslation();
    UI.updateShutterDisplay('--', '');
  });
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (state.points.length === 0) return;
    state.points.pop();
    const m = dom.meteringPoints.querySelector(`.metering-point[data-index="${state.points.length}"]`);
    if (m) m.remove();
    if (state.points.length>0&&state.fullFrameAvgY>0){state.pointAnalyses=LM.analyzePoints(state.points,state.fullFrameAvgY);state.shiftStops=clampShift(state.shiftStops);}
    else{state.pointAnalyses=[];state.shiftStops=0;}
    UI.showViewfinderHint('已撤销 · 剩'+state.points.length+'点',1500);
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
    if (!isNaN(ev)) doCalibrate(ev);
  });
}

// ── Settings ──
function bindSettingsEvents() {
  document.getElementById('select-format').addEventListener('change', e => { state.format = e.target.value; UI.drawFrameLines(dom.frameLines, state.format, state.focalMm); });
  document.getElementById('select-focal').addEventListener('change', e => { state.focalMm = parseInt(e.target.value); UI.drawFrameLines(dom.frameLines, state.format, state.focalMm); });
  document.getElementById('select-film').addEventListener('change', e => { state.filmId = e.target.value; applyFilmSelection(); });
  document.getElementById('select-aperture').addEventListener('change', e => { state.aperture = parseFloat(e.target.value); });
  document.getElementById('input-iso').addEventListener('change', e => { const v=parseInt(e.target.value); if(!isNaN(v)&&v>=6&&v<=25600)state.iso=v; });
  document.getElementById('select-filter').addEventListener('change', e => {
    state.filterId = e.target.value;
    const f = LM.FILTERS.find(ff => ff.id === e.target.value);
    state.filterStops = f ? f.stops : 0;
  });
}

function applyFilmSelection() {
  const film = getFilm(state.filmId);
  if (film) { state.iso = film.iso; document.getElementById('input-iso').value = film.iso; }
}

// ── Calibration (pixel luminance only) ──
function doCalibrate(refEV) {
  if (!state.cameraReady || state.fullFrameAvgY <= 0) {
    alert('请确保摄像头画面正常后再校准。');
    return;
  }

  // Store: at this EV, the camera produced this average luminance
  state.refEV = refEV;
  state.refLuminance = state.fullFrameAvgY;
  state.calibrated = true;
  state.calibrationDate = new Date().toISOString();

  // Compute expected shutter for confirmation
  const expectedShutter = (state.aperture * state.aperture) / (Math.pow(2, refEV) * state.iso / 100);
  const rounded = LM.roundToNearest(expectedShutter, LM.SHUTTER_SPEEDS);

  saveCalibration();
  updateCalibrationUI();
  document.getElementById('calibration-modal').classList.add('hidden');

  UI.showViewfinderHint(`✓ 校准完成: EV${refEV} · 基线 Y=${state.refLuminance.toFixed(4)} · 参考快门 ${LM.formatShutter(rounded.value)}`, 5000);
}

function saveCalibration() {
  try { localStorage.setItem('lightmeter_lumcal', JSON.stringify({ refEV: state.refEV, refLuminance: state.refLuminance, date: state.calibrationDate })); } catch(e){}
}

function loadCalibration() {
  try {
    const raw = localStorage.getItem('lightmeter_lumcal');
    if (raw) {
      const data = JSON.parse(raw);
      state.refEV = data.refEV || 15;
      state.refLuminance = data.refLuminance || null;
      state.calibrated = !!(data.refLuminance);
      state.calibrationDate = data.date;
    }
  } catch(e){}
}

function updateCalibrationUI() {
  const el = document.getElementById('calibration-status');
  if (state.calibrated) {
    el.textContent = `已校准: EV${state.refEV} · Y=${state.refLuminance?.toFixed(4)} · ${state.calibrationDate||''}`;
  } else {
    el.textContent = '尚未校准。晴天户外对准中灰场景（草地/水泥地），点「立即校准」。';
  }
}

// ── SW ──
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

function bindEvents() {
  bindZoneScaleDrag();
  bindViewfinderTap();
  bindButtonEvents();
  bindSettingsEvents();
  window.addEventListener('resize', () => UI.drawFrameLines(dom.frameLines, state.format, state.focalMm));
  window.addEventListener('orientationchange', () => setTimeout(() => UI.drawFrameLines(dom.frameLines, state.format, state.focalMm), 300));
}

init().catch(err => {
  document.getElementById('viewfinder-hint').textContent = '初始化失败: ' + err.message;
});
