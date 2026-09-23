import sharp from 'sharp';
import { MAX_IMAGE_EDGE, toDocumentBlock } from './document-input.js';

async function decode(block: Awaited<ReturnType<typeof toDocumentBlock>>) {
  if (block.type !== 'image' || block.source.type !== 'base64') throw new Error('expected a base64 image');
  const buffer = Buffer.from(block.source.data, 'base64');
  return { mediaType: block.source.media_type, meta: await sharp(buffer).metadata() };
}

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#fff' } });

describe('toDocumentBlock', () => {
  it('passes PDFs through unchanged as a document block', async () => {
    const pdf = Buffer.from('%PDF-1.7 fake');
    const block = await toDocumentBlock(pdf, 'application/pdf');
    expect(block).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
    });
  });

  it('converts PNG to JPEG', async () => {
    const png = await solid(400, 300).png().toBuffer();
    const { mediaType, meta } = await decode(await toDocumentBlock(png, 'image/png'));
    expect(mediaType).toBe('image/jpeg');
    expect(meta.format).toBe('jpeg');
  });

  it('shrinks large photos to the maximum edge, keeping aspect ratio', async () => {
    const photo = await solid(4032, 3024).jpeg().toBuffer();
    const { meta } = await decode(await toDocumentBlock(photo, 'image/jpeg'));
    expect(meta.width).toBe(MAX_IMAGE_EDGE);
    expect(meta.height).toBe(Math.round((3024 / 4032) * MAX_IMAGE_EDGE));
  });

  it('never enlarges small images', async () => {
    const small = await solid(300, 200).jpeg().toBuffer();
    const { meta } = await decode(await toDocumentBlock(small, 'image/jpeg'));
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it('applies EXIF orientation and strips metadata', async () => {
    // Stored landscape with an EXIF flag saying "rotate 90°", as phones do.
    const sideways = await solid(400, 300).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { meta } = await decode(await toDocumentBlock(sideways, 'image/jpeg'));
    expect([meta.width, meta.height]).toEqual([300, 400]);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });
});
