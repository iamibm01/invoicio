import Anthropic from '@anthropic-ai/sdk';
import type { DocumentBlock } from './document-input.js';
import type { ExtractionOutput } from './extraction.schema.js';
import { ExtractionFailedError, ExtractorService, MAX_ATTEMPTS } from './extractor.service.js';

const s = (value: string | null, confidence = 0.95) => ({ value, confidence });

const valid: ExtractionOutput = {
  vendorName: s('Careem'),
  documentNumber: s(null, 0.8),
  date: s('2026-08-14'),
  currency: s('AED'),
  subtotal: s('40.00'),
  tax: s('2.50'),
  total: s('42.50'),
  lineItems: [{ description: s('Trip fare'), quantity: s(null, 0.7), amount: s('40.00') }],
};

type StopReason = Anthropic.Beta.BetaMessage['stop_reason'];

function response(text: string | null, stop_reason: StopReason = 'end_turn', model = 'claude-opus-5') {
  return {
    model,
    stop_reason,
    stop_details: stop_reason === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: null } : null,
    content: text === null ? [] : [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 200 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

const json = (output: unknown) => JSON.stringify(output);
const document: DocumentBlock = {
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: 'x' },
};

function setup(...responses: Array<Anthropic.Beta.BetaMessage | Error>) {
  const create = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) create.mockRejectedValueOnce(r);
    else create.mockResolvedValueOnce(r);
  }
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { extractor: new ExtractorService(client), create };
}

async function failure(promise: Promise<unknown>): Promise<ExtractionFailedError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ExtractionFailedError);
  return error as ExtractionFailedError;
}

describe('ExtractorService', () => {
  it('returns validated, flattened output on the first attempt', async () => {
    const { extractor, create } = setup(response(json(valid)));
    const result = await extractor.extract(document);

    expect(result.attempts).toBe(1);
    expect(result.output).toEqual(valid);
    expect(result.fields.find((f) => f.path === 'total')?.value).toBe('42.50');
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({ fallbacks: 'default', model: 'claude-opus-5' });
  });

  it('records the model that actually answered, e.g. after a fallback', async () => {
    const { extractor } = setup(response(json(valid), 'end_turn', 'claude-opus-4-8'));
    expect((await extractor.extract(document)).model).toBe('claude-opus-4-8');
  });

  it('asks the model to repair output that fails validation', async () => {
    const bad = { ...valid, total: s('AED 42.50', 1.2) };
    const { extractor, create } = setup(response(json(bad)), response(json(valid)));
    const result = await extractor.extract(document);

    expect(result.attempts).toBe(2);
    expect(result.rawOutputs).toHaveLength(2);
    // The rejected attempt was still billed.
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 400 });

    // Second call = original conversation + the bad answer + the validation errors.
    const retry = create.mock.calls[1][0].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1].role).toBe('assistant');
    expect(retry[2].content).toMatch(/total\.value/);
    expect(retry[2].content).toMatch(/total\.confidence/);
  });

  it('starts over after truncated output rather than repairing it', async () => {
    const { extractor, create } = setup(response('{"vendorName":', 'max_tokens'), response(json(valid)));
    const result = await extractor.extract(document);

    expect(result.attempts).toBe(2);
    expect(create.mock.calls[1][0].messages).toHaveLength(1);
  });

  it('gives up as malformed after MAX_ATTEMPTS', async () => {
    const bad = response('not json');
    const { extractor, create } = setup(...Array.from({ length: MAX_ATTEMPTS }, () => bad));
    const error = await failure(extractor.extract(document));

    expect(error).toMatchObject({ kind: 'malformed', attempts: MAX_ATTEMPTS, retryable: false });
    expect(create).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('does not retry a refusal', async () => {
    const { extractor, create } = setup(response(null, 'refusal'));
    const error = await failure(extractor.extract(document));

    expect(error).toMatchObject({ kind: 'refused', retryable: false });
    expect(error.message).toMatch(/cyber/);
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([
    ['rate limit', new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers()), true],
    ['overload', new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers()), true],
    ['connection drop', new Anthropic.APIConnectionError({ message: 'socket hang up' }), true],
    ['bad request', new Anthropic.BadRequestError(400, {}, 'invalid', new Headers()), false],
    ['auth failure', new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers()), false],
  ])('classifies a %s as an api failure (retryable: %s)', async (_, apiError, retryable) => {
    const { extractor } = setup(apiError);
    const error = await failure(extractor.extract(document));
    expect(error).toMatchObject({ kind: 'api', retryable });
    expect(error.cause).toBe(apiError);
  });

  it('lets non-API errors through untouched', async () => {
    const bug = new TypeError('boom');
    const { extractor } = setup(bug);
    await expect(extractor.extract(document)).rejects.toBe(bug);
  });
});
