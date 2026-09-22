import { NextResponse, type NextRequest } from "next/server"

// Must match SESSION_COOKIE in lib/session.ts (that module is server-only).
const SESSION_COOKIE = "invoicio_session"

const PUBLIC_ROUTES = ["/login", "/register", "/design-system"]

/**
 * Optimistic redirect only — it checks that a session cookie exists, not that
 * it's valid. The real check is requireUser() in the DAL, which asks the API.
 *
 * Deliberately no "signed in → leave /login" rule here: a cookie can exist but
 * be expired or forged, and bouncing it to /dashboard would loop. The (auth)
 * layout makes that redirect after verifying the session.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const hasSession = request.cookies.has(SESSION_COOKIE)

  if (!hasSession && !PUBLIC_ROUTES.includes(pathname)) {
    const loginUrl = new URL("/login", request.url)
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // Skip Next internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
}
