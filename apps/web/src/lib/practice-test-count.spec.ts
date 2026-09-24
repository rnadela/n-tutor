import { describe, expect, it } from 'vitest';
import {
  GENERATION_POLL_MS,
  countOptions,
  defaultCount,
  isSettled,
  progressSentence,
  remainingAfter,
} from './practice-test-count';
import { parentCopy } from '@/copy/parent';

describe('countOptions', () => {
  it('offers every count up to the ceiling, whatever the account can afford', () => {
    // The rule the acceptance criterion states in words: counts above the
    // remaining allowance are never removed from the list.
    expect(countOptions(2, 5).map((option) => option.count)).toEqual([1, 2, 3, 4, 5]);
  });

  it('marks the counts above what remains unavailable, and the rest available', () => {
    expect(countOptions(2, 5)).toEqual([
      { count: 1, available: true },
      { count: 2, available: true },
      { count: 3, available: false },
      { count: 4, available: false },
      { count: 5, available: false },
    ]);
  });

  it('marks every count unavailable when nothing remains, and still lists them', () => {
    const options = countOptions(0, 5);
    expect(options).toHaveLength(5);
    expect(options.every((option) => !option.available)).toBe(true);
  });

  it('marks every count available when the whole ceiling is affordable', () => {
    expect(countOptions(5, 5).every((option) => option.available)).toBe(true);
  });

  it('takes the ceiling as a parameter, so no figure lives in the browser', () => {
    // If the API's per-request ceiling changes, nothing here changes.
    expect(countOptions(3, 3)).toHaveLength(3);
    expect(countOptions(3, 7)).toHaveLength(7);
  });
});

describe('defaultCount', () => {
  it('starts on the largest affordable count', () => {
    expect(defaultCount(2, 5)).toBe(2);
    expect(defaultCount(5, 5)).toBe(5);
  });

  it('is nothing when nothing is affordable', () => {
    // `null`, so the screen has a state for "there is nothing to pick" that is
    // not a count it would then quietly submit.
    expect(defaultCount(0, 5)).toBeNull();
  });
});

describe('isSettled', () => {
  it('is false while the job is still to run or running', () => {
    expect(isSettled('Queued')).toBe(false);
    expect(isSettled('Running')).toBe(false);
  });

  it('is true for every terminal outcome, partial success included', () => {
    expect(isSettled('Succeeded')).toBe(true);
    // The one that is neither a success nor a failure still settles: polling a
    // job that will never move again is a request issued forever.
    expect(isSettled('PartiallyComplete')).toBe(true);
    expect(isSettled('Failed')).toBe(true);
  });
});

describe('remainingAfter', () => {
  it('is the limit less what is used and what is about to be spent', () => {
    expect(remainingAfter(1, 2, 0)).toBe(1);
    expect(remainingAfter(2, 2, 0)).toBe(0);
  });

  it('floors at nothing rather than going negative', () => {
    expect(remainingAfter(5, 2, 1)).toBe(0);
  });

  it('is nothing to state on an unlimited tier', () => {
    // `null`, never a number: an invented remainder is a figure a parent could
    // plan around and be wrong about.
    expect(remainingAfter(3, null, 0)).toBeNull();
  });
});

describe('the poll interval', () => {
  it('is a positive interval, so a running job is actually re-read', () => {
    expect(GENERATION_POLL_MS).toBeGreaterThan(0);
  });
});

describe('progressSentence', () => {
  const job = (weightedTopic: string | null) => ({
    producedCount: 1,
    requestedCount: 3,
    weightedTopic,
  });

  it('states what has landed and what was asked for when nothing is weighted', () => {
    expect(progressSentence(job(null))).toBe(parentCopy.generate.progress(1, 3));
    expect(progressSentence(job(null))).toContain('1 of 3');
  });

  it('names the weighted topic when the job carries one', () => {
    // The point of the whole story on this screen: a sentence that dropped the
    // topic would leave a parent unable to tell a weighted request from an
    // unweighted one.
    const sentence = progressSentence(job('Fractions'));
    expect(sentence).toContain('Fractions');
    expect(sentence).toContain('1 of 3');
    expect(sentence).toBe(parentCopy.generate.progressWeighted(1, 3, 'Fractions'));
    expect(sentence).not.toBe(parentCopy.generate.progress(1, 3));
  });

  it('names the topic as it was given, whatever is in it', () => {
    // The label is content read off a parent's page: it is neither retitled
    // nor truncated on its way into the sentence.
    const odd = 'Fractions, decimals & “percentages”';
    expect(progressSentence(job(odd))).toContain(odd);
  });

  it('carries both figures in both forms, so neither sentence quietly drops one', () => {
    expect(
      progressSentence({ producedCount: 0, requestedCount: 5, weightedTopic: null }),
    ).toContain('0 of 5');
    expect(
      progressSentence({ producedCount: 0, requestedCount: 5, weightedTopic: 'Long division' }),
    ).toContain('0 of 5');
  });
});
