import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';

/**
 * The child's "I think this is marked wrong", asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so a component that holds state, a
 * request and a focus move is pinned the way every other stateful file on this surface is:
 * by reading what it says. What a *press* means is a pure function and is asserted in
 * `lib/grade-dispute.spec.ts`; what this file must never contain is asserted here.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'DisputePanel.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the dispute control does', () => {
  it('sends exactly one write, and only the one this story adds', () => {
    expect(CODE.match(/parentApi\.\w+/gu)).toEqual(['parentApi.disputeGrade']);
  });

  it('decides a press through the pure function rather than in the handler', () => {
    // The rule lives in `src/lib` because this suite has no DOM: a rule that only existed
    // inside an event handler would be a rule nothing could assert.
    expect(CODE).toContain('disputeDecision({ online: navigator.onLine, disputed, sending })');
    // And every arm is acted on, so none of them is a value nothing reads.
    for (const arm of ['already', 'busy', 'offline']) {
      expect(CODE).toContain(`'${arm}'`);
    }
  });

  it('nothing is sent on mount, on a timer or on a retry of its own', () => {
    // A press is the only thing that asks. Nothing polls, prefetches, queues or retries.
    expect(CODE).not.toMatch(/setInterval|setTimeout|useSWR|poll/iu);
    // The one effect is the focus move, keyed on the recorded state — not a request.
    // One effect and one only — counted as calls, not as occurrences, so the import does not
    // pad the figure.
    expect(CODE.match(/useEffect\(/gu)).toHaveLength(1);
    expect(CODE).toMatch(/useEffect\([\s\S]*?reportedSentence\.current\?\.focus\(\)/u);
  });

  it('offers no way to un-say it', () => {
    // A record of an objection is not a toggle: the control is replaced by the state, and
    // there is no second press and no API call that could clear one.
    expect(CODE).not.toMatch(/undispute|unDispute|removeDispute|delete/iu);
    expect(CODE).toMatch(/\{disputed \? \(/u);
  });

  it('announces with the very sentence the screen displays', () => {
    expect(CODE).toContain('announce(studentCopy.results.dispute.announcement(ordinal))');
    expect(CODE).toContain('announce(studentCopy.results.dispute.failed)');
    expect(CODE).toContain('announce(studentCopy.results.dispute.offline)');
  });

  it('tells a failure apart from having no connection', () => {
    // "There is no connection" is a thing a child can act on; collapsing it into "it did not
    // work" would send them pressing at a wall.
    expect(CODE).toContain("useState<'failed' | 'offline' | null>(null)");
    expect(CODE).toContain('studentCopy.results.dispute.offline');
    expect(CODE).toContain('studentCopy.results.dispute.failed');
  });

  it('routes nowhere but on the guard’s own refusal', () => {
    expect(CODE.match(/router\.replace/gu)).toHaveLength(1);
    expect(CODE).toContain("router.replace('/student')");
    expect(CODE).not.toMatch(/router\.(push|back|forward)/u);
  });

  it('moves focus off the control it removes', () => {
    // Focus left on an unmounted button falls to the document, which would throw a child
    // working by keyboard to the top of a long paper by their own press.
    expect(CODE).toContain('tabIndex={-1}');
    expect(CODE).toContain('ref={reportedSentence}');
  });

  it('holds no copy of the row and no score of its own', () => {
    // The API answers the whole view and it is handed straight up: this component cannot
    // disagree with the screen about what the mark now is.
    expect(CODE).toContain('onDisputed(view)');
    expect(CODE).not.toMatch(/score|denominator|correct/iu);
  });

  it('writes no user-facing string as a literal', () => {
    // Every sentence is `studentCopy`'s. A string in a component is a string nobody reviewing
    // the voice of this surface will find.
    const jsxText = CODE.match(/>\s*[A-Z][a-z][^<{}]{3,}</gu);
    expect(jsxText).toBeNull();
  });

  it('carries nothing parent-scoped, in any spelling', () => {
    for (const forbidden of [
      /rationale/iu,
      /override/iu,
      /aiState/iu,
      /parentAdjusted/iu,
      /\bAI\b/u,
      /allowance|tier|costMicros|model/iu,
      /\btopic/iu,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });
});

describe('what the dispute copy says', () => {
  const dispute = studentCopy.results.dispute;

  it('promises only that a grown-up will look, and never an outcome', () => {
    // A grade may change and may not. A child told theirs would be fixed would be waiting for
    // something that may never come.
    expect(dispute.note).toContain('look at this question');
    for (const sentence of [
      dispute.control,
      dispute.note,
      dispute.announcement(3),
      dispute.reviewed,
    ]) {
      expect(sentence).not.toMatch(/will be (changed|fixed|corrected)|we will|promise/iu);
    }
  });

  it('names no mechanism and no other party’s workings', () => {
    const everything = [
      dispute.control,
      dispute.note,
      dispute.reported,
      dispute.failed,
      dispute.offline,
      dispute.announcement(2),
      dispute.reviewed,
      dispute.scoreChanged(1, 2, 4),
    ].join(' ');
    for (const forbidden of [
      /\bAI\b/u,
      /model|provider|override|rationale|marking model/iu,
      /allowance|tier|plan|cost|upgrade/iu,
    ]) {
      expect(everything).not.toMatch(forbidden);
    }
  });

  it('blames nobody and praises nobody', () => {
    const everything = [dispute.control, dispute.note, dispute.reported, dispute.reviewed].join(
      ' ',
    );
    expect(everything).not.toMatch(/sorry|apolog|well done|thanks|great|!/iu);
  });

  it('says a grown-up set the mark without saying which way it moved', () => {
    // The mark on the row *is* the mark now; the workings are not a child's to read, and the
    // line has to be true whichever way the adjustment went.
    expect(dispute.reviewed).not.toMatch(/correct|wrong|right|changed to|instead/iu);
    expect(dispute.reviewed).toContain('looked at');
  });

  it('states a changed score as two counts over one total, and computes nothing', () => {
    expect(dispute.scoreChanged(1, 2, 4)).toBe(
      '1 out of 4 became 2 out of 4, after a grown-up looked at it.',
    );
    // No percentage and no difference anywhere in it.
    expect(dispute.scoreChanged(1, 2, 4)).not.toMatch(/%|\+1|gained|lost/u);
  });
});
