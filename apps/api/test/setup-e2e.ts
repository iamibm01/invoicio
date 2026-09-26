// Runs before each e2e test file (see vitest.config.e2e.ts).
import 'dotenv/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { EXTRACTION_QUEUE } from '../src/extractions/extraction-queue.js';

// A queue namespace per test file: test jobs never reach the dev server's
// worker, and parallel test files never see each other's jobs.
process.env.QUEUE_PREFIX = `invoicio-test-${randomUUID()}`;

// Uploads enqueue extractions. Unless a test opts in (and fakes the model),
// nothing should process them; otherwise every upload test would make paid
// API calls.
process.env.EXTRACTION_WORKER ??= 'off';

// The startup recovery sweep acts on every business in the database, and the
// e2e database is the dev database. Tests call the scoped recover() instead.
process.env.EXTRACTION_RECOVERY = 'off';

afterAll(async () => {
  const queue = new Queue(EXTRACTION_QUEUE, {
    connection: { url: process.env.REDIS_URL },
    prefix: process.env.QUEUE_PREFIX,
  });
  await queue.obliterate({ force: true });
  await queue.close();
});
