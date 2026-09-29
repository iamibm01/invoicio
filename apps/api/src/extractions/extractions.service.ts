import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { buffer } from 'node:stream/consumers';
import type { AllowedMimeType } from '../documents/upload-rules.js';
import { DocumentStatus, ExtractionStatus, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { toDocumentBlock, type DocumentBlock } from './document-input.js';
import { PROMPT_VERSION } from './extraction.prompt.js';
import { EXTRACTION_MODEL } from './extractor.service.js';
import { ModelCallError } from './model/structured-output.service.js';
import { ClassificationStep } from './pipeline/classification.step.js';
import { ExtractionStep } from './pipeline/extraction.step.js';
import { ValidationStep } from './pipeline/validation.step.js';
import { PipelineOrchestrator } from './pipeline/pipeline-orchestrator.js';
import type { FailureKind, PipelineResult, PipelineStep, StepKey } from './pipeline/pipeline.types.js';
import { runReviewReasons } from './review-policy.js';

export type RunOutcome =
  | {
      extractionId: string;
      status: 'SUCCEEDED' | 'PARTIAL';
      documentStatus: 'REVIEW' | 'DONE';
      reviewReasons: string[];
    }
  | { extractionId: string; status: 'FAILED'; kind: FailureKind; retryable: boolean };

/** Documents in these states can be (re)processed; anything else is in flight or finished. */
const RUNNABLE: DocumentStatus[] = [DocumentStatus.QUEUED, DocumentStatus.FAILED];

/**
 * Runs the pipeline for one document and records the outcome, success or
 * failure, so every run leaves a trace. The steps themselves, and what
 * happens between them, belong to PipelineOrchestrator; this service owns the
 * document around them: claiming it, loading the file, and turning the
 * pipeline's result into run and document statuses.
 *
 * Lifecycle:
 *   Document  QUEUED ─claim─▶ PROCESSING ─▶ REVIEW | DONE | FAILED
 *   Extraction           RUNNING ─▶ SUCCEEDED | PARTIAL | FAILED
 *
 * The Extraction row is created *before* the model call, so a run that
 * crashes halfway still shows up as RUNNING with a start time rather than
 * vanishing. Every run is a new row; earlier runs of the same document stay
 * put for comparison.
 */
@Injectable()
export class ExtractionsService {
  private readonly logger = new Logger(ExtractionsService.name);

  /** The pipeline, in order. Categorization joins when it's built. */
  private readonly steps: PipelineStep[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly orchestrator: PipelineOrchestrator,
    classificationStep: ClassificationStep,
    extractionStep: ExtractionStep,
    validationStep: ValidationStep,
  ) {
    this.steps = [classificationStep, extractionStep, validationStep];
  }

  async run(businessId: string, documentId: string): Promise<RunOutcome> {
    const document = await this.claim(businessId, documentId);

    const extraction = await this.prisma.extraction.create({
      data: { businessId, documentId, model: EXTRACTION_MODEL, promptVersion: PROMPT_VERSION },
      select: { id: true },
    });

    let block: DocumentBlock;
    try {
      const file = await buffer(await this.storage.getStream(document.storageKey));
      block = await toDocumentBlock(file, document.mimeType as AllowedMimeType);
    } catch (error) {
      // No usable input (file missing, image can't be decoded): nothing to run.
      return this.recordFailure(businessId, documentId, extraction.id, 'extraction', error);
    }

    const result = await this.orchestrator.run(
      { businessId, documentId, extractionId: extraction.id, document: block },
      this.steps,
    );

    if (result.status === 'FAILED') {
      const failure = result.failures.find((f) => f.required)!;
      return this.recordFailure(businessId, documentId, extraction.id, failure.key, failure.cause);
    }
    return this.recordSuccess(businessId, documentId, extraction.id, result);
  }

  /**
   * SUCCEEDED or PARTIAL. Each step already saved its own output; this sets
   * the final statuses. A document is DONE only when nothing needs a person
   * (see runReviewReasons): no low-confidence or missing fields, a confident
   * classification, and no failed or skipped step standing in the way.
   */
  private async recordSuccess(
    businessId: string,
    documentId: string,
    extractionId: string,
    result: PipelineResult,
  ): Promise<RunOutcome> {
    const fields = result.state.extraction?.fields ?? [];
    const classification = result.state.classification?.output ?? null;
    const reasons = runReviewReasons({
      fields,
      classification,
      issues: result.state.validation?.issues ?? [],
      steps: [
        ...result.skipped.map((s) => ({ key: s.key, status: 'SKIPPED' as const, reason: s.reason })),
        ...result.failures.map((f) => ({ key: f.key, status: 'FAILED' as const })),
      ],
    });
    const documentStatus = reasons.length > 0 ? DocumentStatus.REVIEW : DocumentStatus.DONE;
    const status = result.status === 'PARTIAL' ? ExtractionStatus.PARTIAL : ExtractionStatus.SUCCEEDED;
    const errors = Object.fromEntries(
      result.failures.map((f) => [f.key, { kind: f.kind, message: f.message, retryable: f.retryable }]),
    );

    await this.prisma.$transaction([
      this.prisma.extraction.update({
        where: { id: extractionId },
        data: { status, errors: result.failures.length > 0 ? errors : undefined, completedAt: new Date() },
      }),
      this.prisma.document.update({ where: { id: documentId }, data: { status: documentStatus } }),
      this.audit(businessId, documentId, 'extraction.succeeded', {
        extractionId,
        status,
        fieldCount: fields.length,
        failedSteps: result.failures.map((f) => f.key),
        skippedSteps: result.skipped.map((s) => s.step),
        reviewReasons: reasons,
      }),
    ]);

    return { extractionId, status: result.status === 'PARTIAL' ? 'PARTIAL' : 'SUCCEEDED', documentStatus, reviewReasons: reasons };
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
    step: StepKey,
    error: unknown,
  ): Promise<RunOutcome> {
    // Model/API failures are expected and typed. Anything else (storage
    // missing, a corrupt image, a bug) is still recorded, then rethrown so
    // it shows up in logs as the error it is.
    const failure =
      error instanceof ModelCallError
        ? { kind: error.kind, retryable: error.retryable, attempts: error.attempts, rawOutputs: error.rawOutputs }
        : { kind: 'internal' as const, retryable: false, attempts: 0, rawOutputs: [] };
    const message = error instanceof Error ? error.message : String(error);

    await this.prisma.$transaction([
      this.prisma.extraction.update({
        where: { id: extractionId },
        data: {
          status: ExtractionStatus.FAILED,
          // Keyed by pipeline step, like PARTIAL runs' errors.
          errors: { [step]: { kind: failure.kind, message, retryable: failure.retryable } },
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
