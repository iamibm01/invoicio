import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Injectable, Logger } from '@nestjs/common';
import type { PredictedField } from '../evals/score.js';
import type { DocumentBlock } from './document-input.js';
import { buildExtractionMessages, EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION } from './extraction.prompt.js';
import { extractionOutputSchema, flattenExtraction, type ExtractionOutput } from './extraction.schema.js';

export const EXTRACTION_MODEL = 'claude-opus-5';

/** Model calls per document, counting the first. Only malformed output is retried here. */
export const MAX_ATTEMPTS = 3;

const OUTPUT_FORMAT = betaZodOutputFormat(extractionOutputSchema);

export interface ExtractionResult {
  output: ExtractionOutput;
  fields: PredictedField[];
  /** The model that produced the output; differs from EXTRACTION_MODEL if a fallback ran. */
  model: string;
  promptVersion: string;
  attempts: number;
  /** Tokens billed across all attempts, including rejected ones. */
  usage: TokenUsage;
  /** Every raw response, including rejected ones, for debugging and evals. */
  rawOutputs: unknown[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * - `refused`: the model declined, even after the server-side fallback. Retrying won't help.
 * - `malformed`: output still failed validation after MAX_ATTEMPTS.
 * - `api`: the request itself failed. `retryable` says whether trying again later could work.
 */
export type ExtractionFailureKind = 'refused' | 'malformed' | 'api';

export class ExtractionFailedError extends Error {
  constructor(
    readonly kind: ExtractionFailureKind,
    message: string,
    readonly attempts: number,
    readonly retryable: boolean,
    readonly rawOutputs: unknown[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ExtractionFailedError';
  }
}

type Attempt =
  | { ok: true; output: ExtractionOutput }
  | { ok: false; reason: string; /** Message asking the model to fix its output, if a repair is possible. */ repair?: string };

/**
 * Makes the extraction call and turns every way it can go wrong into either a
 * valid result or a typed failure.
 *
 * There are two layers of retry, for different kinds of failure:
 *  - Transport errors (429, 5xx, timeouts, dropped connections) are retried by
 *    the SDK itself with backoff (`maxRetries` on the client). If they still
 *    fail, the error surfaces as `api` + retryable, and the job queue can try
 *    again minutes later.
 *  - Bad output is retried here. When the JSON is complete but breaks a rule
 *    (e.g. confidence 1.2), the model is shown its output plus the validation
 *    errors and asked to fix it. That is cheaper and more reliable than starting
 *    over. Truncated output can't be repaired, so it is re-run from scratch.
 */
@Injectable()
export class ExtractorService {
  private readonly logger = new Logger(ExtractorService.name);

  constructor(private readonly client: Anthropic) {}

  async extract(document: DocumentBlock): Promise<ExtractionResult> {
    const initial: Anthropic.Beta.BetaMessageParam[] = buildExtractionMessages(document);
    let messages = initial;
    const rawOutputs: unknown[] = [];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.call(messages, attempt, rawOutputs);
      rawOutputs.push(response.content);
      // Output tokens include thinking, which is billed even when it isn't displayed.
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      const result = this.check(response);
      if (result.ok) {
        return {
          output: result.output,
          fields: flattenExtraction(result.output),
          model: response.model,
          promptVersion: PROMPT_VERSION,
          attempts: attempt,
          usage,
          rawOutputs,
        };
      }

      if (response.stop_reason === 'refusal') {
        throw new ExtractionFailedError('refused', result.reason, attempt, false, rawOutputs);
      }

      this.logger.warn(`Extraction attempt ${attempt}/${MAX_ATTEMPTS} rejected: ${result.reason}`);
      messages = result.repair
        ? [
            ...messages,
            // The whole response goes back, thinking blocks included, not just the text.
            { role: 'assistant', content: response.content },
            { role: 'user', content: result.repair },
          ]
        : initial;
    }

    throw new ExtractionFailedError(
      'malformed',
      `No valid output after ${MAX_ATTEMPTS} attempts`,
      MAX_ATTEMPTS,
      false,
      rawOutputs,
    );
  }

  private async call(messages: Anthropic.Beta.BetaMessageParam[], attempt: number, rawOutputs: unknown[]) {
    try {
      return await this.client.beta.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 16000,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages,
        // Thinking is adaptive by default on Opus 5. Effort is the main cost
        // lever; lower it only once the eval shows accuracy holds.
        output_config: { effort: 'high', format: OUTPUT_FORMAT },
        // If Opus 5's safety classifier wrongly declines a receipt, the API
        // re-runs the request on a recommended fallback model instead of
        // returning a refusal.
        fallbacks: 'default',
        betas: ['server-side-fallback-2026-07-01'],
      });
    } catch (error) {
      if (!(error instanceof Anthropic.APIError)) throw error;
      // APIConnectionError has no status; it's retryable like a 5xx.
      const status = error.status;
      const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
      throw new ExtractionFailedError('api', error.message, attempt, retryable, rawOutputs, { cause: error });
    }
  }

  /** Checks stop_reason before trusting content, then validates the JSON against the schema. */
  private check(response: Anthropic.Beta.BetaMessage): Attempt {
    switch (response.stop_reason) {
      case 'refusal':
        return { ok: false, reason: `Model declined (${response.stop_details?.category ?? 'no category'})` };
      case 'max_tokens':
        return { ok: false, reason: 'Output was cut off at max_tokens' };
      case 'end_turn':
        break;
      default:
        return { ok: false, reason: `Unexpected stop_reason: ${response.stop_reason}` };
    }

    const text = response.content.find((block) => block.type === 'text')?.text;
    if (text === undefined) return { ok: false, reason: 'Response has no text block' };

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'Output is not valid JSON' };
    }

    const parsed = extractionOutputSchema.safeParse(json);
    if (parsed.success) return { ok: true, output: parsed.data };

    const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    return {
      ok: false,
      reason: `Schema validation failed:\n${issues}`,
      repair: `Your output failed validation:\n${issues}\n\nReturn the complete corrected output. Change only what these errors require.`,
    };
  }
}
