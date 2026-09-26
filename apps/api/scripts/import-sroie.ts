// Writes SROIE's official answers (company, date, total) into a dataset's
// labels.json, for every image in that dataset directory.
//
//   npm run import-sroie -- <SROIE entities dir> <dataset dir>
//   npm run import-sroie -- ~/Downloads/archive/SROIE2019/train/entities evals/datasets/sroie
//
// Official answers replace existing values for the same fields; other fields
// (e.g. hand-checked drafts) are left alone. No API calls.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeLabels, readLabelsFile, writeLabelsFile } from '../src/evals/labels-file.js';
import { sroieToLabels, type SroieEntities } from '../src/evals/sroie.js';

async function main() {
  const [entitiesDir, datasetDir] = process.argv.slice(2);
  if (!entitiesDir || !datasetDir) {
    console.error('Usage: npm run import-sroie -- <SROIE entities dir> <dataset dir>');
    process.exit(1);
  }

  const labelsPath = path.join(datasetDir, 'labels.json');
  let labels = await readLabelsFile(labelsPath);
  const images = (await readdir(datasetDir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();

  for (const image of images) {
    const entitiesPath = path.join(entitiesDir, `${path.parse(image).name}.txt`);
    let entities: SroieEntities;
    try {
      entities = JSON.parse(await readFile(entitiesPath, 'utf8')) as SroieEntities;
    } catch {
      console.log(`${image}: no readable ${path.basename(entitiesPath)}, skipped`);
      continue;
    }

    const fields = sroieToLabels(entities);
    labels = mergeLabels(labels, image, fields, 'authoritative');
    const missing = ['vendorName', 'date', 'total'].filter((p) => !fields.some((f) => f.path === p));
    console.log(`${image}: ${fields.map((f) => `${f.path}=${f.value}`).join('  ')}${missing.length ? `  (unconverted: ${missing.join(', ')})` : ''}`);
  }

  await writeLabelsFile(labelsPath, labels);
  console.log(`\nWrote ${labelsPath}`);
}

await main();
