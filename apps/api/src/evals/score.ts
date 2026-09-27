import { CONFIDENCE_THRESHOLDS, REQUIRED_PATHS } from '../extractions/review-policy.js';
import { FieldValueType } from '../generated/prisma/enums.js';

/** A ground-truth field, in the same flattened shape as `ExtractionField`. */
export interface LabeledField {
  path: string;
  valueType: FieldValueType;
  /** Canonical string form; null means the document genuinely lacks the field. */
  value: string | null;
  /**
   * Where the label came from. Absent = labelled or checked by hand.
   * "official" = a dataset's own ground truth (e.g. SROIE).
   * "draft" = the model's output, not yet checked. Drafts are excluded from
   * scores by default: scoring the model against its own unchecked answers
   * would count every mistake it repeats as correct.
   */
  source?: 'official' | 'draft';
}

export interface PredictedField {
  path: string;
  valueType: FieldValueType;
  value: string | null;
  confidence: number;
}

export interface FieldResult {
  path: string;
  valueType: FieldValueType;
  expected: string | null;
  predicted: string | null;
  /** Null when the model did not return the field at all. */
  confidence: number | null;
  correct: boolean;
  source?: LabeledField['source'];
}

export interface DocumentScore {
  file: string;
  fields: FieldResult[];
  /** Predicted fields with no label, e.g. hallucinated line items. */
  unexpected: PredictedField[];
  /** Everything the model returned, labelled or not; review decisions depend on all of it. */
  predictions: PredictedField[];
}

/**
 * Passed in rather than hard-coded so an eval can try candidate thresholds
 * before changing the ones the pipeline and UI use.
 */
export interface Thresholds {
  high: number;
  medium: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = CONFIDENCE_THRESHOLDS;

interface Tally {
  total: number;
  correct: number;
  accuracy: number;
}

export interface EvalSummary {
  documents: number;
  fields: Tally;
  /** Accuracy per field kind, with line-item indexes collapsed (`lineItems.*.amount`). */
  byPath: Record<string, Tally>;
  /**
   * Accuracy within each confidence level. A well-calibrated model is right
   * more often in higher levels. Fields the model omitted aren't counted here.
   */
  byConfidence: Record<'high' | 'medium' | 'low', Tally>;
  /**
   * Wrong values that scored at or above `thresholds.high`, so the review
   * UI would not flag them. This is the error that matters most: a human
   * never gets the chance to catch it.
   */
  silentErrors: number;
  unexpectedFields: number;
}

/**
 * Normalises values before comparing so that formatting differences don't
 * count as errors. Text matching stays strict apart from case and whitespace:
 * "UBER BV" vs "Uber" is a real disagreement about what the vendor is.
 */
function normalize(valueType: FieldValueType, value: string): string {
  switch (valueType) {
    case FieldValueType.MONEY:
    case FieldValueType.NUMBER: {
      // "84.5" and "84.50" are the same amount.
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : value.trim();
    }
    case FieldValueType.CURRENCY_CODE:
      return value.trim().toUpperCase();
    case FieldValueType.DATE:
      return value.trim();
    case FieldValueType.TEXT:
      return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }
}

function valuesMatch(valueType: FieldValueType, a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return normalize(valueType, a) === normalize(valueType, b);
}

/**
 * Scores one document. Line items are matched by index, so a model that
 * returns the right items in a different order is marked wrong; this is fine
 * while receipts are read top to bottom, but worth revisiting if it shows up
 * as noise in the results.
 */
export function scoreDocument(
  file: string,
  labels: LabeledField[],
  predictions: PredictedField[],
): DocumentScore {
  const predictedByPath = new Map(predictions.map((p) => [p.path, p]));
  const labelledPaths = new Set(labels.map((l) => l.path));

  const fields = labels.map((label): FieldResult => {
    const prediction = predictedByPath.get(label.path);
    const predicted = prediction?.value ?? null;
    return {
      path: label.path,
      valueType: label.valueType,
      expected: label.value,
      predicted,
      confidence: prediction?.confidence ?? null,
      correct: valuesMatch(label.valueType, label.value, predicted),
      source: label.source,
    };
  });

  const unexpected = predictions.filter((p) => !labelledPaths.has(p.path) && p.value !== null);
  return { file, fields, unexpected, predictions };
}

function tally(results: FieldResult[]): Tally {
  const correct = results.filter((r) => r.correct).length;
  return {
    total: results.length,
    correct,
    accuracy: results.length === 0 ? 0 : correct / results.length,
  };
}

function confidenceLevel(score: number, thresholds: Thresholds): 'high' | 'medium' | 'low' {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

/** Field results that count towards scores: drafts only when asked for. */
function scored(scores: DocumentScore[], includeDrafts: boolean): FieldResult[] {
  const all = scores.flatMap((s) => s.fields);
  return includeDrafts ? all : all.filter((r) => r.source !== 'draft');
}

export function summarize(
  scores: DocumentScore[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): EvalSummary {
  const all = scored(scores, includeDrafts);

  const groups = new Map<string, FieldResult[]>();
  for (const result of all) {
    const key = result.path.replace(/\.\d+\./g, '.*.');
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  const levels = { high: [] as FieldResult[], medium: [] as FieldResult[], low: [] as FieldResult[] };
  for (const result of all) {
    if (result.confidence !== null) levels[confidenceLevel(result.confidence, thresholds)].push(result);
  }

  return {
    documents: scores.length,
    fields: tally(all),
    byPath: Object.fromEntries([...groups].map(([path, results]) => [path, tally(results)])),
    byConfidence: {
      high: tally(levels.high),
      medium: tally(levels.medium),
      low: tally(levels.low),
    },
    silentErrors: levels.high.filter((r) => !r.correct).length,
    unexpectedFields: scores.reduce((n, s) => n + s.unexpected.length, 0),
  };
}

export interface CalibrationBucket {
  /** Inclusive lower bound, exclusive upper bound (the top bucket includes 1). */
  from: number;
  to: number;
  total: number;
  correct: number;
  /** Mean confidence the model claimed in this bucket. */
  meanConfidence: number;
  /** How often it was actually right. Well calibrated: close to meanConfidence. */
  accuracy: number;
}

/**
 * Accuracy per confidence band. If the model says "0.95" it should be right
 * about 95% of the time; a band where accuracy sits well below mean
 * confidence is where the model is overconfident, and where the review
 * threshold needs to sit above.
 */
export function calibration(
  scores: DocumentScore[],
  edges: number[] = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 1],
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): CalibrationBucket[] {
  const results = scored(scores, includeDrafts).filter((r) => r.confidence !== null);
  return edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const last = i === edges.length - 2;
    const inBucket = results.filter((r) => r.confidence! >= from && (last ? r.confidence! <= to : r.confidence! < to));
    const correct = inBucket.filter((r) => r.correct).length;
    const total = inBucket.length;
    return {
      from,
      to,
      total,
      correct,
      meanConfidence: total === 0 ? 0 : inBucket.reduce((sum, r) => sum + r.confidence!, 0) / total,
      accuracy: total === 0 ? 0 : correct / total,
    };
  });
}

export interface ThresholdOutcome {
  threshold: number;
  /** Wrong values at or above the threshold: they skip review. */
  silentErrors: number;
  /** Wrong values below the threshold (or missing): a reviewer sees them. */
  caughtErrors: number;
  /** Share of documents that would go to review. */
  reviewRate: number;
}

/**
 * The trade-off behind the "high" threshold. Raising it catches more errors
 * but sends more documents to a person; lowering it saves review work but
 * lets more wrong values through unseen. This shows both sides per candidate,
 * using the same document-level rule as review-policy.ts (any field below
 * the threshold, or a required field missing).
 */
export function thresholdSweep(
  scores: DocumentScore[],
  candidates: number[] = [0.7, 0.8, 0.85, 0.9, 0.95],
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): ThresholdOutcome[] {
  const wrong = scored(scores, includeDrafts).filter((r) => !r.correct);
  return candidates.map((threshold) => {
    const silentErrors = wrong.filter((r) => r.confidence !== null && r.confidence >= threshold).length;
    const reviewed = scores.filter(
      (s) =>
        s.predictions.some((p) => p.confidence < threshold) ||
        REQUIRED_PATHS.some((path) => !s.predictions.some((p) => p.path === path && p.value !== null)),
    ).length;
    return {
      threshold,
      silentErrors,
      caughtErrors: wrong.length - silentErrors,
      reviewRate: scores.length === 0 ? 0 : reviewed / scores.length,
    };
  });
}
