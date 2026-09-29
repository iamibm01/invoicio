import { checkArithmetic, normalizeVendorName, toMilli } from './arithmetic.js';

const f = (entries: Record<string, string | null>) =>
  Object.entries(entries).map(([path, value]) => ({ path, value }));

const items = (...amounts: string[]) =>
  Object.fromEntries(amounts.map((a, i) => [`lineItems.${i}.amount`, a]));

describe('toMilli', () => {
  it('avoids floating-point error', () => {
    expect(toMilli('0.1')! + toMilli('0.2')!).toBe(toMilli('0.3'));
  });

  it('keeps three-decimal currencies exact', () => {
    expect(toMilli('1.235')).toBe(1235);
  });
});

describe('checkArithmetic', () => {
  it('passes a receipt whose numbers add up', () => {
    expect(checkArithmetic(f({ ...items('36.00', '14.50', '6.00'), subtotal: '56.50', tax: '2.83', total: '59.33' }))).toEqual([]);
  });

  it('flags line items that do not add up to the subtotal', () => {
    const issues = checkArithmetic(f({ ...items('36.00', '14.50'), subtotal: '56.50', total: '56.50' }));
    expect(issues).toMatchObject([
      { code: 'LINE_ITEMS_SUBTOTAL_MISMATCH', severity: 'WARNING', message: 'Line items add up to 50.50, but the subtotal is 56.50' },
    ]);
  });

  it('flags a total that does not match subtotal plus tax', () => {
    const issues = checkArithmetic(f({ subtotal: '56.50', tax: '2.83', total: '69.33' }));
    expect(issues).toMatchObject([
      { code: 'TOTAL_MISMATCH', severity: 'WARNING', message: 'Subtotal 56.50 + tax 2.83 = 59.33, but the total is 69.33' },
    ]);
  });

  it('accepts a tax-inclusive total (tax already in the subtotal)', () => {
    expect(checkArithmetic(f({ subtotal: '105.00', tax: '5.00', total: '105.00' }))).toEqual([]);
  });

  it('treats a small difference as a rounding adjustment, not an error', () => {
    // Malaysian cash rounding: 80.91 → 80.90
    const issues = checkArithmetic(f({ ...items('80.91'), subtotal: '80.91', tax: '0.00', total: '80.90' }));
    expect(issues).toMatchObject([{ code: 'ROUNDING_ADJUSTMENT', severity: 'INFO' }]);
  });

  it('falls back to the line items when there is no subtotal', () => {
    expect(checkArithmetic(f({ ...items('40.00'), tax: '2.50', total: '42.50' }))).toEqual([]);
    expect(checkArithmetic(f({ ...items('40.00'), total: '45.00' }))).toMatchObject([
      { code: 'TOTAL_MISMATCH', message: 'Line items 40.00 = 40.00, but the total is 45.00' },
    ]);
  });

  it('counts discounts (negative line items)', () => {
    expect(checkArithmetic(f({ ...items('10.00', '55.90', '-5.59'), subtotal: '60.31', total: '60.31' }))).toEqual([]);
  });

  it('skips checks whose numbers are not on the document', () => {
    expect(checkArithmetic(f({ total: '42.50' }))).toEqual([]);
    expect(checkArithmetic(f({ subtotal: null, tax: null, total: null }))).toEqual([]);
  });
});

describe('normalizeVendorName', () => {
  it.each([
    ['CAREEM NETWORKS FZ-LLC', 'careem networks'],
    ['Careem Networks', 'careem networks'],
    ['MR D.I.Y. (JOHOR) SDN BHD', 'mr d i y'],
    ['MR D.I.Y. (M) SDN BHD', 'mr d i y'],
    ['S.H.H. MOTOR ( SUNGAI RENGIT ) SDN. BHD.', 's h h motor'],
    ['BOOK TA .K (TAMAN DAYA) SDN BHD', 'book ta k'],
  ])('%j → %j', (name, normalized) => {
    expect(normalizeVendorName(name)).toBe(normalized);
  });

  it('returns null for empty names', () => {
    expect(normalizeVendorName('  ')).toBeNull();
    expect(normalizeVendorName(null)).toBeNull();
  });
});
