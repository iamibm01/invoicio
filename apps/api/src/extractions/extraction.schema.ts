import { z } from 'zod';
import { FieldValueType } from '../generated/prisma/enums.js';
import type { PredictedField } from '../evals/score.js';

/*
 * The shape Claude must return, enforced through structured outputs
 * (`output_config.format`). The API guarantees the JSON matches the schema's
 * structure. Constraints it can't enforce server-side (the 0–1 range, the
 * regexes) are stripped from the schema sent to the API and checked by the SDK
 * when it parses the response. A violation there counts as malformed output
 * and is retried.
 *
 * Every field is wrapped as { value, confidence } so that confidence is part
 * of the contract rather than an afterthought: the model can't return a value
 * without also saying how sure it is.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A field value plus the model's confidence that it's right. */
function scored<T extends z.ZodType>(value: T, description: string) {
  return z
    .object({
      value: value.nullable(),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          'Probability from 0 to 1 that value is exactly right. If value is null, how sure you are that the document does not contain this field.',
        ),
    })
    .describe(description);
}

const money = z.string().regex(DECIMAL).describe('Plain decimal, no currency symbol or thousands separator, e.g. "1234.50"');

export const lineItemSchema = z.object({
  description: scored(z.string(), 'Line item text as printed'),
  quantity: scored(z.string().regex(DECIMAL), 'Quantity as a plain decimal; null if not printed'),
  amount: scored(money, 'Line total for this item'),
});

export const extractionOutputSchema = z.object({
  vendorName: scored(z.string(), 'Business that issued the document, as printed'),
  documentNumber: scored(z.string(), 'Receipt or invoice number'),
  date: scored(z.iso.date(), 'Issue date as YYYY-MM-DD'),
  currency: scored(z.string().regex(/^[A-Z]{3}$/), 'ISO 4217 code, e.g. "USD", "AED"'),
  subtotal: scored(money, 'Total before tax'),
  tax: scored(money, 'Total tax amount'),
  total: scored(money, 'Final amount charged'),
  lineItems: z.array(lineItemSchema).describe('Purchased items, top to bottom as printed'),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
type Scored = { value: string | null; confidence: number };

/** Top-level fields and how their values are typed in the database. */
const TOP_LEVEL: Record<Exclude<keyof ExtractionOutput, 'lineItems'>, FieldValueType> = {
  vendorName: FieldValueType.TEXT,
  documentNumber: FieldValueType.TEXT,
  date: FieldValueType.DATE,
  currency: FieldValueType.CURRENCY_CODE,
  subtotal: FieldValueType.MONEY,
  tax: FieldValueType.MONEY,
  total: FieldValueType.MONEY,
};

const LINE_ITEM: Record<keyof z.infer<typeof lineItemSchema>, FieldValueType> = {
  description: FieldValueType.TEXT,
  quantity: FieldValueType.NUMBER,
  amount: FieldValueType.MONEY,
};

/**
 * Flattens the nested model output into one row per field, e.g.
 * `lineItems.0.amount`. This is the shape stored as ExtractionField and the
 * shape the eval scorer compares against labels, so extraction and evaluation
 * can't drift apart.
 */
export function flattenExtraction(output: ExtractionOutput): PredictedField[] {
  const row = (path: string, valueType: FieldValueType, field: Scored): PredictedField => ({
    path,
    valueType,
    value: field.value,
    confidence: field.confidence,
  });

  const fields = Object.entries(TOP_LEVEL).map(([key, valueType]) =>
    row(key, valueType, output[key as keyof typeof TOP_LEVEL]),
  );

  output.lineItems.forEach((item, i) => {
    for (const [key, valueType] of Object.entries(LINE_ITEM)) {
      fields.push(row(`lineItems.${i}.${key}`, valueType, item[key as keyof typeof LINE_ITEM]));
    }
  });

  return fields;
}
