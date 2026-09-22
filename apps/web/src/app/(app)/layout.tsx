import Link from "next/link"

import { ThemeToggle } from "@/components/theme-toggle"
import { UserMenu } from "@/components/user-menu"
import { requireUser } from "@/lib/dal"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser()

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="text-heading tracking-tight">
              Invoicio
            </Link>
            <span className="truncate text-body text-muted-foreground">{user.business.name}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-content flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  )
}
