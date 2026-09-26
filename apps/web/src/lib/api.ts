import "server-only"

import { getSessionToken } from "@/lib/session"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Every message the API returned; Nest validation errors can carry several */
    readonly messages: string[] = [message],
  ) {
    super(message)
  }
}

/**
 * Calls the Invoicio API from the Next.js server, attaching the session token.
 * The browser never talks to the API directly, so the token never leaves the server.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiUrl = process.env.API_URL
  if (!apiUrl) throw new Error("API_URL is not set")

  const token = await getSessionToken()
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...init.headers,
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null
    // Nest validation errors arrive as an array of messages
    const messages = Array.isArray(body?.message) ? body.message : body?.message ? [body.message] : []
    throw new ApiError(res.status, messages[0] ?? res.statusText, messages.length > 0 ? messages : undefined)
  }
  return (await res.json()) as T
}
