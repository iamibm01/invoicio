import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ClassifierService } from '../src/extractions/classification.js';
import { flattenExtraction, type ExtractionOutput } from '../src/extractions/extraction.schema.js';
import { ExtractionsService } from '../src/extractions/extractions.service.js';
import { ExtractorService } from '../src/extractions/extractor.service.js';
import { ValidationService } from '../src/extractions/validation/validation.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { fakeClassifier } from './fakes.js';

// The validation step through the real pipeline and database; only the
// model calls are faked, so each test controls what "was extracted".
describe('Validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let extractions: ExtractionsService;
  let storageDir: string;
  let tenant: { token: string; businessId: string };
  const runId = Date.now().toString(36);
  let uploads = 0;

  const s = (value: string | null, confidence = 0.97) => ({ value, confidence });
  const receipt = (o: { vendor: string; date: string; items: string[]; subtotal: string | null; tax: string | null; total: string }): ExtractionOutput => ({
    vendorName: s(o.vendor),
    documentNumber: s(null),
    date: s(o.date),
    currency: s('MYR'),
    subtotal: s(o.subtotal),
    tax: s(o.tax),
    total: s(o.total),
    lineItems: o.items.map((amount, i) => ({ description: s(`Item ${i}`), quantity: s('1'), amount: s(amount) })),
  });

  const extract = vi.fn<ExtractorService['extract']>();
  const classifier = fakeClassifier();

  /** Uploads a unique image and runs the pipeline with `output` as the extraction. */
  async function runReceipt(output: ExtractionOutput) {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: uploads++, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    const upload = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${tenant.token}`)
      .attach('file', png, `receipt-${uploads}.png`)
      .expect(201);
    const documentId = upload.body.document.id as string;
    extract.mockResolvedValueOnce({
      output,
      fields: flattenExtraction(output),
      model: 'claude-opus-5',
      promptVersion: 'extract-v1',
      attempts: 1,
      usage: { inputTokens: 1000, outputTokens: 200 },
      rawOutputs: [],
    });
    const outcome = await extractions.run(tenant.businessId, documentId);
    return { documentId, outcome };
  }

  const detail = async (id: string) =>
    (await request(app.getHttpServer()).get(`/documents/${id}`).set('Authorization', `Bearer ${tenant.token}`).expect(200))
      .body;

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'invoicio-e2e-'));
    process.env.STORAGE_DIR = storageDir;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ExtractorService)
      .useValue({ extract })
      .overrideProvider(ClassifierService)
      .useValue(classifier)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    extractions = app.get(ExtractionsService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ businessName: 'validate Inc', name: 'validate', email: `validate-${runId}@e2e.test`, password: 'correct-horse-battery' })
      .expect(201);
    tenant = { token: res.body.accessToken, businessId: res.body.user.businessId };
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: tenant.businessId } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('passes a receipt whose numbers add up', async () => {
    const { outcome } = await runReceipt(
      receipt({ vendor: 'Blue Bean', date: '2026-08-01', items: ['36.00', '14.50', '6.00'], subtotal: '56.50', tax: '2.83', total: '59.33' }),
    );
    expect(outcome).toMatchObject({ status: 'SUCCEEDED', documentStatus: 'DONE', reviewReasons: [] });
  });

  it('sends a total that does not add up to review, and clears the warning once corrected', async () => {
    const { documentId, outcome } = await runReceipt(
      receipt({ vendor: 'Kopi Corner', date: '2026-08-02', items: ['10.00'], subtotal: '10.00', tax: '0.60', total: '16.60' }),
    );
    expect(outcome).toMatchObject({
      documentStatus: 'REVIEW',
      reviewReasons: ['Subtotal 10.00 + tax 0.60 = 10.60, but the total is 16.60'],
    });
    const stored = await prisma.validationIssue.findMany({ where: { extraction: { documentId } } });
    expect(stored).toMatchObject([{ code: 'TOTAL_MISMATCH', severity: 'WARNING' }]);

    // The reviewer fixes the misread total; the live check agrees.
    const before = await detail(documentId);
    expect(before.extraction.validation.issues).toMatchObject([{ code: 'TOTAL_MISMATCH' }]);
    const total = before.extraction.fields.find((f: { path: string }) => f.path === 'total');
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${tenant.token}`)
      .send({ corrections: [{ fieldId: total.id, value: '10.60' }] })
      .expect(200);
    expect((await detail(documentId)).extraction.validation.issues).toEqual([]);
  });

  it('notes a rounding adjustment without sending the document to review', async () => {
    const { documentId, outcome } = await runReceipt(
      receipt({ vendor: 'Yongfatt', date: '2026-08-03', items: ['80.91'], subtotal: '80.91', tax: '0.00', total: '80.90' }),
    );
    expect(outcome).toMatchObject({ documentStatus: 'DONE' });
    expect((await detail(documentId)).extraction.validation.issues).toMatchObject([
      { code: 'ROUNDING_ADJUSTMENT', severity: 'INFO' },
    ]);
  });

  it('flags the same purchase submitted twice', async () => {
    const same = { vendor: 'CAREEM NETWORKS FZ-LLC', date: '2026-08-04', items: ['40.00'], subtotal: '40.00', tax: '2.50', total: '42.50' };
    const first = await runReceipt(receipt(same));
    expect(first.outcome).toMatchObject({ documentStatus: 'DONE' });

    // Photographed again: the vendor name reads slightly differently.
    const second = await runReceipt(receipt({ ...same, vendor: 'Careem Networks', total: '42.5' }));
    expect(second.outcome).toMatchObject({ documentStatus: 'REVIEW' });
    const issues = await prisma.validationIssue.findMany({ where: { extraction: { documentId: second.documentId } } });
    expect(issues).toMatchObject([{ code: 'POSSIBLE_DUPLICATE', relatedDocumentId: first.documentId }]);
  });

  it("flags a total far above the vendor's usual amount", async () => {
    for (const [day, total] of [['05', '11.00'], ['06', '12.00'], ['07', '10.00']]) {
      await runReceipt(receipt({ vendor: 'Mr D.I.Y.', date: `2026-08-${day}`, items: [total], subtotal: total, tax: null, total }));
    }
    const { outcome } = await runReceipt(
      receipt({ vendor: 'MR D.I.Y. (M) SDN BHD', date: '2026-08-08', items: ['95.00'], subtotal: '95.00', tax: null, total: '95.00' }),
    );
    expect(outcome).toMatchObject({
      documentStatus: 'REVIEW',
      reviewReasons: ["Total is 8.6× this vendor's usual amount (median 11.00 across 3 documents)"],
    });
  });

  it('makes the run PARTIAL if validation itself fails', async () => {
    vi.spyOn(app.get(ValidationService), 'validate').mockRejectedValueOnce(new Error('database timeout'));
    const { documentId, outcome } = await runReceipt(
      receipt({ vendor: 'Indah Gift', date: '2026-08-09', items: ['60.30'], subtotal: '60.30', tax: null, total: '60.30' }),
    );
    expect(outcome).toMatchObject({ status: 'PARTIAL', documentStatus: 'REVIEW', reviewReasons: ['validation step failed'] });
    expect((await detail(documentId)).extraction.validation).toEqual({ ran: false, issues: [] });
  });
});
