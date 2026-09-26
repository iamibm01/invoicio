import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ExtractionRecoveryService } from '../src/extractions/extraction-recovery.service.js';
import { flattenExtraction, type ExtractionOutput } from '../src/extractions/extraction.schema.js';
import { ExtractorService, type ExtractionResult } from '../src/extractions/extractor.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

// This file runs the real worker against real Redis; only the model is faked.
process.env.EXTRACTION_WORKER = 'on';

describe('Extraction queue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storageDir: string;
  let token: string;
  let businessId: string;
  const runId = Date.now().toString(36);

  const s = (value: string | null) => ({ value, confidence: 0.95 });
  const output: ExtractionOutput = {
    vendorName: s('Careem'),
    documentNumber: s(null),
    date: s('2026-08-14'),
    currency: s('AED'),
    subtotal: s('40.00'),
    tax: s('2.50'),
    total: s('42.50'),
    lineItems: [],
  };
  const result: ExtractionResult = {
    output,
    fields: flattenExtraction(output),
    model: 'claude-opus-5',
    promptVersion: 'extract-v1',
    attempts: 1,
    usage: { inputTokens: 1000, outputTokens: 200 },
    rawOutputs: [],
  };
  const extract = vi.fn<ExtractorService['extract']>(async () => result);

  /** Polls until the document reaches `status`; the worker runs asynchronously. */
  async function waitForStatus(documentId: string, status: string, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      if (doc.status === status) return doc;
      if (Date.now() > deadline) throw new Error(`Document stuck in ${doc.status}, expected ${status}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'invoicio-e2e-'));
    process.env.STORAGE_DIR = storageDir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ExtractorService)
      .useValue({ extract })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        businessName: 'queue Inc',
        name: 'queue',
        email: `queue-${runId}@e2e.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);
    token = res.body.accessToken;
    businessId = res.body.user.businessId;
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: businessId } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  let documentId: string;

  it('extracts an uploaded document in the background', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#abc' } })
      .png()
      .toBuffer();
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', png, 'receipt.png')
      .expect(201);

    // The upload returns immediately; extraction happens afterwards.
    expect(res.body.document.status).toBe('QUEUED');
    documentId = res.body.document.id;

    await waitForStatus(documentId, 'DONE');
    expect(extract).toHaveBeenCalledOnce();
  });

  it('recovers a document left in PROCESSING by a crashed worker', async () => {
    // Simulate a crash: stuck in PROCESSING, last touched an hour ago.
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await app.get(ExtractionRecoveryService).recover({ businessId });

    await waitForStatus(documentId, 'DONE');
    const runs = await prisma.extraction.count({ where: { documentId } });
    expect(runs).toBe(2);
  });

  it('leaves a recently updated PROCESSING document alone', async () => {
    await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING' } });
    await app.get(ExtractionRecoveryService).recover({ businessId });

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe('PROCESSING');
  });
});
