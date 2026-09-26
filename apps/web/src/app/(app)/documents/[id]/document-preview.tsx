import { ExternalLinkIcon } from "lucide-react"

import type { DocumentSummary } from "@/lib/documents"

/**
 * Shows the original next to the extracted data. Served through the Next.js
 * file route, which adds the session token; the API does the tenant check.
 */
export function DocumentPreview({ document }: { document: DocumentSummary }) {
  const src = `/api/documents/${document.id}/file`

  let preview: React.ReactNode
  if (document.mimeType === "application/pdf") {
    preview = <iframe src={src} title={document.originalFilename} className="h-[70vh] w-full rounded-md border" />
  } else if (document.mimeType === "image/heic") {
    // Only Safari can display HEIC; everyone else gets the download link below.
    preview = (
      <p className="rounded-md border border-dashed p-6 text-center text-body text-muted-foreground">
        HEIC photos can&apos;t be previewed in most browsers.
      </p>
    )
  } else {
    // A plain <img>: next/image would fetch the file server-side without the
    // user's session cookie, and there's nothing to optimise for a private,
    // one-off image anyway.
    // eslint-disable-next-line @next/next/no-img-element
    preview = <img src={src} alt={document.originalFilename} className="w-full rounded-md border" />
  }

  return (
    <div className="flex flex-col gap-2">
      {preview}
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 self-start text-caption text-muted-foreground hover:underline"
      >
        Open original
        <ExternalLinkIcon className="size-3" />
      </a>
    </div>
  )
}
