import type { AllowedMimeType } from './upload-rules.js';

// ISO-BMFF brands used by HEIC/HEIF photos (iPhone camera default).
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * Identifies a file from its leading bytes ("magic numbers"). The browser-sent
 * Content-Type and the filename extension are both client-controlled, so they
 * are never trusted to decide what a file is.
 */
export function detectFileType(buffer: Buffer): AllowedMimeType | null {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) return 'image/png';

  // HEIF: bytes 4–8 are "ftyp", followed by a 4-character brand
  if (
    buffer.subarray(4, 8).toString('latin1') === 'ftyp' &&
    HEIF_BRANDS.has(buffer.subarray(8, 12).toString('latin1'))
  ) {
    return 'image/heic';
  }

  return null;
}
