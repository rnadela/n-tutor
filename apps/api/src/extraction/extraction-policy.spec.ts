import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_POLL_MS,
  EXTRACTION_FAILED,
  EXTRACTION_INPUT_UNUSABLE,
  EXTRACTION_NOT_FOUND,
  EXTRACTION_PAGES_GONE,
  MAX_JOB_ATTEMPTS,
  SOURCE_TEST_NOT_FOUND,
  extractionRuntime,
  resetExtractionRuntime,
} from './extraction-policy.js';
import { resolveAiConfig } from '../ai/ai-config.js';
import { SOURCE_TEST_NOT_FOUND as SOURCE_TEST_NOT_FOUND_ORIGIN } from '../sourcetest/source-test-policy.js';

/**
 * The worst case of the `ai` retry sequence under whatever `AI_*` env is
 * currently in effect — `setup.ts` overrides `AI_MAX_ATTEMPTS` and
 * `AI_RETRY_BASE_MS` for the whole suite, so this must read live rather than
 * assume the module's own defaults.
 */
function worstCaseRunMs(): number {
  const { timeoutMs, maxAttempts, retryBaseMs } = resolveAiConfig();
  return maxAttempts * timeoutMs + retryBaseMs * (2 ** (maxAttempts - 1) - 1);
}

function runtimeWith(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  resetExtractionRuntime();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return extractionRuntime();
  } finally {
    process.env = saved;
    resetExtractionRuntime();
  }
}

afterEach(() => {
  resetExtractionRuntime();
});

describe('messages', () => {
  it('states the ownership refusal exactly once, in the module that owns it', () => {
    expect(SOURCE_TEST_NOT_FOUND).toBe(SOURCE_TEST_NOT_FOUND_ORIGIN);
  });

  it('distinguishes nothing-to-report from the two failures', () => {
    expect(
      new Set([
        EXTRACTION_NOT_FOUND,
        EXTRACTION_FAILED,
        EXTRACTION_INPUT_UNUSABLE,
        EXTRACTION_PAGES_GONE,
      ]).size,
    ).toBe(4);
  });

  it('says nothing about a provider, a model or a code', () => {
    for (const message of [
      EXTRACTION_NOT_FOUND,
      EXTRACTION_FAILED,
      EXTRACTION_INPUT_UNUSABLE,
      EXTRACTION_PAGES_GONE,
    ]) {
      expect(message).not.toMatch(/openai|gpt|error|code|[A-Z]{3,}_[A-Z]/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});

describe('runtime resolution', () => {
  it('runs the worker and polls on the stated defaults', () => {
    expect(
      runtimeWith({
        EXTRACTION_WORKER_ENABLED: undefined,
        EXTRACTION_POLL_MS: undefined,
        EXTRACTION_CLAIM_TIMEOUT_MS: undefined,
      }),
    ).toEqual({
      workerEnabled: true,
      pollMs: DEFAULT_POLL_MS,
      claimTimeoutMs: DEFAULT_CLAIM_TIMEOUT_MS,
    });
  });

  it('takes stated overrides', () => {
    expect(
      runtimeWith({
        EXTRACTION_WORKER_ENABLED: 'false',
        EXTRACTION_POLL_MS: '250',
        EXTRACTION_CLAIM_TIMEOUT_MS: '900000',
      }),
    ).toEqual({ workerEnabled: false, pollMs: 250, claimTimeoutMs: 900_000 });
  });

  it('refuses a flag that is neither true nor false', () => {
    expect(() => runtimeWith({ EXTRACTION_WORKER_ENABLED: 'yes' })).toThrow(
      /must be "true" or "false"/,
    );
  });

  it('refuses a poll interval that is not a positive whole number', () => {
    expect(() => runtimeWith({ EXTRACTION_POLL_MS: '0' })).toThrow(
      /must be a positive whole number/,
    );
  });

  it('resolves once and remembers, so the figure cannot change under a running worker', () => {
    const first = runtimeWith({ EXTRACTION_POLL_MS: '250' });
    expect(first.pollMs).toBe(250);
    // A second call with no reset would have returned the memoised value; the
    // helper resets deliberately, which is what makes the test above possible.
    expect(runtimeWith({ EXTRACTION_POLL_MS: '500' }).pollMs).toBe(500);
  });
});

describe('the claim timeout against the worst case of a retried run', () => {
  it('refuses a claim timeout at or below the worst case of every retry', () => {
    // A claim that expires while a retry it is waiting on is still in flight
    // hands the same pages to a second worker, and the account pays twice —
    // so the whole retry sequence, not just one call, must fit inside it.
    const worstCase = worstCaseRunMs();
    expect(() =>
      runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: String(worstCase) }),
    ).toThrow(/must be greater than the worst case/);
    expect(() =>
      runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: String(worstCase - 1) }),
    ).toThrow(/must be greater than the worst case/);
  });

  it('accepts one comfortably above it, and the default is', () => {
    const worstCase = worstCaseRunMs();
    expect(
      runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: String(worstCase + 1) }).claimTimeoutMs,
    ).toBe(worstCase + 1);
    expect(DEFAULT_CLAIM_TIMEOUT_MS).toBeGreaterThan(worstCase);
  });

  it('does not remember a refused resolution, so the next boot re-reads', () => {
    expect(() => runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: '1000' })).toThrow();
    expect(runtimeWith({}).claimTimeoutMs).toBe(DEFAULT_CLAIM_TIMEOUT_MS);
  });
});

describe('the attempt ceiling', () => {
  it('gives a job more than one pass but not an unbounded number', () => {
    // More than one, because a worker whose machine went away must not cost a
    // parent their upload; bounded, because a job that kills the worker would
    // otherwise be read — and paid for — on every pass forever.
    expect(MAX_JOB_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_JOB_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
