import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FieldValueType } from '../generated/prisma/enums.js';
import type { LabeledField } from './score.js';

export interface LabeledDocument {
  /** File name relative to the dataset directory. */
  file: string;
  /** Absolute path, resolved by the loader. */
  filePath: string;
  fields: LabeledField[];
}

const VALUE_TYPES = new Set<string>(Object.values(FieldValueType));

function parseField(raw: unknown, where: string): LabeledField {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: expected an object`);
  const { path: fieldPath, valueType, value } = raw as Record<string, unknown>;
  if (typeof fieldPath !== 'string' || fieldPath === '') throw new Error(`${where}: missing "path"`);
  if (typeof valueType !== 'string' || !VALUE_TYPES.has(valueType)) {
    throw new Error(`${where}: "valueType" must be one of ${[...VALUE_TYPES].join(', ')}`);
  }
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${where}: "value" must be a string or null`);
  }
  return { path: fieldPath, valueType: valueType as FieldValueType, value };
}

/**
 * Loads `<dir>/labels.json` (format in evals/datasets/README.md) and checks
 * that every referenced file exists, so a typo fails before any model calls
 * are made.
 */
export async function loadDataset(dir: string): Promise<LabeledDocument[]> {
  const raw: unknown = JSON.parse(await readFile(path.join(dir, 'labels.json'), 'utf8'));
  if (!Array.isArray(raw)) throw new Error('labels.json: expected an array of documents');

  const documents: LabeledDocument[] = [];
  for (const [i, entry] of raw.entries()) {
    const { file, fields } = (entry ?? {}) as Record<string, unknown>;
    if (typeof file !== 'string' || file === '') throw new Error(`labels.json[${i}]: missing "file"`);
    if (!Array.isArray(fields)) throw new Error(`labels.json[${i}] (${file}): "fields" must be an array`);

    const parsed = fields.map((f, j) => parseField(f, `${file} fields[${j}]`));
    const duplicate = parsed.find((f, j) => parsed.findIndex((g) => g.path === f.path) !== j);
    if (duplicate) throw new Error(`${file}: duplicate path "${duplicate.path}"`);

    const filePath = path.resolve(dir, file);
    await access(filePath).catch(() => {
      throw new Error(`${file}: file not found in ${dir}`);
    });
    documents.push({ file, filePath, fields: parsed });
  }
  return documents;
}
