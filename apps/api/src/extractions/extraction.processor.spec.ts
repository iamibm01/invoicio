import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { ExtractionJobData } from './extraction-queue.js';
import { ExtractionProcessor, RetryableExtractionError } from './extraction.processor.js';
import type { ExtractionsService, RunOutcome } from './extractions.service.js';

const job = { data: { businessId: 'b1', documentId: 'd1' } } as Job<ExtractionJobData>;

function setup(run: () => Promise<RunOutcome>) {
  const extractions = { run: vi.fn(run) } as unknown as ExtractionsService;
  const processor = new ExtractionProcessor(extractions, {} as ConfigService);
  return { processor, extractions };
}

describe('ExtractionProcessor', () => {
  it('runs the extraction for the job document', async () => {
    const { processor, extractions } = setup(async () => ({
      extractionId: 'e1',
      status: 'SUCCEEDED',
      documentStatus: 'DONE',
      reviewReasons: [],
    }));
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(extractions.run).toHaveBeenCalledWith('b1', 'd1');
  });

  it('throws on a retryable failure so BullMQ retries the job', async () => {
    const { processor } = setup(async () => ({ extractionId: 'e1', status: 'FAILED', kind: 'api', retryable: true }));
    await expect(processor.process(job)).rejects.toThrow(RetryableExtractionError);
  });

  it('completes the job on a permanent failure: retrying would fail the same way', async () => {
    const { processor } = setup(async () => ({ extractionId: 'e1', status: 'FAILED', kind: 'refused', retryable: false }));
    await expect(processor.process(job)).resolves.toBeUndefined();
  });

  it.each([
    ['a deleted document', new NotFoundException()],
    ['a document another worker already claimed', new ConflictException('Document is PROCESSING')],
  ])('skips %s without retrying', async (_, error) => {
    const { processor } = setup(() => Promise.reject(error));
    await expect(processor.process(job)).resolves.toBeUndefined();
  });

  it('rethrows unexpected errors so they are retried and logged', async () => {
    const bug = new TypeError('boom');
    const { processor } = setup(() => Promise.reject(bug));
    await expect(processor.process(job)).rejects.toBe(bug);
  });
});
