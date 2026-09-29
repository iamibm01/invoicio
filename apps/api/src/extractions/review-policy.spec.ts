import { FieldValueType } from '../generated/prisma/enums.js';
import { runReviewReasons } from './review-policy.js';

const field = (path: string, value: string | null, confidence = 0.95) => ({
  path,
  valueType: FieldValueType.TEXT,
  value,
  confidence,
});
const complete = [field('vendorName', 'Careem'), field('date', '2026-08-14'), field('total', '42.50')];
const receipt = { documentType: 'RECEIPT', confidence: 0.97 };

describe('runReviewReasons', () => {
  it('has nothing to say about a confident, complete run', () => {
    expect(runReviewReasons({ fields: complete, classification: receipt, steps: [] })).toEqual([]);
  });

  it('flags low-confidence and missing fields', () => {
    const fields = [field('vendorName', 'Careem', 0.6), field('date', '2026-08-14')];
    expect(runReviewReasons({ fields, classification: receipt, steps: [] })).toEqual([
      'total missing',
      'low confidence: vendorName',
    ]);
  });

  it('explains a skipped extraction instead of listing every field as missing', () => {
    expect(
      runReviewReasons({
        fields: [],
        classification: { documentType: 'OTHER', confidence: 0.96 },
        steps: [{ key: 'extraction', status: 'SKIPPED', reason: 'Not a receipt or invoice: a screenshot.' }],
      }),
    ).toEqual(['Not a receipt or invoice: a screenshot.']);
  });

  it('flags an uncertain classification', () => {
    expect(
      runReviewReasons({ fields: complete, classification: { documentType: 'INVOICE', confidence: 0.8 }, steps: [] }),
    ).toEqual(['document type uncertain (invoice)']);
  });

  it('flags every failed step', () => {
    expect(
      runReviewReasons({ fields: complete, classification: null, steps: [{ key: 'classification', status: 'FAILED' }] }),
    ).toEqual(['classification step failed']);
  });
});
