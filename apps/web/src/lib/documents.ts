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

/** Documents in these states are still moving through the pipeline. */
export const IN_FLIGHT_STATUSES: readonly ApiDocumentStatus[] = ["QUEUED", "PROCESSING"]

export type FieldValueType = "TEXT" | "NUMBER" | "MONEY" | "DATE" | "CURRENCY_CODE"

export interface ExtractionField {
  id: string
  /** e.g. "total", "lineItems.0.amount" */
  path: string
  valueType: FieldValueType
  /** Canonical string (ISO date, plain decimal); null when not on the document */
  value: string | null
  confidence: number
}

export type FailureKind = "refused" | "malformed" | "api" | "internal"

export interface ExtractionRun {
  id: string
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED"
  model: string
  promptVersion: string
  attempts: number
  /** Keyed by pipeline step, e.g. { extraction: { kind, message } } */
  errors: Record<string, { kind: FailureKind; message: string; retryable: boolean }> | null
  startedAt: string
  completedAt: string | null
  fields: ExtractionField[]
  /** Why the document needs review; empty when it doesn't */
  reviewReasons: string[]
}

export interface DocumentDetail extends DocumentSummary {
  /** Latest extraction run, or null if none has started */
  extraction: ExtractionRun | null
}

const FIELD_LABELS: Record<string, string> = {
  vendorName: "Vendor",
  documentNumber: "Document no.",
  date: "Date",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  description: "description",
  quantity: "quantity",
  amount: "amount",
}

/** "total" → "Total", "lineItems.2.amount" → "Item 3 amount" */
export function fieldLabel(path: string): string {
  const item = /^lineItems\.(\d+)\.(\w+)$/.exec(path)
  if (item) return `Item ${Number(item[1]) + 1} ${FIELD_LABELS[item[2]] ?? item[2]}`
  return FIELD_LABELS[path] ?? path
}

/** Replaces field paths inside a review reason with their labels, sentence-cased. */
export function humanizeReason(reason: string): string {
  const text = reason.replace(/lineItems\.\d+\.\w+|\b[a-z]+[A-Z]\w*\b|\b(date|currency|subtotal|tax|total)\b/g, fieldLabel)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

/** Formats a canonical value for display; null means the field isn't on the document. */
export function formatFieldValue(field: Pick<ExtractionField, "valueType" | "value">): string {
  if (field.value === null) return "—"
  if (field.valueType === "DATE") return dateFormat.format(new Date(`${field.value}T00:00:00Z`))
  return field.value
}
