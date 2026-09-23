import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ExtractorService } from './extractor.service.js';

@Module({
  providers: [
    {
      provide: Anthropic,
      // Credentials come from the environment (ANTHROPIC_API_KEY, or an
      // `ant auth login` profile). maxRetries covers 429/5xx/connection
      // errors with exponential backoff before the extractor sees them.
      useFactory: () => new Anthropic({ maxRetries: 3 }),
    },
    ExtractorService,
  ],
  exports: [ExtractorService],
})
export class ExtractionsModule {}
