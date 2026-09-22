import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

// Files go to a throwaway directory; database rows are deleted afterwards.
describe('Documents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storageDir: string;
  const createdBusinessIds: string[] = [];
  const runId = Date.now().toString(36);

  const pdf = Buffer.from(`%PDF-1.4\n% receipt ${runId}\n%%EOF\n`);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(runId),
  ]);

  async function registerTenant(name: string) {
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
    return { token: res.body.accessToken as string, businessId: res.body.user.businessId as string };
  }

  const upload = (token: string, data: Buffer, filename: string, contentType?: string) =>
    request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', data, { filename, contentType });

  let tenantA: { token: string; businessId: string };
  let tenantB: { token: string; businessId: string };

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'invoicio-e2e-'));
    process.env.STORAGE_DIR = storageDir; // takes precedence over .env

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    tenantA = await registerTenant('docs-a');
    tenantB = await registerTenant('docs-b');
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('stores a PDF, records it as QUEUED and writes an audit entry', async () => {
    const res = await upload(tenantA.token, pdf, 'receipt.pdf').expect(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.document).toMatchObject({
      originalFilename: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      status: 'QUEUED',
    });

    const files = await readdir(path.join(storageDir, tenantA.businessId));
    expect(files).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: res.body.document.id } });
    expect(audit?.action).toBe('document.uploaded');
  });

  it('identifies type from content, not the claimed type or extension', async () => {
    const res = await upload(tenantA.token, png, 'photo.pdf', 'application/pdf').expect(201);
    expect(res.body.document.mimeType).toBe('image/png');
  });

  it('rejects unsupported content even when disguised as a PDF', async () => {
    await upload(tenantA.token, Buffer.from('MZ not really a pdf'), 'invoice.pdf', 'application/pdf').expect(415);
  });

  it('rejects files over the size limit', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]);
    await upload(tenantA.token, big, 'huge.pdf').expect(413);
  });

  it('requires a file and a signed-in user', async () => {
    await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${tenantA.token}`)
      .expect(400);
    await request(app.getHttpServer()).post('/documents').attach('file', pdf, 'r.pdf').expect(401);
  });

  it('returns the existing document for an exact re-upload without storing it again', async () => {
    const first = await upload(tenantA.token, pdf, 'again.pdf').expect(201);
    expect(first.body.duplicate).toBe(true);
    expect(first.body.document.originalFilename).toBe('receipt.pdf');
    expect(await readdir(path.join(storageDir, tenantA.businessId))).toHaveLength(2); // pdf + png
  });

  it('treats the same file in another business as new', async () => {
    const res = await upload(tenantB.token, pdf, 'receipt.pdf').expect(201);
    expect(res.body.duplicate).toBe(false);
  });

  it('lists and serves documents only within the business', async () => {
    const listA = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tenantA.token}`)
      .expect(200);
    expect(listA.body).toHaveLength(2);

    const pdfDoc = listA.body.find((d: { mimeType: string }) => d.mimeType === 'application/pdf');
    const file = await request(app.getHttpServer())
      .get(`/documents/${pdfDoc.id}/file`)
      .set('Authorization', `Bearer ${tenantA.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect('Content-Type', 'application/pdf');
    expect(Buffer.compare(file.body as Buffer, pdf)).toBe(0);

    // Tenant B gets a 404 — indistinguishable from a document that doesn't exist
    await request(app.getHttpServer())
      .get(`/documents/${pdfDoc.id}/file`)
      .set('Authorization', `Bearer ${tenantB.token}`)
      .expect(404);
  });
});
