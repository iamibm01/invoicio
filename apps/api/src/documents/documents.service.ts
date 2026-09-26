import { Injectable, Logger, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuthUser } from '../auth/auth.types.js';
import { ExtractionQueue } from '../extractions/extraction-queue.js';
import { compareFieldPaths } from '../extractions/extraction.schema.js';
import { reviewReasons } from '../extractions/review-policy.js';
import { currentValue, latestCorrection } from '../reviews/latest-correction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { detectFileType } from './detect-file-type.js';
import { ALLOWED_TYPES } from './upload-rules.js';

const documentSummarySelect = {
  id: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  createdAt: true,
};

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** Every method is scoped to the caller's business. */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly extractionQueue: ExtractionQueue,
  ) {}

  async upload(user: AuthUser, file: UploadedFile) {
    const mimeType = detectFileType(file.buffer);
    if (!mimeType) {
      throw new UnsupportedMediaTypeException('Only PDF, JPG, PNG and HEIC files are supported');
    }

    // Exact re-upload of a file this business already has: return the
    // existing document rather than storing and processing it twice.
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.document.findFirst({
      where: { businessId: user.businessId, checksum },
      select: documentSummarySelect,
    });
    if (existing) return { document: existing, duplicate: true };

    // Virus scanning would hook in here, before the file is persisted
    // (e.g. ClamAV via clamd). Not implemented for the local-only setup.

    const storageKey = `${user.businessId}/${randomUUID()}.${ALLOWED_TYPES[mimeType]}`;
    await this.storage.put(storageKey, file.buffer);

    const document = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.document.create({
          data: {
            businessId: user.businessId,
            uploadedById: user.id,
            storageKey,
            originalFilename: file.originalname,
            mimeType,
            sizeBytes: file.size,
            checksum,
          },
          select: documentSummarySelect,
        });
        await tx.auditLog.create({
          data: {
            businessId: user.businessId,
            actorId: user.id,
            action: 'document.uploaded',
            entityType: 'Document',
            entityId: created.id,
            metadata: { filename: file.originalname, mimeType, sizeBytes: file.size },
          },
        });
        return created;
      })
      .catch(async (error: unknown) => {
        // Don't leave an orphaned file behind if the database write failed.
        await this.storage.delete(storageKey).catch((cleanupError: unknown) => {
          this.logger.error(`Failed to clean up ${storageKey}`, cleanupError);
        });
        throw error;
      });

    await this.enqueueExtraction(user.businessId, document.id);
    return { document, duplicate: false };
  }

  /**
   * The upload has already succeeded at this point, so a Redis outage
   * shouldn't turn it into an error for the user. The document stays QUEUED,
   * and ExtractionRecoveryService enqueues it when the worker next starts.
   */
  private async enqueueExtraction(businessId: string, documentId: string) {
    try {
      await this.extractionQueue.enqueue({ businessId, documentId });
    } catch (error) {
      this.logger.error(`Could not enqueue extraction for document ${documentId}`, error);
    }
  }

  list(businessId: string) {
    return this.prisma.document.findMany({
      where: { businessId },
      select: documentSummarySelect,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * A document with its most recent extraction run. Earlier runs are kept in
   * the database for comparison, but only the latest one is shown. Raw model
   * output is deliberately left out: it's for debugging, not for display.
   */
  async getDetail(businessId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, businessId },
      select: {
        ...documentSummarySelect,
        extractions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            model: true,
            promptVersion: true,
            attempts: true,
            errors: true,
            startedAt: true,
            completedAt: true,
            fields: {
              select: {
                id: true,
                path: true,
                valueType: true,
                value: true,
                confidence: true,
                corrections: latestCorrection,
              },
            },
          },
        },
      },
    });
    if (!document) throw new NotFoundException();

    const { extractions, ...summary } = document;
    const latest = extractions[0];
    if (!latest) return { ...summary, extraction: null };

    const modelFields = latest.fields.sort((a, b) => compareFieldPaths(a.path, b.path));
    // `value` is what currently counts (the latest correction, if any);
    // `aiValue` keeps the model's answer, so the UI can show what changed.
    // Confidence is always the model's: a corrected field shows who
    // corrected it instead.
    const fields = modelFields.map(({ corrections, value, ...field }) => {
      const correction = corrections[0];
      return {
        ...field,
        value: currentValue({ value, corrections }),
        aiValue: value,
        correction: correction ? { by: correction.user.name, at: correction.createdAt } : null,
      };
    });

    return {
      ...summary,
      extraction: {
        ...latest,
        fields,
        // Why the model's output was flagged: judged on the model's values,
        // and recomputed so it reflects the current policy (the audit log
        // keeps the reasons as they were at the time).
        reviewReasons: latest.status === 'SUCCEEDED' ? reviewReasons(modelFields) : [],
      },
    };
  }

  async getFile(
    businessId: string,
    id: string,
  ): Promise<{ stream: Readable; mimeType: string; filename: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id, businessId },
      select: { storageKey: true, mimeType: true, originalFilename: true },
    });
    // Same 404 for "doesn't exist" and "belongs to another business".
    if (!document) throw new NotFoundException();

    return {
      stream: await this.storage.getStream(document.storageKey),
      mimeType: document.mimeType,
      filename: document.originalFilename,
    };
  }
}
