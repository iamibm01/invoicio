import { detectFileType } from './detect-file-type.js';

const bytes = (...values: (number | string)[]) =>
  Buffer.concat(values.map((v) => (typeof v === 'string' ? Buffer.from(v, 'latin1') : Buffer.from([v]))));

describe('detectFileType', () => {
  it('detects PDF, JPEG, PNG and HEIC by signature', () => {
    expect(detectFileType(bytes('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectFileType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(detectFileType(bytes(0, 0, 0, 0x18, 'ftypheic'))).toBe('image/heic');
  });

  it('rejects other files regardless of name or claimed type', () => {
    expect(detectFileType(bytes('hello, I am a .pdf'))).toBeNull();
    expect(detectFileType(bytes('GIF89a'))).toBeNull();
    expect(detectFileType(bytes(0, 0, 0, 0x18, 'ftypavif'))).toBeNull(); // AVIF, not HEIC
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
