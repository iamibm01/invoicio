import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDataset } from './dataset.js';

describe('loadDataset', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'invoicio-eval-'));
    await writeFile(path.join(dir, 'uber.jpg'), 'x');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const writeLabels = (labels: unknown) =>
    writeFile(path.join(dir, 'labels.json'), JSON.stringify(labels));

  it('loads labelled documents and resolves file paths', async () => {
    await writeLabels([
      { file: 'uber.jpg', fields: [{ path: 'total', valueType: 'MONEY', value: '12.00' }] },
    ]);
    const [doc] = await loadDataset(dir);
    expect(doc.filePath).toBe(path.join(dir, 'uber.jpg'));
    expect(doc.fields).toEqual([{ path: 'total', valueType: 'MONEY', value: '12.00' }]);
  });

  it.each([
    [[{ file: 'missing.jpg', fields: [] }], /not found/],
    [[{ file: 'uber.jpg', fields: [{ path: 'total', valueType: 'CASH', value: '1' }] }], /valueType/],
    [[{ file: 'uber.jpg', fields: [{ path: 'total', valueType: 'MONEY', value: 12 }] }], /string or null/],
    [
      [
        {
          file: 'uber.jpg',
          fields: [
            { path: 'total', valueType: 'MONEY', value: '1' },
            { path: 'total', valueType: 'MONEY', value: '2' },
          ],
        },
      ],
      /duplicate/,
    ],
  ])('rejects invalid labels (%#)', async (labels, error) => {
    await writeLabels(labels);
    await expect(loadDataset(dir)).rejects.toThrow(error);
  });
});
