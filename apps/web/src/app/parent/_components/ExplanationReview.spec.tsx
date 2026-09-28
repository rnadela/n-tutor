import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'ExplanationReview.tsx'), 'utf8');
/** The file with its prose stripped, so a comment cannot satisfy an assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * The inline region beneath a parent's answer-key row.
 *
 * `apps/web` runs its unit suite with `environment: 'node'`, so a stateful component's
 * rules are asserted on the source that states them, exactly as the drafts and
 * generate screens' specs do. The decision this component renders is a pure function
 * with its own spec (`lib/explanation-review.spec.ts`), and what a press actually does
 * in a browser is proved by `e2e/tests/parent-explanation-review.spec.ts`.
 */
describe('what a parent can do with one Explanation', () => {
  it('makes exactly three `parentApi.` calls, with a press behind every one', () => {
    // The prose arrives with the Attempt, in the screen's own read, so nothing here reads
    // on mount. The third call is the reconcile, and it is reachable only from a decision
    // that was refused.
    const calls = CODE.match(/parentApi\.\w+/gu) ?? [];
    expect(calls).toEqual([
      'parentApi.flagExplanation',
      'parentApi.disposeExplanationFlag',
      'parentApi.attemptExplanations',
    ]);
    expect(CODE.indexOf('parentApi.attemptExplanations')).toBeGreaterThan(
      CODE.indexOf('cause.status === CONFLICT_STATUS'),
    );
  });

  it('catches this region up when a decision is refused as already recorded', () => {
    // Without it, both controls stay on screen offering a decision the API will refuse for
    // ever, and the parent cannot learn which one was actually recorded short of reloading
    // the whole paper.
    expect(CODE).toContain('cause.status === CONFLICT_STATUS');
    expect(CODE).toContain('parentApi.attemptExplanations(token, attemptId)');
    expect(CODE).toContain('views.find((view) => view.questionId === questionId)');
    expect(CODE).toContain('if (current !== undefined) onFlagged(current);');
  });

  it('reconciles only on the conflict, and announces nothing for it', () => {
    // Every other failure is transient and leaves the controls exactly where they were, to
    // be pressed again — and the refusal sentence is already in the live region, so a
    // second announcement for a read the parent never asked for would narrate the screen's
    // own housekeeping at them.
    const reconcile = CODE.slice(
      CODE.indexOf('if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS)'),
    );
    expect(reconcile).not.toContain('announce(');
    expect(reconcile).not.toContain('setDecisionFailed');
    // And a failed reconcile cannot replace the sentence that is already on screen.
    expect(reconcile).toContain('() => {},');
  });

  it('never generates an Explanation, on a press or otherwise', () => {
    // A parent reading an Attempt with ten unexplained Questions would otherwise bill
    // ten provider calls against their own Explanation Allowance for prose nobody
    // asked for — and the child would find it already there, never having asked.
    expect(CODE).not.toMatch(/explainQuestion/u);
    expect(CODE).not.toMatch(/ExplainPanel/u);
    // Nothing runs on mount that could reach the network. There *is* one effect — it
    // moves focus when the control a parent pressed stops existing — and the claim is
    // that it talks to nothing: the only request in the file is inside `flag()`, which
    // only a press calls.
    const effect = CODE.slice(CODE.indexOf('useEffect('), CODE.indexOf('}, [state]);'));
    expect(effect).toContain('focus()');
    expect(effect).not.toContain('parentApi');
    expect(CODE.indexOf('parentApi.flagExplanation')).toBeGreaterThan(
      CODE.indexOf('function flag()'),
    );
  });

  it('moves focus to the sentence that replaced the control, and only on a press', () => {
    // Reporting unmounts the control, and a browser drops focus to `document.body` when
    // the focused element disappears — which puts a keyboard user out of the paper
    // entirely, mid-list. Focus moves deliberately, to the outcome they need to read.
    expect(CODE).toContain('tabIndex={-1}');
    expect(CODE).toContain('ref={flaggedSentence}');
    expect(CODE).toContain('flaggedSentence.current?.focus()');
    // Guarded on this component's own press, so an Attempt opened with three
    // explanations already reported does not pull focus to one of them on load.
    expect(CODE).toContain('pressed.current = true');
    expect(CODE).toContain("if (state !== 'flagged' || !pressed.current) return;");
  });

  it('shows the reported state without a date rather than the words “Invalid Date”', () => {
    // `reviewStateFor` decides on the field being present — deliberately, and its own
    // spec pins that — so an unparsable instant is still a flag. It is only the date
    // that cannot be stated, and `new Date('').toLocaleString()` is the literal words
    // "Invalid Date", which read as a fault in the report rather than in a string.
    expect(CODE).toContain('readableInstant(');
    expect(CODE).toContain('parentCopy.attempts.flaggedUndated');
    expect(CODE).not.toMatch(/new Date\([^)]*\)\.toLocaleString/u);
  });

  it('heads only the branch that has prose to head', () => {
    // On a twenty-Question paper where the child asked about two, an unconditional
    // heading gives a screen reader eighteen identical headings over eighteen
    // statements that the child was told nothing.
    // The `absent` arm alone, which ends where the alternative begins.
    const absent = CODE.slice(CODE.indexOf("state === 'absent' ? ("), CODE.indexOf(') : ('));
    expect(absent).toContain('explanation-not-asked');
    expect(absent).not.toContain('explanation-heading');
    expect(CODE).toContain('data-testid="explanation-heading"');
    expect(CODE.indexOf('data-testid="explanation-heading"')).toBeGreaterThan(
      CODE.indexOf("state === 'absent'"),
    );
  });

  it('says nothing was explained rather than offering to explain it', () => {
    expect(CODE).toContain("state === 'absent'");
    expect(CODE).toContain('parentCopy.attempts.nothingExplained');
    // And that branch carries no control at all: the flag button is inside the
    // branch that has an Explanation to be about.
    const absentBranch = CODE.slice(
      CODE.indexOf("state === 'absent'"),
      CODE.indexOf('explanation!.body'),
    );
    expect(absentBranch).not.toContain('explanation-flag');
  });

  it('drops the flag control once flagged, rather than leaving an inert one', () => {
    // There is no un-flagging: a record of a concern is not a toggle, so a control
    // left on screen would offer an action that does nothing.
    expect(CODE).toContain("state === 'flagged' ?");
    expect(CODE).toContain('data-testid="explanation-flagged"');
    expect(CODE).toContain('data-testid="explanation-flag"');
    // The flagged arm comes first and the control is the alternative to it.
    expect(CODE.indexOf('explanation-flagged')).toBeLessThan(CODE.indexOf('"explanation-flag"'));
  });

  it('states what flagging does, in words, beside the control', () => {
    // Suppression is the act that changes what a child is served, and it is not this
    // one. A confirmation dialog here would teach a parent otherwise.
    expect(CODE).toContain('parentCopy.attempts.flagNote');
    // Narrowed away from a bare `/confirm/`, because the copy legitimately contains the
    // word — but still catching every spelling of the blocking native dialog this
    // assertion exists to forbid: a bare `confirm(...)` and the two qualified forms. The
    // lookbehind excludes `.` so a copy member read as `something.confirm(...)` could
    // never be mistaken for one, which is why the qualified spellings are named outright
    // rather than left to it. `decide('Confirmed')` and `parentCopy.attempts.confirm` are
    // not calls and match nothing here.
    expect(CODE).not.toMatch(
      /Dialog|Modal|window\.confirm|globalThis\.confirm|(?<![A-Za-z.])confirm\(/u,
    );
  });

  it('draws the child’s report as its own fact, never folded into the parent’s', () => {
    // Two people raising a concern, and two independent pure decisions. A region that
    // read either one for the other would tell a parent their child said something they
    // did not.
    expect(CODE).toContain('const state = reviewStateFor(explanation);');
    expect(CODE).toContain('const studentState = studentFlagStateFor(explanation);');
    expect(CODE).toContain('data-testid="explanation-student-flag"');
    // And nothing here re-derives either from the raw fields.
    expect(CODE).not.toMatch(/explanation\?\.studentFlagDisposition ===/u);
  });

  it('shows the child’s report only where there is one', () => {
    // On a twenty-Question paper where the child reported two, an unconditional block
    // would give a screen reader eighteen statements that nothing was reported.
    expect(CODE).toContain("{studentState !== 'none' && (");
  });

  it('offers exactly two decisions, and only while none is recorded', () => {
    // A closed set of two, and the first decision stands — so a control after one is
    // recorded would be an offer to do something the API refuses with a 409.
    expect(CODE).toContain("studentState === 'awaiting' ? (");
    expect(CODE).toContain("decide('Confirmed')");
    expect(CODE).toContain("decide('Dismissed')");
    expect(CODE.match(/decide\('\w+'\)/gu)).toHaveLength(2);
    // The decided arm carries the outcome and no control at all.
    const decidedArm = CODE.slice(CODE.indexOf('data-testid="explanation-decided"'));
    expect(decidedArm.slice(0, 400)).not.toContain('<Button');
  });

  it('says in words that confirming sends the report on and does not remove anything', () => {
    // The assumption a parent would otherwise make is that agreeing takes the
    // explanation away from their child. It does not, and the note says so *before*
    // either control is pressed.
    expect(CODE).toContain('parentCopy.attempts.dispositionNote');
    expect(CODE.indexOf('parentCopy.attempts.dispositionNote')).toBeLessThan(
      CODE.indexOf("decide('Confirmed')"),
    );
    // And nothing here suppresses, hides or regenerates: there is no such call to make.
    expect(CODE).not.toMatch(/suppress|regenerat|explainQuestion/iu);
  });

  it('moves focus to the sentence that replaced the two controls', () => {
    // Deciding unmounts both, and a browser drops focus to `document.body` when the
    // focused element disappears — out of the paper, mid-list.
    expect(CODE).toContain('ref={decidedSentence}');
    expect(CODE).toContain('decidedSentence.current?.focus()');
    // Guarded on this component's own press, so an Attempt opened with three decisions
    // already made does not pull focus to one of them on load.
    expect(CODE).toContain('decided.current = true');
    expect(CODE).toContain('!decided.current');
  });

  it('issues one decision per press, and renders the API’s own refusal', () => {
    // A double-tap would otherwise issue two calls whose responses land in either order.
    // A second, *different* decision is refused with a 409 whose sentence is written once,
    // in the API's policy file — rendered here rather than restated.
    expect(CODE).toContain('if (deciding || explanation === undefined) return;');
    expect(CODE).toContain('disabled={deciding}');
    expect(CODE).toContain('parentCopy.attempts.disposeFailed');
    expect(CODE).toContain('data-testid="explanation-dispose-failed"');
  });

  it('announces the sentence it displays, once, through the screen’s region', () => {
    // One surface has one live region and the screen owns it, which is why `announce`
    // is a prop rather than a hook of this component's.
    expect(CODE).toContain('announce: (text: string) => void');
    expect(CODE).not.toMatch(/useAnnounce/u);
    const announced = CODE.match(/announce\((?!text)/gu) ?? [];
    // Four call sites — each write's outcome and each write's failure — and every one
    // announces the sentence it also renders.
    expect(announced).toHaveLength(4);
    expect(CODE).toContain('announce(parentCopy.attempts.flagAnnouncement(ordinal))');
    expect(CODE).toContain('parentCopy.attempts.confirmAnnouncement(ordinal)');
    expect(CODE).toContain('parentCopy.attempts.dismissAnnouncement(ordinal)');
    expect(CODE).toContain('announce(sentence)');
    expect(CODE).toContain('setFailed(sentence)');
    expect(CODE).toContain('setDecisionFailed(sentence)');
  });

  it('issues one request per press, however fast the pressing', () => {
    // A double-tap would otherwise issue two calls whose responses land in either
    // order — and announce twice, telling a parent something happened twice.
    expect(CODE).toContain('if (flagging || explanation === undefined) return;');
    expect(CODE).toContain('disabled={flagging}');
  });

  it('ends Parent View only on the guard’s own refusal, on both writes', () => {
    // A transient failure is a sentence in this region with the control still there
    // to press. An expired elevation is not about this Explanation — and the decision
    // route is a write too, so a check it did not carry would be the one that mattered.
    expect(CODE.match(/cause\.notElevated \|\| cause\.status === 401/gu)).toHaveLength(2);
    expect(CODE.match(/onElevationLost\(\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(CODE).toContain('parentCopy.attempts.flagFailed');
  });

  it('draws the stored prose through the one renderer of segments', () => {
    // A fraction arrives as structure and keeps its spoken reading (AD-32).
    expect(CODE).toContain('<RichText segments={explanation!.body} />');
  });

  it('shows a decision without a date rather than the words “Invalid Date”', () => {
    // A decided report whose instant will not parse still says which decision was made —
    // that is the fact — and only the date is unstateable.
    expect(CODE).toContain('parentCopy.attempts.confirmedUndated');
    expect(CODE).toContain('parentCopy.attempts.dismissedUndated');
    expect(CODE).toContain('parentCopy.attempts.studentFlaggedUndated');
    expect(CODE).not.toMatch(/new Date\([^)]*\)\.toLocaleString/u);
  });

  it('sits at h5, under the row’s own h4', () => {
    // An explanation belongs to its Question. A heading at `h4` would make it a
    // sibling of the row it sits inside, and an outline that lies is worse than none.
    expect(CODE).toContain('component="h5"');
    expect(CODE).not.toContain('component="h4"');
  });

  it('names no cost, tier, model or allowance anywhere', () => {
    // A parent reading an Explanation is spending nothing (AD-20, AD-26).
    for (const forbidden of [/allowance/iu, /\btier\b/iu, /costMicros/iu, /rationale/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('every sentence it shows is a member of `parentCopy.attempts`', () => {
    // Third person about the child, never addressed to them (AD-32).
    expect(CODE).not.toMatch(/studentCopy/u);
    const literals = CODE.match(/>\s*[A-Z][a-z]+ [a-z]/gu) ?? [];
    expect(literals).toEqual([]);
  });
});
