// ============================================
// lightmeter.js — Core exposure calculation
// Zone System, EV math, exposure triangle
// ============================================

// ── Standard stop sequences (1/3 stop) ──

/** Standard f-stop values (1/3 stop increments) */
export const APERTURES = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8,
  3.2, 3.5, 4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0,
  9.0, 10, 11, 13, 14, 16, 18, 20, 22,
  25, 29, 32, 36, 40, 45, 51, 57, 64,
];

/** Standard shutter speeds (1/3 stop, in seconds) */
export const SHUTTER_SPEEDS = [
  1/8000, 1/6400, 1/5000, 1/4000, 1/3200, 1/2500, 1/2000, 1/1600,
  1/1250, 1/1000, 1/800, 1/640, 1/500, 1/400, 1/320, 1/250,
  1/200, 1/160, 1/125, 1/100, 1/80, 1/60, 1/50, 1/40,
  1/30, 1/25, 1/20, 1/15, 1/13, 1/10, 1/8, 1/6, 1/5, 1/4,
  1/3, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3, 4, 5, 6,
  8, 10, 13, 15, 20, 25, 30,
];

/** Standard ISO values */
export const ISO_VALUES = [
  25, 50, 64, 80, 100, 125, 160, 200, 250, 320,
  400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500,
  3200, 4000, 5000, 6400,
];

// ── Core EV / Exposure math ──

/**
 * Compute EV (Exposure Value) from aperture, shutter speed, and ISO.
 * EV = log2(N² / t) - log2(ISO / 100)
 *
 * This is the reflected-light EV (ISO 100 normalized).
 */
export function computeEV(aperture, shutterSeconds, iso = 100) {
  return Math.log2((aperture * aperture) / shutterSeconds)
    - Math.log2(iso / 100);
}

/**
 * Given an EV and ISO, find the shutter speed for a given aperture.
 * t = N² / (2^EV * (ISO/100))
 */
export function evToShutter(ev, aperture, iso = 100) {
  const evAdjusted = ev + Math.log2(iso / 100);
  return (aperture * aperture) / Math.pow(2, evAdjusted);
}

/**
 * Given an EV and ISO, find the aperture for a given shutter speed.
 */
export function evToAperture(ev, shutterSeconds, iso = 100) {
  const evAdjusted = ev + Math.log2(iso / 100);
  return Math.sqrt(Math.pow(2, evAdjusted) * shutterSeconds);
}

// ── Rounding to nearest standard stop ──

/**
 * Round a value to the nearest value in a given array.
 * Returns { value, index, delta } where delta is difference in stops.
 */
export function roundToNearest(value, sequence) {
  let best = sequence[0];
  let bestIdx = 0;
  let bestDist = Math.abs(Math.log2(value / best));

  for (let i = 1; i < sequence.length; i++) {
    const dist = Math.abs(Math.log2(value / sequence[i]));
    if (dist < bestDist) {
      bestDist = dist;
      best = sequence[i];
      bestIdx = i;
    }
  }

  return {
    value: best,
    index: bestIdx,
    deltaStops: Math.log2(value / best),
  };
}

/**
 * Format shutter speed as a human-readable string.
 * e.g., 0.008 -> "1/125", 2.5 -> "2.5\""
 */
export function formatShutter(shutterSeconds) {
  if (shutterSeconds >= 1) {
    return shutterSeconds.toFixed(shutterSeconds % 1 === 0 ? 0 : 1) + '"';
  }
  const denominator = Math.round(1 / shutterSeconds);
  // Check if the rounded fraction is close enough
  if (Math.abs(shutterSeconds - 1 / denominator) < 0.001 * shutterSeconds) {
    return '1/' + denominator;
  }
  // For uncommon values, use decimal
  if (shutterSeconds < 0.1) {
    return '1/' + Math.round(1 / shutterSeconds);
  }
  return shutterSeconds.toFixed(2) + '"';
}

/**
 * Format aperture for display.
 */
export function formatAperture(aperture) {
  if (aperture >= 2) {
    return 'f/' + aperture.toFixed(aperture % 1 === 0 ? 0 : 1);
  }
  return 'f/' + aperture.toFixed(1);
}

// ── Zone System (0–X, 11 zones) ──

/** Zone labels */
export const ZONES = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Zone descriptions */
export const ZONE_DESCRIPTIONS = {
  0:  '纯黑 · 片基无细节',
  1:  '近黑 · 微弱调子',
  2:  '首次纹理 · 最深阴影',
  3:  '充足暗部细节',
  4:  '深色树叶 / 阴影侧肤色',
  5:  '18% 中灰 · 测光表基准',
  6:  '浅色肤色 · 阳光下的石头',
  7:  '亮灰 · 雪中带纹理',
  8:  '白中有细微纹理 · 相纸极限',
  9:  '刺眼白 · 仅剩质感',
  10: '纯白 · 相纸基底',
};

/**
 * Convert zone to EV offset from Zone V.
 * Zone V = 0 offset, Zone III = -2, Zone VII = +2, etc.
 */
export function zoneToEVOffset(zone) {
  return zone - 5;
}

/**
 * Convert EV offset to nearest zone.
 */
export function evOffsetToZone(offset) {
  return Math.round(offset + 5);
}

// ── Metering point analysis ──

/**
 * Given a set of metering points (each with its avgLinearY),
 * and the camera's full-frame average (fullFrameY),
 * compute each point's position relative to Zone V.
 *
 * The camera's auto-exposure makes the full-frame average ≈ Zone V (18% gray).
 * So: point_zone = 5 + log2(pointY / fullFrameY)
 *
 * Returns array of { zoneOffset, relativeEV, luminanceRatio }
 */
export function analyzePoints(points, fullFrameY) {
  if (!fullFrameY || fullFrameY <= 0) {
    return points.map(() => ({ zoneOffset: 0, relativeEV: 0, luminanceRatio: 1 }));
  }

  return points.map(p => {
    const luminanceRatio = p.avgLinearY / fullFrameY;
    // Clamp to reasonable range to avoid log2(0) or extreme values
    const clamped = Math.max(1 / 1024, Math.min(1024, luminanceRatio));
    const relativeEV = Math.log2(clamped);
    return {
      zoneOffset: relativeEV,       // How many stops from Zone V (the camera's target)
      relativeEV,
      luminanceRatio: clamped,
    };
  });
}

/**
 * When the user shifts the zone scale so that a specific point
 * lands on a target zone, compute the resulting Zone V shutter speed.
 *
 * shiftStops: how many stops the user shifted the scale
 *   Positive = brighter exposure (zones shift right)
 *   Negative = darker exposure (zones shift left)
 *
 * baseShutterSpeed: the shutter speed that would place the
 *   camera's full-frame average at Zone V (from camera exposure params).
 *   This is essentially the camera's auto-exposure shutter time.
 *
 * To place a specific point at Zone N:
 *   The point is currently at Zone = 5 + pointRelativeOffset
 *   We want it at Zone = N
 *   shiftStops = N - (5 + pointRelativeOffset)
 *   Final shutter = baseShutterSpeed * 2^shiftStops
 */
export function computeZoneShutter(pointRelativeOffset, targetZone, baseShutterSpeed) {
  const currentZone = 5 + pointRelativeOffset;
  const shiftStops = targetZone - currentZone;
  return baseShutterSpeed * Math.pow(2, shiftStops);
}

/**
 * Compute the shift needed to anchor a point to a target zone.
 * Returns shiftStops and the resulting shutter speed.
 */
export function computeAnchorShift(pointAnalyses, anchorPointIndex, targetZone, baseShutterSpeed) {
  if (!pointAnalyses[anchorPointIndex]) {
    return { shiftStops: 0, shutterSpeed: baseShutterSpeed };
  }

  const point = pointAnalyses[anchorPointIndex];
  const currentZone = 5 + point.zoneOffset;
  const shiftStops = targetZone - currentZone;

  return {
    shiftStops,
    shutterSpeed: baseShutterSpeed * Math.pow(2, shiftStops),
    anchorZone: targetZone,
    anchorPointIndex,
  };
}

/**
 * Apply filter compensation and reciprocity to the zone shutter.
 * Returns both the metered and compensated shutter speed.
 */
export function applyCompensation(shutterSpeed, filterStops, reciprocityStops) {
  const totalCompensation = (filterStops || 0) + (reciprocityStops || 0);
  const compensated = shutterSpeed * Math.pow(2, totalCompensation);
  return {
    metered: shutterSpeed,
    compensated,
    compensationStops: totalCompensation,
  };
}

// ── Reciprocity failure ──

/**
 * Calculate reciprocity failure compensation using the Schwarzschild model.
 * T_corrected = (T_metered)^(1/p)
 *
 * Where p is the Schwarzschild exponent (typically 0.70–0.92 for B&W film).
 * Many manufacturers publish a lookup table instead of a single exponent.
 *
 * Returns { correctedSeconds, compensationStops }
 */
export function reciprocityCompensation(meteredSeconds, schwarzschildP = 0.8) {
  if (meteredSeconds < 1) {
    return { correctedSeconds: meteredSeconds, compensationStops: 0 };
  }

  // Schwarzschild: T_corr = T_metered^(1/p)
  const corrected = Math.pow(meteredSeconds, 1 / schwarzschildP);
  const compensationStops = Math.log2(corrected / meteredSeconds);

  return {
    correctedSeconds: corrected,
    compensationStops,
  };
}

/**
 * Alternative: manufacturer lookup table for reciprocity.
 * Many films use a step-based table (e.g., Kodak).
 * Returns compensation in stops.
 */
export function reciprocityLookup(meteredSeconds, table) {
  // table = [{ upTo: 1, addStops: 0 }, { upTo: 10, addStops: 0.5 }, ...]
  let compensation = 0;
  for (const entry of table) {
    if (meteredSeconds <= entry.upTo) {
      compensation = entry.addStops;
      break;
    }
  }
  return {
    correctedSeconds: meteredSeconds * Math.pow(2, compensation),
    compensationStops: compensation,
  };
}

// ── Filter factor ──

/** Common filter factors by type */
export const FILTERS = [
  // B&W contrast filters
  { id: 'none',    name: '无滤镜',       stops: 0,   factor: 1,    type: 'none' },
  { id: 'yellow8', name: '黄镜 #8 (K2)', stops: 1,   factor: 2,    type: 'bw' },
  { id: 'yellow12',name: '黄镜 #12',      stops: 1.5, factor: 3,    type: 'bw' },
  { id: 'yellow11',name: '黄绿镜 #11',    stops: 2,   factor: 4,    type: 'bw' },
  { id: 'orange21',name: '橙镜 #21',      stops: 2.3, factor: 5,    type: 'bw' },
  { id: 'red25',   name: '红镜 #25',      stops: 3,   factor: 8,    type: 'bw' },
  { id: 'red29',   name: '红镜 #29',      stops: 4,   factor: 16,   type: 'bw' },
  { id: 'green58', name: '绿镜 #58',      stops: 3,   factor: 8,    type: 'bw' },
  // ND filters
  { id: 'nd2',     name: 'ND2 (1档)',     stops: 1,   factor: 2,    type: 'nd' },
  { id: 'nd4',     name: 'ND4 (2档)',     stops: 2,   factor: 4,    type: 'nd' },
  { id: 'nd8',     name: 'ND8 (3档)',     stops: 3,   factor: 8,    type: 'nd' },
  { id: 'nd64',    name: 'ND64 (6档)',    stops: 6,   factor: 64,   type: 'nd' },
  { id: 'nd1000',  name: 'ND1000 (10档)', stops: 10,  factor: 1000, type: 'nd' },
  // Color / misc
  { id: '81a',     name: '81A 暖色镜',    stops: 0.3, factor: 1.3,  type: 'color' },
  { id: '85b',     name: '85B 色温转换',  stops: 0.7, factor: 1.6,  type: 'color' },
  { id: 'cpl',     name: '偏光镜 (CPL)',  stops: 1.5, factor: 2.8,  type: 'polarizer' },
];

// ── Scene analysis ──

/**
 * Calculate the scene contrast range (in stops) from the metering points.
 * Returns { minZone, maxZone, rangeStops } describing where all points
 * fall on the Zone scale (before user anchoring).
 */
export function sceneContrastRange(pointAnalyses) {
  if (!pointAnalyses || pointAnalyses.length === 0) {
    return { minZone: 5, maxZone: 5, rangeStops: 0 };
  }

  const offsets = pointAnalyses.map(p => p.zoneOffset);
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);

  return {
    minZone: Math.round(5 + minOffset),
    maxZone: Math.round(5 + maxOffset),
    rangeStops: maxOffset - minOffset,
    minOffset,
    maxOffset,
  };
}

/**
 * Check if the scene contrast fits within the film's dynamic range.
 */
export function checkDynamicRange(pointAnalyses, filmDynamicRangeStops) {
  const range = sceneContrastRange(pointAnalyses);
  return {
    fits: range.rangeStops <= filmDynamicRangeStops,
    sceneRange: range.rangeStops,
    filmRange: filmDynamicRangeStops,
    overBy: Math.max(0, range.rangeStops - filmDynamicRangeStops),
  };
}
