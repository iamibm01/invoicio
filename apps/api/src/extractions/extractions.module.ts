import Anthropic from '@anthropic-ai/sdk';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExtractionQueue, EXTRACTION_QUEUE } from './extraction-queue.js';
import { ExtractionRecoveryService } from './extraction-recovery.service.js';
import { ExtractionProcessor } from './extraction.processor.js';
import { ExtractionsService } from './extractions.service.js';
import { ExtractorService } from './extractor.service.js';

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
    ExtractorService,
    ExtractionsService,
    ExtractionQueue,
    ExtractionProcessor,
    ExtractionRecoveryService,
  ],
  exports: [ExtractionsService, ExtractionQueue],
})
export class ExtractionsModule {}
