import Anthropic from '@anthropic-ai/sdk';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExtractionQueue, EXTRACTION_QUEUE } from './extraction-queue.js';
import { ExtractionRecoveryService } from './extraction-recovery.service.js';
import { ExtractionProcessor } from './extraction.processor.js';
import { ExtractionsService } from './extractions.service.js';
import { ExtractorService } from './extractor.service.js';
import { StructuredOutputService } from './model/structured-output.service.js';
import { ClassifierService } from './classification.js';
import { ClassificationStep } from './pipeline/classification.step.js';
import { ExtractionStep } from './pipeline/extraction.step.js';
import { ValidationStep } from './pipeline/validation.step.js';
import { ValidationService } from './validation/validation.service.js';
import { PipelineOrchestrator } from './pipeline/pipeline-orchestrator.js';

@Module({
  imports: [BullModule.registerQueue({ name: EXTRACTION_QUEUE })],
  providers: [
    {
      provide: Anthropic,
      // Credentials come from the environment (ANTHROPIC_API_KEY, or an
      // `ant auth login` profile). maxRetries covers 429/5xx/connection
      // errors with exponential backoff before the extractor sees them.
      useFactory: () => new Anthropic({ maxRetries: 3 }),
    },
    StructuredOutputService,
    ExtractorService,
    ClassifierService,
    PipelineOrchestrator,
    ClassificationStep,
    ExtractionStep,
    ValidationService,
    ValidationStep,
    ExtractionsService,
    ExtractionQueue,
    ExtractionProcessor,
    ExtractionRecoveryService,
  ],
  exports: [ExtractionsService, ExtractionQueue],
})
export class ExtractionsModule {}
