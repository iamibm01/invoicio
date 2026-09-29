import { Injectable } from '@nestjs/common';
import { PipelineStepName, type Prisma } from '../../generated/prisma/client.js';
import { CLASSIFICATION_PROMPT_VERSION, ClassifierService, type ClassificationResult } from '../classification.js';
import type { PipelineContext, PipelineStep, StepOutput } from './pipeline.types.js';

/**
 * Decides what the document is before anything is extracted. Optional: if it
 * fails, extraction runs anyway (it doesn't need the type), the run is
 * PARTIAL, and a person confirms the type during review.
 */
@Injectable()
export class ClassificationStep implements PipelineStep<'classification'> {
  readonly name = PipelineStepName.CLASSIFICATION;
  readonly key = 'classification';
  readonly required = false;

  constructor(private readonly classifier: ClassifierService) {}

  async run(context: PipelineContext): Promise<StepOutput<ClassificationResult>> {
    const result = await this.classifier.classify(context.document);
    return {
      value: result,
      model: result.model,
      promptVersion: CLASSIFICATION_PROMPT_VERSION,
      usage: result.usage,
    };
  }

  async persist(tx: Prisma.TransactionClient, context: PipelineContext, result: ClassificationResult) {
    const { documentType, confidence, vendorCategory, reason } = result.output;
    await tx.extraction.update({
      where: { id: context.extractionId },
      data: {
        documentType,
        documentTypeConfidence: confidence,
        vendorCategory,
        classificationReason: reason,
      },
    });
  }
}
