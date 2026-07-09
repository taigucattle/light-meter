// ============================================
// app.js — Main controller
// Priority: ImageCapture params > getSettings
// > luminance calibration > Sunny 16 fallback
// ============================================

import * as Camera from './camera.js';
import * as LM from './lightmeter.js';
import * as UI from './ui.js';
import { getFilm } from './films.js';

const state = {
  stream: null, track: null, video: null,
  sampleCanvas: null, sampleCtx: null,
  cameraReady: false,

  // Real exposure params (may be null on iOS)
  cameraExposureTime: null,
  cameraISO: null,
  phoneFNumber: 1.8,
  paramMethod: 'none',

  fullFrameAvgY: 0,

  format: '135', focalMm: 50, filmId: 'hp5',
  aperture: 8, iso: 400,
  filterId: 'none', filterStops: 0,

  points: [], pointAnalyses: [],
  shiftStops: 0,
  previewEnabled: false, zebraEnabled: true,

  // Luminance calibration (fallback)
  calibrated: false, refEV: 15, refLuminance: null, calibrationDate: null,

  meteringInterval: null, _lastRefShutter: null,
};

const dom = {
  viewfinder: document.getElementById('viewfinder'),
  cameraPreview: document.getElementById('camera-preview'),
  frameLines: document.getElementById('frame-lines'),
  meteringPoints: document.getElementById('metering-points'),
  zebraOverlay: document.getElementById('zebra-overlay'), zebraCtx: null,
  zoneMarkers: document.getElementById('zone-markers'),
  zoneInfo: document.getElementById('zone-info'),
  zoneTrack: document.getElementById('zone-track'),
};

async function init() {
  UI.populateSettings();
  dom.zebraCtx = dom.zebraOverlay.getContext('2d');
  bindEvents();
  try { await startCamera(); } catch (err) {
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

async function startCamera() {
  const cam = await Camera.initCamera(dom.cameraPreview);
  state.stream = cam.stream; state.track = cam.track; state.video = cam.video;
  state.cameraExposureTime = cam.exposureTime;
  state.cameraISO = cam.iso;
  state.paramMethod = cam.method;
  const { canvas, ctx } = Camera.createSamplingCanvas(320, 240);
  state.sampleCanvas = canvas; state.sampleCtx = ctx;
  state.cameraReady = true;

  if (cam.exposureTime) {
    UI.showViewfinderHint(`✓ 曝光参数已读取 · 点击画面测光`, 2500);
  } else {
    UI.showViewfinderHint('📷 点 ⚙ → 拍照片读取参数', 0);
  }
  console.log('Camera ready, method:', cam.method);
}

/**
 * User triggers EXIF photo capture from calibration modal.
 */
async function captureExifParams() {
  if (!state.track) return;
  const resultEl = document.getElementById('exif-result');
  if (resultEl) resultEl.textContent = '正在拍摄...';
  UI.showViewfinderHint('正在拍摄...', 0);
  const exif = await Camera.captureExifPhoto(state.track);
  if (exif && exif.exposureTime) {
    state.cameraExposureTime = exif.exposureTime;
    state.cameraISO = exif.iso || state.cameraISO;
    if (exif.fNumber) state.phoneFNumber = exif.fNumber;
    state.paramMethod = 'EXIF';
    const msg = `✓ EXIF: 1/${Math.round(1/exif.exposureTime)}s ISO${exif.iso || '?'} f/${exif.fNumber?.toFixed(1) || state.phoneFNumber.toFixed(1)}`;
    if (resultEl) resultEl.textContent = msg;
    UI.showViewfinderHint(msg, 5000);
  } else {
    if (resultEl) resultEl.textContent = '⚠ EXIF 读取失败，请重试';
    UI.showViewfinderHint('⚠ EXIF 读取失败', 3000);
  }
}

// ── Reference shutter ──
function computeReferenceShutter() {
  // Priority 1: real camera exposure params
  if (state.cameraExposureTime && state.cameraExposureTime > 0) {
    return paramsBasedShutter();
  }
  // Priority 2: luminance calibration
  if (state.calibrated && state.refLuminance > 0 && state.fullFrameAvgY > 0) {
    return luminanceBasedShutter();
  }
  // Priority 3: Sunny 16
  return sunny16();
}

function paramsBasedShutter() {
  // EXIF may have provided phoneFNumber; otherwise default to 1.8
  const phoneF = state.phoneFNumber || 1.8;
  const ratio = state.aperture / phoneF;
  let t = state.cameraExposureTime * (ratio * ratio) * ((state.cameraISO || 100) / state.iso);
  return Math.max(1/32000, Math.min(120, t));
}

function luminanceBasedShutter() {
  const ratio = state.fullFrameAvgY / state.refLuminance;
  const relEV = Math.log2(Math.max(0.001, Math.min(1000, ratio)));
  const ev = state.refEV + relEV;
  return (state.aperture * state.aperture) / (Math.pow(2, ev) * state.iso / 100);
}

function sunny16() {
  return (state.aperture * state.aperture) / (32768 * (state.iso / 100));
}

// ── Metering loop ──
function startMeteringLoop() {
  state.meteringInterval = setInterval(() => {
    if (state.cameraReady) {
      // Poll camera params (may update if method started working)
      const p = Camera.readExposureParams(state.track);
      if (p.exposureTime) { state.cameraExposureTime = p.exposureTime; state.cameraISO = p.iso; }

      const ff = Camera.sampleFullFrame(state.video, state.sampleCtx, state.sampleCanvas);
      state.fullFrameAvgY = ff.avgLinearY;

      for (const pt of state.points) {
        const w = state.sampleCanvas.width, h = state.sampleCanvas.height;
        const r = Camera.sampleRegion(state.video, state.sampleCtx, state.sampleCanvas, pt.xRatio*w, pt.yRatio*h, Math.min(w,h)*0.04);
        pt.avgLinearY = r.avgLinearY; pt.avgSRGB = r.avgSRGB;
      }
      if (state.points.length > 0 && state.fullFrameAvgY > 0) {
        state.pointAnalyses = LM.analyzePoints(state.points, state.fullFrameAvgY);
      } else { state.pointAnalyses = []; }
    }

    const refShutter = computeReferenceShutter();
    if (refShutter !== state._lastRefShutter) { UI.renderShutterTape(refShutter); state._lastRefShutter = refShutter; }
    UI.updateTapeTranslation(state.shiftStops);
    UI.renderZoneScale(dom.zoneMarkers, state.pointAnalyses, state.shiftStops, dom.zoneInfo);
    updateMainShutterDisplay(refShutter);
    if (state.cameraReady && state.zebraEnabled && state.points.length > 0) updateZebra();
    else UI.clearZebra(dom.zebraCtx, dom.zebraOverlay.width, dom.zebraOverlay.height);
    if (state.previewEnabled) UI.updateExposurePreview(dom.cameraPreview, state.shiftStops);
  }, 200);
}

function updateMainShutterDisplay(refShutter) {
  if (!refShutter || refShutter <= 0) { UI.updateShutterDisplay('--', ''); return; }
  let t = refShutter * Math.pow(2, state.shiftStops + state.filterStops);
  const r = LM.roundToNearest(t, LM.SHUTTER_SPEEDS);
  const parts = [];
  if (state.shiftStops !== 0) parts.push(`偏移 ${state.shiftStops>0?'+':''}${state.shiftStops.toFixed(1)}档`);
  if (state.filterStops > 0) parts.push(`滤镜 +${state.filterStops.toFixed(1)}档`);
  if (Math.abs(r.deltaStops) > 0.03) parts.push(`靠档 ${r.deltaStops>0?'+':''}${r.deltaStops.toFixed(2)}EV`);
  UI.updateShutterDisplay(LM.formatShutter(r.value), parts.join(' · '));
}

function updateZebra() {
  const film = getFilm(state.filmId); const filmDR = film ? film.dynamicRange : 10;
  const ctx = state.sampleCtx, c = state.sampleCanvas;
  ctx.drawImage(state.video, 0, 0, c.width, c.height);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const vf = dom.viewfinder.getBoundingClientRect();
  dom.zebraOverlay.width = vf.width; dom.zebraOverlay.height = vf.height;
  dom.zebraCtx.clearRect(0, 0, vf.width, vf.height);
  if (!state.pointAnalyses?.length) return;
  const d = id.data, sx = vf.width/c.width, sy = vf.height/c.height;
  const hdr = filmDR/2, tl = -hdr+state.shiftStops, th = hdr+state.shiftStops;
  for (let y=0;y<c.height;y+=4) for (let x=0;x<c.width;x+=4) {
    const i=(y*c.width+x)*4; if(i>=d.length)continue;
    const ly = Camera.srgbToLinear(d[i]/255)*0.2126+Camera.srgbToLinear(d[i+1]/255)*0.7152+Camera.srgbToLinear(d[i+2]/255)*0.0722;
    const re = Math.log2(Math.max(0.001,ly/Math.max(0.001,state.fullFrameAvgY)));
    if(re<tl&&(x+y)%8<4){dom.zebraCtx.fillStyle='rgba(30,80,255,0.6)';dom.zebraCtx.fillRect(x*sx,y*sy,4*sx,4*sy);}
    else if(re>th&&(x-y)%8<4){dom.zebraCtx.fillStyle='rgba(255,40,0,0.6)';dom.zebraCtx.fillRect(x*sx,y*sy,4*sx,4*sy);}
  }
}

// ── Zone drag ──
function getShiftLimits() {
  if (!state.pointAnalyses?.length) return {min:-5,max:5};
  let lo=-Infinity,hi=Infinity;
  for(const p of state.pointAnalyses){lo=Math.max(lo,-5-p.zoneOffset);hi=Math.min(hi,5-p.zoneOffset);}
  return {min:lo,max:hi};
}
function clamp(v){const l=getShiftLimits();return Math.max(l.min,Math.min(l.max,v));}
function bindZoneScaleDrag(){
  const t=dom.zoneTrack;let d=false,sx=0,ss=0;
  t.addEventListener('pointerdown',e=>{if(!state.points.length)return;d=true;sx=e.clientX||(e.touches&&e.touches[0].clientX)||0;ss=state.shiftStops;t.style.cursor='grabbing';e.preventDefault();});
  t.addEventListener('pointermove',e=>{if(!d)return;const cx=e.clientX||(e.touches&&e.touches[0].clientX)||0;state.shiftStops=clamp(ss+(cx-sx)*10/t.getBoundingClientRect().width);});
  const end=()=>{d=false;t.style.cursor=state.points.length?'grab':'';};
  t.addEventListener('pointerup',end);t.addEventListener('pointerleave',end);t.addEventListener('pointercancel',end);
  t.addEventListener('touchstart',e=>{if(state.points.length)e.preventDefault();},{passive:false});
}

// ── Viewfinder ──
function bindViewfinderTap(){
  dom.viewfinder.addEventListener('click',e=>{
    if(e.target.closest('.metering-point'))return;
    const r=dom.viewfinder.getBoundingClientRect();
    const xr=(e.clientX-r.left)/r.width,yr=(e.clientY-r.top)/r.height;
    const sw=state.sampleCanvas.width,sh=state.sampleCanvas.height;
    const s=Camera.sampleRegion(state.video,state.sampleCtx,state.sampleCanvas,xr*sw,yr*sh,Math.min(sw,sh)*0.04);
    state.points.push({xRatio:xr,yRatio:yr,avgLinearY:s.avgLinearY,avgSRGB:s.avgSRGB});
    const idx=state.points.length-1;
    UI.addMeteringPoint(dom.meteringPoints,xr,yr,idx);
    if(state.fullFrameAvgY>0)state.pointAnalyses=LM.analyzePoints(state.points,state.fullFrameAvgY);
    if(state.points.length===1&&state.pointAnalyses.length>0)state.shiftStops=clamp(-state.pointAnalyses[0].zoneOffset);
    UI.showViewfinderHint(`P${idx+1} 已添加 · ${state.points.length}点`,2000);
  });
  dom.meteringPoints.addEventListener('longpress',e=>{
    const w=e.target.closest('.metering-point');if(!w)return;
    const i=parseInt(w.dataset.index);if(isNaN(i)||i<0||i>=state.points.length)return;
    state.points.splice(i,1);UI.removeMeteringPoint(dom.meteringPoints,w);
    dom.meteringPoints.querySelectorAll('.metering-point').forEach((m,j)=>{m.dataset.index=j;const l=m.querySelector('.metering-point-label');if(l)l.textContent='P'+(j+1);});
    if(state.points.length>0&&state.fullFrameAvgY>0){state.pointAnalyses=LM.analyzePoints(state.points,state.fullFrameAvgY);state.shiftStops=clamp(state.shiftStops);}
    else{state.pointAnalyses=[];state.shiftStops=0;}
    UI.showViewfinderHint(`已删除 · 剩${state.points.length}点`,1500);
  });
}

// ── Buttons ──
function bindButtonEvents(){
  document.getElementById('btn-preview').addEventListener('click',()=>{state.previewEnabled=!state.previewEnabled;document.getElementById('btn-preview').classList.toggle('active',state.previewEnabled);if(!state.previewEnabled)UI.clearExposurePreview(dom.cameraPreview);});
  document.getElementById('btn-zebra').addEventListener('click',()=>{state.zebraEnabled=!state.zebraEnabled;document.getElementById('btn-zebra').classList.toggle('active',state.zebraEnabled);if(!state.zebraEnabled)UI.clearZebra(dom.zebraCtx,dom.zebraOverlay.width,dom.zebraOverlay.height);});
  document.getElementById('btn-clear').addEventListener('click',()=>{state.points=[];state.pointAnalyses=[];state.shiftStops=clamp(0);UI.clearMeteringPoints(dom.meteringPoints);UI.clearZebra(dom.zebraCtx,dom.zebraOverlay.width,dom.zebraOverlay.height);UI.clearZoneScale(dom.zoneMarkers,dom.zoneInfo);UI.clearTapeTranslation();UI.updateShutterDisplay('--','');});
  document.getElementById('btn-undo').addEventListener('click',()=>{if(!state.points.length)return;state.points.pop();const m=dom.meteringPoints.querySelector(`.metering-point[data-index="${state.points.length}"]`);if(m)m.remove();if(state.points.length>0&&state.fullFrameAvgY>0){state.pointAnalyses=LM.analyzePoints(state.points,state.fullFrameAvgY);state.shiftStops=clamp(state.shiftStops);}else{state.pointAnalyses=[];state.shiftStops=0;}UI.showViewfinderHint('已撤销 · 剩'+state.points.length+'点',1500);});
  document.getElementById('btn-calibrate').addEventListener('click',()=>{document.getElementById('calibration-modal').classList.remove('hidden');updateCalibrationUI();});
  document.getElementById('btn-cal-close').addEventListener('click',()=>{document.getElementById('calibration-modal').classList.add('hidden');});
  document.getElementById('btn-cal-do').addEventListener('click',()=>doCalibrate(15));
  document.getElementById('btn-exif-capture').addEventListener('click',()=>captureExifParams());
  document.getElementById('btn-cal-manual').addEventListener('click',()=>{document.getElementById('cal-manual-input').classList.toggle('hidden');});
  document.getElementById('btn-cal-manual-do').addEventListener('click',()=>{const ev=parseFloat(document.getElementById('input-ref-ev').value);if(!isNaN(ev))doCalibrate(ev);});
}

// ── Settings ──
function bindSettingsEvents(){
  document.getElementById('select-format').addEventListener('change',e=>{state.format=e.target.value;UI.drawFrameLines(dom.frameLines,state.format,state.focalMm);});
  document.getElementById('select-focal').addEventListener('change',e=>{state.focalMm=parseInt(e.target.value);UI.drawFrameLines(dom.frameLines,state.format,state.focalMm);});
  document.getElementById('select-film').addEventListener('change',e=>{state.filmId=e.target.value;applyFilmSelection();});
  document.getElementById('select-aperture').addEventListener('change',e=>{state.aperture=parseFloat(e.target.value);});
  document.getElementById('input-iso').addEventListener('change',e=>{const v=parseInt(e.target.value);if(!isNaN(v)&&v>=6&&v<=25600)state.iso=v;});
  document.getElementById('select-filter').addEventListener('change',e=>{state.filterId=e.target.value;const f=LM.FILTERS.find(ff=>ff.id===e.target.value);state.filterStops=f?f.stops:0;});
}
function applyFilmSelection(){const film=getFilm(state.filmId);if(film){state.iso=film.iso;document.getElementById('input-iso').value=film.iso;}}

// ── Calibration ──
function doCalibrate(refEV){
  if(!state.cameraReady||state.fullFrameAvgY<=0){alert('请确保摄像头画面正常。');return;}
  state.refEV=refEV;state.refLuminance=state.fullFrameAvgY;state.calibrated=true;state.calibrationDate=new Date().toISOString();
  const t=(state.aperture*state.aperture)/(Math.pow(2,refEV)*state.iso/100);
  saveCalibration();updateCalibrationUI();document.getElementById('calibration-modal').classList.add('hidden');
  UI.showViewfinderHint(`✓ 校准完成 EV${refEV} · 参考 ${LM.formatShutter(LM.roundToNearest(t,LM.SHUTTER_SPEEDS).value)}`,5000);
}
function saveCalibration(){try{localStorage.setItem('lightmeter_cal4',JSON.stringify({refEV:state.refEV,refLuminance:state.refLuminance,date:state.calibrationDate}));}catch(e){}}
function loadCalibration(){try{const r=localStorage.getItem('lightmeter_cal4');if(r){const d=JSON.parse(r);state.refEV=d.refEV||15;state.refLuminance=d.refLuminance||null;state.calibrated=!!d.refLuminance;state.calibrationDate=d.date;}}catch(e){}}
function updateCalibrationUI(){const el=document.getElementById('calibration-status');el.textContent=state.calibrated?`已校准: EV${state.refEV} · ${state.calibrationDate||''}`:'尚未校准。晴天户外对准中灰场景，点「立即校准」。';}

function registerSW(){if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}
function bindEvents(){bindZoneScaleDrag();bindViewfinderTap();bindButtonEvents();bindSettingsEvents();window.addEventListener('resize',()=>UI.drawFrameLines(dom.frameLines,state.format,state.focalMm));window.addEventListener('orientationchange',()=>setTimeout(()=>UI.drawFrameLines(dom.frameLines,state.format,state.focalMm),300));}
init().catch(err=>{document.getElementById('viewfinder-hint').textContent='初始化失败: '+err.message;});
