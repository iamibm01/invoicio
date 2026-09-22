import Link from "next/link"

import { AppNav } from "@/components/app-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserMenu } from "@/components/user-menu"
import { requireUser } from "@/lib/dal"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser()

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/dashboard" className="text-heading tracking-tight">
              Invoicio
            </Link>
            <AppNav />
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden truncate text-body text-muted-foreground md:inline">{user.business.name}</span>
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
