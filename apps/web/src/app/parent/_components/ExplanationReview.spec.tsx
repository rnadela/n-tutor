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
  it('makes exactly one `parentApi.` call, and it is the flag', () => {
    // The prose arrives with the Attempt, in the screen's own read. A second call
    // here would be a second read of rows the screen already holds.
    const calls = CODE.match(/parentApi\.\w+/gu) ?? [];
    expect(calls).toEqual(['parentApi.flagExplanation']);
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
    expect(CODE).not.toMatch(/Dialog|confirm/u);
  });

  it('announces the sentence it displays, once, through the screen’s region', () => {
    // One surface has one live region and the screen owns it, which is why `announce`
    // is a prop rather than a hook of this component's.
    expect(CODE).toContain('announce: (text: string) => void');
    expect(CODE).not.toMatch(/useAnnounce/u);
    const announced = CODE.match(/announce\((?!text)/gu) ?? [];
    // Two call sites — the outcome and the failure — and each announces the sentence
    // it also renders.
    expect(announced).toHaveLength(2);
    expect(CODE).toContain('announce(parentCopy.attempts.flagAnnouncement(ordinal))');
    expect(CODE).toContain('announce(sentence)');
    expect(CODE).toContain('setFailed(sentence)');
  });

  it('issues one request per press, however fast the pressing', () => {
    // A double-tap would otherwise issue two calls whose responses land in either
    // order — and announce twice, telling a parent something happened twice.
    expect(CODE).toContain('if (flagging || explanation === undefined) return;');
    expect(CODE).toContain('disabled={flagging}');
  });

  it('ends Parent View only on the guard’s own refusal', () => {
    // A transient failure is a sentence in this region with the control still there
    // to press. An expired elevation is not about this Explanation.
    expect(CODE).toContain('cause.notElevated || cause.status === 401');
    expect(CODE).toContain('onElevationLost()');
    expect(CODE).toContain('parentCopy.attempts.flagFailed');
  });

  it('draws the stored prose through the one renderer of segments', () => {
    // A fraction arrives as structure and keeps its spoken reading (AD-32).
    expect(CODE).toContain('<RichText segments={explanation!.body} />');
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
