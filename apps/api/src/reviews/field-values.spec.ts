import { FieldValueType } from '../generated/prisma/enums.js';
import { normalizeFieldValue } from './field-values.js';

const { TEXT, MONEY, NUMBER, DATE, CURRENCY_CODE } = FieldValueType;

describe('normalizeFieldValue', () => {
  it.each([
    [TEXT, '  Blue   Bean Cafe ', 'Blue Bean Cafe'],
    [MONEY, '1,234.50', '1234.50'],
    [MONEY, '-5.59', '-5.59'],
    [NUMBER, '2', '2'],
    [DATE, '2026-08-14', '2026-08-14'],
    [CURRENCY_CODE, 'aed', 'AED'],
  ])('%s %j → %j', (type, input, value) => {
    expect(normalizeFieldValue(type, input)).toEqual({ ok: true, value });
  });

  it.each([TEXT, MONEY, DATE, CURRENCY_CODE])(
    'treats empty %s input as "not on the document"',
    (type) => {
      expect(normalizeFieldValue(type, '   ')).toEqual({ ok: true, value: null });
      expect(normalizeFieldValue(type, null)).toEqual({ ok: true, value: null });
    },
  );

  it.each([
    [MONEY, 'AED 42.50'],
    [MONEY, '12.3.4'],
    [DATE, '14/08/2026'],
    [DATE, '2026-02-30'],
    [CURRENCY_CODE, 'DIRHAM'],
    [TEXT, 'x'.repeat(501)],
  ])('rejects %s %j', (type, input) => {
    expect(normalizeFieldValue(type, input)).toMatchObject({ ok: false });
  });
});
