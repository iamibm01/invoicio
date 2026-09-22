import type { Metadata } from "next"
import { InboxIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { requireUser } from "@/lib/dal"

export const metadata: Metadata = { title: "Dashboard · Invoicio" }

export default async function DashboardPage() {
  const user = await requireUser()

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description={user.business.name} />
      <EmptyState
        icon={InboxIcon}
        title="No documents yet"
        description="Receipt and invoice upload is coming next."
      />
    </>
  )
}
