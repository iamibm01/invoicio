"use server"

import { refresh } from "next/cache"

import { ApiError, apiFetch } from "@/lib/api"

export interface ReviewFormState {
  /** Errors for specific fields, keyed by field path (e.g. "date", "lineItems.0.amount") */
  fieldErrors?: Record<string, string>
  /** Errors that don't belong to one field */
  error?: string
}

interface FieldCorrection {
  fieldId: string
  value: string | null
}

/**
 * Submits a review. The client sends only the fields the reviewer changed,
 * as JSON in one hidden input. Sending unchanged values too would silently
 * overwrite a colleague's newer correction with the stale value this page
 * loaded.
 */
export async function submitReview(
  documentId: string,
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const raw = formData.get("corrections")
  let corrections: FieldCorrection[]
  try {
    corrections = JSON.parse(typeof raw === "string" ? raw : "[]") as FieldCorrection[]
  } catch {
    return { error: "The form was malformed; reload the page and try again." }
  }

  try {
    await apiFetch(`/documents/${encodeURIComponent(documentId)}/review`, {
      method: "POST",
      body: JSON.stringify({ corrections }),
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      // The API reports "path: message" per invalid field; anything else is general.
      const fieldErrors: Record<string, string> = {}
      const other: string[] = []
      for (const message of error.messages) {
        const match = /^([\w.]+): (.+)$/.exec(message)
        if (match) fieldErrors[match[1]] = match[2]
        else other.push(message)
      }
      return { fieldErrors, error: other[0] }
    }
    if (error instanceof ApiError && error.status === 409) {
      return { error: "This document changed while you were reviewing it. Reload to see the latest version." }
    }
    throw error
  }

  // Re-render the page with the saved values; the form remounts with them.
  refresh()
  return {}
}
