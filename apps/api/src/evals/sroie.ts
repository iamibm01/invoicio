import { FieldValueType } from '../generated/prisma/enums.js';
import type { LabeledField } from './score.js';

/** One SROIE `entities/*.txt` file. Values are as printed on the receipt. */
export interface SroieEntities {
  company?: string;
  date?: string;
  address?: string;
  total?: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates like 31/02, which Date would silently roll over.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * SROIE dates are as printed on Malaysian receipts, so numeric dates are
 * day-first. Returns null for shapes it doesn't recognise; the caller leaves
 * that field unlabelled rather than guessing.
 */
export function parseSroieDate(raw: string): string | null {
  const s = raw.trim().replace(/^\((.*)\)$/, '$1').toUpperCase();
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/))) return isoDate(fullYear(m[3]), +m[2], +m[1]);
  if ((m = s.match(/^\d{8}$/))) {
    // DDMMYYYY and YYYYMMDD both occur. Accept whichever reading is a real
    // date, and give up if both are (e.g. 20112018 vs 2011-20-18 is fine,
    // but a string valid both ways is ambiguous).
    const dayFirst = isoDate(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2));
    const yearFirst = isoDate(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
    return dayFirst && yearFirst ? null : (dayFirst ?? yearFirst);
  }
  if ((m = s.match(/^(\d{1,2})[ /-]([A-Z]{3})[ /-](\d{2}|\d{4})$/))) {
    const month = MONTHS.indexOf(m[2]) + 1;
    return month > 0 ? isoDate(fullYear(m[3]), month, +m[1]) : null;
  }
  return null;
}

/** "RM 1,234.50" → "1234.50"; null if what's left isn't a plain decimal. */
export function parseSroieAmount(raw: string): string | null {
  const s = raw.replace(/RM|\$|,|\s/gi, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

/**
 * Converts SROIE's official answers into our label format. SROIE covers only
 * company, date and total (address isn't in our schema), so the remaining
 * fields come from hand-checked drafts. A value that can't be converted is
 * left out rather than labelled wrong: an unlabelled field just isn't scored.
 */
export function sroieToLabels(entities: SroieEntities): LabeledField[] {
  const fields: LabeledField[] = [];
  const company = entities.company?.trim();
  if (company) fields.push({ path: 'vendorName', valueType: FieldValueType.TEXT, value: company });

  const date = entities.date ? parseSroieDate(entities.date) : null;
  if (date) fields.push({ path: 'date', valueType: FieldValueType.DATE, value: date });

  const total = entities.total ? parseSroieAmount(entities.total) : null;
  if (total) fields.push({ path: 'total', valueType: FieldValueType.MONEY, value: total });

  return fields;
}
