import type Anthropic from '@anthropic-ai/sdk';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import type { AllowedMimeType } from '../documents/upload-rules.js';

/**
 * Longest edge Claude reads at full resolution (Opus 4.7 and later). The API
 * downscales anything larger anyway, so resizing here only cuts upload size
 * and keeps phone photos under the per-image size limit. It doesn't lose
 * detail the model would have seen.
 */
export const MAX_IMAGE_EDGE = 2576;

export type DocumentBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

/**
 * Turns a stored document into the content block Claude reads.
 *
 * PDFs go through as-is: the API reads both their text layer and each page as
 * an image. Images are normalised to JPEG, which also:
 *  - applies EXIF orientation, so a sideways phone photo arrives upright
 *    (the model sees raw pixels, not EXIF flags);
 *  - strips metadata such as GPS location, which the model doesn't need.
 */
export async function toDocumentBlock(
  data: Buffer,
  mimeType: AllowedMimeType,
): Promise<DocumentBlock> {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') },
    };
  }

  // Claude accepts JPEG/PNG/GIF/WebP but not HEIC, and sharp's prebuilt
  // binaries can't decode HEIC (they ship without an HEVC decoder), so
  // iPhone photos are decoded by heic-convert first.
  const decodable =
    mimeType === 'image/heic'
      ? Buffer.from(await heicConvert({ buffer: data, format: 'JPEG', quality: 1 }))
      : data;

  const jpeg = await sharp(decodable)
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') },
  };
}
