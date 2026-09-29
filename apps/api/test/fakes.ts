import type { Classification } from '../src/extractions/classification.js';
import type { ClassifierService } from '../src/extractions/classification.js';

export const receiptClassification: Classification = {
  documentType: 'RECEIPT',
  confidence: 0.97,
  vendorCategory: 'TRANSPORT',
  reason: 'Shows a fare paid by card.',
};

/** A ClassifierService stand-in; tests can swap the answer per call with mockResolvedValueOnce. */
export function fakeClassifier(classification: Classification = receiptClassification) {
  const classify = vi.fn<ClassifierService['classify']>(async () => ({
    output: classification,
    model: 'claude-opus-5',
    attempts: 1,
    usage: { inputTokens: 700, outputTokens: 60 },
    rawOutputs: [],
  }));
  return { classify };
}
