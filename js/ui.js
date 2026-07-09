// ============================================
// ui.js — Viewfinder overlays, Zone scale,
// metering points, zebra stripes.
// ============================================

import { FORMATS, FOCAL_LENGTHS, FILM_DATABASE } from './films.js';
import { APERTURES, SHUTTER_SPEEDS, ISO_VALUES, FILTERS, ZONES, roundToNearest, formatShutter } from './lightmeter.js';

// ── Viewfinder frame lines ──

export function drawFrameLines(container, formatId, focalMm) {
  const existing = container.querySelector('.frame-line');
  if (existing) existing.remove();
  container.querySelectorAll('.frame-line-label').forEach(el => el.remove());

  const format = FORMATS.find(f => f.id === formatId);
  if (!format) return;

  const rect = container.getBoundingClientRect();
  const vfW = rect.width, vfH = rect.height;
  const baseFocal = 28;
  const focalScale = baseFocal / focalMm;
  const frameAspect = format.aspectRatio;

  let frameW, frameH;
  if (vfW / vfH > frameAspect) {
    frameH = vfH * 0.85;
    frameW = frameH * frameAspect;
  } else {
    frameW = vfW * 0.85;
    frameH = frameW / frameAspect;
  }
  frameW = Math.min(frameW * focalScale, vfW * 0.95);
  frameH = Math.min(frameH * focalScale, vfH * 0.95);

  const left = (vfW - frameW) / 2;
  const top = (vfH - frameH) / 2;

  const el = document.createElement('div');
  el.className = 'frame-line';
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.width = frameW + 'px';
  el.style.height = frameH + 'px';
  container.appendChild(el);

  const label = document.createElement('div');
  label.className = 'frame-line-label';
  label.textContent = focalMm + 'mm';
  label.style.left = (left + 6) + 'px';
  label.style.bottom = (vfH - top + 4) + 'px';
  container.appendChild(label);
}

// ── Metering points on viewfinder ──
let meteringPointCounter = 0;

export function addMeteringPoint(container, xRatio, yRatio, index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'metering-point';
  wrapper.style.left = (xRatio * 100) + '%';
  wrapper.style.top = (yRatio * 100) + '%';
  wrapper.dataset.index = index;
  wrapper.dataset.id = 'mp-' + (++meteringPointCounter);

  const dot = document.createElement('div');
  dot.className = 'metering-point-dot';
  wrapper.appendChild(dot);

  const label = document.createElement('div');
  label.className = 'metering-point-label';
  label.textContent = 'P' + (index + 1);
  wrapper.appendChild(label);

  let longPressTimer;
  wrapper.addEventListener('pointerdown', () => {
    longPressTimer = setTimeout(() => {
      wrapper.dispatchEvent(new CustomEvent('longpress', { bubbles: true }));
    }, 600);
  });
  wrapper.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  wrapper.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
  wrapper.addEventListener('pointercancel', () => clearTimeout(longPressTimer));

  container.appendChild(wrapper);
  return wrapper;
}

export function removeMeteringPoint(container, wrapper) {
  if (wrapper && wrapper.parentNode) wrapper.remove();
}

export function clearMeteringPoints(container) {
  container.querySelectorAll('.metering-point').forEach(el => el.remove());
}

// ── Zebra overlay ──

export function drawZebra(ctx, canvasW, canvasH, pointAnalyses, shiftStops, filmDR, frameData) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (!frameData || !pointAnalyses || pointAnalyses.length === 0) return;

  const data = frameData.data;
  const halfDR = filmDR / 2;
  const thresholdLow = -halfDR + shiftStops;
  const thresholdHigh = halfDR + shiftStops;

  for (let y = 0; y < canvasH; y += 2) {
    for (let x = 0; x < canvasW; x += 2) {
      const idx = (y * canvasW + x) * 4;
      if (idx >= data.length) continue;
      const r8 = data[idx], g8 = data[idx + 1], b8 = data[idx + 2];
      const linearY = 0.2126 * (r8 / 255) + 0.7152 * (g8 / 255) + 0.0722 * (b8 / 255);
      const relativeEV = Math.log2(Math.max(0.001, linearY));

      if (relativeEV < thresholdLow && (x + y) % 8 < 4) {
        ctx.fillStyle = 'rgba(30, 80, 255, 0.6)';
        ctx.fillRect(x, y, 2, 2);
      } else if (relativeEV > thresholdHigh && (x - y) % 8 < 4) {
        ctx.fillStyle = 'rgba(255, 40, 0, 0.6)';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
}

export function clearZebra(ctx, canvasW, canvasH) {
  ctx.clearRect(0, 0, canvasW, canvasH);
}

// ── Zone scale — sliding shutter tape ──

const TAPE_LABELS = 21; // 21 labels, ±10 stops from center

/**
 * Render the fixed shutter tape (labels never change, printed on the sliding track).
 * Left = slow (big numbers) → right = fast (small numbers).
 */
export function renderShutterTape(refShutter) {
  const tape = document.getElementById('shutter-tape');
  if (!tape) {
    document.getElementById('zone-info').textContent = 'ERR: shutter-tape not found';
    return;
  }

  // Reuse existing spans rather than innerHTML (preserves flex layout)
  const existing = tape.querySelectorAll('span');
  const hasExisting = existing.length === TAPE_LABELS;

  if (!refShutter || refShutter <= 0) {
    if (hasExisting) {
      existing.forEach(s => { s.textContent = '--'; s.style.color = ''; s.style.fontWeight = ''; });
    }
    return;
  }

  for (let i = 0; i < TAPE_LABELS; i++) {
    const zoneOffset = i - 10;
    const raw = refShutter * Math.pow(2, -zoneOffset);
    const rounded = roundToNearest(raw, SHUTTER_SPEEDS);
    const text = formatShutter(rounded.value);

    if (hasExisting) {
      existing[i].textContent = text;
      if (i === 10) {
        existing[i].style.color = 'var(--accent)';
        existing[i].style.fontWeight = '700';
      } else {
        existing[i].style.color = '';
        existing[i].style.fontWeight = '';
      }
    }
  }
}

/**
 * Translate the tape + markers by shiftStops.
 * shiftStops > 0 = tape slides RIGHT = slower shutter at center.
 */
export function updateTapeTranslation(shiftStops) {
  const inner = document.getElementById('zone-track-inner');
  if (!inner) return;
  // Tape is 200% wide, centered via left:50%.
  // Each stop = tapeWidth/20 = 10% of track = 5% of tape.
  // transform = center offset + shift
  const pct = shiftStops * 5;
  inner.style.transform = `translateX(calc(-50% + ${pct}%))`;
}

/**
 * Render metering point markers on the sliding tape.
 * Markers are positioned on the TAPE (not the visual grid).
 * A point's tape position depends only on its brightness (zoneOffset),
 * NOT on shiftStops — it moves with the tape.
 */
export function renderZoneScale(markersContainer, pointAnalyses, shiftStops, infoEl) {
  markersContainer.innerHTML = '';

  if (!pointAnalyses || pointAnalyses.length === 0) {
    if (infoEl) infoEl.textContent = '点击取景画面添加测光点';
    return;
  }

  // Map point indices to their tape positions
  // tapeIndex = 10 + zoneOffset
  // tape position % = (tapeIndex / 20) * 100
  const zoneBins = new Map();

  pointAnalyses.forEach((pt, idx) => {
    const tapeIndex = 10 + pt.zoneOffset;
    const snapped = Math.max(0, Math.min(20, Math.round(tapeIndex)));
    if (!zoneBins.has(snapped)) {
      zoneBins.set(snapped, { indices: [], count: 0, idx: snapped });
    }
    zoneBins.get(snapped).indices.push(idx);
    zoneBins.get(snapped).count++;
  });

  // Render marker in its bin on the tape
  zoneBins.forEach(bin => {
    const positionPercent = (bin.idx / 20) * 100;

    const marker = document.createElement('div');
    marker.className = 'zone-marker';
    if (bin.count > 1) marker.classList.add('zone-marker-stacked');

    const labelText = bin.indices.map(i => 'P' + (i + 1)).join(',');
    marker.textContent = labelText;
    marker.style.left = positionPercent + '%';

    marker.title = `快门 ≈ ${getTapeLabelText(bin.idx)}`;

    markersContainer.appendChild(marker);
  });

  // Info
  if (infoEl) {
    if (pointAnalyses.length >= 2) {
      const offsets = pointAnalyses.map(p => p.zoneOffset);
      const range = (Math.max(...offsets) - Math.min(...offsets)).toFixed(1);
      infoEl.textContent = `场景反差 ${range} 档 · 拖动尺子`;
    } else {
      infoEl.textContent = '拖动尺子放置测光点';
    }
  }
}

function getTapeLabelText(tapeIndex) {
  const tape = document.getElementById('shutter-tape');
  if (!tape) return '--';
  const span = tape.children[Math.round(tapeIndex)];
  return span ? span.textContent : '--';
}

export function clearZoneScale(markersContainer, infoEl) {
  markersContainer.innerHTML = '';
  if (infoEl) infoEl.textContent = '点击取景画面添加测光点';
}

export function clearTapeTranslation() {
  const inner = document.getElementById('zone-track-inner');
  if (!inner) return;
  inner.style.transform = 'translateX(-50%)';
}

// ── Exposure preview ──

/**
 * Simulate exposure on the viewfinder image using CSS brightness filter.
 * shiftStops > 0 = overexpose (brighter), shiftStops < 0 = underexpose (darker).
 * Each stop doubles/halves perceived brightness.
 */
export function updateExposurePreview(videoEl, shiftStops) {
  // Clamp to ±5 stops to avoid extreme values
  const clamped = Math.max(-5, Math.min(5, shiftStops));
  const brightness = Math.pow(2, clamped);
  videoEl.style.filter = `brightness(${brightness.toFixed(2)})`;
  videoEl.style.transition = 'filter 0.15s ease-out';
}

export function clearExposurePreview(videoEl) {
  videoEl.style.filter = '';
  videoEl.style.transition = '';
}

// ── Populate select elements ──

export function populateSelect(selectEl, options) {
  selectEl.innerHTML = '';
  options.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.selected) el.selected = true;
    selectEl.appendChild(el);
  });
}

export function populateSettings() {
  const formatSelect = document.getElementById('select-format');
  populateSelect(formatSelect, FORMATS.map(f => ({ value: f.id, label: f.name })));
  formatSelect.value = '135';

  const focalSelect = document.getElementById('select-focal');
  populateSelect(focalSelect, FOCAL_LENGTHS.map(f => ({ value: f.mm.toString(), label: f.label })));
  focalSelect.value = '50';

  const filmSelect = document.getElementById('select-film');
  populateSelect(filmSelect, FILM_DATABASE.map(f => ({
    value: f.id,
    label: `${f.name} (ISO ${f.iso}) [${f.type === 'bw_neg' ? 'B&W' : f.type === 'color_neg' ? '彩负' : '反转'}]`,
  })));
  filmSelect.value = 'hp5';

  const apertureSelect = document.getElementById('select-aperture');
  populateSelect(apertureSelect, APERTURES.map(a => ({ value: a.toString(), label: 'f/' + a })));
  apertureSelect.value = '8';

  const filterSelect = document.getElementById('select-filter');
  populateSelect(filterSelect, FILTERS.map(f => ({ value: f.id, label: f.name + ' (+' + f.stops + '档)' })));
  filterSelect.value = 'none';
}

// ── Shutter display ──

export function updateShutterDisplay(valueStr, compInfo) {
  document.getElementById('shutter-value').textContent = valueStr;
  document.getElementById('shutter-comp').textContent = compInfo || '';
}

// ── Viewfinder hint ──

let hintTimeout;
export function showViewfinderHint(text, duration = 3000) {
  const el = document.getElementById('viewfinder-hint');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(hintTimeout);
  if (duration > 0) {
    hintTimeout = setTimeout(() => el.classList.add('hidden'), duration);
  }
}

export function hideViewfinderHint() {
  document.getElementById('viewfinder-hint').classList.add('hidden');
}
