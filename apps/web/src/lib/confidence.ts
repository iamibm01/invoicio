export type ConfidenceLevel = "high" | "medium" | "low"

/*
 * Thresholds for bucketing a field's confidence score (0–1). Keep in sync
 * with apps/api/src/extractions/review-policy.ts, which decides REVIEW vs DONE.
 * Anything below HIGH is surfaced in the review UI; LOW fields are
 * flagged as likely wrong. Tune these once there is labeled test data
 * to measure against — they are a starting point, not a result.
 */
export const CONFIDENCE_THRESHOLDS = {
  high: 0.9,
  medium: 0.7,
} as const

export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return "high"
  if (score >= CONFIDENCE_THRESHOLDS.medium) return "medium"
  return "low"
}

export function needsReview(score: number): boolean {
  return getConfidenceLevel(score) !== "high"
}
