import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionFormat } from '../generated/prisma/enums.js';
import { SOURCE_TEST_NOT_FOUND as SOURCE_TEST_NOT_FOUND_ORIGIN } from '../sourcetest/source-test-policy.js';
import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_POLL_MS,
  EXTRACTION_NOT_READY,
  GENERATION_CLOCK_ANOMALY,
  GENERATION_FAILED,
  GENERATION_INPUT_UNUSABLE,
  GENERATION_NOT_REQUESTED,
  GENERATION_REQUEST_REJECTED,
  GENERATION_SOURCE_GONE,
  GENERATION_UPSTREAM_REJECTED,
  MAX_PER_REQUEST,
  NO_GENERATION_ALLOWANCE,
  SOURCE_TEST_NOT_FOUND,
  clampCount,
  formatTargets,
  practiceTestRuntime,
  remainingFor,
  resetPracticeTestRuntime,
  worstCaseRunMs,
} from './practice-test-policy.js';

function runtimeWith(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  resetPracticeTestRuntime();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return practiceTestRuntime();
  } finally {
    process.env = saved;
    resetPracticeTestRuntime();
  }
}

afterEach(() => {
  resetPracticeTestRuntime();
});

describe('messages', () => {
  it('states the ownership refusal exactly once, in the module that owns it', () => {
    expect(SOURCE_TEST_NOT_FOUND).toBe(SOURCE_TEST_NOT_FOUND_ORIGIN);
  });

  it('gives every outcome a sentence of its own', () => {
    expect(
      new Set([
        GENERATION_NOT_REQUESTED,
        NO_GENERATION_ALLOWANCE,
        EXTRACTION_NOT_READY,
        GENERATION_FAILED,
        GENERATION_UPSTREAM_REJECTED,
        GENERATION_SOURCE_GONE,
        GENERATION_INPUT_UNUSABLE,
        GENERATION_REQUEST_REJECTED,
        GENERATION_CLOCK_ANOMALY,
      ]).size,
    ).toBe(9);
  });

  it('asks the parent to retake the pages in exactly one of them', () => {
    // A fault on this side of the wire must never send a parent to photograph
    // a test whose pages were fine.
    const retakes = [
      GENERATION_FAILED,
      GENERATION_UPSTREAM_REJECTED,
      GENERATION_SOURCE_GONE,
      GENERATION_INPUT_UNUSABLE,
      GENERATION_REQUEST_REJECTED,
      GENERATION_CLOCK_ANOMALY,
    ].filter((message) => /retake|photo|page/i.test(message));
    expect(retakes).toEqual([GENERATION_INPUT_UNUSABLE]);
  });

  it('says nothing about a provider, a model, a tier or a code', () => {
    for (const message of [
      GENERATION_NOT_REQUESTED,
      NO_GENERATION_ALLOWANCE,
      EXTRACTION_NOT_READY,
      GENERATION_FAILED,
      GENERATION_UPSTREAM_REJECTED,
      GENERATION_SOURCE_GONE,
      GENERATION_INPUT_UNUSABLE,
      GENERATION_REQUEST_REJECTED,
      GENERATION_CLOCK_ANOMALY,
    ]) {
      expect(message).not.toMatch(/openai|gpt|free|plus|family|internal|error|code/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});

describe('runtime resolution', () => {
  it('runs the worker and polls on the stated defaults', () => {
    expect(
      runtimeWith({
        GENERATION_WORKER_ENABLED: undefined,
        GENERATION_POLL_MS: undefined,
        GENERATION_CLAIM_TIMEOUT_MS: undefined,
      }),
    ).toEqual({
      workerEnabled: true,
      pollMs: DEFAULT_POLL_MS,
      claimTimeoutMs: DEFAULT_CLAIM_TIMEOUT_MS,
    });
  });

  it('reads every override', () => {
    expect(
      runtimeWith({
        GENERATION_WORKER_ENABLED: 'false',
        GENERATION_POLL_MS: '250',
        GENERATION_CLAIM_TIMEOUT_MS: String(worstCaseRunMs() + 1_000),
      }),
    ).toEqual({
      workerEnabled: false,
      pollMs: 250,
      claimTimeoutMs: worstCaseRunMs() + 1_000,
    });
  });

  it('refuses a poll interval that is not a positive whole number', () => {
    // A mistyped interval must be a process that refuses to start, not a
    // worker that silently never runs.
    expect(() => runtimeWith({ GENERATION_POLL_MS: 'soon' })).toThrow('GENERATION_POLL_MS');
    expect(() => runtimeWith({ GENERATION_POLL_MS: '0' })).toThrow('GENERATION_POLL_MS');
  });

  it('refuses a worker flag that is neither true nor false', () => {
    expect(() => runtimeWith({ GENERATION_WORKER_ENABLED: 'yes' })).toThrow(
      'GENERATION_WORKER_ENABLED',
    );
  });
});

describe('the boot-time claim-timeout invariant', () => {
  it('accepts a claim timeout above the worst case of the whole run', () => {
    expect(
      runtimeWith({ GENERATION_CLAIM_TIMEOUT_MS: String(worstCaseRunMs() + 1) }).claimTimeoutMs,
    ).toBe(worstCaseRunMs() + 1);
  });

  it('refuses a claim timeout exactly at the worst case', () => {
    // Exactly at is not above: a claim expiring at the instant the last call
    // returns hands the job to a second worker mid-landing.
    expect(() => runtimeWith({ GENERATION_CLAIM_TIMEOUT_MS: String(worstCaseRunMs()) })).toThrow(
      'GENERATION_CLAIM_TIMEOUT_MS',
    );
  });

  it('refuses a claim timeout below the worst case', () => {
    expect(() =>
      runtimeWith({ GENERATION_CLAIM_TIMEOUT_MS: String(worstCaseRunMs() - 1) }),
    ).toThrow('GENERATION_CLAIM_TIMEOUT_MS');
  });

  it('measures the worst case over every call one request may make, not one', () => {
    // The whole difference from extraction's invariant: a generation job makes
    // up to MAX_PER_REQUEST calls in sequence. A timeout sized for one call is
    // refused, which is what this asserts.
    const oneCall = worstCaseRunMs() / MAX_PER_REQUEST;
    expect(() => runtimeWith({ GENERATION_CLAIM_TIMEOUT_MS: String(oneCall + 1) })).toThrow(
      'GENERATION_CLAIM_TIMEOUT_MS',
    );
  });

  it('clears the invariant on the shipped default', () => {
    // The figure in `.env.example` has to be a figure that actually boots.
    expect(DEFAULT_CLAIM_TIMEOUT_MS).toBeGreaterThan(worstCaseRunMs());
  });
});

describe('remainingFor', () => {
  it('is the limit less what has been used', () => {
    expect(remainingFor(0, 2)).toBe(2);
    expect(remainingFor(1, 2)).toBe(1);
  });

  it('is nothing once the limit is reached', () => {
    expect(remainingFor(2, 2)).toBe(0);
  });

  it('floors at nothing when usage is already past the limit', () => {
    // A tier downgraded mid-period. A negative remainder would clamp a request
    // to a negative count, which is neither a refusal nor a number of tests.
    expect(remainingFor(9, 2)).toBe(0);
  });

  it('resolves an unlimited tier to the per-request ceiling, never a sentinel', () => {
    expect(remainingFor(100, null)).toBe(MAX_PER_REQUEST);
  });
});

describe('clampCount', () => {
  it('takes what was asked for when it is affordable', () => {
    expect(clampCount(3, 5)).toBe(3);
  });

  it('clamps an overreach to what remains, whatever the client sent', () => {
    // The acceptance criterion: the persisted count is the clamp's, not the
    // client's. A request for nine on two remaining is a request for two.
    expect(clampCount(9, 2)).toBe(2);
  });

  it('never exceeds the per-request ceiling even on an unlimited tier', () => {
    expect(clampCount(100, 100)).toBe(MAX_PER_REQUEST);
  });

  it('is nothing when nothing remains', () => {
    expect(clampCount(3, 0)).toBe(0);
  });

  it('is nothing for a count that is not a positive whole number', () => {
    expect(clampCount(0, 5)).toBe(0);
    expect(clampCount(-2, 5)).toBe(0);
    expect(clampCount(Number.NaN, 5)).toBe(0);
    // Floored rather than rounded: 2.9 tests is at most two.
    expect(clampCount(2.9, 5)).toBe(2);
  });
});

const MC: QuestionFormat = 'MultipleChoice';
const FIB: QuestionFormat = 'FillInTheBlank';
const SA: QuestionFormat = 'ShortAnswer';

/** The targets as a plain object, so an assertion reads as the mix it is. */
function mix(formats: QuestionFormat[], total: number): Record<string, number> {
  return Object.fromEntries(formatTargets(formats, total));
}

describe('formatTargets', () => {
  it('reproduces a uniform source exactly', () => {
    expect(mix([MC, MC, MC], 3)).toEqual({ MultipleChoice: 3 });
  });

  it('apportions a mixed source proportionally', () => {
    expect(mix([MC, MC, FIB, SA], 4)).toEqual({
      MultipleChoice: 2,
      FillInTheBlank: 1,
      ShortAnswer: 1,
    });
  });

  it('always sums to the total, whatever the remainders are', () => {
    // Three formats over four questions cannot divide evenly; rounding each
    // share independently would give five or three, and a Practice Test with
    // one question too many is not what was asked for.
    for (const total of [1, 2, 3, 4, 5, 7, 11]) {
      const targets = formatTargets([MC, MC, FIB, SA, SA], total);
      const sum = [...targets.values()].reduce((acc, count) => acc + count, 0);
      expect(sum).toBe(total);
    }
  });

  it('keeps every source format in the result even when its share rounds to nothing', () => {
    // A rule that can silently drop a format is a rule the post-hoc check could
    // never state: the payload validator asserts on exactly these keys.
    const targets = formatTargets([MC, MC, MC, MC, MC, MC, MC, MC, MC, FIB], 1);
    expect([...targets.keys()].sort()).toEqual(['FillInTheBlank', 'MultipleChoice']);
    expect(targets.get('FillInTheBlank')).toBe(0);
    expect(targets.get('MultipleChoice')).toBe(1);
  });

  it('breaks remainder ties by first appearance, so it is deterministic', () => {
    // Two formats, equal counts, an odd total: one of them gets the extra seat,
    // and which one must not depend on iteration order.
    expect(mix([FIB, MC], 3)).toEqual({ FillInTheBlank: 2, MultipleChoice: 1 });
    expect(mix([MC, FIB], 3)).toEqual({ MultipleChoice: 2, FillInTheBlank: 1 });
  });

  it('is empty for a source with nothing in it, or a total of nothing', () => {
    expect(mix([], 5)).toEqual({});
    expect(mix([MC], 0)).toEqual({});
  });
});
