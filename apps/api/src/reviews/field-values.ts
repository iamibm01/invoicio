import { z } from 'zod';
import { FieldValueType } from '../generated/prisma/enums.js';

export type NormalizeResult = { ok: true; value: string | null } | { ok: false; error: string };

const DECIMAL = /^-?\d+(\.\d+)?$/;
const isoDate = z.iso.date();
const MAX_TEXT_LENGTH = 500;

/**
 * Turns a reviewer's input into the same canonical form the model must
 * produce (plain decimals, ISO dates, ISO currency codes), so a corrected
 * value is never less clean than an AI value and downstream code (export,
 * the dashboard, evals) parses both the same way.
 *
 * An empty input means "this field isn't on the document", stored as null,
 * just as the model reports an absent field.
 */
export function normalizeFieldValue(
  valueType: FieldValueType,
  input: string | null,
): NormalizeResult {
  const raw = input?.trim() ?? '';
  if (raw === '') return { ok: true, value: null };

  switch (valueType) {
    case FieldValueType.TEXT:
      return raw.length <= MAX_TEXT_LENGTH
        ? { ok: true, value: raw.replace(/\s+/g, ' ') }
        : { ok: false, error: `must be at most ${MAX_TEXT_LENGTH} characters` };

    case FieldValueType.MONEY:
    case FieldValueType.NUMBER: {
      // Forgive how people type amounts ("1,234.50", "1 234.50"), store the canonical form.
      const plain = raw.replace(/[,\s]/g, '');
      return DECIMAL.test(plain)
        ? { ok: true, value: plain }
        : { ok: false, error: 'must be a number like 1234.50' };
    }

    case FieldValueType.DATE:
      return isoDate.safeParse(raw).success
        ? { ok: true, value: raw }
        : { ok: false, error: 'must be a real date as YYYY-MM-DD' };

    case FieldValueType.CURRENCY_CODE: {
      const code = raw.toUpperCase();
      return /^[A-Z]{3}$/.test(code)
        ? { ok: true, value: code }
        : { ok: false, error: 'must be a 3-letter code like USD' };
    }
  }
}
