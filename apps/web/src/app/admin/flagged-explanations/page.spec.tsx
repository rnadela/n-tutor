import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminCopy } from '@/copy/admin';

const PAGE_SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this screen is required
 * to explain at length that it suppresses nothing and carries no tier or cost — and a bare
 * `not.toMatch(/suppress/i)` over the raw source would make writing that explanation a test
 * failure.
 */
const CODE = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * The operator's queue of Explanations to judge.
 *
 * `apps/web` runs its unit tests without a DOM, so a screen's rules are asserted on the
 * source that states them, exactly as the accounts screen's siblings do. What the rendered
 * queue says in a browser, and that a dismissed report is absent from it, is proved by
 * `e2e/tests/student-explanation-flagging.spec.ts`.
 */
describe('the operator’s queue of flagged Explanations', () => {
  it('makes exactly one call, and it is the queue read', () => {
    expect(CODE).toContain('adminApi.flaggedExplanations()');
    expect(CODE.match(/adminApi\.\w+/gu)).toEqual(['adminApi.flaggedExplanations']);
  });

  it('filters nothing itself, because the filter is the API’s query', () => {
    // "No Admin response may carry an unconfirmed student flag" is a guarantee only the
    // query can make: a browser-side filter would hold it in the one place it cannot be
    // enforced, and a reader would believe it.
    expect(CODE).not.toMatch(/\.filter\(/u);
    expect(CODE).not.toMatch(/disposition|Confirmed|Dismissed|awaiting/iu);
  });

  it('draws one row per Explanation, keyed by the Explanation', () => {
    // A parent's own concern and a student concern the same parent confirmed are two
    // records of one paragraph, and the operator judges the paragraph once.
    expect(CODE).toContain('key={entry.explanationId}');
    expect(CODE).toContain('data-testid="flagged-row"');
  });

  it('names every route that raised it, never just one', () => {
    // Which route raised it is the fact that says whether a child was involved, and a row
    // that named one would lose it.
    expect(CODE).toContain('entry.raisedBy');
    expect(CODE).toContain('.map((route) => adminCopy.flaggedExplanations.raisedBy[route]');
    expect(CODE).not.toMatch(/raisedBy\[0\]|raisedBy\.find/u);
  });

  it('keeps the API’s order and recomputes no queue position', () => {
    // An entry's place is the earliest instant either route raised it, which the server
    // folded. Re-deriving it here would be a second opinion about it.
    expect(CODE).not.toMatch(/\.sort\(/u);
    expect(CODE).not.toMatch(/\.reverse\(\)/u);
    expect(CODE).toContain('entry.raisedAt');
  });

  it('states the instant without a date rather than the words “Invalid Date”', () => {
    expect(CODE).toContain('adminCopy.flaggedExplanations.raisedAtUndated');
    expect(CODE).toContain('Number.isNaN(when.getTime())');
  });

  it('renders an empty queue as a sentence, and only once the read has answered', () => {
    // An empty queue is the normal case, never an error — and "nothing is flagged" is a
    // claim a screen that has not heard back is in no position to make.
    expect(CODE).toContain('useState<FlaggedExplanation[] | null>(null)');
    expect(CODE).toContain('entries.length === 0');
    expect(CODE).toContain('adminCopy.flaggedExplanations.empty');
    expect(adminCopy.flaggedExplanations.empty).not.toMatch(/error|fail/iu);
  });

  it('draws the prose through the one renderer of stored segments', () => {
    // A fraction an operator has to judge arrives as structure rather than as a glyph
    // (AD-32).
    expect(CODE).toContain('<RichText segments={entry.body} />');
    expect(CODE).not.toMatch(/dangerouslySetInnerHTML|\.join\(''\)/u);
  });

  it('offers no action at all: nothing suppresses, edits or regenerates', () => {
    // This story opens the queue. Suppression is Story 6.4's, and a parent's decision is
    // the parent's — there is no route here to overturn one.
    expect(CODE).not.toMatch(
      /suppress|regenerat|\bedit\b|delete|method: '(POST|PATCH|PUT|DELETE)'/iu,
    );
    // The only control is Retry, which re-issues the read.
    expect(CODE.match(/<Button/gu)).toHaveLength(1);
    expect(CODE).toContain('onClick={load}');
  });

  it('shows the identifiers and no fact about a family beyond them', () => {
    // An operator has to be able to name what they are judging; no display name, email,
    // cost, tier, model name or allowance figure is part of that (AD-20, AD-26).
    expect(CODE).toContain('entry.parentAccountId');
    expect(CODE).toContain('entry.studentProfileId');
    for (const forbidden of [
      /displayName/u,
      /\bemail\b/iu,
      /costMicros/iu,
      /\btier\b/iu,
      /\bmodel\b/iu,
      /allowance/iu,
      /rationale/iu,
      /\bscore\b/iu,
      /mastery/iu,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('puts list semantics back where the style strips them', () => {
    expect(CODE).toContain('role="list"');
    expect(CODE).toContain('role="listitem"');
  });

  it('gives each card one heading that says which entry it is', () => {
    // A screen-reader user navigating by heading would otherwise hear the same three
    // in-card labels N times with nothing to tell one entry from another.
    expect(CODE).toContain('adminCopy.flaggedExplanations.entryHeading(entry.questionId)');
    // Exactly one `h2` per card, and the three in-card labels sit under it.
    expect(CODE.match(/component="h2"/gu)).toHaveLength(1);
    expect(CODE.match(/component="h3"/gu)).toHaveLength(3);
    // And the card's heading comes first, so the outline reads in the order it nests.
    expect(CODE.indexOf('data-testid="flagged-entry"')).toBeLessThan(
      CODE.indexOf('adminCopy.flaggedExplanations.raisedByHeading'),
    );
  });

  it('renders a route this copy does not map as itself, never as nothing', () => {
    // Which route raised an entry is the fact that says whether a child was involved, and
    // a silently blank one would read as an entry nobody raised.
    expect(CODE).toContain('adminCopy.flaggedExplanations.raisedBy[route] ?? route');
  });

  it('sends an operator back to sign-in only on the guard’s own refusal', () => {
    // Any other failure is a sentence with a Retry, not a reason to throw away a session
    // that is still good.
    expect(CODE).toContain('cause.status === 401');
    expect(CODE).toContain('clearToken()');
    expect(CODE).toContain('adminCopy.flaggedExplanations.loadFailed');
  });

  it('writes no sentence of its own: every one is a member of `adminCopy`', () => {
    const literals = CODE.match(/>\s*[A-Z][a-z]+ [a-z]/gu) ?? [];
    expect(literals).toEqual([]);
    expect(CODE).not.toMatch(/parentCopy|studentCopy/u);
  });
});

describe('what the flagged-queue copy is allowed to say', () => {
  const copy = adminCopy.flaggedExplanations;
  const sentences = [
    copy.title,
    copy.intro,
    copy.empty,
    copy.loading,
    copy.loadFailed,
    copy.retry,
    copy.explanationHeading,
    copy.raisedByHeading,
    copy.entryHeading('a-question-id'),
    copy.raisedAtUndated,
    copy.identifiersHeading,
    copy.explanationIdLabel,
    copy.attemptIdLabel,
    copy.questionIdLabel,
    copy.accountIdLabel,
    copy.studentIdLabel,
  ];

  it('names no cost, tier, model or allowance figure', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\btier\b|\bcost\b|\$|£|allowance|\bmodel\b|\btoken\b/iu);
    }
  });

  it('stays factual: no exclamation, no apology, no urgency', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toContain('!');
      expect(sentence).not.toMatch(/sorry|apolog|urgent|immediately|please/iu);
    }
  });

  it('says which reports are listed and which are not', () => {
    // An operator who did not know that a dismissed student report is absent would read an
    // empty queue as a system that lost something.
    expect(copy.intro).toMatch(/parent/iu);
    expect(copy.intro).toMatch(/student/iu);
    expect(copy.intro).toMatch(/not listed/iu);
    expect(copy.intro).toMatch(/once/iu);
  });

  it('names both routes, and only those two', () => {
    expect(Object.keys(copy.raisedBy).sort()).toEqual(['Parent', 'Student']);
  });

  it('keeps every figure a parameter and writes none into a sentence', () => {
    expect(copy.raisedAt('LATER')).toContain('LATER');
    expect(copy.entryHeading('LATER')).toContain('LATER');
    expect(copy.entryHeading('a')).not.toBe(copy.entryHeading('b'));
    // The id is handed in, so the heading is excluded from the no-digits rule the fixed
    // sentences obey — a uuid is a parameter, not a figure this copy wrote.
    for (const sentence of sentences.filter((one) => one !== copy.entryHeading('a-question-id'))) {
      expect(sentence).not.toMatch(/\d/u);
    }
  });

  it('is reachable from the nav, because a queue nobody can open goes nowhere', () => {
    expect(adminCopy.nav.flaggedExplanations).toBe('Flagged Explanations');
  });
});
