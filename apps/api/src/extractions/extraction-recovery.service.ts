import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExtractionQueue } from './extraction-queue.js';

/**
 * A PROCESSING document untouched for this long belongs to a worker that
 * died mid-run. A normal run takes seconds; even three repair attempts at
 * worst-case latency finish far sooner.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Makes the queue self-healing across restarts. Two gaps can strand a document:
 *  - the upload saved the document, but adding the job failed (Redis down),
 *    so it sits in QUEUED with no job;
 *  - a worker crashed mid-run, so it sits in PROCESSING and can never be
 *    claimed again.
 * On startup, stale PROCESSING documents go back to QUEUED, and every QUEUED
 * document is (re-)enqueued. Enqueueing is idempotent (job id = document id),
 * so documents that already have a job are unaffected.
 *
 * This deliberately spans all businesses: it's a system task acting on
 * pipeline state, not a request made on behalf of any tenant.
 */
@Injectable()
export class ExtractionRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExtractionRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ExtractionQueue,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    // Only the process that runs the worker should repair its state.
    if (this.config.get('EXTRACTION_WORKER') === 'off') return;

    const { count: reset } = await this.prisma.document.updateMany({
      where: { status: DocumentStatus.PROCESSING, updatedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
      data: { status: DocumentStatus.QUEUED },
    });

    const queued = await this.prisma.document.findMany({
      where: { status: DocumentStatus.QUEUED },
      select: { id: true, businessId: true },
    });
    for (const doc of queued) await this.queue.enqueue({ businessId: doc.businessId, documentId: doc.id });

    if (reset > 0 || queued.length > 0) {
      this.logger.log(`Recovered ${reset} stale document(s); enqueued ${queued.length} queued document(s)`);
    }
  }
}
