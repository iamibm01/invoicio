import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { AlertTriangleIcon, LoaderCircleIcon, XCircleIcon } from "lucide-react"

import { AutoRefresh } from "@/components/auto-refresh"
import { PageHeader } from "@/components/page-header"
import { StatusBadge, type DocumentStatus } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, apiFetch } from "@/lib/api"
import {
  humanizeReason,
  IN_FLIGHT_STATUSES,
  type DocumentDetail,
  type ExtractionRun,
  type FailureKind,
} from "@/lib/documents"

import { DocumentPreview } from "./document-preview"
import { ReviewForm } from "./review-form"

export const metadata: Metadata = { title: "Document · Invoicio" }

/**
 * The queue retries a retryable failure after 30s, then 60s. Within this
 * window after a failure, the page keeps polling so the retry shows up.
 */
const RETRY_WINDOW_MS = 2 * 60 * 1000

const FAILURE_MESSAGES: Record<FailureKind, string> = {
  refused: "The model declined to process this document.",
  malformed: "The model didn't return valid data after several attempts.",
  api: "The extraction service couldn't be reached.",
  internal: "Something went wrong while processing this document.",
}

async function getDocument(id: string): Promise<DocumentDetail> {
  try {
    return await apiFetch<DocumentDetail>(`/documents/${encodeURIComponent(id)}`)
  } catch (error) {
    // 400 = not a valid id, 404 = doesn't exist or belongs to another business.
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound()
    throw error
  }
}

/**
 * True for a retryable failure recent enough that the queue's retry is still
 * pending. A plain function rather than render logic: it depends on the clock,
 * so it's a fact about the data at request time, not part of rendering.
 */
function isRetryPending(document: DocumentDetail, now = Date.now()): boolean {
  const run = document.extraction
  return (
    document.status === "FAILED" &&
    run?.errors?.extraction?.retryable === true &&
    run.completedAt != null &&
    now - new Date(run.completedAt).getTime() < RETRY_WINDOW_MS
  )
}

function latestCorrectionAt(run: ExtractionRun): string {
  return run.fields.reduce((latest, f) => (f.correction && f.correction.at > latest ? f.correction.at : latest), "")
}

function formatDuration(run: ExtractionRun): string | null {
  if (!run.completedAt) return null
  const seconds = (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
  return `${seconds.toFixed(1)}s`
}

export default async function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  const { id } = await params
  const document = await getDocument(id)
  const run = document.extraction
  const failure = run?.errors?.extraction

  const inFlight = IN_FLIGHT_STATUSES.includes(document.status)
  const retryPending = isRetryPending(document)

  let panel: React.ReactNode
  if (inFlight || !run) {
    panel = (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          {document.status === "QUEUED" ? "Waiting to be extracted…" : "Extracting fields…"}
        </p>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  } else if (run.status === "FAILED") {
    panel = (
      <Alert variant="destructive">
        <XCircleIcon />
        <AlertTitle>Extraction failed</AlertTitle>
        <AlertDescription>
          {failure ? FAILURE_MESSAGES[failure.kind] : "Unknown error."}
          {retryPending && " It will be retried automatically."}
        </AlertDescription>
      </Alert>
    )
  } else {
    panel = (
      <div className="flex flex-col gap-4">
        {document.status === "REVIEW" && run.reviewReasons.length > 0 && (
          <Alert variant="warning">
            <AlertTriangleIcon />
            <AlertTitle>Needs review</AlertTitle>
            <AlertDescription>
              <ul className="list-inside list-disc">
                {run.reviewReasons.map((reason) => (
                  <li key={reason}>{humanizeReason(reason)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {/* Keyed on what a save changes, so the form remounts with fresh values after one. */}
        <ReviewForm
          key={`${document.status}:${latestCorrectionAt(run)}`}
          documentId={document.id}
          status={document.status}
          fields={run.fields}
        />
      </div>
    )
  }

  return (
    <>
      <AutoRefresh active={inFlight || retryPending} />
      <PageHeader
        title={document.originalFilename}
        description={`Uploaded ${new Date(document.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
        actions={<StatusBadge status={document.status.toLowerCase() as DocumentStatus} />}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <DocumentPreview document={document} />
        </div>
        <section className="flex flex-col gap-4">
          <h2 className="text-heading">Extracted data</h2>
          {panel}
          {run?.completedAt && (
            <p className="text-caption text-muted-foreground tabular">
              {[run.model, run.promptVersion, `${run.attempts} attempt${run.attempts === 1 ? "" : "s"}`, formatDuration(run)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </section>
      </div>
    </>
  )
}
