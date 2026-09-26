import { parseSroieAmount, parseSroieDate, sroieToLabels } from './sroie.js';

describe('parseSroieDate', () => {
  it.each([
    ['25/12/2018', '2018-12-25'],
    ['12-01-19', '2019-01-12'],
    ['23-01-2019', '2019-01-23'],
    ['9/1/2019', '2019-01-09'],
    ['05/03/18', '2018-03-05'],
    ['2018-06-02', '2018-06-02'],
    ['25032018', '2018-03-25'],
    ['15 MAR 2018', '2018-03-15'],
    ['02-JAN-2019', '2019-01-02'],
    ['7 mar 18', '2018-03-07'],
    ['2018/02/22', '2018-02-22'],
    ['11.02.18', '2018-02-11'],
    ['25/FEB/2017', '2017-02-25'],
    ['(06/12/2016)', '2016-12-06'],
    ['20180304', '2018-03-04'],
  ])('%s → %s', (raw, iso) => {
    expect(parseSroieDate(raw)).toBe(iso);
  });

  // 12/28/2017 is a US-order date: day-first reading gives month 28, so it's
  // left unlabelled rather than mislabelled.
  it.each(['31/02/2018', '12/28/2017', '13 FOO 2018', 'yesterday', ''])('rejects %j', (raw) => {
    expect(parseSroieDate(raw)).toBeNull();
  });
});

describe('parseSroieAmount', () => {
  it.each([
    ['9.00', '9.00'],
    ['RM 60.30', '60.30'],
    ['RM33.90', '33.90'],
    ['$4.50', '4.50'],
    ['1,234.50', '1234.50'],
    ['-1.73', '-1.73'],
  ])('%s → %s', (raw, amount) => {
    expect(parseSroieAmount(raw)).toBe(amount);
  });

  it.each(['', 'N/A'])('rejects %j', (raw) => {
    expect(parseSroieAmount(raw)).toBeNull();
  });
});

describe('sroieToLabels', () => {
  it('maps company, date and total, ignoring address', () => {
    expect(
      sroieToLabels({
        company: 'BOOK TA .K (TAMAN DAYA) SDN BHD',
        date: '25/12/2018',
        address: 'NO.53 JALAN SAGU 18',
        total: '9.00',
      }),
    ).toEqual([
      { path: 'vendorName', valueType: 'TEXT', value: 'BOOK TA .K (TAMAN DAYA) SDN BHD' },
      { path: 'date', valueType: 'DATE', value: '2018-12-25' },
      { path: 'total', valueType: 'MONEY', value: '9.00' },
    ]);
  });

  it('leaves out values it cannot convert instead of guessing', () => {
    expect(sroieToLabels({ company: 'ACME', date: 'sometime', total: '' }).map((f) => f.path)).toEqual([
      'vendorName',
    ]);
  });
});
