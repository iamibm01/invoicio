// Mirrors the API's document summary (apps/api/src/documents).
export type ApiDocumentStatus = "QUEUED" | "PROCESSING" | "REVIEW" | "DONE" | "FAILED"

export interface DocumentSummary {
  id: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  status: ApiDocumentStatus
  createdAt: string
}

export interface UploadResult {
  document: DocumentSummary
  /** True when this exact file was already uploaded; `document` is the existing one */
  duplicate: boolean
}
