import Link from "next/link"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"

import type { ExtractionRun } from "@/lib/documents"

/**
 * What the validation step found. Arithmetic checks are recomputed from the
 * current values by the API, so correcting a field and saving clears its
 * warning here.
 */
export function ValidationChecks({ validation }: { validation: ExtractionRun["validation"] }) {
  if (!validation.ran) {
    return <p className="text-caption text-muted-foreground">Checks didn&apos;t run for this document.</p>
  }
  if (validation.issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <CircleCheckIcon className="size-4 text-success" />
        Amounts add up · no duplicate or unusual amount found
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {validation.issues.map((issue) => {
        const Icon = issue.severity === "WARNING" ? TriangleAlertIcon : InfoIcon
        return (
          <li key={`${issue.code}:${issue.message}`} className="flex items-start gap-2 text-caption">
            <Icon
              className={
                issue.severity === "WARNING" ? "mt-0.5 size-4 shrink-0 text-warning" : "mt-0.5 size-4 shrink-0 text-info"
              }
            />
            <span>
              {issue.message}
              {issue.relatedDocumentId && (
                <>
                  {" "}
                  <Link href={`/documents/${issue.relatedDocumentId}`} className="underline">
                    View
                  </Link>
                </>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
