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
export const REQUIRED_PATHS = ['vendorName', 'date', 'total'] as const;

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

/**
 * Review reason for a pipeline step that failed in a PARTIAL run: the output
 * is usable, but that step's checks are missing, so a person stands in for them.
 */
export function stepFailureReason(step: string): string {
  return `${step} step failed`;
}

/** What runReviewReasons needs to know about a finished run. */
export interface RunForReview {
  fields: PredictedField[];
  classification: { documentType: string; confidence: number } | null;
  /** Steps that didn't succeed; `key` is the step's lower-case name, e.g. "validation". */
  steps: { key: string; status: 'FAILED' | 'SKIPPED'; reason?: string }[];
}

/**
 * Every reason a finished run needs a person, in one place. Used both when a
 * run completes (to choose REVIEW or DONE) and when a document is shown (to
 * explain why), so the two can never disagree.
 */
export function runReviewReasons(run: RunForReview): string[] {
  const reasons: string[] = [];

  // If extraction was skipped, "vendorName missing" etc. would be noise:
  // the skip reason (e.g. "Not a receipt or invoice: ...") is the explanation.
  const extractionSkipped = run.steps.find((s) => s.key === 'extraction' && s.status === 'SKIPPED');
  if (extractionSkipped) reasons.push(extractionSkipped.reason ?? 'extraction skipped');
  else reasons.push(...reviewReasons(run.fields));

  if (run.classification && run.classification.confidence < CONFIDENCE_THRESHOLDS.high) {
    reasons.push(`document type uncertain (${run.classification.documentType.toLowerCase()})`);
  }
  for (const step of run.steps) {
    if (step.status === 'FAILED') reasons.push(stepFailureReason(step.key));
  }
  return reasons;
}
