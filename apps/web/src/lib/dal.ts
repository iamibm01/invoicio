import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { ApiError, apiFetch } from "@/lib/api"
import type { SessionUser } from "@/lib/auth-types"
import { getSessionToken } from "@/lib/session"

/**
 * The real auth check (proxy.ts only looks for the cookie). Validates the
 * token against the API, memoized per request so layouts and pages can
 * both call it.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (!(await getSessionToken())) return null
  try {
    return await apiFetch<SessionUser>("/auth/me")
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
})

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}
