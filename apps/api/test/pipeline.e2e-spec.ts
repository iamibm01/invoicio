import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ExtractionFailedError } from '../src/extractions/extractor.service.js';
import { PipelineOrchestrator } from '../src/extractions/pipeline/pipeline-orchestrator.js';
import type {
  PipelineContext,
  PipelineStep,
  StepKey,
} from '../src/extractions/pipeline/pipeline.types.js';
import { PipelineStepName } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

// The orchestrator against the real database, with fake steps: this checks
// the handoff and failure rules, not any particular step.
describe('PipelineOrchestrator (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PipelineOrchestrator;
  let storageDir: string;
  let businessId: string;
  let token: string;
  const runId = Date.now().toString(36);
  let uploads = 0;

  /** A fresh document and RUNNING extraction to run fake steps against. */
  async function newContext(): Promise<PipelineContext> {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: uploads++, g: 1, b: 1 } },
    })
      .png()
      .toBuffer();
    const upload = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', png, 'x.png')
      .expect(201);
    const documentId = upload.body.document.id as string;
    const extraction = await prisma.extraction.create({
      data: { businessId, documentId, model: 'test', promptVersion: 'test' },
    });
    return {
      businessId,
      documentId,
      extractionId: extraction.id,
      document: { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '' } },
    };
  }

  /**
   * A fake step. Tests stand in for steps that don't exist yet, so the key is
   * cast: the orchestrator treats keys opaquely.
   */
  function step(
    name: PipelineStepName,
    key: string,
    options: Partial<Pick<PipelineStep, 'required' | 'skipReason' | 'persist'>> & {
      run?: PipelineStep['run'];
    } = {},
  ): PipelineStep {
    return {
      name,
      key: key as StepKey,
      required: options.required ?? false,
      skipReason: options.skipReason,
      persist: options.persist,
      run:
        options.run ??
        (async () => ({
          value: { from: key } as never,
          model: 'claude-opus-5',
          usage: { inputTokens: 10, outputTokens: 5 },
        })),
    };
  }

  const rows = (extractionId: string) =>
    prisma.pipelineStep.findMany({ where: { extractionId }, orderBy: { startedAt: 'asc' } });

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'invoicio-e2e-'));
    process.env.STORAGE_DIR = storageDir;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    orchestrator = app.get(PipelineOrchestrator);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        businessName: 'pipeline Inc',
        name: 'pipeline',
        email: `pipeline-${runId}@e2e.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);
    businessId = res.body.user.businessId;
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: businessId } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('runs steps in order, handing each one the state so far, and records every step', async () => {
    const context = await newContext();
    const seenByValidation = vi.fn();
    const result = await orchestrator.run(context, [
      step(PipelineStepName.CLASSIFICATION, 'classification'),
      step(PipelineStepName.EXTRACTION, 'extraction', { required: true }),
      step(PipelineStepName.VALIDATION, 'validation', {
        run: async (_ctx, state) => {
          seenByValidation({ ...state });
          return { value: { from: 'validation' } as never };
        },
      }),
    ]);

    expect(result.status).toBe('SUCCEEDED');
    expect(seenByValidation).toHaveBeenCalledWith({
      classification: { from: 'classification' },
      extraction: { from: 'extraction' },
    });
    const recorded = await rows(context.extractionId);
    expect(recorded.map((r) => [r.name, r.status])).toEqual([
      ['CLASSIFICATION', 'SUCCEEDED'],
      ['EXTRACTION', 'SUCCEEDED'],
      ['VALIDATION', 'SUCCEEDED'],
    ]);
    expect(recorded[0]).toMatchObject({ model: 'claude-opus-5', inputTokens: 10, outputTokens: 5 });
    expect(recorded[2].model).toBeNull(); // a code-only step reports no model
    expect(recorded.every((r) => r.completedAt !== null)).toBe(true);
  });

  it('marks the run PARTIAL when an optional step fails, and keeps going', async () => {
    const context = await newContext();
    const result = await orchestrator.run(context, [
      step(PipelineStepName.EXTRACTION, 'extraction', { required: true }),
      step(PipelineStepName.VALIDATION, 'validation', {
        run: () => Promise.reject(new ExtractionFailedError('api', 'Overloaded', 1, true, [])),
      }),
      step(PipelineStepName.CATEGORIZATION, 'categorization'),
    ]);

    expect(result.status).toBe('PARTIAL');
    expect(result.failures).toMatchObject([
      { key: 'validation', kind: 'api', retryable: true, required: false },
    ]);
    expect(result.state).toHaveProperty('categorization');
    const recorded = await rows(context.extractionId);
    expect(recorded.map((r) => r.status)).toEqual(['SUCCEEDED', 'FAILED', 'SUCCEEDED']);
    expect(recorded[1].error).toEqual({ kind: 'api', message: 'Overloaded', retryable: true });
  });

  it('stops the run when a required step fails', async () => {
    const context = await newContext();
    const after = vi.fn();
    const result = await orchestrator.run(context, [
      step(PipelineStepName.EXTRACTION, 'extraction', {
        required: true,
        run: () => Promise.reject(new TypeError('boom')),
      }),
      step(PipelineStepName.VALIDATION, 'validation', { run: after }),
    ]);

    expect(result.status).toBe('FAILED');
    expect(result.failures[0]).toMatchObject({
      kind: 'internal',
      message: 'boom',
      retryable: false,
    });
    expect(after).not.toHaveBeenCalled();
    expect((await rows(context.extractionId)).map((r) => [r.name, r.status])).toEqual([
      ['EXTRACTION', 'FAILED'],
    ]);
  });

  it('records a skipped step with its reason, without running it', async () => {
    const context = await newContext();
    const run = vi.fn();
    const result = await orchestrator.run(context, [
      step(PipelineStepName.EXTRACTION, 'extraction', { skipReason: () => 'not a receipt', run }),
    ]);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      skipped: [{ step: 'EXTRACTION', reason: 'not a receipt' }],
    });
    expect(run).not.toHaveBeenCalled();
    expect(await rows(context.extractionId)).toMatchObject([
      { status: 'SKIPPED', error: { reason: 'not a receipt' } },
    ]);
  });

  it('treats a failure to save output as a step failure, rolling the save back', async () => {
    const context = await newContext();
    const result = await orchestrator.run(context, [
      step(PipelineStepName.EXTRACTION, 'extraction', {
        required: true,
        persist: async (tx, ctx) => {
          await tx.extractionField.create({
            data: {
              businessId: ctx.businessId,
              extractionId: ctx.extractionId,
              path: 'total',
              valueType: 'MONEY',
              value: '1',
              confidence: 0.9,
            },
          });
          throw new Error('disk full');
        },
      }),
    ]);

    expect(result.status).toBe('FAILED');
    expect(result.state).not.toHaveProperty('extraction');
    expect(
      await prisma.extractionField.count({ where: { extractionId: context.extractionId } }),
    ).toBe(0);
    expect((await rows(context.extractionId))[0].status).toBe('FAILED');
  });
});
