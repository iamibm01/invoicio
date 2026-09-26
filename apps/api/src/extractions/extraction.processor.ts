import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConflictException, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { EXTRACTION_QUEUE, type ExtractionJobData } from './extraction-queue.js';
import { ExtractionsService } from './extractions.service.js';

/**
 * Thrown to make BullMQ retry the job later with backoff. Only failures that
 * might succeed on a later try (e.g. the API was overloaded) use it.
 */
export class RetryableExtractionError extends Error {}

/*
 * concurrency 2: at most two documents are extracted at once per process,
 * which keeps us well inside API rate limits while still overlapping the
 * ~5–10s model calls.
 *
 * autorun false: the worker doesn't start pulling jobs just because the
 * module loaded. onApplicationBootstrap starts it unless EXTRACTION_WORKER is
 * "off", which lets tests (and, later, an API-only deployment) enqueue jobs
 * without processing them.
 */
@Processor(EXTRACTION_QUEUE, { concurrency: 2, autorun: false })
export class ExtractionProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(
    private readonly extractions: ExtractionsService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  onApplicationBootstrap() {
    if (this.config.get('EXTRACTION_WORKER') === 'off') return;
    // run() resolves only when the worker is closed at shutdown, so it isn't awaited.
    this.worker.run().catch((error: unknown) => this.logger.error('Extraction worker stopped', error));
  }

  async process(job: Job<ExtractionJobData>): Promise<void> {
    const { businessId, documentId } = job.data;
    try {
      const outcome = await this.extractions.run(businessId, documentId);
      if (outcome.status === 'FAILED' && outcome.retryable) {
        // The failure is already recorded (document FAILED, Extraction row
        // saved); throwing tells BullMQ to try the whole job again later.
        throw new RetryableExtractionError(`Extraction ${outcome.extractionId} failed (${outcome.kind})`);
      }
    } catch (error) {
      // Nothing to do: the document was deleted, or another worker already
      // claimed it or finished it. Completing the job quietly is correct.
      // Retrying would only fail the same way again.
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        this.logger.log(`Skipping job for document ${documentId}: ${error.message}`);
        return;
      }
      throw error;
    }
  }
}
