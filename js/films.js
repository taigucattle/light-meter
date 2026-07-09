// ============================================
// films.js — Film stock database
// Characteristic curves, reciprocity, DR
// ============================================

/**
 * Film stock database.
 *
 * Fields:
 *   name          — Display name
 *   iso           — Box speed
 *   type          — 'bw_neg' | 'color_neg' | 'color_reversal'
 *   formats       — Available formats
 *   dynamicRange  — Effective printable range in stops
 *   gamma         — Approximate contrast index / average gradient
 *   toeStops      — Approximate length of toe (shadows) in stops
 *   shoulderStops — Approximate length of shoulder (highlights) in stops
 *   reciprocity   — Schwarzschild p-exponent OR lookup table
 *   developer     — Typical developer and its effect on CI
 *   spectralNotes — B&W spectral sensitivity notes
 */
export const FILM_DATABASE = [
  // ═══ B&W Negative Films ═══
  {
    id: 'hp5',
    name: 'Ilford HP5+',
    iso: 400,
    type: 'bw_neg',
    formats: ['135', '120', '4x5', '8x10'],
    dynamicRange: 10,
    gamma: 0.55,
    toeStops: 1.5,
    shoulderStops: 2.5,
    reciprocity: { type: 'schwarzschild', p: 0.78 },
    developer: {
      default: 'ID-11 1+1',
      options: [
        { name: 'ID-11 1+1', gamma: 0.55, ei: 400 },
        { name: 'DD-X', gamma: 0.62, ei: 400 },
        { name: 'Rodinal 1+25', gamma: 0.50, ei: 320 },
        { name: 'HC-110 Dil.B', gamma: 0.56, ei: 400 },
      ],
    },
    spectralNotes: '全色 · 中反差 · 宽曝光容差 ±2 档',
  },
  {
    id: 'fp4',
    name: 'Ilford FP4+',
    iso: 125,
    type: 'bw_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 11,
    gamma: 0.53,
    toeStops: 1.8,
    shoulderStops: 3.0,
    reciprocity: { type: 'schwarzschild', p: 0.81 },
    developer: {
      default: 'ID-11 1+1',
      options: [
        { name: 'ID-11 1+1', gamma: 0.53, ei: 125 },
        { name: 'DD-X', gamma: 0.58, ei: 125 },
      ],
    },
    spectralNotes: '全色 · 极细颗粒 · 高锐度',
  },
  {
    id: 'delta100',
    name: 'Ilford Delta 100',
    iso: 100,
    type: 'bw_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 10.5,
    gamma: 0.60,
    toeStops: 1.2,
    shoulderStops: 2.5,
    reciprocity: { type: 'schwarzschild', p: 0.85 },
    developer: {
      default: 'DD-X',
      options: [
        { name: 'DD-X', gamma: 0.60, ei: 100 },
        { name: 'ID-11 1+1', gamma: 0.56, ei: 100 },
      ],
    },
    spectralNotes: '全色 · T颗粒 · ISO 100 中最高锐度',
  },
  {
    id: 'delta3200',
    name: 'Ilford Delta 3200',
    iso: 3200,
    type: 'bw_neg',
    formats: ['135', '120'],
    dynamicRange: 8.5,
    gamma: 0.58,
    toeStops: 1.0,
    shoulderStops: 2.0,
    reciprocity: { type: 'schwarzschild', p: 0.72 },
    developer: {
      default: 'DD-X',
      options: [
        { name: 'DD-X', gamma: 0.58, ei: 3200 },
        { name: 'Microphen', gamma: 0.55, ei: 3200 },
      ],
    },
    spectralNotes: '全色 · 真ISO约1000 · 迫冲容量大',
  },
  {
    id: 'tri-x',
    name: 'Kodak Tri-X 400',
    iso: 400,
    type: 'bw_neg',
    formats: ['135', '120'],
    dynamicRange: 9.5,
    gamma: 0.56,
    toeStops: 1.8,
    shoulderStops: 3.0,
    reciprocity: { type: 'schwarzschild', p: 0.80 },
    developer: {
      default: 'D-76 1+1',
      options: [
        { name: 'D-76 1+1', gamma: 0.56, ei: 400 },
        { name: 'HC-110 Dil.B', gamma: 0.58, ei: 400 },
        { name: 'XTOL 1+1', gamma: 0.54, ei: 400 },
      ],
    },
    spectralNotes: '全色 · 经典颗粒 · 强光肩部巨长 · 过曝3档仍可用',
  },
  {
    id: 'tmax400',
    name: 'Kodak T-Max 400',
    iso: 400,
    type: 'bw_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 9.5,
    gamma: 0.62,
    toeStops: 1.2,
    shoulderStops: 2.2,
    reciprocity: { type: 'schwarzschild', p: 0.85 },
    developer: {
      default: 'T-Max Dev',
      options: [
        { name: 'T-Max Dev', gamma: 0.65, ei: 400 },
        { name: 'D-76 1+1', gamma: 0.60, ei: 400 },
        { name: 'XTOL 1+1', gamma: 0.58, ei: 400 },
      ],
    },
    spectralNotes: '全色 · T颗粒 · 倒易律特性极佳',
  },
  {
    id: 'tmax100',
    name: 'Kodak T-Max 100',
    iso: 100,
    type: 'bw_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 10,
    gamma: 0.63,
    toeStops: 1.0,
    shoulderStops: 2.3,
    reciprocity: { type: 'schwarzschild', p: 0.87 },
    developer: {
      default: 'T-Max Dev',
      options: [
        { name: 'T-Max Dev', gamma: 0.65, ei: 100 },
        { name: 'D-76 1+1', gamma: 0.62, ei: 100 },
        { name: 'XTOL 1+1', gamma: 0.60, ei: 100 },
      ],
    },
    spectralNotes: '全色 · T颗粒 · 最细颗粒100度卷',
  },
  {
    id: 'acros2',
    name: 'Fuji Acros II',
    iso: 100,
    type: 'bw_neg',
    formats: ['135', '120'],
    dynamicRange: 10.5,
    gamma: 0.56,
    toeStops: 1.5,
    shoulderStops: 3.0,
    reciprocity: { type: 'none' }, // Acros II has virtually no reciprocity failure
    developer: {
      default: 'D-76',
      options: [
        { name: 'D-76', gamma: 0.56, ei: 100 },
        { name: 'Fujidol-E', gamma: 0.54, ei: 100 },
        { name: 'Rodinal 1+50', gamma: 0.52, ei: 80 },
      ],
    },
    spectralNotes: '全色 · 倒易律特性史上最佳 · 长曝无需补偿',
  },
  {
    id: 'foma100',
    name: 'Fomapan 100',
    iso: 100,
    type: 'bw_neg',
    formats: ['135', '120', '4x5', '8x10'],
    dynamicRange: 10,
    gamma: 0.58,
    toeStops: 2.0,
    shoulderStops: 2.5,
    reciprocity: { type: 'schwarzschild', p: 0.72 },
    developer: {
      default: 'Fomadon R09',
      options: [
        { name: 'Fomadon R09 (Rodinal)', gamma: 0.55, ei: 100 },
        { name: 'D-76', gamma: 0.58, ei: 100 },
      ],
    },
    spectralNotes: '全色 · 传统颗粒 · 暗部趾部较长 · 倒易律差',
  },
  {
    id: 'foma200',
    name: 'Fomapan 200',
    iso: 200,
    type: 'bw_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 9.5,
    gamma: 0.55,
    toeStops: 1.8,
    shoulderStops: 2.0,
    reciprocity: { type: 'schwarzschild', p: 0.74 },
    developer: {
      default: 'Fomadon R09',
      options: [
        { name: 'Fomadon R09', gamma: 0.54, ei: 200 },
        { name: 'D-76', gamma: 0.55, ei: 200 },
      ],
    },
    spectralNotes: '全色 · 反差偏软 · 性价比高',
  },
  {
    id: 'foma400',
    name: 'Fomapan 400',
    iso: 400,
    type: 'bw_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 9,
    gamma: 0.56,
    toeStops: 1.5,
    shoulderStops: 2.0,
    reciprocity: { type: 'schwarzschild', p: 0.73 },
    developer: {
      default: 'Fomadon R09',
      options: [
        { name: 'Fomadon R09', gamma: 0.55, ei: 320 },
        { name: 'D-76', gamma: 0.57, ei: 400 },
      ],
    },
    spectralNotes: '全色 · 实ISO偏低 · 建议EI320拍',
  },
  {
    id: 'kentmere400',
    name: 'Kentmere 400',
    iso: 400,
    type: 'bw_neg',
    formats: ['135', '120'],
    dynamicRange: 9.5,
    gamma: 0.56,
    toeStops: 1.5,
    shoulderStops: 2.3,
    reciprocity: { type: 'schwarzschild', p: 0.77 },
    developer: {
      default: 'D-76',
      options: [
        { name: 'D-76', gamma: 0.56, ei: 400 },
        { name: 'HC-110 Dil.B', gamma: 0.57, ei: 400 },
      ],
    },
    spectralNotes: '全色 · 入门卷 · Ilford代工',
  },
  {
    id: 'shanghai_gp3',
    name: '上海 GP3 100',
    iso: 100,
    type: 'bw_neg',
    formats: ['120', '4x5'],
    dynamicRange: 9,
    gamma: 0.55,
    toeStops: 2.0,
    shoulderStops: 2.0,
    reciprocity: { type: 'schwarzschild', p: 0.70 },
    developer: {
      default: 'D-76',
      options: [
        { name: 'D-76', gamma: 0.55, ei: 100 },
        { name: 'HC-110 Dil.B', gamma: 0.54, ei: 80 },
      ],
    },
    spectralNotes: '老式乳剂 · 暗部差 · 倒易律差 · 国产经典',
  },

  // ═══ Color Negative Films ═══
  {
    id: 'portra400',
    name: 'Kodak Portra 400',
    iso: 400,
    type: 'color_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 15,
    gamma: 0.50,
    toeStops: 2.0,
    shoulderStops: 5.0,
    reciprocity: { type: 'schwarzschild', p: 0.90 },
    spectralNotes: '宽容度之王 · 肤色优化 · 过曝6档仍可救',
  },
  {
    id: 'portra160',
    name: 'Kodak Portra 160',
    iso: 160,
    type: 'color_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 14,
    gamma: 0.52,
    toeStops: 2.0,
    shoulderStops: 4.5,
    reciprocity: { type: 'schwarzschild', p: 0.90 },
    spectralNotes: '比400色饱和稍高 · 肖像/风光兼备',
  },
  {
    id: 'portra800',
    name: 'Kodak Portra 800',
    iso: 800,
    type: 'color_neg',
    formats: ['135', '120'],
    dynamicRange: 13,
    gamma: 0.50,
    toeStops: 2.5,
    shoulderStops: 4.0,
    reciprocity: { type: 'schwarzschild', p: 0.88 },
    spectralNotes: '低光之王 · 颗粒较Portra400粗 · 迫冲至1600可用',
  },
  {
    id: 'ektar100',
    name: 'Kodak Ektar 100',
    iso: 100,
    type: 'color_neg',
    formats: ['135', '120', '4x5'],
    dynamicRange: 11,
    gamma: 0.65,
    toeStops: 1.5,
    shoulderStops: 3.0,
    reciprocity: { type: 'schwarzschild', p: 0.90 },
    spectralNotes: '世界最细颗粒彩负 · 高饱和 · 像反转片的彩负',
  },
  {
    id: 'gold200',
    name: 'Kodak Gold 200',
    iso: 200,
    type: 'color_neg',
    formats: ['135', '120'],
    dynamicRange: 12,
    gamma: 0.55,
    toeStops: 2.0,
    shoulderStops: 4.0,
    reciprocity: { type: 'schwarzschild', p: 0.88 },
    spectralNotes: '暖色调 · 性价比 · 阳光卷 · 高光金灿灿',
  },
  {
    id: 'ultramax400',
    name: 'Kodak Ultramax 400',
    iso: 400,
    type: 'color_neg',
    formats: ['135'],
    dynamicRange: 11,
    gamma: 0.56,
    toeStops: 2.0,
    shoulderStops: 3.5,
    reciprocity: { type: 'schwarzschild', p: 0.87 },
    spectralNotes: '饱和偏高 · 廉价全能卷 · 迫冲一般',
  },
  {
    id: 'fuji400',
    name: 'Fujifilm 400 (美产)',
    iso: 400,
    type: 'color_neg',
    formats: ['135'],
    dynamicRange: 11,
    gamma: 0.54,
    toeStops: 2.0,
    shoulderStops: 3.5,
    reciprocity: { type: 'schwarzschild', p: 0.87 },
    spectralNotes: '据信为Kodak代工 · 类Ultramax · 偏冷调',
  },
  {
    id: 'cinestill800t',
    name: 'CineStill 800T',
    iso: 800,
    type: 'color_neg',
    formats: ['135', '120'],
    dynamicRange: 12,
    gamma: 0.55,
    toeStops: 2.0,
    shoulderStops: 4.0,
    reciprocity: { type: 'schwarzschild', p: 0.88 },
    spectralNotes: '灯光卷 · 去碳层 · 光晕效果 · 暗光神器',
  },
  {
    id: 'cinestill400d',
    name: 'CineStill 400D',
    iso: 400,
    type: 'color_neg',
    formats: ['135', '120'],
    dynamicRange: 13,
    gamma: 0.52,
    toeStops: 2.0,
    shoulderStops: 4.5,
    reciprocity: { type: 'schwarzschild', p: 0.90 },
    spectralNotes: '日光电影卷 · 去碳层 · 类似Vision3 250D',
  },
  {
    id: 'lomo800',
    name: 'Lomography 800',
    iso: 800,
    type: 'color_neg',
    formats: ['135', '120'],
    dynamicRange: 11,
    gamma: 0.55,
    toeStops: 2.0,
    shoulderStops: 3.5,
    reciprocity: { type: 'schwarzschild', p: 0.86 },
    spectralNotes: '饱和偏高 · Lomo味 · 据信Kodak代工',
  },
  {
    id: 'phoenix200',
    name: 'Harman Phoenix 200',
    iso: 200,
    type: 'color_neg',
    formats: ['135', '120'],
    dynamicRange: 8,
    gamma: 0.70,
    toeStops: 1.5,
    shoulderStops: 1.0,
    reciprocity: { type: 'schwarzschild', p: 0.75 },
    spectralNotes: 'Ilford首款彩负 · 实验性 · 高反差 · 高光易飞',
  },

  // ═══ Color Reversal (Slide) Films ═══
  {
    id: 'velvia50',
    name: 'Fuji Velvia 50',
    iso: 50,
    type: 'color_reversal',
    formats: ['135', '120', '4x5', '8x10'],
    dynamicRange: 5,
    gamma: 0.85,
    toeStops: 1.0,
    shoulderStops: 0.5,
    reciprocity: { type: 'schwarzschild', p: 0.85 },
    spectralNotes: '反转片之王 · 5档DR · 高光宁可欠半档 · 风景专用',
  },
  {
    id: 'velvia100',
    name: 'Fuji Velvia 100',
    iso: 100,
    type: 'color_reversal',
    formats: ['135', '120', '4x5'],
    dynamicRange: 5,
    gamma: 0.82,
    toeStops: 1.0,
    shoulderStops: 0.5,
    reciprocity: { type: 'schwarzschild', p: 0.85 },
    spectralNotes: '稍冷调 · 比50速度翻倍 · 精度要求同等严苛',
  },
  {
    id: 'provia100f',
    name: 'Fuji Provia 100F',
    iso: 100,
    type: 'color_reversal',
    formats: ['135', '120', '4x5', '8x10'],
    dynamicRange: 6,
    gamma: 0.78,
    toeStops: 1.2,
    shoulderStops: 0.8,
    reciprocity: { type: 'schwarzschild', p: 0.88 },
    spectralNotes: '中性色彩 · 人像/风光通用 · 比Velvia多1档',
  },
  {
    id: 'ektachrome100',
    name: 'Kodak Ektachrome E100',
    iso: 100,
    type: 'color_reversal',
    formats: ['135', '120', '4x5'],
    dynamicRange: 6,
    gamma: 0.79,
    toeStops: 1.2,
    shoulderStops: 0.8,
    reciprocity: { type: 'schwarzschild', p: 0.87 },
    spectralNotes: '中性偏冷 · 蓝色表现佳 · 柯达复活之作',
  },
];

// ── Format definitions ──
export const FORMATS = [
  {
    id: '135',
    name: '135 (35mm)',
    aspectRatio: 3/2,   // 36×24mm
    cropFactor: 1.0,    // vs full-frame reference
  },
  {
    id: '120_66',
    name: '120 6×6',
    aspectRatio: 1/1,   // 56×56mm
    cropFactor: 0.55,
  },
  {
    id: '120_67',
    name: '120 6×7',
    aspectRatio: 7/6,   // 56×67mm
    cropFactor: 0.50,
  },
  {
    id: '120_645',
    name: '120 6×4.5',
    aspectRatio: 4/3,   // 56×42mm
    cropFactor: 0.62,
  },
  {
    id: '120_69',
    name: '120 6×9',
    aspectRatio: 3/2,   // 56×84mm
    cropFactor: 0.43,
  },
];

/** Focal lengths for frame line display */
export const FOCAL_LENGTHS = [
  { mm: 21, label: '21mm', category: '超广角' },
  { mm: 24, label: '24mm', category: '超广角' },
  { mm: 28, label: '28mm', category: '广角' },
  { mm: 35, label: '35mm', category: '广角' },
  { mm: 40, label: '40mm', category: '标准' },
  { mm: 50, label: '50mm', category: '标准' },
  { mm: 75, label: '75mm', category: '中焦' },
  { mm: 85, label: '85mm', category: '中焦' },
  { mm: 90, label: '90mm', category: '中焦' },
  { mm: 105, label: '105mm', category: '长焦' },
  { mm: 135, label: '135mm', category: '长焦' },
];

// ── Film lookup helpers ──

/**
 * Find a film by ID.
 */
export function getFilm(id) {
  return FILM_DATABASE.find(f => f.id === id);
}

/**
 * Get films filtered by format.
 */
export function getFilmsByFormat(formatId) {
  return FILM_DATABASE.filter(f => f.formats.some(fmt => {
    // Match format category (135, 120, 4x5, 8x10)
    const base = fmt.toLowerCase();
    const query = formatId.toLowerCase();
    if (base === query) return true;
    // 120 format group matches all 120 variants
    if (base === '120' && query.startsWith('120')) return true;
    return false;
  }));
}

/**
 * Get reciprocity compensation for a film at a given metered time.
 */
export function getFilmReciprocity(film, meteredSeconds) {
  if (!film || !film.reciprocity) return { correctedSeconds: meteredSeconds, compensationStops: 0 };

  const r = film.reciprocity;

  if (r.type === 'none') {
    return { correctedSeconds: meteredSeconds, compensationStops: 0 };
  }

  if (r.type === 'schwarzschild') {
    if (meteredSeconds < 1) return { correctedSeconds: meteredSeconds, compensationStops: 0 };
    const corrected = Math.pow(meteredSeconds, 1 / r.p);
    return {
      correctedSeconds: corrected,
      compensationStops: Math.log2(corrected / meteredSeconds),
    };
  }

  return { correctedSeconds: meteredSeconds, compensationStops: 0 };
}
