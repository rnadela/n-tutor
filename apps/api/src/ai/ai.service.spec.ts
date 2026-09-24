import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PrismaService } from '../prisma/prisma.service.js';
import { costMicrosFor, DEFAULT_MODEL_PINS } from './ai-config.js';
import { AiInputError, AiService, AiUpstreamError } from './ai.service.js';

/** What the fake is asked for, and what it is expected to answer with. */
const Payload = z.object({ pageCount: z.number().int() });

/**
 * A Prisma stand-in that records the cost rows and nothing else. A unit spec,
 * so the database is not the subject: what is being asserted is *whether* a row
 * is written and what figures it carries.
 */
function prismaSpy() {
  const created: Record<string, unknown>[] = [];
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    created.push(data);
  });
  return { created, prisma: { aiCall: { create } } as unknown as PrismaService };
}

function serviceWith(env: Record<string, string>): {
  ai: AiService;
  created: Record<string, unknown>[];
} {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const { created, prisma } = prismaSpy();
  try {
    return { ai: new AiService(prisma), created };
  } finally {
    process.env = saved;
  }
}

const IMAGE = { ordinal: 1, buffer: Buffer.from('not-really-a-jpeg'), mimeType: 'image/jpeg' };

function request(overrides: Partial<Parameters<AiService['run']>[0]> = {}) {
  return {
    callClass: 'Extraction' as const,
    parentAccountId: 'parent-1',
    images: [IMAGE],
    prompt: 'Read the pages.',
    schema: Payload,
    schemaName: 'payload',
    fakePayload: ({ imageCount }: { imageCount: number }) => ({ pageCount: imageCount }),
    ...overrides,
  };
}

/** The failure latch is an env variable read per call, so it is set per test. */
function withFakeFailure<T>(kind: string, run: () => Promise<T>): Promise<T> {
  process.env.AI_FAKE_FAILURE = kind;
  return run().finally(() => {
    delete process.env.AI_FAKE_FAILURE;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.AI_FAKE_FAILURE;
});

describe('a successful fake run', () => {
  it('parses the payload to the schema it was given', async () => {
    const { ai } = serviceWith({});
    const result = await ai.run(request({ images: [IMAGE, { ...IMAGE, ordinal: 2 }] }));
    expect(result.payload).toEqual({ pageCount: 2 });
  });

  it('writes exactly one cost row, with the pinned snapshot and the computed cost', async () => {
    const { ai, created } = serviceWith({});
    const { usage } = await ai.run(request());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      parentAccountId: 'parent-1',
      callClass: 'Extraction',
      model: DEFAULT_MODEL_PINS.Extraction.model,
      costMicros: usage.costMicros,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    // The figure is the pin's arithmetic and not something the service invented.
    expect(usage.costMicros).toBe(
      costMicrosFor(DEFAULT_MODEL_PINS.Extraction, usage.inputTokens, usage.outputTokens),
    );
  });

  it('has no correlation id when nothing minted one, as a worker-run job has none', async () => {
    const { ai, created } = serviceWith({});
    await ai.run(request());
    expect(created[0]!.correlationId).toBeNull();
  });

  it('carries no image bytes in the row it writes', async () => {
    const { ai, created } = serviceWith({});
    await ai.run(request());
    expect(JSON.stringify(created[0])).not.toContain('not-really-a-jpeg');
  });

  it('still resolves with the paid-for answer when the cost row fails to write', async () => {
    const saved = { ...process.env };
    const create = vi.fn(async () => {
      throw new Error('db down');
    });
    const prisma = { aiCall: { create } } as unknown as PrismaService;
    const ai = new AiService(prisma);
    const error = vi.spyOn(ai['logger'], 'error').mockImplementation(() => undefined);
    try {
      const result = await ai.run(request());
      expect(result.payload).toEqual({ pageCount: 1 });
    } finally {
      process.env = saved;
    }
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('The call completed and is not recorded.'),
    );
  });
});

describe('upstream faults', () => {
  it('retries a transport fault to exhaustion and then throws', async () => {
    const { ai, created } = serviceWith({ AI_MAX_ATTEMPTS: '3', AI_RETRY_BASE_MS: '1' });
    const warn = vi.spyOn(ai['logger'], 'warn').mockImplementation(() => undefined);

    await withFakeFailure('transport', async () => {
      await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    });

    expect(warn).toHaveBeenCalledTimes(3);
    // Nothing completed, so nothing is charged for.
    expect(created).toHaveLength(0);
  });

  it("treats a payload the schema rejects as the provider's fault, not the caller's", async () => {
    const { ai, created } = serviceWith({ AI_MAX_ATTEMPTS: '2', AI_RETRY_BASE_MS: '1' });
    vi.spyOn(ai['logger'], 'warn').mockImplementation(() => undefined);

    await withFakeFailure('schema', async () => {
      await expect(ai.run(request())).rejects.toBeInstanceOf(AiUpstreamError);
    });
    expect(created).toHaveLength(0);
  });

  it('says nothing about the provider in the message it throws', async () => {
    const { ai } = serviceWith({ AI_MAX_ATTEMPTS: '1', AI_RETRY_BASE_MS: '1' });
    vi.spyOn(ai['logger'], 'warn').mockImplementation(() => undefined);

    await withFakeFailure('transport', async () => {
      const fault = await ai
        .run(request())
        .then(() => new Error('The call succeeded when it should have failed.'))
        .catch((cause: unknown) => cause as Error);
      expect(fault.message).toBe('The AI provider could not be reached.');
      expect(fault.message).not.toContain('not-really-a-jpeg');
    });
  });

  it('logs the call class and the attempt, and never the images', async () => {
    const { ai } = serviceWith({ AI_MAX_ATTEMPTS: '2', AI_RETRY_BASE_MS: '1' });
    const warn = vi.spyOn(ai['logger'], 'warn').mockImplementation(() => undefined);

    await withFakeFailure('transport', async () => {
      await ai.run(request()).catch(() => undefined);
    });

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toBe('An Extraction call failed on attempt 1 of 2.');
    expect(lines.join('\n')).not.toContain('not-really-a-jpeg');
  });
});

describe('input faults', () => {
  it('refuses a vision call with no images, and never retries one', async () => {
    const { ai, created } = serviceWith({});
    await expect(ai.run(request({ images: [] }))).rejects.toBeInstanceOf(AiInputError);
    expect(created).toHaveLength(0);
  });
});
