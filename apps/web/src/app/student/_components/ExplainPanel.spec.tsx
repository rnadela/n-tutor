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
  it('makes exactly one student-scoped call, and it is the explanation call', () => {
    expect(CODE).toContain('parentApi.explainQuestion(attemptId, questionId)');
    expect(CODE.match(/parentApi\./gu)).toHaveLength(1);
    // No bearer and no parent-scoped member: the binding names the child.
    expect(CODE).not.toMatch(/Authorization|elevat/iu);
  });

  it('never polls, never prefetches and never retries on its own', () => {
    // The first ask bills a provider call. A timer here would bill one per
    // Question per visit, with nobody having asked for any of them.
    expect(CODE).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|poll|prefetch/iu);
    // And nothing asks on mount: the only `useEffect` here is the announcement.
    expect(CODE.match(/useEffect\(/gu)).toHaveLength(1);
    expect(CODE).not.toMatch(/useEffect\([\s\S]{0,400}?explainQuestion/u);
  });

  it('decides what a press means through the pure function, not inline', () => {
    // The rules that cost money — never ask twice for prose already held, never
    // start a second request while one is out, never send with no connection —
    // live where they can be asserted without a DOM.
    expect(CODE).toContain('explainDecision({ online: navigator.onLine, state })');
    expect(CODE).toContain("if (decision === 'stored' || decision === 'busy') return;");
  });

  it('reads the connection at the press rather than latching it', () => {
    // A held flag behind listeners is a second thing that can be wrong; what
    // matters is whether there is a connection when something would be sent.
    expect(CODE.match(/navigator\.onLine/gu)).toHaveLength(1);
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
    expect(CODE.match(/announce\(/gu)).toHaveLength(1);
  });

  it('is never a modal and never a route of its own', () => {
    // UX-DR16: the question, both answers and the reason belong on screen together.
    expect(CODE).not.toMatch(/Dialog|Modal|Drawer|Popover|href=/u);
    // The one navigation is the binding refusal every read on this surface makes.
    expect(CODE.match(/router\./gu)).toHaveLength(1);
    expect(CODE).toContain("router.replace('/auth/sign-in')");
  });

  it('keeps both tappable things at the surface’s tap-target floor', () => {
    expect(CODE.match(/minHeight: comfortableDensity\.tapTarget/gu)).toHaveLength(2);
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
  });

  it('announces once, through the one region, with the sentence it displays', () => {
    expect(CODE).toContain('useAnnounce()');
    expect(CODE.match(/announce\(/gu)).toHaveLength(1);
    expect(CODE).toContain('const sentence = spokenOf(state, ordinal);');
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
    expect(CODE).toContain('{open && (');
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
  const sentences = [
    copy.control,
    copy.heading,
    copy.idle,
    copy.loading,
    copy.failed,
    copy.offline,
    copy.atCap(null),
    copy.atCap('No Explanation Allowance is left this period.'),
    copy.announcement(1),
    copy.announcement(4),
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
    expect(copy.atCap('No more this period.')).toMatch(/not about you/u);
    // And says the work already done is still readable.
    expect(copy.atCap(null)).toMatch(/still here/u);
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
});
