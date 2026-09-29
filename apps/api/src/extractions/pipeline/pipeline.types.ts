import type { PipelineStepName, Prisma } from '../../generated/prisma/client.js';
import type { DocumentBlock } from '../document-input.js';
import type { ClassificationResult } from '../classification.js';
import type { ExtractionResult } from '../extractor.service.js';
import type { ModelFailureKind, TokenUsage } from '../model/structured-output.service.js';

/** Fixed facts about the run, available to every step. */
export interface PipelineContext {
  businessId: string;
  documentId: string;
  extractionId: string;
  document: DocumentBlock;
}

/**
 * What the steps have produced so far. This is the state handoff: each step
 * reads what earlier steps left here and adds its own output under its own
 * key. Steps never call each other; the orchestrator is the only thing that
 * moves data between them, so each step can be tested and replaced alone.
 * Validation and categorization get their keys as they're built.
 */
export interface PipelineState {
  classification?: ClassificationResult;
  extraction?: ExtractionResult;
}

export type StepKey = keyof PipelineState;

export interface StepOutput<T> {
  value: T;
  /** Set by model-backed steps; code-only steps leave these out. */
  model?: string;
  promptVersion?: string;
  usage?: TokenUsage;
}

export interface PipelineStep<K extends StepKey = StepKey> {
  readonly name: PipelineStepName;
  /** Where this step's output lives in PipelineState (and in Extraction.errors). */
  readonly key: K;
  /**
   * A required step's failure fails the whole run: nothing useful can follow
   * (no extraction, nothing to validate). An optional step's failure makes the
   * run PARTIAL: everything else still runs and is kept, and the document
   * goes to review with the gap called out.
   */
  readonly required: boolean;
  /** A reason to skip this step given what earlier steps found, or null to run it. */
  skipReason?(state: PipelineState): string | null;
  run(
    context: PipelineContext,
    state: PipelineState,
  ): Promise<StepOutput<NonNullable<PipelineState[K]>>>;
  /**
   * Saves the step's output. Runs in the same transaction that marks the
   * step SUCCEEDED, so a step is never recorded as done without its output.
   */
  persist?(
    tx: Prisma.TransactionClient,
    context: PipelineContext,
    value: NonNullable<PipelineState[K]>,
  ): Promise<void>;
}

export type FailureKind = ModelFailureKind | 'internal';

export interface StepFailure {
  step: PipelineStepName;
  key: StepKey;
  required: boolean;
  kind: FailureKind;
  message: string;
  retryable: boolean;
  /** The original error, for logging and step-specific details (e.g. raw model output). */
  cause: unknown;
}

export interface PipelineResult {
  /**
   * SUCCEEDED: every step that ran succeeded.
   * PARTIAL: an optional step failed; the rest of the output is usable.
   * FAILED: a required step failed; the run stopped there.
   */
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  state: PipelineState;
  failures: StepFailure[];
  skipped: { step: PipelineStepName; key: StepKey; reason: string }[];
}
