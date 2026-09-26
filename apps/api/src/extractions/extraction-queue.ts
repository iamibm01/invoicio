import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';

export const EXTRACTION_QUEUE = 'extraction';

/**
 * Only ids go on the queue, never file contents or extracted data. The worker
 * reloads everything from the database, so a job that sits in Redis for a
 * while still acts on current state, and Redis never holds tenant data.
 */
export interface ExtractionJobData {
  businessId: string;
  documentId: string;
}

/*
 * Job-level retries are the third and slowest retry layer:
 *   1. the SDK retries HTTP errors within seconds;
 *   2. the extractor re-asks the model when its output is malformed;
 *   3. the queue re-runs the whole job after 30s, then 60s, for failures that
 *      might be temporary (e.g. the API being overloaded for a few minutes).
 */
export const EXTRACTION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  // Failed jobs are kept for a week for debugging. The run details live on
  // the Extraction row anyway.
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

@Injectable()
export class ExtractionQueue {
  constructor(@InjectQueue(EXTRACTION_QUEUE) private readonly queue: Queue<ExtractionJobData>) {}

  /**
   * The job id is the document id, so enqueueing a document that already has
   * a waiting or running job is a no-op rather than a duplicate extraction.
   * (Once a job finishes it's removed, so a later re-run can be queued again.)
   */
  async enqueue(data: ExtractionJobData): Promise<void> {
    await this.queue.add('extract', data, { ...EXTRACTION_JOB_OPTIONS, jobId: data.documentId });
  }
}
