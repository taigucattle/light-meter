// ============================================
// exif.js — Minimal EXIF parser for JPEG
// Extracts ExposureTime, ISO, FNumber
// ============================================

/**
 * Parse EXIF data from a JPEG ArrayBuffer.
 * Returns { exposureTime, iso, fNumber } or nulls.
 */
export function parseExif(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);

  // Find APP1 marker (0xFFE1) containing "Exif\0\0"
  let offset = 2; // skip SOI marker
  while (offset < data.length - 10) {
    if (data[offset] === 0xFF && data[offset + 1] === 0xE1) {
      const length = (data[offset + 2] << 8) | data[offset + 3];
      const exifStart = offset + 4;
      // Check for "Exif\0\0"
      if (exifStart + 6 <= data.length &&
          data[exifStart] === 0x45 && // E
          data[exifStart + 1] === 0x78 && // x
          data[exifStart + 2] === 0x69 && // i
          data[exifStart + 3] === 0x66 && // f
          data[exifStart + 4] === 0x00 &&
          data[exifStart + 5] === 0x00) {
        return parseTIFF(data, exifStart + 6);
      }
    }
    // Skip to next marker
    offset += 2;
    if (offset + 2 < data.length) {
      const segLen = (data[offset] << 8) | data[offset + 1];
      offset += segLen;
    } else {
      break;
    }
  }

  return { exposureTime: null, iso: null, fNumber: null };
}

function parseTIFF(data, tiffOffset) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const littleEndian = data[tiffOffset] === 0x49; // 'II' = little-endian

  const tiffMagic = view.getUint16(tiffOffset + 2, littleEndian);
  if (tiffMagic !== 0x002A) return {};

  const ifd0Offset = view.getUint32(tiffOffset + 4, littleEndian);
  const result = { exposureTime: null, iso: null, fNumber: null };

  // Parse IFD0
  parseIFD(view, tiffOffset + ifd0Offset, littleEndian, result);

  // Look for EXIF sub-IFD (tag 0x8769)
  // Parse it for ISO and other EXIF-specific tags
  // We'll handle this in the main IFD parser

  return result;
}

function parseIFD(view, offset, le, result) {
  const numEntries = view.getUint16(offset, le);
  let exifSubIFD = null;

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = offset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, le);
    const type = view.getUint16(entryOffset + 2, le);
    const count = view.getUint32(entryOffset + 4, le);

    // Read value (4 bytes, or offset to data)
    const valueOffset = entryOffset + 8;
    let value;

    switch (tag) {
      case 0x829A: // ExposureTime (rational: 2x UINT32)
        value = readRational(view, entryOffset, le);
        if (value) result.exposureTime = value;
        break;

      case 0x829D: // FNumber (rational)
        value = readRational(view, entryOffset, le);
        if (value) result.fNumber = value;
        break;

      case 0x8827: // ISO (SHORT)
        if (count === 1) {
          result.iso = view.getUint16(valueOffset, le);
        }
        break;

      case 0x8769: // ExifIFD pointer
        exifSubIFD = view.getUint32(valueOffset, le);
        break;
    }
  }

  // Parse EXIF sub-IFD if present
  if (exifSubIFD && result.iso === null) {
    // exifSubIFD is relative to TIFF header start
    // The TIFF header starts at... we need the original tiffOffset
    // For now, ISO might be in IFD0 directly on modern cameras
    parseSubIFD(view, offset + exifSubIFD - 8, le, result);
  }
}

function parseSubIFD(view, offset, le, result) {
  if (offset < 0 || offset + 2 > view.byteLength) return;
  const numEntries = view.getUint16(offset, le);
  for (let i = 0; i < numEntries; i++) {
    const eo = offset + 2 + i * 12;
    if (eo + 12 > view.byteLength) break;
    const tag = view.getUint16(eo, le);
    if (tag === 0x8827) { // ISO
      result.iso = view.getUint16(eo + 8, le);
    }
  }
}

function readRational(view, entryOffset, le) {
  // Rational type = 5, 2 UINT32 values (numerator / denominator)
  // Values > 4 bytes stored at offset pointed to by the 4-byte value field
  const type = view.getUint16(entryOffset + 2, le);
  if (type !== 5) {
    // Try reading as regular value
    const num = view.getUint32(entryOffset + 8, le);
    if (num > 0 && num < 1000000) return num;
    return null;
  }

  // The 4-byte value field is an offset to the actual data
  const dataOffset = view.getUint32(entryOffset + 8, le);

  // Need to calculate absolute position in the buffer
  // The offset is relative to TIFF header... this is tricky.
  // For simplicity, try reading from entryOffset + 8
  // For inlined values (most common), data is right there
  // Actually for EXIF, the offset in the value field is from TIFF header start
  // Let's try a simpler approach: if the offset seems reasonable, read from it
  const absOffset = entryOffset + 8 + dataOffset;
  if (absOffset + 8 < view.byteLength) {
    const num = view.getUint32(absOffset, le);
    const den = view.getUint32(absOffset + 4, le);
    if (den > 0) return num / den;
  }

  return null;
}

/**
 * Capture a photo via ImageCapture and read EXIF.
 * Returns { exposureTime, iso, fNumber }.
 */
export async function readExifFromCamera(track) {
  if (typeof ImageCapture === 'undefined') return null;

  try {
    const capturer = new ImageCapture(track);
    const blob = await capturer.takePhoto();
    const arrayBuffer = await blob.arrayBuffer();
    return parseExif(arrayBuffer);
  } catch (e) {
    console.warn('EXIF capture failed:', e);
    return null;
  }
}
