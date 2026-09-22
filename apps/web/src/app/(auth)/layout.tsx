import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/dal"

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // Already signed in (verified with the API, not just a cookie) → skip the form
  if (await getCurrentUser()) redirect("/dashboard")

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <p className="text-heading tracking-tight">Invoicio</p>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}
