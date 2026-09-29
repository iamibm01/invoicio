import { Injectable } from '@nestjs/common';
import type { PredictedField } from '../evals/score.js';
import type { DocumentBlock } from './document-input.js';
import { buildExtractionMessages, EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION } from './extraction.prompt.js';
import { extractionOutputSchema, flattenExtraction, type ExtractionOutput } from './extraction.schema.js';
import {
  DEFAULT_MODEL,
  StructuredOutputService,
  type ModelOptions,
  type StructuredResult,
} from './model/structured-output.service.js';

export const EXTRACTION_MODEL = DEFAULT_MODEL;

export interface ExtractionResult extends StructuredResult<ExtractionOutput> {
  fields: PredictedField[];
  promptVersion: string;
}

/**
 * Reads a document's fields. The retries, validation and failure typing live
 * in StructuredOutputService; this class only knows what to ask for.
 */
@Injectable()
export class ExtractorService {
  constructor(private readonly model: StructuredOutputService) {}

  async extract(document: DocumentBlock, options: ModelOptions = {}): Promise<ExtractionResult> {
    const result = await this.model.generate({
      schema: extractionOutputSchema,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: buildExtractionMessages(document),
      label: 'extraction',
      ...options,
    });
    return { ...result, fields: flattenExtraction(result.output), promptVersion: PROMPT_VERSION };
  }
}
