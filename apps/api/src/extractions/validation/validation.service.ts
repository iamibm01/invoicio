import { Injectable } from '@nestjs/common';
import { ExtractionStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { checkArithmetic, normalizeVendorName, toMilli, type FieldValue, type IssueDraft } from './arithmetic.js';

/** A total above this multiple of the vendor's median gets flagged. */
const UNUSUAL_MULTIPLIER = 3;
/** Fewer earlier documents than this and there's no "usual" to compare against. */
const MIN_HISTORY = 3;

export interface ValidationResult {
  issues: IssueDraft[];
}

interface Scope {
  businessId: string;
  documentId: string;
}

/**
 * The validation step's checks. All of them are code, not model calls:
 * arithmetic and database lookups have exact answers, so they're cheaper,
 * faster and more reliable done directly.
 *
 * Duplicate and history checks compare against other documents' extracted
 * (model) values. Corrections aren't taken into account yet; linking
 * documents to Vendor records (extraction tools, task 3) will make these
 * lookups exact and indexed instead of scanning extracted fields.
 */
@Injectable()
export class ValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(scope: Scope, fields: FieldValue[]): Promise<ValidationResult> {
    const [duplicates, unusual] = await Promise.all([
      this.findDuplicates(scope, fields),
      this.checkUnusualAmount(scope, fields),
    ]);
    return { issues: [...checkArithmetic(fields), ...duplicates, ...unusual] };
  }

  /** Finished runs of *other* documents in this business. */
  private otherRuns({ businessId, documentId }: Scope) {
    return {
      businessId,
      extraction: {
        documentId: { not: documentId },
        status: { in: [ExtractionStatus.SUCCEEDED, ExtractionStatus.PARTIAL] },
      },
    };
  }

  /**
   * Same vendor, same date, same total: very likely the same purchase
   * submitted twice (e.g. photographed again). Exact re-uploads of the same
   * file are already caught at upload by checksum; this catches the rest.
   */
  private async findDuplicates(scope: Scope, fields: FieldValue[]): Promise<IssueDraft[]> {
    const value = (path: string) => fields.find((f) => f.path === path)?.value ?? null;
    const date = value('date');
    const total = toMilli(value('total'));
    const vendor = normalizeVendorName(value('vendorName'));
    if (!date || total === null || !vendor) return [];

    const sameDate = await this.prisma.extractionField.findMany({
      where: { ...this.otherRuns(scope), path: 'date', value: date },
      select: {
        extraction: {
          select: {
            documentId: true,
            document: { select: { originalFilename: true, createdAt: true } },
            fields: { where: { path: { in: ['total', 'vendorName'] } }, select: { path: true, value: true } },
          },
        },
      },
    });

    const issues = new Map<string, IssueDraft>();
    for (const { extraction } of sameDate) {
      const other = (path: string) => extraction.fields.find((f) => f.path === path)?.value ?? null;
      const matches = toMilli(other('total')) === total && normalizeVendorName(other('vendorName')) === vendor;
      if (!matches || issues.has(extraction.documentId)) continue;
      issues.set(extraction.documentId, {
        code: 'POSSIBLE_DUPLICATE',
        severity: 'WARNING',
        message: `Possible duplicate of "${extraction.document.originalFilename}" (same vendor, date and total)`,
        details: { documentId: extraction.documentId, uploadedAt: extraction.document.createdAt.toISOString() },
        relatedDocumentId: extraction.documentId,
      });
    }
    return [...issues.values()];
  }

  /**
   * Flags a total far above what this vendor usually charges. The median,
   * not the mean, is the baseline, so one earlier outlier doesn't hide the
   * next. Only compares documents in the same currency.
   */
  private async checkUnusualAmount(scope: Scope, fields: FieldValue[]): Promise<IssueDraft[]> {
    const value = (path: string) => fields.find((f) => f.path === path)?.value ?? null;
    const total = toMilli(value('total'));
    const vendor = normalizeVendorName(value('vendorName'));
    const currency = value('currency');
    if (total === null || !vendor) return [];

    const vendorFields = await this.prisma.extractionField.findMany({
      where: { ...this.otherRuns(scope), path: 'vendorName', value: { not: null } },
      select: {
        value: true,
        extraction: {
          select: {
            documentId: true,
            fields: { where: { path: { in: ['total', 'currency'] } }, select: { path: true, value: true } },
          },
        },
      },
      orderBy: { extraction: { startedAt: 'desc' } },
    });

    // One total per document (its newest run), same vendor and currency.
    const history = new Map<string, number>();
    for (const { value: name, extraction } of vendorFields) {
      if (normalizeVendorName(name) !== vendor || history.has(extraction.documentId)) continue;
      const other = (path: string) => extraction.fields.find((f) => f.path === path)?.value ?? null;
      const otherTotal = toMilli(other('total'));
      if (otherTotal === null || other('currency') !== currency) continue;
      history.set(extraction.documentId, otherTotal);
    }
    if (history.size < MIN_HISTORY) return [];

    const sorted = [...history.values()].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    if (median <= 0 || total <= median * UNUSUAL_MULTIPLIER) return [];

    const ratio = total / median;
    return [
      {
        code: 'UNUSUAL_AMOUNT',
        severity: 'WARNING',
        message: `Total is ${ratio.toFixed(1)}× this vendor's usual amount (median ${(median / 1000).toFixed(2)} across ${history.size} documents)`,
        details: { total: total / 1000, median: median / 1000, documents: history.size },
      },
    ];
  }
}
