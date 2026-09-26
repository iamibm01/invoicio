import { FieldValueType } from '../generated/prisma/enums.js';
import { mergeLabels, type LabelEntry } from './labels-file.js';

const { TEXT, MONEY } = FieldValueType;
const official: LabelEntry[] = [
  {
    file: 'a.jpg',
    fields: [
      { path: 'vendorName', valueType: TEXT, value: 'ACME SDN BHD' },
      { path: 'total', valueType: MONEY, value: '9.00' },
    ],
  },
];

describe('mergeLabels', () => {
  it('adds a new entry for an unlabelled file', () => {
    const merged = mergeLabels(official, 'b.jpg', [{ path: 'total', valueType: MONEY, value: '1.00' }], 'fill-missing');
    expect(merged.map((e) => e.file)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('fills missing paths from a draft without overwriting existing labels', () => {
    const merged = mergeLabels(
      official,
      'a.jpg',
      [
        { path: 'vendorName', valueType: TEXT, value: 'ACME' }, // draft disagrees
        { path: 'tax', valueType: MONEY, value: '0.50' },
      ],
      'fill-missing',
    );
    expect(merged[0].fields).toEqual([
      { path: 'vendorName', valueType: TEXT, value: 'ACME SDN BHD' },
      { path: 'total', valueType: MONEY, value: '9.00' },
      { path: 'tax', valueType: MONEY, value: '0.50' },
    ]);
  });

  it('lets authoritative labels replace existing values in place', () => {
    const drafted: LabelEntry[] = [
      { file: 'a.jpg', fields: [{ path: 'total', valueType: MONEY, value: '90.00' }] },
    ];
    const merged = mergeLabels(drafted, 'a.jpg', [{ path: 'total', valueType: MONEY, value: '9.00' }], 'authoritative');
    expect(merged[0].fields).toEqual([{ path: 'total', valueType: MONEY, value: '9.00' }]);
  });
});
