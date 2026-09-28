import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

/**
 * The parent's region for one Question's mark, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so a component holding state, two
 * requests, a retained slot and a focus move is pinned the way every other stateful parent
 * file is: by reading what it says. What a *flip* is, and what a retained slot may become,
 * are pure functions asserted in `lib/grade-dispute.spec.ts`.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'GradeReview.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the grade region does', () => {
  it('calls exactly the three writes this region needs, and makes no read of its own', () => {
    // The adjustment, and the two that hold and drop the retained pick. **`uncommittedState`
    // is not among them**: this region is mounted per Question, so reading the account's
    // slots here would be one identical request per row on mount. The screen reads them once
    // and hands the array down.
    //
    // Newlines allowed between the object and the member: several of these are written as
    // chained promises and would otherwise be missed by a same-line match.
    expect(
      new Set(CODE.match(/parentApi\s*\.\s*\w+/gu)?.map((call) => call.replace(/\s+/gu, ''))),
    ).toEqual(
      new Set([
        'parentApi.overrideGrade',
        'parentApi.saveUncommittedState',
        'parentApi.discardUncommittedState',
      ]),
    );
    expect(CODE).toContain('retainedSlots: readonly UncommittedStateView[]');
  });

  it('shows the recorded mark whether or not a parent has adjusted it', () => {
    // The recorded mark is retained, and it is the evidence the adjustment was made against:
    // a parent who thought adjusting destroyed it would stop being able to check themselves.
    expect(CODE).toContain('parentCopy.attempts.override.recorded(');
    expect(CODE).toContain('row.aiState');
    // Not behind the adjusted branch: it is stated unconditionally.
    expect(CODE).not.toMatch(/row\.parentAdjusted[^\n]*override\.recorded/u);
  });

  it('keeps the reason collapsed by default, behind one label and aria-expanded', () => {
    expect(CODE).toContain('useState(false)');
    expect(CODE).toContain('aria-expanded={reasonOpen}');
    expect(CODE).toContain('aria-controls={reasonId}');
    // One label for both directions: a label that changed under the finger would be a second,
    // contradictory account of which way the press goes.
    expect(CODE.match(/override\.reasonControl/gu)).toHaveLength(1);
  });

  it('states a question that never had a reason as that fact rather than a failure', () => {
    expect(CODE).toContain('row.rationale ?? parentCopy.attempts.override.noReason');
  });

  it('offers the control only where a mark could actually be set', () => {
    // `flipOf` answers null for an unanswered or ungraded question — the same set the API
    // refuses with its own 409 — so the control a parent is offered and the answer they would
    // get read one predicate.
    expect(CODE).toContain('const flip = flipOf(row.state)');
    expect(CODE).toContain('{flip !== null && (');
    // And it is *not* gated on `parentAdjusted`: a parent may set a mark back.
    expect(CODE).not.toMatch(/row\.parentAdjusted && picked === null/u);
  });

  it('gates the "you can change it" sentence on the control being offered', () => {
    // A child may object to any mark, including one nothing judged — there is no
    // student-side rule about which. On such a row `flipOf` answers null and no control is
    // drawn, so telling the parent they can change it would be an instruction with nothing
    // to press.
    expect(CODE).toContain('{!row.parentAdjusted && flip !== null && (');
  });

  it('says why a question that was never judged has no control', () => {
    // An absence would leave a parent looking for a control, most of all on a row their
    // child objected to. The reason is stated instead, from the copy layer.
    expect(CODE).toContain('{flip === null && (');
    expect(CODE).toContain('parentCopy.attempts.override.notJudged');
  });

  it('lets a pick be put back without saving the wrong mark', () => {
    // A pick is a step and not a decision. Without a way out, a mis-press is escapable only
    // by committing the mark it picked — and the control it replaced is gone.
    expect(CODE).toContain('function unpick()');
    expect(CODE).toContain('onClick={unpick}');
    expect(CODE).toContain('parentCopy.attempts.override.cancel');
    // The slot goes with it, or the next restore offers back a mark this parent abandoned.
    expect(CODE).toMatch(/function unpick\(\)[\s\S]*?discardUncommittedState/u);
  });

  it('drops the pick on a refusal it could never recover from', () => {
    // Both 409s are rules about the row rather than about the moment — the mark asked for is
    // already the one that counts, or the question was never judged. Leaving the pick set
    // would leave a Save control that fails identically however many times it is pressed,
    // which is exactly what a stale tab does after somebody else set the same mark.
    expect(CODE).toContain('cause.status === CONFLICT_STATUS) unpick()');
  });

  it('restores a retained pick from the screen’s array, with no request of its own', () => {
    expect(CODE).toContain('for (const slot of retainedSlots)');
    expect(CODE).not.toMatch(/parentApi\s*\.\s*uncommittedState/u);
    // An empty array is the screen's read still in flight *or* a failed one, and neither is
    // "this parent picked nothing" — so neither is latched as an answer.
    expect(CODE).toContain('if (retainedSlots.length === 0) return');
  });

  it('says a failure once, to the region, and renders the copy of it', () => {
    // The sentence already goes to the screen's one live region through `announce`; a
    // `role="alert"` on the node that shows it would reach assistive technology twice for
    // one failure.
    expect(CODE).toContain('announce(sentence)');
    expect(CODE).not.toMatch(/role="alert"|role="status"|aria-live/u);
  });

  it('separates picking from saving, and commits only on the explicit save', () => {
    expect(CODE).toContain('onClick={() => pick(flip)}');
    expect(CODE).toContain('onClick={save}');
    // The pick holds the slot; only `save` calls the write.
    expect(CODE).toMatch(/function pick\([\s\S]*?saveUncommittedState/u);
    // The adjustment is written in exactly one place, and it is after `save` begins: a lazy
    // "not inside pick" match would simply run on into `save` and pass for the wrong reason,
    // so the claim is made positionally instead.
    expect(CODE.match(/overrideGrade/gu)).toHaveLength(1);
    expect(CODE.indexOf('overrideGrade')).toBeGreaterThan(CODE.indexOf('function save()'));
  });

  it('keys the retained slot by the run and the Question together', () => {
    // A scope of the Attempt alone would restore one Question's pick onto every row of the
    // paper. Spelled by the one function that spells it, so the write and the read agree.
    expect(CODE.match(/overrideScope\(attemptId, row\.questionId\)/gu)).toHaveLength(2);
    expect(CODE).toContain("kind: 'GradeOverride'");
  });

  it('decides what a retained slot may become through the pure function', () => {
    expect(CODE).toContain('retainedOverrideOf(slot, scope, row.state)');
    // The reason is re-read from the run and never retained: the payload is the mark alone.
    expect(CODE).toContain('payload: { state }');
    expect(CODE).not.toMatch(/payload: \{[^}]*rationale/u);
  });

  it('never lets a slot read block the row', () => {
    // The recorded mark and the reason are what the parent sees instead, which is the truth
    // about the question: losing a pick is a smaller harm than a row that will not render.
    expect(CODE).toMatch(/\.catch\(\(\) => \{/u);
  });

  it('discards the slot once the mark is committed', () => {
    expect(CODE).toMatch(/discardUncommittedState\(token, id\)\.catch\(\(\) => \{\}\)/u);
  });

  it('swallows a second save while one is out', () => {
    expect(CODE).toContain('if (saving || picked === null) return');
    expect(CODE).toContain('disabled={saving}');
  });

  it('renders the API’s own sentence for a refusal it authored', () => {
    // The two 409s are written once, server-side, and rendered rather than restated.
    expect(CODE).toContain('cause.reason !== null');
    expect(CODE).toContain('parentCopy.attempts.override.failed');
  });

  it('ends Parent View only on the elevation guard’s own refusal', () => {
    expect(CODE).toContain('cause.notElevated || cause.status === 401');
    expect(CODE).toContain('onElevationLost()');
    expect(CODE).not.toMatch(/router\./u);
  });

  it('announces through the screen’s region with the words the row shows', () => {
    expect(CODE).toContain('parentCopy.attempts.override.announcement(');
    // A region of its own would be a second one on one surface.
    expect(CODE).not.toMatch(/aria-live|useAnnounce/u);
  });

  it('hands the whole recalculated run up rather than patching a row', () => {
    // The mark and the score commit together server-side; a row-shaped update would leave the
    // browser to work out the new fraction, which is a second denominator (FR-37).
    expect(CODE).toContain('onAdjusted(view)');
    expect(CODE).not.toMatch(/score|denominator/iu);
  });

  it('moves focus off the control it removes', () => {
    expect(CODE).toContain('tabIndex={-1}');
    expect(CODE).toContain('ref={adjustedSentence}');
  });

  it('offers no dismissal and no second outcome', () => {
    // Nothing authorizes a control that settles a dispute the other way, so there is none and
    // no sentence implying one.
    expect(CODE).not.toMatch(/dismiss|uphold|decline|reject|agree/iu);
  });

  it('writes no user-facing string as a literal', () => {
    expect(CODE.match(/>\s*[A-Z][a-z][^<{}]{3,}</gu)).toBeNull();
  });

  it('carries no cost, tier, model or allowance figure', () => {
    for (const forbidden of [/allowance/iu, /\btier/iu, /costMicros|\bcost\b/iu, /\bmodel\b/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });
});

describe('what the override copy says', () => {
  const override = parentCopy.attempts.override;

  it('names every consequence before the mark is set', () => {
    // Four facts, each one a parent would otherwise assume the other way.
    expect(override.note).toMatch(/recalculates the score/iu);
    expect(override.note).toMatch(/recorded mark and its reason are kept/iu);
    expect(override.note).toMatch(/student sees the new mark/iu);
    expect(override.note).toMatch(/never the reason/iu);
  });

  it('names no model, provider, cost or tier anywhere', () => {
    const everything = [
      override.heading,
      override.reasonControl,
      override.reasonHeading,
      override.noReason,
      override.note,
      override.control('correct'),
      override.save,
      override.restored,
      override.rowParentAdjusted,
      override.announcement(2, 'correct'),
      override.failed,
      override.scoreChanged(1, 2, 4),
    ].join(' ');
    for (const forbidden of [
      /\bAI\b/u,
      /model|provider|gpt|openai/iu,
      /allowance|tier|price|upgrade|\bcost/iu,
    ]) {
      expect(everything).not.toMatch(forbidden);
    }
  });

  it('offers no word for a dismissal', () => {
    const everything = Object.values(override)
      .map((value) =>
        typeof value === 'function'
          ? String(value(1 as never, 'correct' as never, 4 as never))
          : typeof value === 'string'
            ? value
            : Object.values(value).join(' '),
      )
      .join(' ');
    expect(everything).not.toMatch(/dismiss|uphold|decline|reject the report/iu);
  });

  it('says the student may be left as they are, so a parent is not pressed', () => {
    expect(override.disputeAwaiting).toMatch(/leave it as it is/iu);
  });

  it('states a changed score as two counts over one total, and computes nothing', () => {
    expect(override.scoreChanged(11, 12, 15)).toBe(
      '11 of 15 marked correct, adjusted by parent to 12 of 15.',
    );
    expect(override.scoreChanged(11, 12, 15)).toMatch(/adjusted by parent/iu);
    expect(override.scoreChanged(11, 12, 15)).not.toMatch(/%|\+1/u);
  });

  it('gives each mark a word of the parent’s own, not the enum’s', () => {
    expect(override.grade).toEqual({
      Correct: 'correct',
      Incorrect: 'not correct',
      Unanswered: 'unanswered',
      Ungraded: 'not graded yet',
    });
  });
});
