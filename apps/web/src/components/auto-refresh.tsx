"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

interface AutoRefreshProps {
  /** Poll only while something on the page can still change */
  active: boolean
  intervalMs?: number
}

/**
 * Re-renders the current page's server components on an interval while
 * `active`, so pipeline status updates appear without a manual reload.
 *
 * Polling fits here: extractions take seconds, a few pages poll at most, and
 * the data is already fetched server-side with the session token, so the
 * browser still never talks to the API. Server-sent events or websockets
 * would need an authenticated channel from the browser for little gain.
 *
 * Renders nothing. Once the page data says nothing is in flight, `active`
 * turns false and the polling stops by itself.
 */
export function AutoRefresh({ active, intervalMs = 2000 }: AutoRefreshProps) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      // Don't poll from a background tab.
      if (document.visibilityState === "visible") router.refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs, router])

  return null
}
