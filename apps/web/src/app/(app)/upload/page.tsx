import type { Metadata } from "next"

import { DocumentsTable } from "@/components/documents-table"
import { PageHeader } from "@/components/page-header"
import { apiFetch } from "@/lib/api"
import type { DocumentSummary } from "@/lib/documents"

import { UploadDropzone } from "./upload-dropzone"

export const metadata: Metadata = { title: "Upload · Invoicio" }

export default async function UploadPage() {
  const documents = await apiFetch<DocumentSummary[]>("/documents")

  return (
    <>
      <PageHeader
        title="Upload documents"
        description="Receipts and invoices are queued for extraction as soon as they upload."
      />
      <UploadDropzone />
      {documents.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-heading">Recent uploads</h2>
          <DocumentsTable documents={documents} />
        </section>
      )}
    </>
  )
}
