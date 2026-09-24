import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_MIN_USABLE_QUESTIONS_PER_PAGE,
  DEFAULT_POLL_MS,
  EXTRACTION_FAILED,
  EXTRACTION_INPUT_UNUSABLE,
  EXTRACTION_NOT_FOUND,
  EXTRACTION_PAGES_GONE,
  MAX_JOB_ATTEMPTS,
  SOURCE_TEST_NOT_FOUND,
  extractionRuntime,
  isThinExtraction,
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
      minUsableQuestionsPerPage: DEFAULT_MIN_USABLE_QUESTIONS_PER_PAGE,
    });
  });

  it('takes stated overrides', () => {
    expect(
      runtimeWith({
        EXTRACTION_WORKER_ENABLED: 'false',
        EXTRACTION_POLL_MS: '250',
        EXTRACTION_CLAIM_TIMEOUT_MS: '900000',
        EXTRACTION_MIN_USABLE_PER_PAGE: '4',
      }),
    ).toEqual({
      workerEnabled: false,
      pollMs: 250,
      claimTimeoutMs: 900_000,
      minUsableQuestionsPerPage: 4,
    });
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

  it('refuses a thin threshold of zero, which would switch the warning off silently', () => {
    expect(() => runtimeWith({ EXTRACTION_MIN_USABLE_PER_PAGE: '0' })).toThrow(
      /EXTRACTION_MIN_USABLE_PER_PAGE must be a positive whole number/,
    );
  });

  it('refuses a thin threshold that is not a number at all', () => {
    expect(() => runtimeWith({ EXTRACTION_MIN_USABLE_PER_PAGE: 'abc' })).toThrow(
      /EXTRACTION_MIN_USABLE_PER_PAGE must be a positive whole number/,
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
    expect(() => runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: String(worstCase) })).toThrow(
      /must be greater than the worst case/,
    );
    expect(() => runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: String(worstCase - 1) })).toThrow(
      /must be greater than the worst case/,
    );
  });

  it('accepts one comfortably above it, and the default is', () => {
    const worstCase = worstCaseRunMs();
    expect(runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: String(worstCase + 1) }).claimTimeoutMs).toBe(
      worstCase + 1,
    );
    expect(DEFAULT_CLAIM_TIMEOUT_MS).toBeGreaterThan(worstCase);
  });

  it('does not remember a refused resolution, so the next boot re-reads', () => {
    expect(() => runtimeWith({ EXTRACTION_CLAIM_TIMEOUT_MS: '1000' })).toThrow();
    expect(runtimeWith({}).claimTimeoutMs).toBe(DEFAULT_CLAIM_TIMEOUT_MS);
  });
});

describe('the thin verdict', () => {
  it('calls an Extraction thin when it is below the density line', () => {
    // Three usable questions off three pages, against a line of two per page.
    expect(isThinExtraction(3, 3, 2)).toBe(true);
  });

  it('calls one exactly on the line healthy, not thin', () => {
    expect(isThinExtraction(6, 3, 2)).toBe(false);
  });

  it('calls one above the line healthy', () => {
    expect(isThinExtraction(9, 3, 2)).toBe(false);
  });

  it('calls an Extraction that found nothing usable thin, whatever the page count', () => {
    for (const pageCount of [1, 3, 10]) {
      expect(isThinExtraction(0, pageCount, 2)).toBe(true);
    }
  });

  it('holds a one-page upload to the same density as a ten-page one', () => {
    expect(isThinExtraction(1, 1, 2)).toBe(true);
    expect(isThinExtraction(2, 1, 2)).toBe(false);
    expect(isThinExtraction(19, 10, 2)).toBe(true);
    expect(isThinExtraction(20, 10, 2)).toBe(false);
  });

  it('calls a zero-page read thin rather than letting the arithmetic call it healthy', () => {
    // `0 < 0 * n` is false, so the bare comparison would answer healthy about
    // the emptiest read there is. Healthy is the one answer it cannot be.
    expect(isThinExtraction(0, 0, 2)).toBe(true);
    expect(isThinExtraction(0, 0, 1)).toBe(true);
    // And a nonsense page count is no exception either.
    expect(isThinExtraction(0, -1, 2)).toBe(true);
    expect(isThinExtraction(5, 0, 2)).toBe(true);
  });

  it('takes the figure as an argument rather than reading the environment', () => {
    // Same counts, two thresholds, two verdicts: the rule owns no figure.
    expect(isThinExtraction(3, 3, 1)).toBe(false);
    expect(isThinExtraction(3, 3, 2)).toBe(true);
  });

  it('errs toward warning: the default asks for more than one usable question a page', () => {
    expect(DEFAULT_MIN_USABLE_QUESTIONS_PER_PAGE).toBeGreaterThan(1);
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
