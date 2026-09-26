import Link from "next/link"
import { FileTextIcon, ImageIcon } from "lucide-react"

import { StatusBadge, type DocumentStatus } from "@/components/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DocumentSummary } from "@/lib/documents"
import { formatBytes } from "@/lib/upload-rules"

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

export function DocumentsTable({ documents }: { documents: DocumentSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead className="hidden sm:table-cell">Size</TableHead>
          <TableHead className="hidden sm:table-cell">Uploaded</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const Icon = doc.mimeType === "application/pdf" ? FileTextIcon : ImageIcon
          return (
            <TableRow key={doc.id}>
              <TableCell className="max-w-0 w-full">
                <Link href={`/documents/${doc.id}`} className="flex items-center gap-2 hover:underline">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{doc.originalFilename}</span>
                </Link>
              </TableCell>
              <TableCell className="hidden tabular text-muted-foreground sm:table-cell">
                {formatBytes(doc.sizeBytes)}
              </TableCell>
              <TableCell className="hidden tabular text-muted-foreground sm:table-cell">
                {dateFormat.format(new Date(doc.createdAt))}
              </TableCell>
              <TableCell className="text-right">
                <StatusBadge status={doc.status.toLowerCase() as DocumentStatus} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
