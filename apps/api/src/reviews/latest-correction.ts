import type { Prisma } from '../generated/prisma/client.js';

/**
 * Corrections are append-only: the model's value on ExtractionField is never
 * overwritten, and each edit adds a row. The newest row wins. (id, a
 * time-ordered UUIDv7, breaks ties between edits in the same millisecond.)
 * Keeping every row preserves the full edit history, which is what later
 * powers learning from corrections.
 */
export const latestCorrection = {
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: 1,
  select: { correctedValue: true, createdAt: true, user: { select: { name: true } } },
} satisfies Prisma.ExtractionField$correctionsArgs;

/** The value that currently counts: the latest correction if any, else the model's. */
export function currentValue(field: {
  value: string | null;
  corrections: { correctedValue: string | null }[];
}): string | null {
  return field.corrections.length > 0 ? field.corrections[0].correctedValue : field.value;
}
