// Client-side pre-check so users get instant feedback. The API re-validates
// everything (and identifies type from file content) — keep in sync with
// apps/api/src/documents/upload-rules.ts.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

const ACCEPTED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "heic", "heif"]
const ACCEPTED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]

/** Value for <input accept>. Extensions included because many browsers report HEIC with an empty type. */
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_MIME_TYPES, ...ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`)].join(",")

export function validateUpload(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (!ACCEPTED_MIME_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.includes(extension)) {
    return "Unsupported file type — use PDF, JPG, PNG or HEIC"
  }
  if (file.size > MAX_UPLOAD_BYTES) return `Too large — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}`
  if (file.size === 0) return "File is empty"
  return null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
