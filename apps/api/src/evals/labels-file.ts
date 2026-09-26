import { readFile, writeFile } from 'node:fs/promises';
import type { LabeledField } from './score.js';

export interface LabelEntry {
  file: string;
  fields: LabeledField[];
}

/**
 * Adds fields to a file's label entry.
 *
 * - `authoritative` (e.g. SROIE's official answers) replaces any existing
 *   value for the same path.
 * - Otherwise (model drafts) only paths with no label yet are added, so a
 *   draft can never overwrite an official or hand-corrected label.
 */
export function mergeLabels(
  entries: LabelEntry[],
  file: string,
  fields: LabeledField[],
  mode: 'authoritative' | 'fill-missing',
): LabelEntry[] {
  const existing = entries.find((e) => e.file === file);
  if (!existing) return [...entries, { file, fields }];

  const incoming = new Map(fields.map((f) => [f.path, f]));
  const kept =
    mode === 'authoritative'
      ? existing.fields.map((f) => incoming.get(f.path) ?? f)
      : existing.fields;
  const keptPaths = new Set(kept.map((f) => f.path));
  const added = fields.filter((f) => !keptPaths.has(f.path));

  return entries.map((e) => (e === existing ? { file, fields: [...kept, ...added] } : e));
}

export async function readLabelsFile(labelsPath: string): Promise<LabelEntry[]> {
  try {
    return JSON.parse(await readFile(labelsPath, 'utf8')) as LabelEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeLabelsFile(labelsPath: string, entries: LabelEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(labelsPath, `${JSON.stringify(sorted, null, 2)}\n`);
}
