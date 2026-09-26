// Runs the extraction on local files and prints what came back, without
// touching the database or storage. For trying the prompt on real receipts.
//
//   npm run extract -- path/to/receipt.jpg [more files...] [--json]
//
// Every run makes real API calls and costs money.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { detectFileType } from '../src/documents/detect-file-type.js';
import { MAX_UPLOAD_BYTES } from '../src/documents/upload-rules.js';
import { toDocumentBlock } from '../src/extractions/document-input.js';
import { ExtractionFailedError, ExtractorService, type TokenUsage } from '../src/extractions/extractor.service.js';
import { CONFIDENCE_THRESHOLDS, reviewReasons } from '../src/extractions/review-policy.js';
import type { PredictedField } from '../src/evals/score.js';

// Claude Opus 5 list prices, USD per million tokens. A fallback model may
// bill differently, so treat the figure as an estimate.
const PRICE_PER_MTOK = { input: 5, output: 25 };

function level(confidence: number): string {
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (confidence >= CONFIDENCE_THRESHOLDS.medium) return 'MEDIUM';
  return 'LOW';
}

function printFields(fields: PredictedField[]) {
  const width = Math.max(...fields.map((f) => f.path.length));
  for (const f of fields) {
    const value = f.value === null ? '—' : f.value;
    console.log(`  ${f.path.padEnd(width)}  ${f.confidence.toFixed(2)} ${level(f.confidence).padEnd(6)}  ${value}`);
  }
}

function cost(usage: TokenUsage): string {
  const usd =
    (usage.inputTokens * PRICE_PER_MTOK.input + usage.outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
  return `${usage.inputTokens} in / ${usage.outputTokens} out ≈ $${usd.toFixed(4)}`;
}

async function extractFile(extractor: ExtractorService, file: string, printJson: boolean) {
  console.log(`\n=== ${path.basename(file)}`);

  // Same checks as an upload: size limit, and type from magic bytes, not the extension.
  const data = await readFile(file);
  if (data.length > MAX_UPLOAD_BYTES) return console.log('  skipped: larger than the 10 MB upload limit');
  const mimeType = detectFileType(data);
  if (!mimeType) return console.log('  skipped: not a PDF, JPG, PNG or HEIC file');

  const started = performance.now();
  try {
    const result = await extractor.extract(await toDocumentBlock(data, mimeType));
    const seconds = ((performance.now() - started) / 1000).toFixed(1);

    console.log(`  ${mimeType} · ${result.model} · ${result.attempts} attempt(s) · ${seconds}s · ${cost(result.usage)}\n`);
    printFields(result.fields);

    const reasons = reviewReasons(result.fields);
    console.log(`\n  → ${reasons.length > 0 ? `REVIEW (${reasons.join('; ')})` : 'DONE'}`);
    if (printJson) console.log(`\n${JSON.stringify(result.output, null, 2)}`);
  } catch (error) {
    if (!(error instanceof ExtractionFailedError)) throw error;
    console.log(`  FAILED (${error.kind}, retryable: ${error.retryable}) after ${error.attempts} attempt(s): ${error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const printJson = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: npm run extract -- <file> [more files...] [--json]');
    process.exit(1);
  }

  const extractor = new ExtractorService(new Anthropic({ maxRetries: 3 }));
  // One at a time: easier to follow, and gentler on rate limits.
  for (const file of files) await extractFile(extractor, path.resolve(file), printJson);
}

await main();
