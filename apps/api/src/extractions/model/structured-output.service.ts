import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Models every pipeline step can run on. Both support adaptive thinking,
 * effort and structured outputs with the same request shape. Haiku 4.5 is
 * left out on purpose: it rejects `effort` and needs a thinking token budget
 * instead, so it would need its own request variant.
 */
export const SUPPORTED_MODELS = ['claude-opus-5', 'claude-sonnet-5'] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Model calls per request, counting the first. Only bad output is retried here. */
export const MAX_ATTEMPTS = 3;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelOptions {
  model?: SupportedModel;
  effort?: Effort;
}

export interface StructuredRequest<S extends z.ZodType> extends ModelOptions {
  /** What the model must return; enforced by the API and re-checked here. */
  schema: S;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Used in log lines, e.g. "extraction", "classification". */
  label: string;
}

export interface StructuredResult<T> {
  output: T;
  /** The model that produced the output; differs from the requested one if a fallback ran. */
  model: string;
  attempts: number;
  /** Tokens billed across all attempts, including rejected ones. */
  usage: TokenUsage;
  /** Every raw response, including rejected ones, for debugging and evals. */
  rawOutputs: unknown[];
}

/**
 * - `refused`: the model declined, even after the server-side fallback. Retrying won't help.
 * - `malformed`: output still failed validation after MAX_ATTEMPTS.
 * - `api`: the request itself failed. `retryable` says whether trying again later could work.
 */
export type ModelFailureKind = 'refused' | 'malformed' | 'api';

export class ModelCallError extends Error {
  constructor(
    readonly kind: ModelFailureKind,
    message: string,
    readonly attempts: number,
    readonly retryable: boolean,
    readonly rawOutputs: unknown[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ModelCallError';
  }
}

type Attempt<T> =
  | { ok: true; output: T }
  | { ok: false; reason: string; /** Message asking the model to fix its output, if a repair is possible. */ repair?: string };

/**
 * One model call that must return JSON matching a schema, with every way it
 * can go wrong turned into either a valid result or a typed failure. Shared
 * by all model-backed pipeline steps, so each gets the same safeguards.
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
export class StructuredOutputService {
  private readonly logger = new Logger(StructuredOutputService.name);
  /** Output formats are derived from schemas once, not on every call. */
  private readonly formats = new WeakMap<z.ZodType, ReturnType<typeof betaZodOutputFormat>>();

  constructor(private readonly client: Anthropic) {}

  async generate<S extends z.ZodType>(request: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    const initial = request.messages;
    let messages = initial;
    const rawOutputs: unknown[] = [];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.call(request, messages, attempt, rawOutputs);
      rawOutputs.push(response.content);
      // Output tokens include thinking, which is billed even when it isn't displayed.
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      const result = this.check(request.schema, response);
      if (result.ok) {
        return { output: result.output, model: response.model, attempts: attempt, usage, rawOutputs };
      }

      if (response.stop_reason === 'refusal') {
        throw new ModelCallError('refused', result.reason, attempt, false, rawOutputs);
      }

      this.logger.warn(`${request.label} attempt ${attempt}/${MAX_ATTEMPTS} rejected: ${result.reason}`);
      messages = result.repair
        ? [
            ...messages,
            // The whole response goes back, thinking blocks included, not just the text.
            { role: 'assistant', content: response.content },
            { role: 'user', content: result.repair },
          ]
        : initial;
    }

    throw new ModelCallError('malformed', `No valid output after ${MAX_ATTEMPTS} attempts`, MAX_ATTEMPTS, false, rawOutputs);
  }

  private async call(
    request: StructuredRequest<z.ZodType>,
    messages: Anthropic.Beta.BetaMessageParam[],
    attempt: number,
    rawOutputs: unknown[],
  ) {
    const { model = DEFAULT_MODEL, effort = 'high' } = request;
    try {
      return await this.client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: request.system,
        messages,
        // Thinking is adaptive by default. Effort is the main cost lever;
        // lower it only once the eval shows accuracy holds.
        output_config: { effort, format: this.format(request.schema) },
        // If Opus 5's safety classifier wrongly declines a document, the API
        // re-runs the request on a recommended fallback model instead of
        // returning a refusal. Only enabled where documented (Opus 5).
        ...(model === 'claude-opus-5' && {
          fallbacks: 'default' as const,
          betas: ['server-side-fallback-2026-07-01'],
        }),
      });
    } catch (error) {
      if (!(error instanceof Anthropic.APIError)) throw error;
      // APIConnectionError has no status; it's retryable like a 5xx.
      const status = error.status;
      const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
      throw new ModelCallError('api', error.message, attempt, retryable, rawOutputs, { cause: error });
    }
  }

  private format(schema: z.ZodType) {
    let format = this.formats.get(schema);
    if (!format) {
      format = betaZodOutputFormat(schema);
      this.formats.set(schema, format);
    }
    return format;
  }

  /** Checks stop_reason before trusting content, then validates the JSON against the schema. */
  private check<S extends z.ZodType>(schema: S, response: Anthropic.Beta.BetaMessage): Attempt<z.infer<S>> {
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

    const parsed = schema.safeParse(json);
    if (parsed.success) return { ok: true, output: parsed.data };

    const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    return {
      ok: false,
      reason: `Schema validation failed:\n${issues}`,
      repair: `Your output failed validation:\n${issues}\n\nReturn the complete corrected output. Change only what these errors require.`,
    };
  }
}
