import { ConflictException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { flattenExtraction, type ExtractionOutput } from '../src/extractions/extraction.schema.js';
import { ExtractionsService } from '../src/extractions/extractions.service.js';
import {
  ExtractionFailedError,
  ExtractorService,
  type ExtractionResult,
} from '../src/extractions/extractor.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

// Real database and storage; only the model call is faked, so these tests
// check what gets persisted without spending API credits.
describe('Extractions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let extractions: ExtractionsService;
  let storageDir: string;
  const createdBusinessIds: string[] = [];
  const runId = Date.now().toString(36);
  const extract = vi.fn<ExtractorService['extract']>();

  const s = (value: string | null, confidence = 0.95) => ({ value, confidence });
  const output = (overrides: Partial<ExtractionOutput> = {}): ExtractionOutput => ({
    vendorName: s('Careem'),
    documentNumber: s(null),
    date: s('2026-08-14'),
    currency: s('AED'),
    subtotal: s('40.00'),
    tax: s('2.50'),
    total: s('42.50'),
    lineItems: [{ description: s('Trip fare'), quantity: s(null), amount: s('40.00') }],
    ...overrides,
  });
  const result = (o: ExtractionOutput, model = 'claude-opus-5'): ExtractionResult => ({
    output: o,
    fields: flattenExtraction(o),
    model,
    promptVersion: 'extract-v1',
    attempts: 1,
    usage: { inputTokens: 1000, outputTokens: 200 },
    rawOutputs: [[{ type: 'text', text: JSON.stringify(o) }]],
  });

  let tenant: { token: string; businessId: string };
  let uploads = 0;

  /** Uploads a unique real PNG (so the checksum never collides) and returns its id. */
  async function uploadDocument(): Promise<string> {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: uploads++, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${tenant.token}`)
      .attach('file', png, `receipt-${uploads}.png`)
      .expect(201);
    return res.body.document.id as string;
  }

  const load = (documentId: string) =>
    prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { extractions: { include: { fields: true }, orderBy: { startedAt: 'asc' } } },
    });

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
    extractions = app.get(ExtractionsService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        businessName: 'extract Inc',
        name: 'extract',
        email: `extract-${runId}@e2e.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);
    tenant = { token: res.body.accessToken, businessId: res.body.user.businessId };
    createdBusinessIds.push(tenant.businessId);
  });

  beforeEach(() => extract.mockReset());

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('stores fields and marks a confident extraction DONE', async () => {
    const documentId = await uploadDocument();
    extract.mockResolvedValueOnce(result(output(), 'claude-opus-4-8'));

    const outcome = await extractions.run(tenant.businessId, documentId);
    expect(outcome).toMatchObject({ status: 'SUCCEEDED', documentStatus: 'DONE', reviewReasons: [] });

    // The extractor received an image block built from the stored file.
    expect(extract.mock.calls[0][0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });

    const doc = await load(documentId);
    expect(doc.status).toBe('DONE');
    const [run] = doc.extractions;
    expect(run).toMatchObject({ status: 'SUCCEEDED', model: 'claude-opus-4-8', attempts: 1 });
    expect(run.completedAt).not.toBeNull();
    expect(run.fields).toHaveLength(10);
    expect(run.fields.every((f) => f.businessId === tenant.businessId)).toBe(true);
    expect(run.fields.find((f) => f.path === 'total')).toMatchObject({
      valueType: 'MONEY',
      value: '42.50',
      confidence: 0.95,
    });

    const audit = await prisma.auditLog.findFirst({ where: { entityId: documentId, action: 'extraction.succeeded' } });
    expect(audit).toMatchObject({ actorId: null });
  });

  it('sends low-confidence or incomplete extractions to REVIEW with reasons', async () => {
    const documentId = await uploadDocument();
    extract.mockResolvedValueOnce(result(output({ total: s(null), currency: s('USD', 0.6) })));

    const outcome = await extractions.run(tenant.businessId, documentId);
    expect(outcome).toMatchObject({
      documentStatus: 'REVIEW',
      reviewReasons: ['total missing', 'low confidence: currency'],
    });
    expect((await load(documentId)).status).toBe('REVIEW');
  });

  it('records a model failure, and allows a retry that creates a second run', async () => {
    const documentId = await uploadDocument();
    extract.mockRejectedValueOnce(
      new ExtractionFailedError('api', 'Overloaded', 1, true, [[{ type: 'text', text: 'partial' }]]),
    );

    const failed = await extractions.run(tenant.businessId, documentId);
    expect(failed).toMatchObject({ status: 'FAILED', kind: 'api', retryable: true });

    let doc = await load(documentId);
    expect(doc.status).toBe('FAILED');
    expect(doc.extractions[0]).toMatchObject({
      status: 'FAILED',
      errors: { extraction: { kind: 'api', message: 'Overloaded', retryable: true } },
      rawOutput: [[{ type: 'text', text: 'partial' }]],
    });
    expect(doc.extractions[0].fields).toHaveLength(0);

    extract.mockResolvedValueOnce(result(output()));
    await extractions.run(tenant.businessId, documentId);
    doc = await load(documentId);
    expect(doc.status).toBe('DONE');
    expect(doc.extractions.map((e) => e.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('records then rethrows unexpected errors', async () => {
    const documentId = await uploadDocument();
    const bug = new TypeError('boom');
    extract.mockRejectedValueOnce(bug);

    await expect(extractions.run(tenant.businessId, documentId)).rejects.toBe(bug);
    const doc = await load(documentId);
    expect(doc.status).toBe('FAILED');
    expect(doc.extractions[0].errors).toMatchObject({ extraction: { kind: 'internal', message: 'boom' } });
  });

  it('refuses to re-run a finished document', async () => {
    const documentId = await uploadDocument();
    extract.mockResolvedValueOnce(result(output()));
    await extractions.run(tenant.businessId, documentId);

    await expect(extractions.run(tenant.businessId, documentId)).rejects.toThrow(ConflictException);
    expect(extract).toHaveBeenCalledOnce();
  });

  it("returns 404 for another business's document", async () => {
    const documentId = await uploadDocument();
    const otherBusiness = '00000000-0000-7000-8000-000000000000';
    await expect(extractions.run(otherBusiness, documentId)).rejects.toThrow(NotFoundException);
    expect((await load(documentId)).status).toBe('QUEUED');
  });

  describe('GET /documents/:id', () => {
    const get = (id: string) =>
      request(app.getHttpServer()).get(`/documents/${id}`).set('Authorization', `Bearer ${tenant.token}`);

    it('returns no extraction for a document that has not run yet', async () => {
      const documentId = await uploadDocument();
      const res = await get(documentId).expect(200);
      expect(res.body).toMatchObject({ id: documentId, status: 'QUEUED', extraction: null });
    });

    it('returns the latest run with fields in document order and review reasons', async () => {
      const documentId = await uploadDocument();
      extract.mockResolvedValueOnce(result(output({ currency: s('USD', 0.6) })));
      await extractions.run(tenant.businessId, documentId);

      const res = await get(documentId).expect(200);
      expect(res.body.status).toBe('REVIEW');
      expect(res.body.extraction).toMatchObject({
        status: 'SUCCEEDED',
        reviewReasons: ['low confidence: currency'],
      });
      expect(res.body.extraction.fields.map((f: { path: string }) => f.path)).toEqual(
        flattenExtraction(output()).map((f) => f.path),
      );
      expect(res.body.extraction).not.toHaveProperty('rawOutput');
    });

    it("returns 404 for another business's document", async () => {
      const documentId = await uploadDocument();
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          businessName: 'other Inc',
          name: 'other',
          email: `other-${runId}@e2e.test`,
          password: 'correct-horse-battery',
        })
        .expect(201);
      createdBusinessIds.push(other.body.user.businessId);

      await request(app.getHttpServer())
        .get(`/documents/${documentId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(404);
    });
  });

  it('lets only one of two concurrent runs claim a document', async () => {
    const documentId = await uploadDocument();
    extract.mockResolvedValue(result(output()));

    const outcomes = await Promise.allSettled([
      extractions.run(tenant.businessId, documentId),
      extractions.run(tenant.businessId, documentId),
    ]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(extract).toHaveBeenCalledOnce();
    expect((await load(documentId)).extractions).toHaveLength(1);
  });
});
