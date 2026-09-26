import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { flattenExtraction, type ExtractionOutput } from '../src/extractions/extraction.schema.js';
import { ExtractionsService } from '../src/extractions/extractions.service.js';
import { ExtractorService } from '../src/extractions/extractor.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

interface Field {
  id: string;
  path: string;
  value: string | null;
  aiValue: string | null;
  correction: { by: string; at: string } | null;
}

// Real database; the model is faked and extractions are run directly.
describe('Reviews (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storageDir: string;
  const createdBusinessIds: string[] = [];
  const runId = Date.now().toString(36);
  let uploads = 0;

  const s = (value: string | null, confidence = 0.95) => ({ value, confidence });
  const output: ExtractionOutput = {
    vendorName: s('Careem'),
    documentNumber: s(null),
    date: s('2026-08-14'),
    currency: s('USD', 0.6), // low confidence, so the document lands in REVIEW
    subtotal: s('40.00'),
    tax: s('2.50'),
    total: s('42.50'),
    lineItems: [{ description: s('Trip fare'), quantity: s(null), amount: s('40.00') }],
  };
  const extract = vi.fn<ExtractorService['extract']>(async () => ({
    output,
    fields: flattenExtraction(output),
    model: 'claude-opus-5',
    promptVersion: 'extract-v1',
    attempts: 1,
    usage: { inputTokens: 1000, outputTokens: 200 },
    rawOutputs: [],
  }));

  async function register(name: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        businessName: `${name} Inc`,
        name,
        email: `${name}-${runId}@e2e.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);
    createdBusinessIds.push(res.body.user.businessId);
    return {
      token: res.body.accessToken as string,
      businessId: res.body.user.businessId as string,
    };
  }

  async function upload(token: string): Promise<string> {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: uploads++, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', png, 'receipt.png')
      .expect(201);
    return res.body.document.id as string;
  }

  /** An uploaded document with a finished extraction, in REVIEW. */
  async function reviewableDocument(tenant: { token: string; businessId: string }) {
    const id = await upload(tenant.token);
    await app.get(ExtractionsService).run(tenant.businessId, id);
    return id;
  }

  const detail = async (token: string, id: string) =>
    (
      await request(app.getHttpServer())
        .get(`/documents/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { status: string; extraction: { fields: Field[] } };

  const field = (fields: Field[], p: string) => fields.find((f) => f.path === p)!;

  const review = (
    token: string,
    id: string,
    corrections: { fieldId: string; value: string | null }[],
  ) =>
    request(app.getHttpServer())
      .post(`/documents/${id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ corrections });

  let alice: { token: string; businessId: string };

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
    alice = await register('reviewer');
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('stores corrections without touching the model value, and confirms the review', async () => {
    const id = await reviewableDocument(alice);
    const before = await detail(alice.token, id);
    expect(before.status).toBe('REVIEW');
    const currency = field(before.extraction.fields, 'currency');
    const total = field(before.extraction.fields, 'total');

    const res = await review(alice.token, id, [
      { fieldId: currency.id, value: 'aed' },
      { fieldId: total.id, value: '1,042.50' },
    ]).expect(200);
    expect(res.body).toEqual({ documentStatus: 'DONE', corrected: 2 });

    const after = await detail(alice.token, id);
    expect(after.status).toBe('DONE');
    expect(field(after.extraction.fields, 'currency')).toMatchObject({
      value: 'AED',
      aiValue: 'USD',
      correction: { by: 'reviewer' },
    });
    expect(field(after.extraction.fields, 'total')).toMatchObject({
      value: '1042.50',
      aiValue: '42.50',
    });
    expect(field(after.extraction.fields, 'vendorName').correction).toBeNull();

    // The model's value is still on the field row; the edit is a separate row.
    const stored = await prisma.extractionField.findUniqueOrThrow({ where: { id: currency.id } });
    expect(stored.value).toBe('USD');
    const audit = await prisma.auditLog.findMany({
      where: { businessId: alice.businessId, entityId: { in: [id, currency.id] } },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['document.reviewed', 'field.corrected']),
    );
  });

  it('confirms a review with no changes, and skips values that did not change', async () => {
    const id = await reviewableDocument(alice);
    const vendor = field((await detail(alice.token, id)).extraction.fields, 'vendorName');

    const res = await review(alice.token, id, [{ fieldId: vendor.id, value: ' Careem ' }]).expect(
      200,
    );
    expect(res.body).toEqual({ documentStatus: 'DONE', corrected: 0 });
    expect(await prisma.correction.count({ where: { extractionFieldId: vendor.id } })).toBe(0);
  });

  it('lets a DONE document be edited again, recording what each edit replaced', async () => {
    const id = await reviewableDocument(alice);
    const tax = field((await detail(alice.token, id)).extraction.fields, 'tax');

    await review(alice.token, id, [{ fieldId: tax.id, value: '3.00' }]).expect(200);
    await review(alice.token, id, [{ fieldId: tax.id, value: '' }]).expect(200);

    expect(field((await detail(alice.token, id)).extraction.fields, 'tax')).toMatchObject({
      value: null,
      aiValue: '2.50',
    });
    const history = await prisma.correction.findMany({
      where: { extractionFieldId: tax.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((c) => [c.previousValue, c.correctedValue])).toEqual([
      ['2.50', '3.00'],
      ['3.00', null],
    ]);
  });

  it('rejects invalid values without saving anything', async () => {
    const id = await reviewableDocument(alice);
    const fields = (await detail(alice.token, id)).extraction.fields;

    const res = await review(alice.token, id, [
      { fieldId: field(fields, 'currency').id, value: 'AED' },
      { fieldId: field(fields, 'date').id, value: '14/08/2026' },
    ]).expect(400);
    expect(res.body.message).toEqual(['date: must be a real date as YYYY-MM-DD']);

    // All or nothing: the valid currency edit wasn't saved either.
    expect((await detail(alice.token, id)).status).toBe('REVIEW');
    expect(
      await prisma.correction.count({ where: { extractionFieldId: field(fields, 'currency').id } }),
    ).toBe(0);
  });

  it('rejects a field that belongs to a different document', async () => {
    const id = await reviewableDocument(alice);
    const otherId = await reviewableDocument(alice);
    const foreign = field((await detail(alice.token, otherId)).extraction.fields, 'total');

    await review(alice.token, id, [{ fieldId: foreign.id, value: '1.00' }]).expect(400);
  });

  it('refuses to review a document whose extraction has not finished', async () => {
    const id = await upload(alice.token);
    await review(alice.token, id, []).expect(409);
  });

  it("returns 404 for another business's document", async () => {
    const id = await reviewableDocument(alice);
    const bob = await register('outsider');
    await review(bob.token, id, []).expect(404);
  });
});
