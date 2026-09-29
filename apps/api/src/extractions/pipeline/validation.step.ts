import { Injectable } from '@nestjs/common';
import { PipelineStepName, type Prisma } from '../../generated/prisma/client.js';
import { ValidationService, type ValidationResult } from '../validation/validation.service.js';
import type { PipelineContext, PipelineState, PipelineStep, StepOutput } from './pipeline.types.js';

/**
 * Checks the extracted fields: arithmetic, duplicates, unusual amounts.
 * Plain code, so no model or token usage is reported. Optional: if it
 * crashes, the run is PARTIAL and a person stands in for the checks.
 */
@Injectable()
export class ValidationStep implements PipelineStep<'validation'> {
  readonly name = PipelineStepName.VALIDATION;
  readonly key = 'validation';
  readonly required = false;

  constructor(private readonly validation: ValidationService) {}

  skipReason(state: PipelineState): string | null {
    return state.extraction ? null : 'No extracted fields to validate';
  }

  async run(context: PipelineContext, state: PipelineState): Promise<StepOutput<ValidationResult>> {
    const value = await this.validation.validate(
      { businessId: context.businessId, documentId: context.documentId },
      state.extraction?.fields ?? [],
    );
    return { value };
  }

  async persist(tx: Prisma.TransactionClient, context: PipelineContext, result: ValidationResult) {
    if (result.issues.length === 0) return;
    await tx.validationIssue.createMany({
      data: result.issues.map((issue) => ({
        ...issue,
        businessId: context.businessId,
        extractionId: context.extractionId,
      })),
    });
  }
}
