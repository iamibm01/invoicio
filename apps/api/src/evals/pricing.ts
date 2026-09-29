import type { TokenUsage } from '../extractions/model/structured-output.service.js';

/**
 * List prices, USD per million tokens (Anthropic API, as of 2026-09).
 * Includes the model Opus 5's refusal fallback can route to, since the model
 * that answered is the one that bills. Update when prices change.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Estimated cost in USD, or null for a model with no known price. */
export function estimateCost(model: string, usage: TokenUsage): number | null {
  const price = PRICE_PER_MTOK[model];
  if (!price) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
