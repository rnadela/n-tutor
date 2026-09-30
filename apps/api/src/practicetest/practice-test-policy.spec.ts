import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionFormat } from '../generated/prisma/enums.js';
import { SOURCE_TEST_NOT_FOUND as SOURCE_TEST_NOT_FOUND_ORIGIN } from '../sourcetest/source-test-policy.js';
import { MAX_LABEL_LENGTH } from './practice-test-payload.js';
import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_POLL_MS,
  EXTRACTION_NOT_READY,
  GENERATION_ALLOWANCE_SPENT,
  GENERATION_CLOCK_ANOMALY,
  GENERATION_FAILED,
  GENERATION_INPUT_UNUSABLE,
  GENERATION_NOT_REQUESTED,
  GENERATION_REQUEST_REJECTED,
  GENERATION_SOURCE_GONE,
  GENERATION_UPSTREAM_REJECTED,
  MAX_PER_REQUEST,
  MAX_TOPIC_LABEL_LENGTH,
  SOURCE_TEST_NOT_FOUND,
  WEIGHTED_TOPIC_SHARE,
  WEIGHTED_TOPIC_UNKNOWN,
  clampCount,
  compareStudentListRows,
  formatTargets,
  lastSubmission,
  normalizeTopicLabel,
  practiceTestRuntime,
  remainingFor,
  studentListState,
  resetPracticeTestRuntime,
  weightedTopicFloor,
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
        GENERATION_ALLOWANCE_SPENT,
        EXTRACTION_NOT_READY,
        GENERATION_FAILED,
        GENERATION_UPSTREAM_REJECTED,
        GENERATION_SOURCE_GONE,
        GENERATION_INPUT_UNUSABLE,
        GENERATION_REQUEST_REJECTED,
        GENERATION_CLOCK_ANOMALY,
        WEIGHTED_TOPIC_UNKNOWN,
      ]).size,
    ).toBe(10);
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
      GENERATION_ALLOWANCE_SPENT,
    ].filter((message) => /retake|photo|page/i.test(message));
    expect(retakes).toEqual([GENERATION_INPUT_UNUSABLE]);
  });

  it('never tells a parent the cap stopped a job is worth trying again', () => {
    // `GENERATION_FAILED` says "Try again", which is false until the period
    // turns over: the provider answered and the upload was fine.
    expect(GENERATION_ALLOWANCE_SPENT).not.toBe(GENERATION_FAILED);
    expect(GENERATION_ALLOWANCE_SPENT).not.toMatch(/try again/i);
    // And it is not the input's fault either, so it is not that sentence.
    expect(GENERATION_ALLOWANCE_SPENT).not.toBe(GENERATION_INPUT_UNUSABLE);
  });

  it('says nothing about a provider, a model, a tier or a code', () => {
    for (const message of [
      GENERATION_NOT_REQUESTED,
      GENERATION_ALLOWANCE_SPENT,
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

describe('weightedTopicFloor', () => {
  it('is the share of the total, rounded up', () => {
    // The figure the prompt quotes and the post-hoc pass counts against, from
    // one formula: a draft below it is refused, so the two must never differ.
    for (const total of [2, 3, 4, 5, 10, 17, 40]) {
      expect(weightedTopicFloor(total)).toBe(Math.ceil(total * WEIGHTED_TOPIC_SHARE));
    }
  });

  it('never asks for fewer than one question', () => {
    // A one-question Extraction must be weightable at all; a floor of zero
    // would make the weighting a rule nothing enforces.
    expect(weightedTopicFloor(1)).toBe(1);
  });

  it('never asks for more questions than the draft holds', () => {
    // A floor above the total is a rule no draft could ever satisfy, and every
    // attempt spent on it is a provider call spent to be refused.
    for (const total of [1, 2, 3, 5, 9]) {
      expect(weightedTopicFloor(total)).toBeLessThanOrEqual(total);
    }
  });

  it('is nothing for a draft with no questions in it', () => {
    expect(weightedTopicFloor(0)).toBe(0);
    expect(weightedTopicFloor(-3)).toBe(0);
    expect(weightedTopicFloor(Number.NaN)).toBe(0);
  });

  it('leaves room for the other topics a weighted draft must still cover', () => {
    // "Predominantly", not "entirely": the share is a majority and stops short
    // of the whole draft wherever the draft is big enough to have a remainder.
    expect(WEIGHTED_TOPIC_SHARE).toBeGreaterThan(0.5);
    expect(WEIGHTED_TOPIC_SHARE).toBeLessThan(1);
    expect(weightedTopicFloor(10)).toBeLessThan(10);
  });
});

describe('normalizeTopicLabel', () => {
  it('folds the drift a model and a browser actually produce', () => {
    // Case and whitespace, and nothing else. The request-time resolve and the
    // post-hoc count both go through this, so they agree by construction.
    expect(normalizeTopicLabel('  fractions ')).toBe(normalizeTopicLabel('Fractions'));
    expect(normalizeTopicLabel('Long\n  Division')).toBe(normalizeTopicLabel('long division'));
  });

  it('folds compatibility forms, so one label typed two ways is one label', () => {
    // NFKC, explicitly: a full-width label pasted out of a document and the
    // same label typed on an ASCII keyboard are the same Topic, and the
    // request-time resolve has to match the one the Extraction stored. Without
    // this case the `normalize` call could be deleted and nothing would fail.
    expect(normalizeTopicLabel('Ｆｒａｃｔｉｏｎｓ')).toBe(normalizeTopicLabel('Fractions'));
    // A non-breaking space is whitespace a model emits and a human cannot see.
    expect(normalizeTopicLabel('Long\u00a0Division')).toBe(normalizeTopicLabel('long division'));
    // And a compatibility ligature, which is the same word spelled one glyph
    // shorter.
    expect(normalizeTopicLabel('\ufb01gures')).toBe(normalizeTopicLabel('Figures'));
  });

  it('is not canonicalization, and never becomes it', () => {
    // Merging these two is Mastery's decision (AD-11, Epic 7). Making it here
    // would split, or fuse, one concept in a second place.
    expect(normalizeTopicLabel('Fractions')).not.toBe(normalizeTopicLabel('Fraction'));
    expect(normalizeTopicLabel('Adding fractions')).not.toBe(normalizeTopicLabel('fractions'));
  });

  it('bounds an incoming label at the same figure a generated one is bounded at', () => {
    expect(MAX_TOPIC_LABEL_LENGTH).toBe(MAX_LABEL_LENGTH);
  });
});

describe('what condition a released practice test is in for a child', () => {
  it('is not started when no Attempt exists', () => {
    expect(studentListState([])).toBe('NotStarted');
  });

  it('is in progress while an Attempt has not been handed in', () => {
    expect(studentListState([{ submittedAt: null }])).toBe('InProgress');
  });

  it('is completed once every Attempt has been handed in', () => {
    expect(studentListState([{ submittedAt: new Date('2026-01-01T00:00:00.000Z') }])).toBe(
      'Completed',
    );
  });

  it('lets an open retake outrank a past submission, whichever order they arrive in', () => {
    // The band exists to surface what there is to do, so a sitting left open is
    // work to return to even on a test finished once already.
    const submitted = { submittedAt: new Date('2026-01-01T00:00:00.000Z') };
    const open = { submittedAt: null };
    expect(studentListState([submitted, open])).toBe('InProgress');
    expect(studentListState([open, submitted])).toBe('InProgress');
  });
});

describe('the instant a completed practice test is ordered by', () => {
  it('is the most recent submission, not the last row it was handed', () => {
    const later = new Date('2026-03-02T00:00:00.000Z');
    const earlier = new Date('2026-03-01T00:00:00.000Z');
    expect(lastSubmission([{ submittedAt: later }, { submittedAt: earlier }])).toEqual(later);
    expect(lastSubmission([{ submittedAt: earlier }, { submittedAt: later }])).toEqual(later);
  });

  it('is null when nothing was ever handed in', () => {
    expect(lastSubmission([])).toBeNull();
    expect(lastSubmission([{ submittedAt: null }])).toBeNull();
  });

  it('ignores the open sitting beside a submitted one', () => {
    const at = new Date('2026-03-02T00:00:00.000Z');
    expect(lastSubmission([{ submittedAt: null }, { submittedAt: at }])).toEqual(at);
  });
});

describe('the order the child’s list is served in', () => {
  function row(
    id: string,
    state: 'NotStarted' | 'InProgress' | 'Completed',
    createdAt: string,
    lastSubmittedAt: string | null = null,
  ) {
    return {
      id,
      state,
      createdAt: new Date(createdAt),
      lastSubmittedAt: lastSubmittedAt === null ? null : new Date(lastSubmittedAt),
    };
  }

  function ordered(rows: ReturnType<typeof row>[]): string[] {
    return [...rows].sort(compareStudentListRows).map((entry) => entry.id);
  }

  it('puts everything there is still to do ahead of everything finished', () => {
    // Whatever the dates say: a test completed this morning sits below one
    // released last year and never opened.
    const done = row('a', 'Completed', '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z');
    const todo = row('b', 'NotStarted', '2025-01-01T00:00:00.000Z');
    expect(ordered([done, todo])).toEqual(['b', 'a']);
    expect(ordered([todo, done])).toEqual(['b', 'a']);
  });

  it('mixes not-started and in-progress in one band, newest made first', () => {
    const rows = [
      row('a', 'NotStarted', '2026-01-01T00:00:00.000Z'),
      row('b', 'InProgress', '2026-03-01T00:00:00.000Z'),
      row('c', 'NotStarted', '2026-02-01T00:00:00.000Z'),
    ];
    // In progress is not a band of its own: both are work waiting, and the
    // only thing that separates them in the list is the date.
    expect(ordered(rows)).toEqual(['b', 'c', 'a']);
  });

  it('orders the completed band by the most recent submission', () => {
    const rows = [
      row('a', 'Completed', '2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
      row('b', 'Completed', '2026-04-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
    ];
    // Made-at would say `b` first; submitted-at says `a`, and submitted-at is
    // what distinguishes two finished tests to the child who finished them.
    expect(ordered(rows)).toEqual(['a', 'b']);
  });

  it('breaks a tie on the id, descending, in both bands', () => {
    const band1 = [
      row('id-1', 'NotStarted', '2026-01-01T00:00:00.000Z'),
      row('id-2', 'InProgress', '2026-01-01T00:00:00.000Z'),
    ];
    expect(ordered(band1)).toEqual(['id-2', 'id-1']);
    const band2 = [
      row('id-1', 'Completed', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      row('id-2', 'Completed', '2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
    ];
    expect(ordered(band2)).toEqual(['id-2', 'id-1']);
  });

  it('is a total order, so the list cannot shuffle between reads', () => {
    const rows = [
      row('a', 'NotStarted', '2026-01-01T00:00:00.000Z'),
      row('b', 'InProgress', '2026-01-01T00:00:00.000Z'),
      row('c', 'Completed', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
      row('d', 'Completed', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    ];
    const expected = ordered(rows);
    // Every arrival order settles on the same answer.
    expect(ordered([...rows].reverse())).toEqual(expected);
    expect(ordered([rows[2]!, rows[0]!, rows[3]!, rows[1]!])).toEqual(expected);
    // And antisymmetry: no pair claims to precede the other.
    // `|| 0` normalises `-0`, which `toBe` distinguishes from `0`.
    const direction = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      Math.sign(compareStudentListRows(a, b)) || 0;
    for (const left of rows) {
      expect(direction(left, left)).toBe(0);
      for (const right of rows) {
        expect(direction(left, right)).toBe(-direction(right, left) || 0);
      }
    }
  });
});
