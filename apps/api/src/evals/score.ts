import { FieldValueType } from '../generated/prisma/enums.js';

/** A ground-truth field, in the same flattened shape as `ExtractionField`. */
export interface LabeledField {
  path: string;
  valueType: FieldValueType;
  /** Canonical string form; null means the document genuinely lacks the field. */
  value: string | null;
}

export interface PredictedField extends LabeledField {
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
}

export interface DocumentScore {
  file: string;
  fields: FieldResult[];
  /** Predicted fields with no label, e.g. hallucinated line items. */
  unexpected: PredictedField[];
}

/**
 * Mirrors CONFIDENCE_THRESHOLDS in apps/web/src/lib/confidence.ts. Passed in
 * rather than imported so an eval can try candidate thresholds before
 * changing the ones the UI uses.
 */
export interface Thresholds {
  high: number;
  medium: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { high: 0.9, medium: 0.7 };

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
    };
  });

  const unexpected = predictions.filter((p) => !labelledPaths.has(p.path) && p.value !== null);
  return { file, fields, unexpected };
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

export function summarize(
  scores: DocumentScore[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): EvalSummary {
  const all = scores.flatMap((s) => s.fields);

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
