// Keep in sync with apps/web/src/lib/upload-rules.ts (the client-side pre-check).
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_TYPES;
