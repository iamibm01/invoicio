import type { PredictedField } from '../evals/score.js';

/**
 * Keep in sync with apps/web/src/lib/confidence.ts, which uses the same
 * thresholds to colour fields in the UI. Starting points until the eval's
 * calibration numbers say otherwise.
 */
export const CONFIDENCE_THRESHOLDS = { high: 0.9, medium: 0.7 } as const;

/**
 * Fields an expense can't be processed without. If one is missing, the
 * document goes to review even when the model is confident it's absent: a
 * receipt with no total is either misread or not really a receipt.
 */
const REQUIRED_PATHS = ['vendorName', 'date', 'total'] as const;

/**
 * Decides whether a person needs to look at this extraction before it counts
 * as done. Returns the reasons rather than a boolean, so the audit log (and
 * later the review UI) can say *why* a document was flagged.
 */
export function reviewReasons(fields: PredictedField[]): string[] {
  const reasons: string[] = [];

  for (const path of REQUIRED_PATHS) {
    const field = fields.find((f) => f.path === path);
    if (!field || field.value === null) reasons.push(`${path} missing`);
  }

  const lowConfidence = fields.filter((f) => f.confidence < CONFIDENCE_THRESHOLDS.high).map((f) => f.path);
  if (lowConfidence.length > 0) reasons.push(`low confidence: ${lowConfidence.join(', ')}`);

  return reasons;
}
