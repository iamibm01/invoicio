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
    const refreshIfVisible = () => {
      // Background tabs don't poll; they catch up the moment they're shown again.
      if (document.visibilityState === "visible") router.refresh()
    }
    const id = setInterval(refreshIfVisible, intervalMs)
    document.addEventListener("visibilitychange", refreshIfVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", refreshIfVisible)
    }
  }, [active, intervalMs, router])

  return null
}
