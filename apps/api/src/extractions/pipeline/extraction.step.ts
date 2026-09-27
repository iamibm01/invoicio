import { Injectable } from '@nestjs/common';
import { PipelineStepName, type Prisma } from '../../generated/prisma/client.js';
import { ExtractorService, type ExtractionResult } from '../extractor.service.js';
import type { PipelineContext, PipelineStep, StepOutput } from './pipeline.types.js';

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

  async run(context: PipelineContext): Promise<StepOutput<ExtractionResult>> {
    const result = await this.extractor.extract(context.document);
    return { value: result, model: result.model, usage: result.usage };
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
