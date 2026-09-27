import { FieldValueType } from '../generated/prisma/enums.js';
import { calibration, scoreDocument, summarize, thresholdSweep, type LabeledField, type PredictedField } from './score.js';

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

describe('draft labels', () => {
  const withDraft: LabeledField[] = [
    { path: 'total', valueType: MONEY, value: '42.50', source: 'official' },
    { path: 'tax', valueType: MONEY, value: '9.99', source: 'draft' },
  ];
  const score = scoreDocument('careem.jpg', withDraft, [predicted('total', '42.50', 0.95), predicted('tax', '2.50', 0.95)]);

  it('are left out of scores by default', () => {
    expect(summarize([score]).fields).toMatchObject({ total: 1, correct: 1 });
  });

  it('can be included explicitly', () => {
    expect(summarize([score], undefined, { includeDrafts: true }).fields).toMatchObject({ total: 2, correct: 1 });
  });

  it('still count as labelled, so they are not reported as unexpected', () => {
    expect(score.unexpected).toEqual([]);
  });
});

describe('calibration', () => {
  it('compares claimed confidence with actual accuracy per band', () => {
    const score = scoreDocument('careem.jpg', labels, [
      predicted('vendorName', 'Careem', 0.97),
      predicted('date', '2026-08-14', 0.96),
      predicted('currency', 'USD', 0.96), // wrong but confident
      predicted('total', '42.50', 0.6),
    ]);
    const buckets = calibration([score], [0, 0.9, 1]);
    expect(buckets[0]).toMatchObject({ from: 0, to: 0.9, correct: 1 });
    expect(buckets[1]).toMatchObject({ from: 0.9, to: 1, total: 3, correct: 2 });
    expect(buckets[1].meanConfidence).toBeCloseTo(0.9633, 3);
    expect(buckets[1].accuracy).toBeCloseTo(2 / 3);
  });
});

describe('thresholdSweep', () => {
  // Two documents: one with a confident mistake, one clean but with a medium field.
  const risky = scoreDocument('a.jpg', labels, [
    predicted('vendorName', 'Careem', 0.97),
    predicted('date', '2026-08-14', 0.97),
    predicted('total', '99.00', 0.92), // wrong
  ]);
  const clean = scoreDocument('b.jpg', labels, [
    predicted('vendorName', 'Careem', 0.97),
    predicted('date', '2026-08-14', 0.85),
    predicted('total', '42.50', 0.97),
  ]);
  const sweep = thresholdSweep([risky, clean], [0.8, 0.9, 0.95]);

  it('trades silent errors against review workload', () => {
    // The wrong total (0.92) slips through below 0.95 and is caught at 0.95,
    // at the cost of sending both documents to review.
    expect(sweep.map(({ threshold, silentErrors, reviewRate }) => [threshold, silentErrors, reviewRate])).toEqual([
      [0.8, 1, 0],
      [0.9, 1, 0.5],
      [0.95, 0, 1],
    ]);
  });

  it('sends a document with a missing required field to review at any threshold', () => {
    const missing = scoreDocument('c.jpg', labels, [predicted('vendorName', 'Careem', 0.99)]);
    expect(thresholdSweep([missing], [0.5])[0].reviewRate).toBe(1);
  });
});
