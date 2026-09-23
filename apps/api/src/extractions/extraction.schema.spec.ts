import { extractionOutputSchema, flattenExtraction, type ExtractionOutput } from './extraction.schema.js';

const s = (value: string | null, confidence = 0.9) => ({ value, confidence });

const output: ExtractionOutput = {
  vendorName: s('Careem'),
  documentNumber: s(null, 0.8),
  date: s('2026-08-14'),
  currency: s('AED', 0.6),
  subtotal: s('40.00'),
  tax: s('2.50'),
  total: s('42.50', 0.97),
  lineItems: [
    { description: s('Trip fare'), quantity: s(null, 0.7), amount: s('40.00') },
    { description: s('Booking fee'), quantity: s('1'), amount: s('0.00', 0.4) },
  ],
};

describe('extractionOutputSchema', () => {
  it('accepts well-formed output', () => {
    expect(extractionOutputSchema.safeParse(output).success).toBe(true);
  });

  // These constraints are enforced client-side by the SDK, not by the API,
  // so the schema itself has to catch them.
  it.each([
    ['confidence above 1', { ...output, total: s('42.50', 1.2) }],
    ['money with a currency symbol', { ...output, total: s('AED 42.50') }],
    ['money with a thousands separator', { ...output, total: s('1,042.50') }],
    ['a non-ISO date', { ...output, date: s('14/08/2026') }],
    ['an impossible date', { ...output, date: s('2026-02-30') }],
    ['a lowercase currency code', { ...output, currency: s('aed') }],
  ])('rejects %s', (_, bad) => {
    expect(extractionOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('flattenExtraction', () => {
  const fields = flattenExtraction(output);

  it('produces one row per field, with line items indexed', () => {
    expect(fields.map((f) => f.path)).toEqual([
      'vendorName',
      'documentNumber',
      'date',
      'currency',
      'subtotal',
      'tax',
      'total',
      'lineItems.0.description',
      'lineItems.0.quantity',
      'lineItems.0.amount',
      'lineItems.1.description',
      'lineItems.1.quantity',
      'lineItems.1.amount',
    ]);
  });

  it('carries value type, value and confidence through', () => {
    expect(fields.find((f) => f.path === 'total')).toEqual({
      path: 'total',
      valueType: 'MONEY',
      value: '42.50',
      confidence: 0.97,
    });
    expect(fields.find((f) => f.path === 'lineItems.0.quantity')).toMatchObject({
      valueType: 'NUMBER',
      value: null,
      confidence: 0.7,
    });
  });
});
