import "server-only"

import { cookies } from "next/headers"

/** httpOnly cookie holding the API access token. Read by proxy.ts and the DAL. */
export const SESSION_COOKIE = "invoicio_session"

export async function setSession(accessToken: string, expiresInSeconds: number) {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: expiresInSeconds,
  })
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value
}

export async function clearSession() {
  ;(await cookies()).delete(SESSION_COOKIE)
}
