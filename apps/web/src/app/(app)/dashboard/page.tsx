import type { Metadata } from "next"
import Link from "next/link"
import { InboxIcon, UploadIcon } from "lucide-react"

import { AutoRefresh } from "@/components/auto-refresh"
import { DocumentsTable } from "@/components/documents-table"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { requireUser } from "@/lib/dal"
import { IN_FLIGHT_STATUSES, type DocumentSummary } from "@/lib/documents"

export const metadata: Metadata = { title: "Dashboard · Invoicio" }

export default async function DashboardPage() {
  const [user, documents] = await Promise.all([requireUser(), apiFetch<DocumentSummary[]>("/documents")])

  const uploadLink = (
    <Link href="/upload" className={buttonVariants({ size: "sm" })}>
      <UploadIcon data-icon="inline-start" />
      Upload
    </Link>
  )

  const recent = documents.slice(0, 10)

  return (
    <>
      <AutoRefresh active={recent.some((doc) => IN_FLIGHT_STATUSES.includes(doc.status))} />
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description={user.business.name}
        actions={documents.length > 0 ? uploadLink : undefined}
      />
      {documents.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-heading">Recent documents</h2>
          <DocumentsTable documents={recent} />
        </section>
      ) : (
        <EmptyState
          icon={InboxIcon}
          title="No documents yet"
          description="Upload a receipt or invoice to start extraction."
          action={uploadLink}
        />
      )}
    </>
  )
}
