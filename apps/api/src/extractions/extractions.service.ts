import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { buffer } from 'node:stream/consumers';
import type { AllowedMimeType } from '../documents/upload-rules.js';
import { DocumentStatus, ExtractionStatus, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { toDocumentBlock } from './document-input.js';
import { PROMPT_VERSION } from './extraction.prompt.js';
import {
  EXTRACTION_MODEL,
  ExtractionFailedError,
  ExtractorService,
  type ExtractionFailureKind,
} from './extractor.service.js';
import { reviewReasons } from './review-policy.js';

export type RunOutcome =
  | { extractionId: string; status: 'SUCCEEDED'; documentStatus: 'REVIEW' | 'DONE'; reviewReasons: string[] }
  | { extractionId: string; status: 'FAILED'; kind: ExtractionFailureKind | 'internal'; retryable: boolean };

/** Documents in these states can be (re)processed; anything else is in flight or finished. */
const RUNNABLE: DocumentStatus[] = [DocumentStatus.QUEUED, DocumentStatus.FAILED];

/**
 * Runs the extraction for one document and records the outcome, success or
 * failure, so every run leaves a trace.
 *
 * Lifecycle:
 *   Document  QUEUED ─claim─▶ PROCESSING ─▶ REVIEW | DONE | FAILED
 *   Extraction           RUNNING ─▶ SUCCEEDED | FAILED
 *
 * The Extraction row is created *before* the model call, so a run that
 * crashes halfway still shows up as RUNNING with a start time rather than
 * vanishing. Every run is a new row; earlier runs of the same document stay
 * put for comparison.
 */
@Injectable()
export class ExtractionsService {
  private readonly logger = new Logger(ExtractionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly extractor: ExtractorService,
  ) {}

  async run(businessId: string, documentId: string): Promise<RunOutcome> {
    const document = await this.claim(businessId, documentId);

    const extraction = await this.prisma.extraction.create({
      data: { businessId, documentId, model: EXTRACTION_MODEL, promptVersion: PROMPT_VERSION },
      select: { id: true },
    });

    try {
      const file = await buffer(await this.storage.getStream(document.storageKey));
      const result = await this.extractor.extract(
        await toDocumentBlock(file, document.mimeType as AllowedMimeType),
      );

      const reasons = reviewReasons(result.fields);
      const documentStatus = reasons.length > 0 ? DocumentStatus.REVIEW : DocumentStatus.DONE;

      // One transaction: the fields, the run's outcome and the document's
      // status change together, so no reader ever sees a DONE document
      // without its fields.
      await this.prisma.$transaction([
        this.prisma.extractionField.createMany({
          data: result.fields.map((field) => ({ ...field, businessId, extractionId: extraction.id })),
        }),
        this.prisma.extraction.update({
          where: { id: extraction.id },
          data: {
            status: ExtractionStatus.SUCCEEDED,
            model: result.model,
            attempts: result.attempts,
            rawOutput: result.rawOutputs as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        }),
        this.prisma.document.update({ where: { id: documentId }, data: { status: documentStatus } }),
        this.audit(businessId, documentId, 'extraction.succeeded', {
          extractionId: extraction.id,
          model: result.model,
          attempts: result.attempts,
          fieldCount: result.fields.length,
          reviewReasons: reasons,
        }),
      ]);

      return {
        extractionId: extraction.id,
        status: 'SUCCEEDED',
        documentStatus,
        reviewReasons: reasons,
      };
    } catch (error) {
      return this.recordFailure(businessId, documentId, extraction.id, error);
    }
  }

  /**
   * Moves the document to PROCESSING, but only from a runnable state. The
   * check and the update are one conditional UPDATE, so if two workers pick
   * up the same document at once, exactly one wins. The loser gets a 409
   * instead of running (and paying for) a duplicate extraction.
   */
  private async claim(businessId: string, documentId: string) {
    const { count } = await this.prisma.document.updateMany({
      where: { id: documentId, businessId, status: { in: RUNNABLE } },
      data: { status: DocumentStatus.PROCESSING },
    });

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, businessId },
      select: { storageKey: true, mimeType: true, status: true },
    });
    if (!document) throw new NotFoundException();
    if (count === 0) throw new ConflictException(`Document is ${document.status}, not runnable`);
    return document;
  }

  private async recordFailure(
    businessId: string,
    documentId: string,
    extractionId: string,
    error: unknown,
  ): Promise<RunOutcome> {
    // Model/API failures are expected and typed. Anything else (storage
    // missing, a corrupt image, a bug) is still recorded, then rethrown so
    // it shows up in logs as the error it is.
    const failure =
      error instanceof ExtractionFailedError
        ? { kind: error.kind, retryable: error.retryable, attempts: error.attempts, rawOutputs: error.rawOutputs }
        : { kind: 'internal' as const, retryable: false, attempts: 0, rawOutputs: [] };
    const message = error instanceof Error ? error.message : String(error);

    await this.prisma.$transaction([
      this.prisma.extraction.update({
        where: { id: extractionId },
        data: {
          status: ExtractionStatus.FAILED,
          // `errors` is keyed by pipeline step; Phase 3 adds classify/validate/categorize.
          errors: { extraction: { kind: failure.kind, message, retryable: failure.retryable } },
          attempts: failure.attempts,
          rawOutput: failure.rawOutputs as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
      this.prisma.document.update({ where: { id: documentId }, data: { status: DocumentStatus.FAILED } }),
      this.audit(businessId, documentId, 'extraction.failed', { extractionId, kind: failure.kind, message }),
    ]);

    if (failure.kind === 'internal') {
      this.logger.error(`Extraction ${extractionId} crashed`, error);
      throw error;
    }
    this.logger.warn(`Extraction ${extractionId} failed (${failure.kind}): ${message}`);
    return { extractionId, status: 'FAILED', kind: failure.kind, retryable: failure.retryable };
  }

  /** Pipeline actions are logged with no actor: the system did them, not a user. */
  private audit(businessId: string, documentId: string, action: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({
      data: { businessId, actorId: null, action, entityType: 'Document', entityId: documentId, metadata },
    });
  }
}
