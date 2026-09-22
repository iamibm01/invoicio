import { Badge } from "@/components/ui/badge"

// Mirrors the pipeline job states and approval workflow states.
// Replace with the Prisma enums once the schema exists.
export type DocumentStatus = "queued" | "processing" | "review" | "done" | "failed"
export type ApprovalStatus = "submitted" | "approved" | "rejected"

type BadgeVariant = "secondary" | "info" | "warning" | "success" | "destructive"

const statusConfig: Record<DocumentStatus | ApprovalStatus, { variant: BadgeVariant; label: string }> = {
  queued: { variant: "secondary", label: "Queued" },
  processing: { variant: "info", label: "Processing" },
  review: { variant: "warning", label: "Needs review" },
  done: { variant: "success", label: "Done" },
  failed: { variant: "destructive", label: "Failed" },
  submitted: { variant: "secondary", label: "Submitted" },
  approved: { variant: "success", label: "Approved" },
  rejected: { variant: "destructive", label: "Rejected" },
}

export function StatusBadge({ status }: { status: DocumentStatus | ApprovalStatus }) {
  const { variant, label } = statusConfig[status]
  return (
    <Badge variant={variant}>
      {status === "processing" && (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {label}
    </Badge>
  )
}
