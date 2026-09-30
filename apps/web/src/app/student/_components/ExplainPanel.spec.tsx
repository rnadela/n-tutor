import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'ExplainPanel.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this component
 * is required to explain at length why nothing polls, why nothing prefetches and
 * why a failure cannot take the results screen down — and a bare
 * `not.toContain('poll')` over the raw source would make writing that explanation
 * a test failure.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * Asserted over the component's own source, because `apps/web` runs its specs with
 * `environment: 'node'` and no DOM: a component that presses, reads, announces and
 * holds state cannot be rendered here. The pure half of its behaviour is
 * `lib/explain-panel.ts` and has a function spec; the clicking and keyboard claims
 * are `e2e/tests/student-explanations.spec.ts`'s; what is left — that it asks once,
 * asks only when pressed, and says only what `studentCopy` says — is what this pins.
 */
describe('what asks for an explanation', () => {
  it('makes exactly two student-scoped calls: ask, and report', () => {
    expect(CODE).toContain('parentApi.explainQuestion(attemptId, questionId)');
    expect(CODE).toContain('parentApi.flagExplanationAsStudent(attemptId, questionId)');
    // Two, and no third. In particular nothing parent-scoped: no read of a parent's
    // flag, no disposition and no list.
    expect(CODE.match(/parentApi\.\w+/gu)).toEqual([
      'parentApi.explainQuestion',
      'parentApi.flagExplanationAsStudent',
    ]);
    // No bearer and no parent-scoped member: the binding names the child.
    expect(CODE).not.toMatch(/Authorization|elevat/iu);
    // And nothing here can learn what a grown-up decided (AD-20, AD-26).
    expect(CODE).not.toMatch(/disposition|Confirmed|Dismissed|parentFlagged/iu);
  });

  it('never polls, never prefetches and never retries on its own', () => {
    // The first ask bills a provider call. A timer here would bill one per
    // Question per visit, with nobody having asked for any of them.
    expect(CODE).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|poll|prefetch/iu);
    // And nothing asks on mount: the only six `useEffect`s here are the two announcements,
    // the two focus moves, the one that adopts the removed prop when it arrives, and the one
    // that mirrors it into a ref for the two requests below to read live — and none of them
    // touches the API — the prop is handed down from the screen's own attempt-scoped read, so
    // adopting it costs no request.
    expect(CODE.match(/useEffect\(/gu)).toHaveLength(6);
    expect(CODE).not.toMatch(/useEffect\([\s\S]{0,400}?explainQuestion/u);
    expect(CODE).not.toMatch(/useEffect\([\s\S]{0,400}?flagExplanationAsStudent/u);
    expect(CODE).not.toMatch(/useEffect\([\s\S]{0,400}?parentApi\./u);
  });

  it('decides what a report press means through the pure function, not inline', () => {
    // The rules that decide whether anything leaves the device — never send a second
    // report for a concern already recorded, never start a second request while one is
    // out, never send with no connection — live where they can be asserted with no DOM.
    expect(CODE).toContain('flagDecision({ online: navigator.onLine, state, sending })');
    expect(CODE).toContain(
      "if (decision === 'noProse' || decision === 'already' || decision === 'busy') return;",
    );
  });

  it('touches nothing about the explanation on any report outcome', () => {
    // The prose stays rendered and the panel stays open whatever happens: the paragraph
    // may well be right, and taking it off screen would be this panel deciding something
    // only a grown-up can.
    const report = CODE.slice(
      CODE.indexOf('const report = useCallback('),
      CODE.indexOf('const announced'),
    );
    // The only `setState` this handler makes writes the same `loaded` state back, with the
    // report's instant on it. Every other outcome is a `ReportOutcome` beside the prose,
    // which is why the panel's own union cannot be made to say "this failed" about a
    // paragraph that is still perfectly readable.
    // Two, and the second is the one case where the explanation legitimately leaves the
    // screen: a grown-up removed it between the prose arriving and this press. Nothing was
    // recorded, so nothing is announced as recorded — the panel becomes the removed state,
    // which is the true thing to show and the one thing this panel is allowed to learn.
    expect(report.match(/setState\(\{\s*\n?\s*kind: '(\w+)'/gu)?.length).toBe(2);
    expect(report).toMatch(/setState\(\{\s*\n?\s*kind: 'loaded'/u);
    expect(report).toMatch(/setState\(\{\s*kind: 'suppressed' \}\)/u);
    expect(report).toContain('if (value.suppressed || suppressedRef.current)');
    // And it never closes the panel or touches the prose it was handed.
    expect(report).not.toContain('setOpen');
    expect(report).not.toMatch(/state\.body/u);
  });

  it('moves focus to the sentence that replaced the control, and only on a press', () => {
    // Reporting unmounts the control, and a browser drops focus to `document.body` when
    // the focused element disappears — which puts a keyboard user out of the paper
    // entirely, mid-list. Focus moves deliberately, to the outcome they need to read.
    expect(CODE).toContain('tabIndex={-1}');
    expect(CODE).toContain('ref={flagged}');
    expect(CODE).toContain('flagged.current?.focus()');
    // Guarded on this panel's own press, so re-opening a panel reported last week does
    // not take the keyboard from a child who has not touched anything.
    expect(CODE).toContain('pressed.current = true');
    expect(CODE).toContain('if (flaggedAtOf(state) === null || !pressed.current) return;');
    // And the focus effect talks to nothing: the only requests are inside the handlers.
    const focusEffect = CODE.slice(
      CODE.indexOf('if (flaggedAtOf(state) === null'),
      CODE.indexOf('}, [state]);'),
    );
    expect(focusEffect).not.toContain('parentApi');
  });

  it('drops the report control once reported, rather than leaving an inert one', () => {
    // There is no un-reporting: a record of a concern is not a toggle, so a control left
    // on screen would offer an action that does nothing.
    expect(CODE).toContain('state.studentFlaggedAt === null ? (');
    expect(CODE).toContain('data-testid="explain-flag"');
    expect(CODE).toContain('data-testid="explain-flagged"');
  });

  it('puts the report control inside the loaded branch and nowhere else', () => {
    // A panel with nothing in it has nothing to be wrong about.
    expect(CODE.indexOf('data-testid="explain-flag"')).toBeGreaterThan(
      CODE.indexOf("state.kind === 'loaded' && ("),
    );
    expect(CODE.indexOf('data-testid="explain-flag"')).toBeGreaterThan(
      CODE.indexOf('data-testid="explain-body"'),
    );
  });

  it('shows the reported state without a date rather than the words “Invalid Date”', () => {
    // A report whose instant will not parse is still a report; only the date is
    // unstateable, and a screen reader says those two words out loud.
    expect(CODE).toContain('studentCopy.results.explain.flaggedUndated');
    expect(CODE).toContain('Number.isNaN(when.getTime())');
  });

  it('decides what a press means through the pure function, not inline', () => {
    // The rules that cost money — never ask twice for prose already held, never
    // start a second request while one is out, never send with no connection —
    // live where they can be asserted without a DOM.
    expect(CODE).toContain('explainDecision({ online: navigator.onLine, state })');
    // `removed` is here beside `stored` and `busy`, and the rule that produces it is in
    // `explainDecision` ahead of every other arm: a press must never leave the device for a
    // Question a grown-up has settled, whatever the connection is doing.
    expect(CODE).toContain(
      "if (decision === 'stored' || decision === 'removed' || decision === 'busy') return;",
    );
  });

  it('withholds the control entirely where a grown-up removed the explanation', () => {
    // **In place of the control, not beside it and not disabled.** A child cannot undo this,
    // so an inert control or a retry that could never help would be an offer of something
    // that does nothing — and there is no report control either.
    expect(CODE).toContain("state.kind === 'suppressed' ? (");
    expect(CODE).toContain('data-testid="explain-suppressed"');
    expect(CODE).toContain('studentCopy.results.explain.suppressed');
    expect(CODE).toContain('studentCopy.results.explain.suppressedAnnouncement(ordinal)');
    // The control is the alternative to it, so it is not rendered in that state at all.
    expect(CODE.indexOf('data-testid="explain-suppressed"')).toBeLessThan(
      CODE.indexOf('data-testid="explain-control"'),
    );
    // And the disclosure draws nothing there: the two lines stand on their own.
    expect(CODE).toContain("{open && state.kind !== 'suppressed' && (");
  });

  it('adopts the removed prop when it arrives, not only at mount', () => {
    // The initializer alone is not enough, and the gap it leaves is the whole guarantee: the
    // results screen makes two independent reads, rows mount as soon as the answer key lands,
    // and a panel that mounted before the suppression read resolved would keep `idle` and
    // draw `Explain this` for a Question the parent removed. Which control a child sees would
    // be decided by which request won.
    expect(CODE).toContain('}, [suppressed]);');
    expect(CODE).toContain(
      "setState((held) => (held.kind === 'suppressed' ? held : { kind: 'suppressed' }))",
    );
    // The prop is read outside the initializer, which is the claim: two sites, not one.
    expect(CODE.match(/\bsuppressed\b(?!:)/gu)?.length).toBeGreaterThan(1);
    // And it only ever moves one way. Suppression is not reversible, and the prop goes false
    // on the retry path — where the screen resets the set before re-reading — so an arm that
    // put the control back would be a child un-doing a parent's decision by pressing Retry.
    const adopt = CODE.slice(
      CODE.indexOf('if (!suppressed) return;'),
      CODE.indexOf('}, [suppressed]);'),
    );
    expect(adopt).not.toMatch(/kind: 'idle'/u);
  });

  it('moves focus to the sentence that replaced the control it settled', () => {
    // A press on either control can come back saying a grown-up removed this explanation, and
    // both controls unmount when it does — dropping a keyboard user to `document.body`, out of
    // the paper mid-list. The same failure this file already solves for the report control.
    expect(CODE).toContain('ref={removedLine}');
    expect(CODE).toContain('removedLine.current?.focus()');
    // Guarded on this panel's own press, so a panel that mounted already removed — or one the
    // late-arriving prop adopted — does not take the keyboard from a child who touched nothing.
    expect(CODE).toContain('settled.current = true');
    expect(CODE).toContain("if (state.kind !== 'suppressed' || !settled.current) return;");
  });

  it('gives the removed state no error severity, no glyph and no retry', () => {
    // Nothing failed. A grown-up made a decision, and a screen that framed it as a fault
    // would be arguing with them at a child.
    const removed = CODE.slice(
      CODE.indexOf('data-testid="explain-suppressed"'),
      CODE.indexOf('data-testid="explain-control"'),
    );
    expect(removed).not.toContain('<Alert');
    expect(removed).not.toContain('severity');
    expect(removed).not.toContain('explain-retry');
    expect(removed).not.toContain('explain-flag');
    // Product voice in the dashboard face, never the generated-prose role.
    expect(removed).toContain('typeRoles.caption');
    expect(removed).not.toContain('typeRoles.explanationBody');
  });

  it('marks a replacement plainly, and only where there is one', () => {
    // So a child re-reading a question they asked about twice is not left wondering why the
    // words changed. It says nothing about who asked for it, why, or what it replaced.
    expect(CODE).toContain('{state.replacement && (');
    expect(CODE).toContain('studentCopy.results.explain.replacementNote');
    expect(CODE).toContain('data-testid="explain-replacement"');
  });

  it('never learns or relays a grown-up’s words, a reason or an instant', () => {
    // The whole of what the child is told is two sentences of `studentCopy`'s. Nothing
    // parent-scoped has anywhere on this surface to arrive (AD-20, AD-26).
    for (const forbidden of [
      /suppressedAt/u,
      /canSuppress/u,
      /generation/u,
      /parentFlag/iu,
      /disposition/iu,
      /allowance/iu,
      /\btier\b/iu,
      /rationale/iu,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('reads the connection at each press rather than latching it', () => {
    // A held flag behind listeners is a second thing that can be wrong; what
    // matters is whether there is a connection when something would be sent. Both
    // presses read it, and neither holds it.
    expect(CODE.match(/navigator\.onLine/gu)).toHaveLength(2);
    expect(CODE).not.toMatch(/addEventListener/u);
  });

  it('is a disclosure, with the state carried in ARIA rather than only in colour', () => {
    expect(CODE).toContain('aria-expanded={open}');
    // Only while the panel is mounted: a collapsed one is unmounted, and pointing
    // `aria-controls` at an absent id is read inconsistently.
    expect(CODE).toContain('aria-controls={open ? panelId : undefined}');
    expect(CODE).toContain('id={panelId}');
  });

  it('speaks each outcome once, not twice', () => {
    // The note the live region carries must not also be its own implicit region:
    // `role="status"` on that alert would have a screen reader say it twice.
    const noteAlert = CODE.slice(
      CODE.indexOf('data-testid="explain-note"') - 400,
      CODE.indexOf('data-testid="explain-note"'),
    );
    expect(noteAlert).not.toMatch(/role="status"/u);
    // The report's own failure sentence is in the live region too, so its alert carries
    // no implicit region either.
    const flagAlert = CODE.slice(
      CODE.indexOf('data-testid="explain-flag-failed"') - 400,
      CODE.indexOf('data-testid="explain-flag-failed"'),
    );
    expect(flagAlert).not.toMatch(/role="status"/u);
    // Two call sites, one per effect, and neither speaks anything the panel does not show.
    expect(CODE.match(/announce\(/gu)).toHaveLength(2);
  });

  it('is never a modal and never a route of its own', () => {
    // UX-DR16: the question, both answers and the reason belong on screen together.
    expect(CODE).not.toMatch(/Dialog|Modal|Drawer|Popover|href=/u);
    // The one navigation is the binding refusal every read on this surface makes, and
    // both presses make exactly that one and no other.
    expect(CODE.match(/router\.replace\('\/auth\/sign-in'\)/gu)).toHaveLength(2);
    expect(CODE.match(/router\.\w+/gu)?.every((call) => call === 'router.replace')).toBe(true);
  });

  it('keeps every tappable thing at the surface’s tap-target floor', () => {
    // The disclosure, the retry and the report control.
    expect(CODE.match(/minHeight: comfortableDensity\.tapTarget/gu)).toHaveLength(3);
    // No literal pixel figure anywhere: the floor is a token (UX-DR10).
    expect(CODE).not.toMatch(/minHeight: ['"]?\d/u);
  });

  it('animates nothing, so there is no duration to get wrong', () => {
    expect(CODE).not.toMatch(/Collapse|Fade|Grow|Zoom|transition|animate|keyframes/iu);
    // And no literal millisecond figure, which is the rule a `motion.*` token exists
    // to keep (UX-DR37).
    expect(CODE).not.toMatch(/\d+ms|duration: \d/u);
  });

  it('offers a retry only as a person pressing, in every refusing state', () => {
    expect(CODE).toContain('onClick={ask}');
    expect(CODE).toContain('data-testid="explain-retry"');
    expect(CODE).not.toMatch(/attempt(s|Count)|maxAttempts|backoff/iu);
  });

  it('states every sentence out of studentCopy and writes none of its own', () => {
    // No literal string a child could read: every one is a member, so the four
    // states cannot come to disagree with the rest of the surface.
    expect(CODE).toMatch(/studentCopy\.results\.explain\.control/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.heading/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.idle/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.loading/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.failed/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.offline/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.atCap\(/u);
    expect(CODE).toContain('studentCopy.retry');
    // The report's own six, for the same reason.
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flagControl/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flagNote/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flagged\(/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flaggedUndated/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flagFailed/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flagOffline/u);
    expect(CODE).toMatch(/studentCopy\.results\.explain\.flagAnnouncement\(ordinal\)/u);
  });

  it('announces once per outcome, through the one region, with the sentence it displays', () => {
    expect(CODE).toContain('useAnnounce()');
    expect(CODE.match(/announce\(/gu)).toHaveLength(2);
    expect(CODE).toContain('const sentence = spokenOf(state, ordinal);');
    // The report's outcome carries its own sentence, so what is spoken and what is shown
    // are one string.
    expect(CODE).toContain('announce(reported.sentence);');
    // And a recorded report does not re-announce that the explanation arrived: the
    // prose did not change.
    expect(CODE).toContain('flaggedAtOf(previous) !== flaggedAtOf(state)');
    // The `loaded` sentence is rendered as well as spoken, from the one member both
    // come from.
    expect(CODE.match(/studentCopy\.results\.explain\.announcement\(ordinal\)/gu)).toHaveLength(2);
  });

  it('renders the prose through the one renderer of stored segments', () => {
    // A fraction arrives as structure and keeps its spoken reading (AD-32).
    expect(CODE).toContain('<RichText segments={state.body} />');
    expect(CODE).not.toMatch(/dangerouslySetInnerHTML|\.join\(''\)/u);
  });

  it('renders the refusal the API authored rather than restating it', () => {
    // The cap sentence is written once, in the API's policy file. A second spelling
    // here would be two answers to one refusal.
    expect(CODE).toContain("setState({ kind: 'atCap', limitSentence: cause.reason })");
    expect(CODE).toContain('cause.status === CONFLICT_STATUS');
  });

  it('drops the collapsed panel from the tree rather than hiding it', () => {
    // Prose left in the DOM is prose a screen reader reaches and a child cannot see.
    expect(CODE).toContain('{open && ');
    expect(CODE).not.toMatch(/display: 'none'|hidden=\{/u);
  });

  it('sits at h5, inside the row it belongs to rather than beside it', () => {
    // The row's own heading is `h4`. An explanation is part of its Question.
    expect(CODE).toContain('component="h5"');
    expect(CODE).not.toMatch(/component="h[234]"/u);
  });
});

describe('what the explain copy is allowed to say', () => {
  const copy = studentCopy.results.explain;
  /**
   * An opaque stand-in for the API's own at-cap sentence, and deliberately not a
   * copy of it: the sentence is written once, in the API's `allowance` policy
   * file, and a web test carrying its words would be a second spelling that drifts
   * the moment the first one is reworded. What these cases assert is what this
   * module wraps it in, which is the same whatever it says.
   */
  const API_SENTENCE = 'THE SENTENCE THE API HANDED OVER.';
  const sentences = [
    copy.control,
    copy.heading,
    copy.idle,
    copy.loading,
    copy.failed,
    copy.offline,
    copy.atCap(null),
    copy.atCap(API_SENTENCE),
    copy.announcement(1),
    copy.announcement(4),
    copy.flagControl,
    copy.flagNote,
    copy.flagged('28 September 2026, 10:00'),
    copy.flaggedUndated,
    copy.flagFailed,
    copy.flagOffline,
    copy.flagAnnouncement(1),
    copy.flagAnnouncement(4),
  ];

  it('never counts an allowance down in front of a child', () => {
    // An allowance is a billing fact (AD-26). No running total, no badge, no
    // "3 left" — and the refusal names the plan without naming how far.
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\bleft\b.*\d|\d+\s*(of|\/)\s*\d+|remaining/iu);
      expect(sentence).not.toMatch(/\bFree\b|\bPlus\b|\bFamily\b|upgrade|plan costs|\$|£/iu);
    }
  });

  it('never exclaims, apologises or blames the child', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toContain('!');
      expect(sentence).not.toMatch(/sorry|apolog|your fault|you should have|too many/iu);
    }
  });

  it('keeps the three unhappy states three different sentences', () => {
    // "No connection" is a thing a child can act on and "the plan ran out" is not;
    // collapsing either into "it did not work" would send them pressing at a wall.
    const unhappy = new Set([copy.failed, copy.offline, copy.atCap(null)]);
    expect(unhappy.size).toBe(3);
  });

  it('puts the blame for the cap on the plan', () => {
    expect(copy.atCap(null)).toMatch(/Your plan/u);
    expect(copy.atCap(API_SENTENCE)).toMatch(/not about you/u);
    // And says the work already done is still readable.
    expect(copy.atCap(null)).toMatch(/still here/u);
  });

  it('hands the API’s sentence through whole rather than rewriting it', () => {
    // The limit and the reset date are the API's to state and are written once, in
    // its `allowance` policy file. This module's job is to wrap that sentence, so
    // the sentence has to survive verbatim — a reword, a truncation or a re-render
    // here would be a second answer to one refusal. Asserted against an opaque
    // sentinel, so this case cannot drift when the API's wording changes.
    const wrapped = copy.atCap(API_SENTENCE);
    expect(wrapped).toContain(API_SENTENCE);
    // And the wrapper is additive: the child-facing clause is this module's own and
    // sits beside the API's words rather than replacing any of them.
    expect(wrapped).toMatch(/not about you/u);
    expect(wrapped).toMatch(/still here/u);
    expect(wrapped.length).toBeGreaterThan(API_SENTENCE.length);
    // The fallback is the only branch that writes a sentence of its own, and it is
    // reached only when the refusal arrived without one.
    expect(copy.atCap(null)).not.toContain(API_SENTENCE);
  });

  it('names the Question in the announcement, from a handed-in ordinal', () => {
    expect(copy.announcement(7)).toContain('question 7');
    expect(copy.announcement(7)).not.toBe(copy.announcement(8));
  });

  it('uses one label for both directions of the disclosure', () => {
    // `aria-expanded` says which way the press goes; a label that changed under the
    // finger would be a second, contradictory account of it.
    expect(typeof copy.control).toBe('string');
  });

  it('promises a grown-up will read it, and promises nothing beyond that', () => {
    // A child told an outcome nobody has decided on would be waiting for something that
    // may never come. What is promised is exactly what is true.
    expect(copy.flagNote).toMatch(/grown-up/u);
    expect(copy.flagAnnouncement(3)).toMatch(/grown-up/u);
    for (const sentence of [copy.flagControl, copy.flagNote, copy.flagAnnouncement(3)]) {
      expect(sentence).not.toMatch(
        /operator|admin|queue|review team|\bwe\b|support|ticket|fixed|removed|deleted/iu,
      );
    }
  });

  it('says the explanation stays put, because it does', () => {
    // The paragraph staying on screen is deliberate — it may well be right — and a child
    // who pressed a button and watched nothing move would otherwise think it failed.
    expect(copy.flagNote).toMatch(/Nothing here changes/u);
    expect(copy.flagAnnouncement(3)).toMatch(/Nothing here changes/u);
  });

  it('never praises or blames the child for reporting', () => {
    for (const sentence of [copy.flagControl, copy.flagNote, copy.flagAnnouncement(3)]) {
      expect(sentence).not.toMatch(/well done|thank|good job|nice work|your fault|you broke/iu);
    }
  });

  it('keeps the report’s two unhappy states two different sentences', () => {
    // "There is no connection" is a thing a child can act on, and collapsing it into
    // "it did not work" would send them pressing at a wall.
    expect(copy.flagFailed).not.toBe(copy.flagOffline);
    expect(copy.flagOffline).toMatch(/not connected/u);
  });

  it('names the Question in the report announcement, from a handed-in ordinal', () => {
    expect(copy.flagAnnouncement(7)).toContain('question 7');
    expect(copy.flagAnnouncement(7)).not.toBe(copy.flagAnnouncement(8));
  });

  it('states the reported instant as a parameter and never writes one', () => {
    expect(copy.flagged('LATER')).toContain('LATER');
    expect(copy.flaggedUndated).not.toMatch(/\d/u);
  });
});
