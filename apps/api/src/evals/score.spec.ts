import { FieldValueType } from '../generated/prisma/enums.js';
import { scoreDocument, summarize, type LabeledField, type PredictedField } from './score.js';

const { TEXT, MONEY, DATE, CURRENCY_CODE } = FieldValueType;

const labels: LabeledField[] = [
  { path: 'vendorName', valueType: TEXT, value: 'Careem' },
  { path: 'date', valueType: DATE, value: '2026-08-14' },
  { path: 'currency', valueType: CURRENCY_CODE, value: 'AED' },
  { path: 'total', valueType: MONEY, value: '42.50' },
  { path: 'tax', valueType: MONEY, value: null },
  { path: 'lineItems.0.amount', valueType: MONEY, value: '40.00' },
  { path: 'lineItems.1.amount', valueType: MONEY, value: '2.50' },
];

function predicted(path: string, value: string | null, confidence: number): PredictedField {
  const label = labels.find((l) => l.path === path);
  return { path, valueType: label?.valueType ?? MONEY, value, confidence };
}

describe('scoreDocument', () => {
  it('ignores formatting differences but not content differences', () => {
    const score = scoreDocument('careem.jpg', labels, [
      predicted('vendorName', '  CAREEM ', 0.95),
      predicted('date', '2026-08-14', 0.95),
      predicted('currency', 'aed', 0.95),
      predicted('total', '42.5', 0.95),
      predicted('tax', null, 0.8),
      predicted('lineItems.0.amount', '40', 0.9),
      predicted('lineItems.1.amount', '3.50', 0.6),
    ]);
    expect(score.fields.filter((f) => !f.correct).map((f) => f.path)).toEqual(['lineItems.1.amount']);
  });

  it('marks a missing prediction wrong unless the label is null', () => {
    const score = scoreDocument('careem.jpg', labels, []);
    const tax = score.fields.find((f) => f.path === 'tax');
    const total = score.fields.find((f) => f.path === 'total');
    expect(tax).toMatchObject({ correct: true, confidence: null });
    expect(total).toMatchObject({ correct: false, predicted: null });
  });

  it('reports unlabelled non-null predictions as unexpected', () => {
    const score = scoreDocument('careem.jpg', labels, [
      predicted('lineItems.2.amount', '9.99', 0.4),
      predicted('lineItems.3.amount', null, 0.2),
    ]);
    expect(score.unexpected.map((u) => u.path)).toEqual(['lineItems.2.amount']);
  });
});

describe('summarize', () => {
  const score = scoreDocument('careem.jpg', labels, [
    predicted('vendorName', 'Careem Networks', 0.93), // wrong, confident: silent error
    predicted('date', '2026-08-14', 0.97),
    predicted('currency', 'AED', 0.99),
    predicted('total', '42.50', 0.92),
    predicted('tax', null, 0.75),
    predicted('lineItems.0.amount', '40.00', 0.8),
    predicted('lineItems.1.amount', '25.0', 0.5), // wrong, but would be reviewed
  ]);
  const summary = summarize([score]);

  it('computes overall accuracy', () => {
    expect(summary.fields).toEqual({ total: 7, correct: 5, accuracy: 5 / 7 });
  });

  it('collapses line-item indexes when grouping by path', () => {
    expect(summary.byPath['lineItems.*.amount']).toEqual({ total: 2, correct: 1, accuracy: 0.5 });
  });

  it('buckets by confidence and counts confident errors as silent', () => {
    expect(summary.byConfidence.high).toMatchObject({ total: 4, correct: 3 });
    expect(summary.byConfidence.medium).toMatchObject({ total: 2, correct: 2 });
    expect(summary.byConfidence.low).toMatchObject({ total: 1, correct: 0 });
    expect(summary.silentErrors).toBe(1);
  });

  it('accepts candidate thresholds', () => {
    expect(summarize([score], { high: 0.95, medium: 0.7 }).silentErrors).toBe(0);
  });
});
