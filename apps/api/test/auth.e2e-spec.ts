import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

// Runs against the local database. Every business created here is tracked and
// deleted afterwards (users cascade with their business).
describe('Auth & tenancy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdBusinessIds: string[] = [];
  const runId = Date.now().toString(36);
  const email = (name: string) => `${name}-${runId}@e2e.test`;
  const password = 'correct-horse-battery';

  async function register(name: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ businessName: `${name} Inc`, name, email: email(name), password })
      .expect(201);
    createdBusinessIds.push(res.body.user.businessId);
    return res.body as { accessToken: string; user: { id: string; businessId: string; role: string } };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
    await app.close();
  });

  it('keeps /health public', () => request(app.getHttpServer()).get('/health').expect(200));

  it('registers a business with its first user as admin', async () => {
    const { accessToken, user } = await register('alice');
    expect(accessToken).toEqual(expect.any(String));
    expect(user.role).toBe('ADMIN');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ businessName: 'Dup', name: 'Dup', email: email('alice').toUpperCase(), password })
      .expect(409);
  });

  it('logs in and returns the current user from /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: email('alice'), password })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(email('alice'));
    expect(me.body.business.name).toBe('alice Inc');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: email('alice'), password: 'nope-nope-nope' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: email('nobody'), password })
      .expect(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl')
      .expect(401);
  });

  it('validates input and rejects unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ businessName: 'X', name: 'X', email: 'not-an-email', password: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ businessName: 'X', name: 'X', email: email('x'), password, role: 'ADMIN', isAdmin: true })
      .expect(400);
  });

  describe('roles and tenant isolation', () => {
    let adminA: string;
    let adminB: string;
    let submitterA: string;

    beforeAll(async () => {
      adminA = (await register('tenant-a')).accessToken;
      adminB = (await register('tenant-b')).accessToken;

      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminA}`)
        .send({ name: 'Sub A', email: email('sub-a'), password, role: 'SUBMITTER' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: email('sub-a'), password })
        .expect(200);
      submitterA = login.body.accessToken;
    });

    it("lists only the caller's own business users", async () => {
      const a = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${adminA}`).expect(200);
      const b = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${adminB}`).expect(200);

      expect(a.body.map((u: { email: string }) => u.email).sort()).toEqual([email('sub-a'), email('tenant-a')].sort());
      expect(b.body.map((u: { email: string }) => u.email)).toEqual([email('tenant-b')]);
    });

    it('forbids non-admins from managing users', async () => {
      await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${submitterA}`).expect(403);
      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${submitterA}`)
        .send({ name: 'Nope', email: email('nope'), password, role: 'ADMIN' })
        .expect(403);
    });

    it('revokes access immediately when a user is deleted', async () => {
      await prisma.user.delete({ where: { email: email('sub-a') } });
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${submitterA}`).expect(401);
    });
  });
});
