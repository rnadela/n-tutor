import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_MODEL_PINS, costMicrosFor } from './ai-config.js';
import { AiRejectedError, AiService, AiUpstreamError } from './ai.service.js';

/**
 * The `openai` transport, exercised directly.
 *
 * Every other tier runs on the fake (AD-22), which is right — but it also means
 * the branch that actually talks to a provider is the one branch nothing
 * executes. The SDK call itself is stubbed; what is asserted is everything this
 * module decides: which model is sent, how the images are laid out, what the
 * format is called, where the token figures come from, and which faults are
 * worth retrying.
 */

const Payload = z.object({ ok: z.boolean() });

function prismaSpy() {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    prisma: {
      aiCall: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
        }),
      },
    } as unknown as PrismaService,
  };
}

/** A service on the `openai` transport, with `responses.parse` replaced. */
function openAiServiceWith(
  parse: (body: unknown) => unknown,
  env: Record<string, string> = {},
): { ai: AiService; created: Record<string, unknown>[]; calls: unknown[] } {
  const saved = { ...process.env };
  Object.assign(process.env, {
    AI_TRANSPORT: 'openai',
    OPENAI_API_KEY: 'sk-test',
    AI_RETRY_BASE_MS: '1',
    ...env,
  });
  const { created, prisma } = prismaSpy();
  let ai: AiService;
  try {
    ai = new AiService(prisma);
  } finally {
    process.env = saved;
  }
  const calls: unknown[] = [];
  // The SDK client is built lazily on first use; seeding the private field is
  // what keeps this a unit test rather than a network one.
  (ai as unknown as { client: unknown }).client = {
    responses: {
      parse: async (body: unknown) => {
        calls.push(body);
        return parse(body);
      },
    },
  };
  vi.spyOn(ai['logger'], 'warn').mockImplementation(() => undefined);
  vi.spyOn(ai['logger'], 'error').mockImplementation(() => undefined);
  return { ai, created, calls };
}

const IMAGES = [
  { ordinal: 1, buffer: Buffer.from('page-one'), mimeType: 'image/jpeg' },
  { ordinal: 2, buffer: Buffer.from('page-two'), mimeType: 'image/jpeg' },
];

function request() {
  return {
    callClass: 'Extraction' as const,
    parentAccountId: 'parent-1',
    images: IMAGES,
    prompt: 'Read the pages.',
    schema: Payload,
    schemaName: 'source_test_extraction',
    fakePayload: () => ({ ok: true }),
  };
}

const answered = (usage: { input_tokens: number; output_tokens: number } | undefined) => () => ({
  output_parsed: { ok: true },
  output_text: '{"ok":true}',
  usage,
});

/** An SDK fault as the client raises one: a status and nothing this reads. */
function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error('the provider said something with content in it'), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is sent', () => {
  it('sends the pinned snapshot for the call class', async () => {
    const { ai, calls } = openAiServiceWith(answered({ input_tokens: 10, output_tokens: 2 }));
    await ai.run(request());
    expect((calls[0] as { model: string }).model).toBe(DEFAULT_MODEL_PINS.Extraction.model);
  });

  it('sends the prompt once and every image after it, in ordinal order', async () => {
    const { ai, calls } = openAiServiceWith(answered({ input_tokens: 10, output_tokens: 2 }));
    await ai.run(request());

    const content = (
      calls[0] as { input: { content: { type: string; text?: string; image_url?: string }[] }[] }
    ).input[0]!.content;
    expect(content.filter((part) => part.type === 'input_text')).toHaveLength(1);
    expect(content[0]!.text).toBe('Read the pages.');

    const images = content.filter((part) => part.type === 'input_image');
    expect(images).toHaveLength(IMAGES.length);
    // Order is the whole contract: the model is told these are pages 1..N.
    expect(images[0]!.image_url).toBe(
      `data:image/jpeg;base64,${Buffer.from('page-one').toString('base64')}`,
    );
    expect(images[1]!.image_url).toBe(
      `data:image/jpeg;base64,${Buffer.from('page-two').toString('base64')}`,
    );
  });

  it('declares the structured-output format under the name it was given', async () => {
    const { ai, calls } = openAiServiceWith(answered({ input_tokens: 10, output_tokens: 2 }));
    await ai.run(request());
    const format = (calls[0] as { text: { format: { name: string; type: string } } }).text.format;
    expect(format.name).toBe('source_test_extraction');
    // The Responses API's structured output, never legacy `json_object` (AD-9).
    expect(format.type).toBe('json_schema');
  });
});

describe('what comes back', () => {
  it('takes the token figures from the provider, not from an estimate', async () => {
    const { ai, created } = openAiServiceWith(answered({ input_tokens: 1234, output_tokens: 56 }));
    const { usage } = await ai.run(request());
    expect(usage.inputTokens).toBe(1234);
    expect(usage.outputTokens).toBe(56);
    expect(usage.costMicros).toBe(costMicrosFor(DEFAULT_MODEL_PINS.Extraction, 1234, 56));
    expect(created[0]).toMatchObject({ inputTokens: 1234, outputTokens: 56 });
  });

  it('refuses an answer that reported no usage rather than billing it as free', async () => {
    const { ai, created } = openAiServiceWith(answered(undefined));
    await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    // A cost table that under-reports is worse than one missing a row.
    expect(created).toHaveLength(0);
  });

  it('refuses an answer whose usage counts are not numbers rather than billing NaN', async () => {
    const { ai, created } = openAiServiceWith(() => ({
      output_parsed: { ok: true },
      output_text: '{"ok":true}',
      usage: { input_tokens: null, output_tokens: 2 },
    }));
    await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    expect(created).toHaveLength(0);
  });

  it("parses the payload against the caller's schema, not the SDK's", async () => {
    const { ai } = openAiServiceWith(() => ({
      output_parsed: { ok: 'yes' },
      output_text: '{"ok":"yes"}',
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
  });
});

describe('fault classification', () => {
  it.each([401, 403, 400, 404, 422])('fails fast on a %d, without retrying', async (status) => {
    let attempts = 0;
    const { ai, created } = openAiServiceWith(
      () => {
        attempts += 1;
        throw apiError(status);
      },
      { AI_MAX_ATTEMPTS: '3' },
    );

    const fault = await ai
      .run(request())
      .then(() => new Error('the call succeeded'))
      .catch((cause: unknown) => cause as Error);

    expect(fault).toBeInstanceOf(AiRejectedError);
    expect(attempts).toBe(1);
    expect(created).toHaveLength(0);
    // Not one word of the provider's own message escapes (AD-20).
    expect(fault.message).toBe('The AI provider refused the request.');
  });

  it.each([429, 408, 500, 503])('retries a %d to exhaustion', async (status) => {
    let attempts = 0;
    const { ai } = openAiServiceWith(
      () => {
        attempts += 1;
        throw apiError(status);
      },
      { AI_MAX_ATTEMPTS: '3' },
    );

    await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    expect(attempts).toBe(3);
  });

  it('retries a fault carrying no status at all, as a network error does', async () => {
    let attempts = 0;
    const { ai } = openAiServiceWith(
      () => {
        attempts += 1;
        throw new Error('socket hang up');
      },
      { AI_MAX_ATTEMPTS: '2' },
    );

    await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    expect(attempts).toBe(2);
  });
});

describe('the client itself', () => {
  it('leaves retrying to this module alone', async () => {
    // Built for real this time, and driven against a `fetch` that always
    // fails: with the SDK's default `maxRetries: 2` one attempt of ours would
    // be three requests, so counting them is what proves the setting.
    const saved = { ...process.env };
    Object.assign(process.env, {
      AI_TRANSPORT: 'openai',
      OPENAI_API_KEY: 'sk-test',
      AI_MAX_ATTEMPTS: '1',
      AI_RETRY_BASE_MS: '1',
    });
    let ai: AiService;
    try {
      ai = new AiService(prismaSpy().prisma);
    } finally {
      process.env = saved;
    }
    vi.spyOn(ai['logger'], 'warn').mockImplementation(() => undefined);

    let requests = 0;
    vi.stubGlobal('fetch', async () => {
      requests += 1;
      throw new Error('connection refused');
    });

    await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    expect(requests).toBe(1);
    vi.unstubAllGlobals();
  });
});
