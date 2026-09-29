import type { ValidationIssueCode, ValidationSeverity } from '../../generated/prisma/enums.js';

export interface IssueDraft {
  code: ValidationIssueCode;
  severity: ValidationSeverity;
  message: string;
  details?: Record<string, string | number | null>;
  relatedDocumentId?: string;
}

/** A field as validation sees it: path and canonical value. */
export interface FieldValue {
  path: string;
  value: string | null;
}

/*
 * Amounts are compared as integers in thousandths, never as floats: in
 * floating point 0.1 + 0.2 !== 0.3, and a receipt check must not fail on
 * that. Thousandths rather than cents because some currencies (KWD, BHD,
 * OMR) use three decimal places.
 */
const SCALE = 1000;

/** Differences at or below this are treated as equal (half a cent of slack for per-line rounding). */
const TOLERANCE = 5;

/**
 * Differences up to this are a rounding adjustment, not an error: several
 * countries (e.g. Malaysia, Switzerland) round cash totals to 0.05.
 */
const ROUNDING = 50;

export function toMilli(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * SCALE) : null;
}

function format(milli: number): string {
  const decimals = milli % 10 === 0 ? 2 : 3;
  return (milli / SCALE).toFixed(decimals);
}

/**
 * Checks the document's own numbers against each other:
 *  1. line items against the subtotal;
 *  2. subtotal (or the line items, if there's no subtotal) plus tax against
 *     the total. A total equal to the subtotal alone is accepted too, since
 *     tax-inclusive receipts list tax that's already in the subtotal.
 * A check is skipped when the numbers it needs aren't on the document:
 * missing data is the extraction's concern, not a validation failure.
 */
export function checkArithmetic(fields: FieldValue[]): IssueDraft[] {
  const get = (path: string) => toMilli(fields.find((f) => f.path === path)?.value);
  const items = fields
    .filter((f) => /^lineItems\.\d+\.amount$/.test(f.path))
    .map((f) => toMilli(f.value))
    .filter((v): v is number => v !== null);
  const itemsSum = items.length > 0 ? items.reduce((a, b) => a + b, 0) : null;
  const subtotal = get('subtotal');
  const tax = get('tax');
  const total = get('total');
  const issues: IssueDraft[] = [];

  if (itemsSum !== null && subtotal !== null && Math.abs(itemsSum - subtotal) > TOLERANCE) {
    issues.push({
      code: 'LINE_ITEMS_SUBTOTAL_MISMATCH',
      severity: 'WARNING',
      message: `Line items add up to ${format(itemsSum)}, but the subtotal is ${format(subtotal)}`,
      details: { lineItemsSum: format(itemsSum), subtotal: format(subtotal) },
    });
  }

  const base = subtotal ?? itemsSum;
  if (base !== null && total !== null) {
    const candidates = [base + (tax ?? 0), base];
    const closest = Math.min(...candidates.map((c) => Math.abs(total - c)));
    const expected = base + (tax ?? 0);
    const basis = `${subtotal !== null ? 'Subtotal' : 'Line items'} ${format(base)}${tax !== null ? ` + tax ${format(tax)}` : ''}`;

    if (closest > ROUNDING) {
      issues.push({
        code: 'TOTAL_MISMATCH',
        severity: 'WARNING',
        message: `${basis} = ${format(expected)}, but the total is ${format(total)}`,
        details: { expected: format(expected), total: format(total), difference: format(total - expected) },
      });
    } else if (closest > TOLERANCE) {
      issues.push({
        code: 'ROUNDING_ADJUSTMENT',
        severity: 'INFO',
        message: `Total differs from ${basis.toLowerCase()} by ${format(Math.abs(total - expected))}, likely a rounding adjustment`,
        details: { expected: format(expected), total: format(total) },
      });
    }
  }

  return issues;
}

/**
 * Vendor names as printed vary ("CAREEM NETWORKS FZ-LLC", "Careem Networks"),
 * so duplicate and history checks compare a loose form: lower case, with
 * company suffixes, punctuation and anything in parentheses removed. On
 * receipts, parentheses almost always name a branch or region ("MR D.I.Y.
 * (JOHOR)", "(M) SDN BHD"), which shouldn't split one vendor into several.
 * Mirrors Vendor.normalizedName.
 */
export function normalizeVendorName(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(sdn|bhd|llc|ltd|limited|inc|fz|fze|co|corp|plc|gmbh|pte)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === '' ? null : normalized;
}
