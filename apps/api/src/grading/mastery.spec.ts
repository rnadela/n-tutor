import { describe, expect, it } from 'vitest';
import {
  MASTERY_ATTEMPT_WINDOW,
  hasEvidence,
  masteryFrom,
  masteryWindowOf,
  topicWindowsOf,
  type MasteryWindowAttempt,
  type TopicWindowTag,
} from './mastery.js';

/**
 * FR-26's window and FR-26's fraction, case by case.
 *
 * Every claim here is about **one** rule — which Attempts are in the window, and what
 * one grade state does to the figure — because that is what the story fixes. Pure, so
 * both are assertable without a database, without a provider and without a tag row.
 */

/** Newest first, as every caller of `masteryWindowOf` hands them over. */
function attemptsAt(...practiceTestIds: readonly string[]): MasteryWindowAttempt[] {
  return practiceTestIds.map((practiceTestId, index) => ({
    attemptId: `attempt-${index}`,
    practiceTestId,
  }));
}

describe('masteryWindowOf', () => {
  it('keeps every Attempt when there are fewer than the window', () => {
    const window = masteryWindowOf(attemptsAt('t1', 't2'), new Set(['t1', 't2']));
    expect(window.map((attempt) => attempt.attemptId)).toEqual(['attempt-0', 'attempt-1']);
  });

  it('keeps only the newest five when there are more', () => {
    const window = masteryWindowOf(
      attemptsAt('t1', 't2', 't3', 't4', 't5', 't6'),
      new Set(['t1', 't2', 't3', 't4', 't5', 't6']),
    );
    expect(window).toHaveLength(MASTERY_ATTEMPT_WINDOW);
    // The sixth is the oldest and is the one evicted; nothing about it contributes.
    expect(window.map((attempt) => attempt.practiceTestId)).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('drops Attempts at papers that never mentioned the Topic before taking the window', () => {
    // Five runs at other papers sit in front of the two that carry the Topic. Filtering
    // after the slice would answer with nothing at all.
    const window = masteryWindowOf(
      attemptsAt('other', 'other', 'other', 'other', 'other', 'topic-a', 'topic-b'),
      new Set(['topic-a', 'topic-b']),
    );
    expect(window.map((attempt) => attempt.practiceTestId)).toEqual(['topic-a', 'topic-b']);
  });

  it('answers with nothing when no Attempt included the Topic', () => {
    expect(masteryWindowOf(attemptsAt('t1', 't2'), new Set(['t9']))).toEqual([]);
  });

  it('preserves the order it was given rather than sorting', () => {
    const given = attemptsAt('t3', 't1', 't2');
    expect(masteryWindowOf(given, new Set(['t1', 't2', 't3']))).toEqual(given);
  });
});

describe('masteryFrom', () => {
  it('divides Correct by the answered Questions', () => {
    expect(masteryFrom(['Correct', 'Correct', 'Correct', 'Incorrect'])).toEqual({
      correct: 3,
      incorrect: 1,
      unanswered: 0,
      value: 0.75,
    });
  });

  it('counts Unanswered in its own right and in neither term of the fraction', () => {
    expect(masteryFrom(['Correct', 'Incorrect', 'Unanswered', 'Unanswered'])).toEqual({
      correct: 1,
      incorrect: 1,
      unanswered: 2,
      // Over the answered two only, never over the four presented.
      value: 0.5,
    });
  });

  it('leaves Ungraded out of every count', () => {
    expect(masteryFrom(['Correct', 'Ungraded'])).toEqual({
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      value: 1,
    });
  });

  it('treats a missing grade row exactly as Ungraded', () => {
    expect(masteryFrom(['Correct', null])).toEqual(masteryFrom(['Correct', 'Ungraded']));
  });

  it('answers a null value rather than a zero when nothing was answered', () => {
    expect(masteryFrom(['Unanswered', 'Ungraded', null])).toEqual({
      correct: 0,
      incorrect: 0,
      unanswered: 1,
      value: null,
    });
  });

  it('answers a null value over no entries at all', () => {
    expect(masteryFrom([])).toEqual({ correct: 0, incorrect: 0, unanswered: 0, value: null });
  });

  it('answers a real zero for a window that was answered and all wrong', () => {
    // The distinction the nullable value exists for: this is 0, and the case above is
    // "nothing to say".
    expect(masteryFrom(['Incorrect', 'Incorrect']).value).toBe(0);
  });
});

describe('hasEvidence', () => {
  it('is false for a window nothing judged', () => {
    expect(hasEvidence(masteryFrom(['Ungraded', null]))).toBe(false);
  });

  it('is false for no entries at all', () => {
    expect(hasEvidence(masteryFrom([]))).toBe(false);
  });

  it('is true for a window of nothing but blanks', () => {
    // A child who was asked and skipped is a fact worth reporting, even though it
    // divides into no fraction.
    expect(hasEvidence(masteryFrom(['Unanswered']))).toBe(true);
  });

  it('is true as soon as one Question was judged', () => {
    expect(hasEvidence(masteryFrom(['Incorrect', 'Ungraded']))).toBe(true);
  });
});

describe('topicWindowsOf', () => {
  /** Tags for one Topic, spelled `test:question`. */
  function tagsFor(topicId: string, ...pairs: readonly `${string}:${string}`[]): TopicWindowTag[] {
    return pairs.map((pair) => {
      const [practiceTestId, questionId] = pair.split(':') as [string, string];
      return { topicId, questionId, practiceTestId };
    });
  }

  it('keeps a Topic’s own five when unrelated papers interleave with them', () => {
    // Six papers carrying the Topic, with five papers about something else woven
    // through. The window is the Topic's newest five and no other paper reaches it.
    const attempts = attemptsAt('t1', 'other', 't2', 'other', 't3', 't4', 'other', 't5', 't6');
    const windows = topicWindowsOf(
      attempts,
      tagsFor('topic-a', 't1:q1', 't2:q2', 't3:q3', 't4:q4', 't5:q5', 't6:q6'),
      ['topic-a'],
    );
    expect(windows.get('topic-a')!.window.map((attempt) => attempt.practiceTestId)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
    ]);
  });

  it('groups the question ids per paper rather than into one pile', () => {
    // "Which Questions of *this* paper are on the Topic" is the counting rule's
    // question, and a single flat list would count another paper's Questions against
    // an Attempt that never presented them.
    const windows = topicWindowsOf(
      attemptsAt('t1', 't2'),
      tagsFor('topic-a', 't1:q1', 't1:q2', 't2:q3'),
      ['topic-a'],
    );
    const byTest = windows.get('topic-a')!.questionIdsByTest;
    expect(byTest.get('t1')).toEqual(['q1', 'q2']);
    expect(byTest.get('t2')).toEqual(['q3']);
  });

  it('keeps two Topics’ windows apart, over one set of Attempts and one set of tags', () => {
    const windows = topicWindowsOf(
      attemptsAt('t1', 't2'),
      [...tagsFor('topic-a', 't1:q1'), ...tagsFor('topic-b', 't2:q2')],
      ['topic-a', 'topic-b'],
    );
    expect(windows.get('topic-a')!.window.map((a) => a.practiceTestId)).toEqual(['t1']);
    expect(windows.get('topic-b')!.window.map((a) => a.practiceTestId)).toEqual(['t2']);
    expect(windows.get('topic-a')!.questionIdsByTest.get('t2')).toBeUndefined();
  });

  it('answers an empty window for a Topic no tag mentions, rather than omitting it', () => {
    // Every named Topic gets an answer: a caller that had to tell "no evidence" from
    // "not asked about" would be a caller deciding this rule for itself.
    const windows = topicWindowsOf(attemptsAt('t1'), tagsFor('topic-a', 't1:q1'), [
      'topic-a',
      'topic-z',
    ]);
    expect(windows.has('topic-z')).toBe(true);
    expect(windows.get('topic-z')).toEqual({ window: [], questionIdsByTest: new Map() });
  });

  it('answers an empty window for every Topic when there is no qualifying Attempt', () => {
    const windows = topicWindowsOf([], tagsFor('topic-a', 't1:q1'), ['topic-a']);
    expect(windows.get('topic-a')!.window).toEqual([]);
    // The tags are still grouped: the window is empty, not the grouping.
    expect(windows.get('topic-a')!.questionIdsByTest.get('t1')).toEqual(['q1']);
  });

  it('agrees with masteryWindowOf, because it is what it calls', () => {
    // The extraction is a move and not a re-write: the selection this answers with is
    // the selection the one window function makes.
    const attempts = attemptsAt('t1', 'other', 't2');
    expect(
      topicWindowsOf(attempts, tagsFor('topic-a', 't1:q1', 't2:q2'), ['topic-a']).get('topic-a')!
        .window,
    ).toEqual(masteryWindowOf(attempts, new Set(['t1', 't2'])));
  });
});
