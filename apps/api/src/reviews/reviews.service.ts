import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import {
  DocumentStatus,
  ExtractionStatus,
  type FieldValueType,
  type Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FieldCorrectionDto } from './dto/submit-review.dto.js';
import { normalizeFieldValue } from './field-values.js';
import { currentValue, latestCorrection } from './latest-correction.js';

/** A document can be reviewed once extraction has finished, and re-edited after. */
const REVIEWABLE: DocumentStatus[] = [DocumentStatus.REVIEW, DocumentStatus.DONE];

interface ReviewableField {
  id: string;
  path: string;
  valueType: FieldValueType;
  value: string | null;
  corrections: { correctedValue: string | null }[];
}

interface FieldChange {
  fieldId: string;
  path: string;
  previousValue: string | null;
  correctedValue: string | null;
}

export interface ReviewOutcome {
  documentStatus: DocumentStatus;
  /** Fields whose value actually changed; unchanged submissions are skipped. */
  corrected: number;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Applies a reviewer's edits to the latest extraction and confirms the
   * review, all in one transaction:
   *  - each changed field gets a new Correction row (the model's value stays
   *    untouched, and `previousValue` records what the reviewer replaced);
   *  - a REVIEW document becomes DONE: submitting the form is the human
   *    saying "these values are right now", edited or not.
   * A DONE document can be edited again; it simply stays DONE.
   *
   * Any user in the business can review for now. Restricting it to
   * approvers belongs with the approval workflow (Phase 4).
   */
  async submit(
    user: AuthUser,
    documentId: string,
    corrections: FieldCorrectionDto[],
  ): Promise<ReviewOutcome> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, businessId: user.businessId },
      select: {
        status: true,
        extractions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            status: true,
            fields: {
              select: {
                id: true,
                path: true,
                valueType: true,
                value: true,
                corrections: latestCorrection,
              },
            },
          },
        },
      },
    });
    if (!document) throw new NotFoundException();

    const run = document.extractions[0];
    if (!REVIEWABLE.includes(document.status) || run?.status !== ExtractionStatus.SUCCEEDED) {
      throw new ConflictException(
        `Document is ${document.status} and has no finished extraction to review`,
      );
    }

    const changes = this.validate(run.fields, corrections);

    await this.prisma.$transaction(async (tx) => {
      if (document.status === DocumentStatus.REVIEW) {
        // Conditional on still being in REVIEW, like the extraction claim: if
        // the document changed since it was read (e.g. a re-extraction
        // started), throwing rolls back the whole review instead of saving
        // corrections against a run that's being replaced.
        const { count } = await tx.document.updateMany({
          where: { id: documentId, businessId: user.businessId, status: DocumentStatus.REVIEW },
          data: { status: DocumentStatus.DONE },
        });
        if (count === 0)
          throw new ConflictException('Document changed during review; reload and try again');
        await this.audit(tx, user, 'document.reviewed', 'Document', documentId, {
          corrected: changes.length,
        });
      }

      for (const change of changes) {
        await tx.correction.create({
          data: {
            businessId: user.businessId,
            extractionFieldId: change.fieldId,
            userId: user.id,
            previousValue: change.previousValue,
            correctedValue: change.correctedValue,
          },
        });
        await this.audit(tx, user, 'field.corrected', 'ExtractionField', change.fieldId, {
          documentId,
          path: change.path,
          previousValue: change.previousValue,
          correctedValue: change.correctedValue,
        });
      }
    });

    return { documentStatus: DocumentStatus.DONE, corrected: changes.length };
  }

  /**
   * Checks every submitted correction before anything is written: the field
   * must belong to this document's latest run (not an older run or another
   * document), and the value must be valid for its type. Returns only the
   * fields whose value actually changes.
   */
  private validate(fields: ReviewableField[], corrections: FieldCorrectionDto[]): FieldChange[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const errors: string[] = [];
    const seen = new Set<string>();
    const changes: FieldChange[] = [];

    for (const { fieldId, value } of corrections) {
      const field = byId.get(fieldId);
      if (!field) {
        errors.push(`${fieldId}: not a field of this document's latest extraction`);
        continue;
      }
      if (seen.has(fieldId)) {
        errors.push(`${field.path}: corrected more than once`);
        continue;
      }
      seen.add(fieldId);

      const normalized = normalizeFieldValue(field.valueType, value);
      if (!normalized.ok) {
        errors.push(`${field.path}: ${normalized.error}`);
        continue;
      }
      const previousValue = currentValue(field);
      if (normalized.value !== previousValue) {
        changes.push({
          fieldId,
          path: field.path,
          previousValue,
          correctedValue: normalized.value,
        });
      }
    }

    // All or nothing: a half-applied review would be harder to reason about
    // than asking the reviewer to fix one field and resubmit.
    if (errors.length > 0) throw new BadRequestException(errors);
    return changes;
  }

  private audit(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        businessId: user.businessId,
        actorId: user.id,
        action,
        entityType,
        entityId,
        metadata,
      },
    });
  }
}
