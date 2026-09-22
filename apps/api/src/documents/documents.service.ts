import { Injectable, Logger, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuthUser } from '../auth/auth.types.js';
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

    try {
      const document = await this.prisma.$transaction(async (tx) => {
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
      });
      return { document, duplicate: false };
    } catch (error) {
      // Don't leave an orphaned file behind if the database write failed.
      await this.storage.delete(storageKey).catch((cleanupError: unknown) => {
        this.logger.error(`Failed to clean up ${storageKey}`, cleanupError);
      });
      throw error;
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
