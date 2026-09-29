import { Injectable } from '@nestjs/common';
import { PipelineStepName, type Prisma } from '../../generated/prisma/client.js';
import { PROMPT_VERSION } from '../extraction.prompt.js';
import { ExtractorService, type ExtractionResult } from '../extractor.service.js';
import type { PipelineContext, PipelineState, PipelineStep, StepOutput } from './pipeline.types.js';

/**
 * Extraction is skipped only when the classifier is very sure the document
 * isn't a receipt or invoice. Skipping a real receipt is the costlier mistake
 * (a person gets no fields), so the bar is higher than the review threshold.
 */
export const SKIP_NON_EXPENSE_CONFIDENCE = 0.9;

/**
 * Reads the document's fields: the Phase 2 extraction call, now one step of
 * the pipeline. Required: without fields there's nothing to validate,
 * categorize or review.
 */
@Injectable()
export class ExtractionStep implements PipelineStep<'extraction'> {
  readonly name = PipelineStepName.EXTRACTION;
  readonly key = 'extraction';
  readonly required = true;

  constructor(private readonly extractor: ExtractorService) {}

  skipReason(state: PipelineState): string | null {
    const classification = state.classification?.output;
    if (classification?.documentType === 'OTHER' && classification.confidence >= SKIP_NON_EXPENSE_CONFIDENCE) {
      return `Not a receipt or invoice: ${classification.reason}`;
    }
    return null;
  }

  async run(context: PipelineContext): Promise<StepOutput<ExtractionResult>> {
    const result = await this.extractor.extract(context.document);
    return { value: result, model: result.model, promptVersion: PROMPT_VERSION, usage: result.usage };
  }

  async persist(tx: Prisma.TransactionClient, context: PipelineContext, result: ExtractionResult) {
    await tx.extractionField.createMany({
      data: result.fields.map((field) => ({
        ...field,
        businessId: context.businessId,
        extractionId: context.extractionId,
      })),
    });
    await tx.extraction.update({
      where: { id: context.extractionId },
      data: {
        model: result.model,
        attempts: result.attempts,
        rawOutput: result.rawOutputs as Prisma.InputJsonValue,
      },
    });
  }
}
