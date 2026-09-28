import { describe, expect, it } from 'vitest';
import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';
import { PARENT_FLAG_ORIGIN, STUDENT_FLAG_ORIGIN } from './explanation-flag.js';
import {
  NO_EXPLANATION_TO_REGENERATE,
  NO_EXPLANATION_TO_SUPPRESS,
  NOTHING_TO_REGENERATE,
  SUPPRESSION_NEEDS_A_FLAG,
} from './explanation-policy.js';
import {
  latestGenerations,
  suppressedQuestionIds,
  suppressionUnlocked,
  type GenerationRow,
  type SuppressionFlag,
} from './explanation-suppression.js';

/**
 * The pure part of suppression: when a parent may remove an Explanation, and which
 * generation of a Question counts.
 *
 * The **stateful** rows of the story's matrix — that a suppressed read makes no provider
 * call and charges nothing, that a regeneration on a capped Free account still answers
 * 201, that the suppressed row survives and stays in the Admin queue, and that two
 * concurrent regenerations leave one row — need the real app and the real database and
 * live in `test/explanation-suppression.int-spec.ts`. What is here needs neither.
 */

function parentFlag(): SuppressionFlag {
  return { origin: PARENT_FLAG_ORIGIN, disposition: null };
}

function studentFlag(disposition: 'Confirmed' | 'Dismissed' | null = null): SuppressionFlag {
  return { origin: STUDENT_FLAG_ORIGIN, disposition };
}

function generation(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return { questionId: 'q1', generation: 1, suppressedAt: null, ...overrides };
}

describe('when a parent may remove an Explanation from their child', () => {
  it('unlocks on a parent-origin flag', () => {
    // A parent-origin flag is already the parent's own judgement: there is nothing
    // further to ask them, which is why it qualifies outright in the Admin queue's
    // `where` too — and this predicate *is* that `where`.
    expect(suppressionUnlocked([parentFlag()])).toBe(true);
  });

  it('unlocks on a student-origin flag the parent confirmed', () => {
    expect(suppressionUnlocked([studentFlag('Confirmed')])).toBe(true);
  });

  it('stays locked where nothing is recorded at all', () => {
    // Never automatic. Suppression follows a recorded concern, and there is none here.
    expect(suppressionUnlocked([])).toBe(false);
  });

  it('stays locked while the child’s report is awaiting a decision', () => {
    // Its own case, because "awaiting" is the *absence* of a disposition: a predicate
    // that asked whether a disposition exists at all would let this through, and a
    // parent would be offered the removal of something nobody has read.
    expect(suppressionUnlocked([studentFlag(null)])).toBe(false);
  });

  it('stays locked where the parent dismissed the child’s report', () => {
    // Its own case too, and the one that matters most: a dismissal is the parent having
    // read the same prose and judged it fine. A predicate that only tested for the
    // presence of a decision would offer suppression for exactly the decision that says
    // not to.
    expect(suppressionUnlocked([studentFlag('Dismissed')])).toBe(false);
  });

  it('unlocks on the parent’s own flag even where they dismissed the child’s', () => {
    // Two people, two rows, two independent facts. The parent's own concern stands on
    // its own whatever they decided about their child's.
    expect(suppressionUnlocked([studentFlag('Dismissed'), parentFlag()])).toBe(true);
  });

  it('reads the flags by origin and never by position', () => {
    // `flags[0]` would be whichever row the planner happened to return first, which is
    // how a dismissed student flag would come to unlock a suppression. So the order is
    // deliberately the wrong way round in both directions here.
    expect(suppressionUnlocked([parentFlag(), studentFlag('Dismissed')])).toBe(true);
    expect(suppressionUnlocked([studentFlag(null), studentFlag('Confirmed')])).toBe(true);
  });
});

describe('which generation of a Question counts', () => {
  it('resolves the highest generation, not the first or the last in the list', () => {
    // The ordinal the writes maintain, never a position: a list index renumbers itself
    // the day the read's order changes, and two rows written inside one millisecond have
    // no order by their instants at all.
    const rows = [
      generation({ generation: 2 }),
      generation({ generation: 3 }),
      generation({ generation: 1 }),
    ];
    expect(latestGenerations(rows).get('q1')?.generation).toBe(3);
  });

  it('resolves one latest per Question, independently', () => {
    const rows = [
      generation({ questionId: 'q1', generation: 1 }),
      generation({ questionId: 'q2', generation: 1 }),
      generation({ questionId: 'q2', generation: 2 }),
    ];
    const latest = latestGenerations(rows);
    expect(latest.get('q1')?.generation).toBe(1);
    expect(latest.get('q2')?.generation).toBe(2);
    expect(latest.size).toBe(2);
  });

  it('answers nothing for no rows at all', () => {
    expect(latestGenerations([]).size).toBe(0);
  });
});

describe('which Questions a child may not be shown an explanation for', () => {
  it('lists a Question whose only generation is suppressed', () => {
    const ids = suppressedQuestionIds([generation({ suppressedAt: new Date() })]);
    expect(ids).toEqual(['q1']);
  });

  it('omits a Question whose suppressed generation has a live replacement', () => {
    // The latest generation is the one that counts: the child is being served the
    // replacement, and the removed row behind it is a parent-side and operator-side
    // fact. A list that read *any* suppressed row would withhold the control from a
    // Question the child can read perfectly well.
    const ids = suppressedQuestionIds([
      generation({ generation: 1, suppressedAt: new Date() }),
      generation({ generation: 2, suppressedAt: null }),
    ]);
    expect(ids).toEqual([]);
  });

  it('lists a Question whose replacement was itself suppressed', () => {
    // There is no ceiling: each generation can be reported and removed on its own terms.
    const ids = suppressedQuestionIds([
      generation({ generation: 1, suppressedAt: new Date() }),
      generation({ generation: 2, suppressedAt: new Date() }),
    ]);
    expect(ids).toEqual(['q1']);
  });

  it('does not depend on the order the rows arrive in', () => {
    const suppressedFirst = suppressedQuestionIds([
      generation({ generation: 2, suppressedAt: null }),
      generation({ generation: 1, suppressedAt: new Date() }),
    ]);
    expect(suppressedFirst).toEqual([]);
  });

  it('omits a live Question, and answers nothing for an Attempt with no rows', () => {
    expect(suppressedQuestionIds([generation()])).toEqual([]);
    // Which is also the answer a foreign or unknown Attempt gets, because its `where`
    // matches nothing — never a 404 that would confirm an id exists (AD-18).
    expect(suppressedQuestionIds([])).toEqual([]);
  });
});

describe('what this story refuses with', () => {
  it('refuses a missing Explanation with the one sentence every ownership refusal reuses', () => {
    // A Question nobody asked about, a sibling's Attempt, another account's, one that
    // never existed and one still open are five facts and one sentence: spelling them
    // apart is how the outside reads which of another account's ids exist (AD-18).
    expect(NO_EXPLANATION_TO_SUPPRESS).toBe(PRACTICE_TEST_NOT_FOUND);
  });

  it('says a concern has to be recorded first, and says nothing else', () => {
    expect(SUPPRESSION_NEEDS_A_FLAG).not.toBe(PRACTICE_TEST_NOT_FOUND);
    // No child, no Question, no tier, no number, no price and no apology.
    expect(SUPPRESSION_NEEDS_A_FLAG).not.toMatch(/\d/u);
    expect(SUPPRESSION_NEEDS_A_FLAG).not.toMatch(
      /sorry|apolog|\btier\b|\bplan\b|\bcost\b|\bfree\b/iu,
    );
    expect(SUPPRESSION_NEEDS_A_FLAG).not.toContain('!');
  });

  it('refuses a missing Explanation on the replacement path under its own name', () => {
    // The same sentence by value, for the same AD-18 reason — and its own constant, because the
    // *reason* differs and this file's convention is that each reason gets its own name: there,
    // nothing to stop serving; here, nothing to put in its place.
    expect(NO_EXPLANATION_TO_REGENERATE).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(NO_EXPLANATION_TO_REGENERATE).toBe(NO_EXPLANATION_TO_SUPPRESS);
    // And it is **not** the 409: a Question with no Explanation at all and one whose
    // Explanation is still being served are different states, and only the second is
    // something a parent can act on by removing it first.
    expect(NO_EXPLANATION_TO_REGENERATE).not.toBe(NOTHING_TO_REGENERATE);
  });

  it('says the child is still being served it, and names no cost', () => {
    expect(NOTHING_TO_REGENERATE).not.toBe(PRACTICE_TEST_NOT_FOUND);
    expect(NOTHING_TO_REGENERATE).not.toBe(SUPPRESSION_NEEDS_A_FLAG);
    // In particular it does not say what a regeneration *would* cost: the screen states
    // that beside the control before it fires, and a refusal restating it would be a
    // second source for one figure.
    expect(NOTHING_TO_REGENERATE).not.toMatch(/\d/u);
    expect(NOTHING_TO_REGENERATE).not.toMatch(
      /sorry|apolog|\btier\b|\bplan\b|\bcost\b|\bfree\b|allowance/iu,
    );
    expect(NOTHING_TO_REGENERATE).not.toContain('!');
  });
});
