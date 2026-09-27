// Runs the extractor over labelled datasets and reports accuracy, calibration
// and the review-threshold trade-off. Makes real API calls: roughly $0.03-0.05
// per document on Opus 5.
//
//   npm run eval -- evals/datasets/sroie
//   npm run eval -- evals/datasets/sroie evals/datasets/own --limit 20
//   npm run eval -- evals/datasets/sroie --model claude-sonnet-5 --effort low
//
// Options:
//   --model <id>         claude-opus-5 (default) or claude-sonnet-5
//   --effort <level>     low | medium | high (default) | xhigh | max
//   --limit <n>          only the first n documents (across all datasets)
//   --concurrency <n>    documents in flight at once (default 2)
//   --include-drafts     also score unchecked draft labels (not a real accuracy figure)
//
// Results are saved to evals/results/ (gitignored) for comparing runs.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectFileType } from '../src/documents/detect-file-type.js';
import { loadDataset, type LabeledDocument } from '../src/evals/dataset.js';
import { estimateCost } from '../src/evals/pricing.js';
import {
  calibration,
  scoreDocument,
  summarize,
  thresholdSweep,
  type DocumentScore,
  type FieldResult,
} from '../src/evals/score.js';
import { toDocumentBlock } from '../src/extractions/document-input.js';
import { PROMPT_VERSION } from '../src/extractions/extraction.prompt.js';
import {
  EXTRACTION_MODEL,
  ExtractionFailedError,
  ExtractorService,
  SUPPORTED_MODELS,
  type Effort,
  type ExtractionModel,
  type TokenUsage,
} from '../src/extractions/extractor.service.js';
import { CONFIDENCE_THRESHOLDS } from '../src/extractions/review-policy.js';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Options {
  datasets: string[];
  model: ExtractionModel;
  effort: Effort;
  limit?: number;
  concurrency: number;
  includeDrafts: boolean;
}

interface RunRecord {
  file: string;
  ok: boolean;
  error?: string;
  model?: string;
  attempts: number;
  seconds: number;
  usage: TokenUsage;
  costUsd: number | null;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flagsWithValues = new Set(['--model', '--effort', '--limit', '--concurrency']);
  const datasets = argv.filter((a, i) => !a.startsWith('--') && !flagsWithValues.has(argv[i - 1]));

  const model = (value('--model') ?? EXTRACTION_MODEL) as ExtractionModel;
  const effort = (value('--effort') ?? 'high') as Effort;
  const limit = value('--limit') ? Number(value('--limit')) : undefined;
  const concurrency = Number(value('--concurrency') ?? 2);

  const problems = [
    datasets.length === 0 && 'give at least one dataset directory',
    !SUPPORTED_MODELS.includes(model) && `--model must be one of ${SUPPORTED_MODELS.join(', ')}`,
    !EFFORTS.includes(effort) && `--effort must be one of ${EFFORTS.join(', ')}`,
    limit !== undefined && !(limit > 0) && '--limit must be a positive number',
    !(concurrency > 0) && '--concurrency must be a positive number',
  ].filter(Boolean);
  if (problems.length > 0) {
    console.error(`${problems.join('\n')}\n\nUsage: npm run eval -- <dataset dir>... [--model m] [--effort e] [--limit n]`);
    process.exit(1);
  }
  return { datasets, model, effort, limit, concurrency, includeDrafts: argv.includes('--include-drafts') };
}

/** Runs `fn` over items with at most `n` in flight, keeping results in input order. */
async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
const row = (cells: (string | number)[], widths: number[]) =>
  '  ' + cells.map((c, i) => String(c)[i === 0 ? 'padEnd' : 'padStart'](widths[i])).join('  ');

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Load and validate every dataset before spending anything.
  let documents: (LabeledDocument & { name: string })[] = [];
  for (const dir of options.datasets) {
    const dataset = path.basename(path.resolve(dir));
    for (const doc of await loadDataset(dir)) documents.push({ ...doc, name: `${dataset}/${doc.file}` });
  }
  if (options.limit) documents = documents.slice(0, options.limit);

  const draftCount = documents.flatMap((d) => d.fields).filter((f) => f.source === 'draft').length;
  console.log(
    `Evaluating ${documents.length} documents · ${options.model} · effort ${options.effort} · prompt ${PROMPT_VERSION}`,
  );

  const extractor = new ExtractorService(new Anthropic({ maxRetries: 3 }));
  const records: RunRecord[] = [];
  const scores: DocumentScore[] = await mapPool(documents, options.concurrency, async (doc) => {
    const started = performance.now();
    const data = await readFile(doc.filePath);
    const mimeType = detectFileType(data);
    if (!mimeType) throw new Error(`${doc.name}: not a PDF, JPG, PNG or HEIC file`);

    let predictions: Awaited<ReturnType<ExtractorService['extract']>>['fields'] = [];
    const record: RunRecord = { file: doc.name, ok: false, attempts: 0, seconds: 0, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 };
    try {
      const result = await extractor.extract(await toDocumentBlock(data, mimeType), {
        model: options.model,
        effort: options.effort,
      });
      predictions = result.fields;
      Object.assign(record, {
        ok: true,
        model: result.model,
        attempts: result.attempts,
        usage: result.usage,
        costUsd: estimateCost(result.model, result.usage),
      });
    } catch (error) {
      if (!(error instanceof ExtractionFailedError)) throw error;
      // A failed extraction still counts: every labelled field is scored as
      // missed, the same outcome a user would get.
      Object.assign(record, { error: `${error.kind}: ${error.message}`, attempts: error.attempts });
    }
    record.seconds = (performance.now() - started) / 1000;
    records.push(record);

    const score = scoreDocument(doc.name, doc.fields, predictions);
    const counted = score.fields.filter((f) => options.includeDrafts || f.source !== 'draft');
    const correct = counted.filter((f) => f.correct).length;
    console.log(
      `  ${record.ok ? '✓' : '✗'} ${doc.name.padEnd(36)} ${String(correct).padStart(3)}/${String(counted.length).padEnd(3)} ${record.seconds.toFixed(1).padStart(5)}s${record.error ? `  ${record.error}` : ''}`,
    );
    return score;
  });

  report(options, scores, records, draftCount);

  const resultsDir = path.join('evals', 'results');
  await mkdir(resultsDir, { recursive: true });
  const file = path.join(
    resultsDir,
    `${new Date().toISOString().replace(/[:.]/g, '-')}_${options.model}_${options.effort}_${PROMPT_VERSION}.json`,
  );
  await writeFile(
    file,
    JSON.stringify(
      {
        options,
        promptVersion: PROMPT_VERSION,
        summary: summarize(scores, CONFIDENCE_THRESHOLDS, options),
        calibration: calibration(scores, undefined, options),
        thresholdSweep: thresholdSweep(scores, undefined, options),
        runs: records,
        scores,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull results: ${file}`);
}

function report(options: Options, scores: DocumentScore[], records: RunRecord[], draftCount: number) {
  const summary = summarize(scores, CONFIDENCE_THRESHOLDS, options);
  const failures = records.filter((r) => !r.ok).length;
  const costs = records.map((r) => r.costUsd);
  const totalCost = costs.every((c) => c !== null) ? costs.reduce<number>((a, c) => a + (c ?? 0), 0) : null;
  const avgSeconds = records.reduce((a, r) => a + r.seconds, 0) / Math.max(records.length, 1);

  console.log('\n── Summary');
  console.log(
    `  Field accuracy  ${pct(summary.fields.accuracy)}  (${summary.fields.correct}/${summary.fields.total} fields, ${scores.length} documents)`,
  );
  if (draftCount > 0 && !options.includeDrafts) {
    console.log(`  Not scored      ${draftCount} unchecked draft labels (check them, or pass --include-drafts)`);
  }
  console.log(`  Failures        ${failures}`);
  console.log(`  Retries         ${records.filter((r) => r.attempts > 1).length} documents needed a repair attempt`);
  console.log(`  Unexpected      ${summary.unexpectedFields} predicted values with no label`);
  console.log(
    `  Cost            ${totalCost === null ? 'unknown (unpriced model)' : `$${totalCost.toFixed(2)} total, $${(totalCost / Math.max(records.length, 1)).toFixed(3)}/document`}`,
  );
  console.log(`  Time            ${avgSeconds.toFixed(1)}s/document on average`);

  console.log('\n── Accuracy by field');
  for (const [field, tally] of Object.entries(summary.byPath).sort()) {
    console.log(row([field, pct(tally.accuracy), `${tally.correct}/${tally.total}`], [26, 6, 7]));
  }

  console.log('\n── Calibration: does claimed confidence match actual accuracy?');
  console.log(row(['confidence', 'fields', 'claimed', 'actual'], [12, 6, 7, 7]));
  for (const b of calibration(scores, undefined, options)) {
    if (b.total === 0) continue;
    console.log(row([`${b.from.toFixed(2)}–${b.to.toFixed(2)}`, b.total, pct(b.meanConfidence), pct(b.accuracy)], [12, 6, 7, 7]));
  }

  console.log(`\n── Review threshold trade-off (current: ${CONFIDENCE_THRESHOLDS.high})`);
  console.log(row(['threshold', 'silent errors', 'caught', 'docs to review'], [10, 13, 6, 14]));
  for (const t of thresholdSweep(scores, undefined, options)) {
    const marker = t.threshold === CONFIDENCE_THRESHOLDS.high ? ' ←' : '';
    console.log(row([t.threshold.toFixed(2), t.silentErrors, t.caughtErrors, pct(t.reviewRate) + marker], [10, 13, 6, 14]));
  }

  const wrong = scores.flatMap((s) =>
    s.fields
      .filter((f) => !f.correct && (options.includeDrafts || f.source !== 'draft'))
      .map((f): [string, FieldResult] => [s.file, f]),
  );
  const silent = wrong.filter(([, f]) => f.confidence !== null && f.confidence >= CONFIDENCE_THRESHOLDS.high);
  const show = (items: [string, FieldResult][]) => {
    for (const [file, f] of items.slice(0, 25)) {
      const conf = f.confidence === null ? ' n/a' : f.confidence.toFixed(2);
      console.log(`  ${conf}  ${file} · ${f.path}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.predicted)}`);
    }
    if (items.length > 25) console.log(`  … ${items.length - 25} more in the results file`);
  };

  console.log(`\n── Silent errors: wrong, but confident enough to skip review (${silent.length})`);
  show(silent);
  console.log(`\n── All errors (${wrong.length})`);
  show(wrong);
}

await main();
