import { Injectable, Logger } from '@nestjs/common';
import { PipelineStepStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ExtractionFailedError } from '../extractor.service.js';
import type {
  PipelineContext,
  PipelineResult,
  PipelineState,
  PipelineStep,
  StepFailure,
} from './pipeline.types.js';

/**
 * Runs pipeline steps in order and owns everything between them: passing
 * state along, recording each step, and deciding what a failure means.
 *
 * Every step leaves a PipelineStep row: RUNNING when it starts (so a crash
 * shows where it happened), then SUCCEEDED, FAILED or SKIPPED with timing,
 * model and token usage. A step's output is saved in the same transaction
 * that marks it SUCCEEDED, so earlier steps' work survives a later failure.
 */
@Injectable()
export class PipelineOrchestrator {
  private readonly logger = new Logger(PipelineOrchestrator.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(context: PipelineContext, steps: PipelineStep[]): Promise<PipelineResult> {
    const state: PipelineState = {};
    const failures: StepFailure[] = [];
    const skipped: PipelineResult['skipped'] = [];
    const base = { businessId: context.businessId, extractionId: context.extractionId };

    for (const step of steps) {
      const reason = step.skipReason?.(state) ?? null;
      if (reason !== null) {
        await this.prisma.pipelineStep.create({
          data: {
            ...base,
            name: step.name,
            status: PipelineStepStatus.SKIPPED,
            error: { reason },
            completedAt: new Date(),
          },
        });
        skipped.push({ step: step.name, reason });
        continue;
      }

      const row = await this.prisma.pipelineStep.create({
        data: { ...base, name: step.name },
        select: { id: true },
      });
      try {
        const output = await step.run(context, state);
        await this.prisma.$transaction(async (tx) => {
          await step.persist?.(tx, context, output.value);
          await tx.pipelineStep.update({
            where: { id: row.id },
            data: {
              status: PipelineStepStatus.SUCCEEDED,
              model: output.model,
              inputTokens: output.usage?.inputTokens,
              outputTokens: output.usage?.outputTokens,
              completedAt: new Date(),
            },
          });
        });
        // Only now is the output visible to later steps.
        (state as Record<string, unknown>)[step.key] = output.value;
      } catch (error) {
        const failure = describeFailure(step, error);
        failures.push(failure);
        await this.prisma.pipelineStep.update({
          where: { id: row.id },
          data: {
            status: PipelineStepStatus.FAILED,
            error: { kind: failure.kind, message: failure.message, retryable: failure.retryable },
            completedAt: new Date(),
          },
        });
        this.logger.warn(
          `${step.name} failed (${failure.kind}) for extraction ${context.extractionId}: ${failure.message}`,
        );
        if (step.required) return { status: 'FAILED', state, failures, skipped };
      }
    }

    return { status: failures.length > 0 ? 'PARTIAL' : 'SUCCEEDED', state, failures, skipped };
  }
}

/**
 * Model and API failures are typed and say whether retrying could help.
 * Anything else (a bug, a storage error) is "internal" and not retryable here;
 * the caller decides whether to rethrow it.
 */
function describeFailure(step: PipelineStep, error: unknown): StepFailure {
  const common = { step: step.name, key: step.key, required: step.required, cause: error };
  if (error instanceof ExtractionFailedError) {
    return { ...common, kind: error.kind, message: error.message, retryable: error.retryable };
  }
  return {
    ...common,
    kind: 'internal',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
