import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

/**
 * The list of the marks one student says are wrong, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so a screen holding two reads, a
 * selector and a staleness guard is pinned by reading what it says — exactly as the reported
 * explanations screen it is modelled on is. What an *outcome* is, is a pure function asserted
 * in `lib/grade-dispute.spec.ts`.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the disputes screen does', () => {
  it('makes exactly two reads and no write', () => {
    // The profiles are the selector; the disputes are the list. Nothing here sets a mark: the
    // one remedy is taken next to the question it is about, because adjusting without having
    // read the reason is the thing this feature must not make easy.
    expect(new Set(CODE.match(/parentApi\.\w+/gu))).toEqual(
      new Set(['parentApi.students', 'parentApi.gradeDisputes']),
    );
    expect(CODE).not.toMatch(/overrideGrade|method: 'POST'/u);
  });

  it('shows one child at a time, defaulting to the first', () => {
    // A dispute belongs to one child, and a list spanning two would make "newest first" a
    // question about whose.
    expect(CODE).toContain(
      "setStudentProfileId((chosen) => (chosen === '' ? (found[0]?.id ?? '') : chosen))",
    );
    expect(CODE).toContain('id="parent-disputes-student"');
  });

  it('guards a superseded read from overwriting a fresher list', () => {
    // Switching children outlives a read in flight; without the guard it could resolve after
    // the fact and put one child's disputes under another's name.
    expect(CODE.match(/applyIfCurrent/gu)).toHaveLength(3);
    expect(CODE).toContain('const issued = (requestId.current += 1)');
  });

  it('holds "answered" apart from "not loading", for both reads', () => {
    // "Not loading" is also what a *failed* read leaves behind, and "this student has not said
    // a mark is wrong" is a claim a screen that never heard back cannot make.
    expect(CODE).toContain('const [loaded, setLoaded] = useState(false)');
    expect(CODE).toContain('const [profilesLoaded, setProfilesLoaded] = useState(false)');
    expect(CODE).toContain('loaded &&');
    expect(CODE).toContain('profilesLoaded && (');
  });

  it('states the two read failures separately', () => {
    // Saying the disputes could not be listed when it was the students that could not be read
    // names the wrong thing beside a selector that is empty for a reason the sentence does not
    // give.
    expect(CODE).toContain('parentCopy.disputes.profilesFailed');
    expect(CODE).toContain('parentCopy.disputes.listFailed');
  });

  it('never renders a platform or upstream string at a parent', () => {
    // A rejection carries whatever the platform put there. The API's own sentence is rendered
    // when it authored one; this screen's own otherwise, and never `cause.message`.
    expect(CODE).toContain('cause instanceof ParentApiError && cause.reason !== null');
    expect(CODE).not.toMatch(/cause\.message/u);
  });

  it('derives the outcome from the one function, and never by comparing the two marks', () => {
    // Resolution is the adjustment. Comparing the marks would answer "awaiting" for a parent
    // who set a mark and then set it back, which is a decision they demonstrably made.
    expect(CODE).toContain('disputeOutcomeOf(entry)');
    expect(CODE).not.toMatch(/recordedState\s*[=!]==?\s*entry\.effectiveState/u);
  });

  it('lists both kinds, awaiting and resolved', () => {
    expect(CODE).toContain('parentCopy.disputes.awaiting');
    expect(CODE).toContain('parentCopy.disputes.resolved');
    // And it never filters: a screen that dropped resolved entries would make a parent's own
    // adjustment look like the objection never happened.
    expect(CODE).not.toMatch(/disputes\.filter/u);
  });

  it('states both the recorded mark and the mark that counts now', () => {
    expect(CODE).toContain('parentCopy.disputes.recorded(');
    expect(CODE).toContain('parentCopy.disputes.effective(');
  });

  it('keeps the API’s order and sorts nothing', () => {
    expect(CODE).not.toMatch(/\.sort\(/u);
  });

  it('keeps an entry whose context no longer resolves, and loses only its labels', () => {
    expect(CODE).toContain('parentCopy.disputes.whereUnknown');
    expect(CODE).toContain('parentCopy.disputes.unknownSubject');
    expect(CODE).toContain('parentCopy.disputes.raisedUndated');
    expect(CODE).toContain('parentCopy.disputes.resolvedUndated');
  });

  it('derives no ordinal from a row’s position in the list', () => {
    expect(CODE).toContain('entry.runOrdinal');
    expect(CODE).toContain('entry.questionOrdinal');
    expect(CODE).not.toMatch(/\.map\(\(entry, (index|i)\)/u);
  });

  it('restores list semantics by hand', () => {
    // `listStyle: 'none'` strips them in Safari/VoiceOver along with the item count, which is
    // the one thing a parent scanning this needs announced.
    expect(CODE).toContain('role="list"');
    expect(CODE).toContain('role="listitem"');
  });

  it('links into the run with a typed route rather than a bare string', () => {
    expect(CODE).toContain('function attemptHref');
    expect(CODE).toContain('component={AttemptLink}');
  });

  it('carries no Mastery figure, no run score and no analytics', () => {
    // It is a plain parent screen and not the Analytics dashboard band.
    for (const forbidden of [
      /mastery/iu,
      /weak\s*area/iu,
      /\bscore\b/iu,
      /percent|%|chart|trend/iu,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('carries no reason, no cost, no tier and no model name', () => {
    for (const forbidden of [/rationale/iu, /allowance/iu, /\btier/iu, /\bmodel\b/iu, /\bcost/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('writes no user-facing string as a literal', () => {
    expect(CODE.match(/>\s*[A-Z][a-z][^<{}]{3,}</gu)).toBeNull();
  });
});

describe('what the disputes copy says', () => {
  const disputes = parentCopy.disputes;

  it('offers no word for a dismissal, because there is no such outcome', () => {
    const everything = [
      disputes.title,
      disputes.intro,
      disputes.empty,
      disputes.awaiting,
      disputes.resolved('then'),
      disputes.resolvedUndated,
      disputes.open,
    ].join(' ');
    expect(everything).not.toMatch(/dismiss|uphold|decline|reject/iu);
  });

  it('states awaiting as what it is: nobody has decided', () => {
    expect(disputes.awaiting).toMatch(/waiting/iu);
  });

  it('names no Mastery figure, cost, tier or model', () => {
    const everything = [disputes.title, disputes.intro, disputes.empty, disputes.open].join(' ');
    for (const forbidden of [/mastery/iu, /allowance|tier|price|upgrade/iu, /model|provider/iu]) {
      expect(everything).not.toMatch(forbidden);
    }
  });

  it('gives each mark the same word the run’s own region uses', () => {
    expect(disputes.grade).toEqual(parentCopy.attempts.override.grade);
  });

  it('has its own sentence for each of the two reads that can fail', () => {
    expect(disputes.listFailed).not.toBe(disputes.profilesFailed);
  });
});

describe('the way in from Parent View', () => {
  it('is linked, because a dispute a parent cannot reach did not surface', () => {
    const parentView = readFileSync(path.resolve(import.meta.dirname, '..', 'page.tsx'), 'utf8');
    expect(parentView).toContain('href="/parent/grade-disputes"');
    expect(parentView).toContain('parentCopy.parentView.gradeDisputes');
  });
});
