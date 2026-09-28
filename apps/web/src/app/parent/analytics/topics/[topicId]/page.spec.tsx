import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

/**
 * The topic drill-down screen, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so a screen holding three staged
 * reads, a query parameter behind `Suspense` and one consequential control is pinned by
 * reading what it says — exactly as the dashboard it is reached from is. The rules it
 * delegates (the cost arithmetic, the empty-state predicate, the percentage) are pure
 * functions with their own specs.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the topic drill-down screen does', () => {
  it('makes three reads and exactly one write, and the write is Story 4.2’s request', () => {
    // The drill-down is the screen; the profiles put a name on it; the allowance makes
    // the cost statable. The only write is the existing generation request — there is no
    // new generation path here.
    //
    // Matched on the member name alone, with whatever whitespace prettier put between
    // it and `parentApi`: which API surfaces this screen calls is the claim, and a
    // reflow of the call is not a change to it.
    const called = new Set(
      (CODE.match(/parentApi\s*\.\s*(\w+)/gu) ?? []).map((hit) =>
        hit.replace(/[\s.]/gu, '').replace(/^parentApi/u, ''),
      ),
    );
    expect(called).toEqual(
      new Set(['topicDrillDown', 'students', 'generationAllowance', 'startGeneration']),
    );
    expect(CODE).not.toMatch(/method: 'POST'|method: 'PUT'|method: 'DELETE'/u);
  });

  it('reads the selected student from the query string, behind a Suspense boundary', () => {
    // `useSearchParams` opts a route out of static prerendering otherwise, and the
    // selected student is the whole reason it is read.
    expect(CODE).toContain('useSearchParams');
    expect(CODE).toContain('<Suspense fallback={null}>');
    expect(CODE).toMatch(/<Suspense[\s\S]*<TopicDrillDown \/>[\s\S]*<\/Suspense>/u);
  });

  it('refuses to guess which child it is about', () => {
    // A drill-down under the wrong name is the most consequential thing this screen
    // could get wrong, so no student in the URL is no read at all.
    expect(CODE).toContain("studentProfileId === ''");
    expect(CODE).not.toMatch(/profiles\[0\]/u);
  });

  it('never mutates the staleness ref during render', () => {
    // A render is not a commit: React may run one and throw it away, and a body that
    // retired a request id could drop the response of the read still in flight.
    expect(CODE).toContain('const issued = (requestId.current += 1)');
    expect(CODE.match(/current\.current\.value = /gu)).toHaveLength(1);
    expect(CODE).not.toMatch(/current\.current\.value = requestId\.current/u);
  });

  it('guards every superseded read from overwriting fresher figures', () => {
    expect(CODE.match(/applyIfCurrent/gu)!.length).toBeGreaterThanOrEqual(6);
  });

  it('holds "answered" apart from "not loading"', () => {
    expect(CODE).toContain('const [loaded, setLoaded] = useState(false)');
    expect(CODE).toContain('loaded &&');
  });

  it('states each failure separately, and never a platform string', () => {
    expect(CODE).toContain('parentCopy.topicDrillDown.loadFailed');
    expect(CODE).toContain('parentCopy.topicDrillDown.profilesFailed');
    expect(CODE).toContain('parentCopy.topicDrillDown.allowanceFailed');
    expect(CODE).toContain('parentCopy.topicDrillDown.fireFailed');
    // The API's own sentence where it authored one, and this screen's otherwise.
    expect(CODE).toContain('cause.reason');
    expect(CODE).not.toMatch(/cause\.message/u);
  });

  it('gives each read its own failure slot, so neither can hide the other', () => {
    // On one shared slot, whichever read settled last silently replaced the other's
    // sentence — and a parent owed two facts read one.
    expect(CODE).toContain('const [error, setError] = useState<string | null>(null)');
    expect(CODE).toContain(
      'const [profilesError, setProfilesError] = useState<string | null>(null)',
    );
    expect(CODE).toContain('const [costError, setCostError] = useState<string | null>(null)');
    // The profiles failure writes its own slot and never the drill-down's.
    expect(CODE).toContain('setProfilesError(parentCopy.topicDrillDown.profilesFailed)');
    expect(CODE).not.toMatch(/setError\(parentCopy\.topicDrillDown\.profilesFailed\)/u);
    // And both alerts are rendered, rather than one branch choosing between them.
    expect(CODE).toContain('data-testid="topic-drill-down-error"');
    expect(CODE).toContain('data-testid="topic-drill-down-profiles-error"');
  });

  it('reads the allowance in its own effect, with its own retry', () => {
    // On the shared `attempt` counter, retrying a failed cost line re-issued the
    // drill-down and blanked the evidence a parent was mid-way through reading.
    expect(CODE).toContain('const [costAttempt, setCostAttempt] = useState(0)');
    expect(CODE).toContain('setCostAttempt((value) => value + 1)');
    // Its own staleness guard, since it is its own read.
    expect(CODE).toContain('costCurrent.current');
    // The allowance effect depends on its own counter and never on the screen's.
    expect(CODE).toMatch(/\}, \[token, costAttempt, leave\]\)/u);
    // And the cost block's Retry never bumps the screen-wide one.
    const costBlock = CODE.slice(CODE.indexOf('topic-drill-down-cost-error'));
    expect(costBlock).not.toMatch(/setAttempt\(/u);
  });

  it('states a sentence for a student the address names but this account does not have', () => {
    // A deleted profile, another account's child, or an edited link. Without this the
    // screen rendered nothing at all: no error, no empty state, only the back link.
    expect(CODE).toContain('chosen === null');
    expect(CODE).toContain('data-testid="topic-drill-down-unknown-student"');
    expect(CODE).toContain('parentCopy.topicDrillDown.unknownStudent');
    // And only once the profiles read has answered: an empty list is also what a failed
    // read leaves behind.
    expect(CODE).toContain('const [profilesLoaded, setProfilesLoaded] = useState(false)');
    expect(CODE).toContain('profilesLoaded && (');
  });

  it('names the student through the address and never in a literal', () => {
    // Parent View is third person by name (UX-DR31).
    expect(CODE).toContain('<AddressProvider surface="parent"');
    expect(CODE).toContain('subject={chosen.displayName}');
    expect(CODE).toContain('address.Name');
    expect(CODE).toContain('address.name');
  });

  it('states the figure only with the count it is over, and the blanks beside it', () => {
    expect(CODE).toContain('parentCopy.topicDrillDown.figure(percent, view.mastery!.answered)');
    expect(CODE).not.toMatch(/\{\s*percent\s*\}%/u);
    expect(CODE).toContain('parentCopy.topicDrillDown.blanks(');
    expect(CODE).toContain('parentCopy.topicDrillDown.blanksNone');
    // And what a blank means, said once on the screen it matters on.
    expect(CODE).toContain('parentCopy.topicDrillDown.blanksExplained(');
  });

  it('says in words that a topic has no figure, rather than drawing a zero', () => {
    expect(CODE).toContain('percent === null');
    expect(CODE).toContain('parentCopy.topicDrillDown.figureNone');
  });

  it('never re-decides a Weak Area and never states a threshold', () => {
    expect(CODE).toContain('view.mastery!.isWeakArea && <WeakAreaMarker />');
    expect(CODE).not.toMatch(/\b(ceilingPercent|answeredFloor)\b/u);
    expect(CODE).not.toMatch(/mastery!?\.value\s*[<>]/u);
  });

  it('skips no heading rank: one h1, and h2 for every section under it', () => {
    // `AnswerKeyRow` heads each row at `h4` under these, so an `h3` here would make the
    // rows siblings of the section they belong to — and an outline that lies is worse
    // than no outline.
    expect(CODE.match(/component="h1"/gu)).toHaveLength(1);
    expect(CODE).toContain('component="h2" variant="cardTitle"');
    expect(CODE).not.toMatch(/component="h3"/u);
  });

  it('heads a row whose question cannot be identified by what is known, not "Question 0"', () => {
    // The API sets the sentinel ordinal for a row whose stored question could not be
    // read back; heading it by that number would be a claim about a number the API has
    // just said it cannot recover.
    expect(CODE).toContain('ordinal === UNIDENTIFIED_ORDINAL');
    expect(CODE).toContain('parentCopy.topicDrillDown.unidentifiedQuestion');
    expect(CODE).toContain('parentCopy.attempts.question(ordinal)');
    // The sentinel is the shared constant, never a literal here.
    expect(CODE).not.toMatch(/ordinal === 0/u);
  });

  it('names the upload through the one function that picks among the four sentences', () => {
    // Inline, the both-absent branch rendered "From the upload of From a finished
    // practice test" — and no node-environment test could reach it.
    expect(CODE).toContain('targetSentence(target)');
    expect(CODE).not.toMatch(/generateFromUnknownSubject|generateFromUndated/u);
  });

  it('renders the evidence through the shared answer-key row, in two separate lists', () => {
    // A second row layout here would be the place the two parent rooms' grade semantics
    // drift; a merged list would say a blank was a wrong answer.
    expect(CODE).toContain('<AnswerKeyRow');
    expect(CODE).toContain('labels={PARENT_ROW_LABELS}');
    expect(CODE).toContain('rows={view.missed}');
    expect(CODE).toContain('rows={view.unanswered}');
    expect(CODE).not.toMatch(/\[\s*\.\.\.view\.missed,\s*\.\.\.view\.unanswered\s*\]/u);
    // And each row says which run it came off, so a row read alone still states it.
    expect(CODE).toContain('rowFromSentence(row.submittedAt)');
  });

  it('sorts nothing and filters nothing: the order and the lists are the API’s', () => {
    expect(CODE).not.toMatch(/\.sort\(|\.filter\(\(row/u);
  });

  it('states the whole cost above the control, and computes no figure itself', () => {
    // Three lines, all in practice tests, all the API's figures through `costOf`.
    expect(CODE).toContain('costOf(allowance)');
    expect(CODE).toContain('parentCopy.topicDrillDown.costSpend(cost.count)');
    expect(CODE).toContain('parentCopy.topicDrillDown.costRemaining(cost.remaining)');
    expect(CODE).toContain('parentCopy.topicDrillDown.costAfter(cost.after)');
    expect(CODE).toContain('parentCopy.topicDrillDown.resets(');
    // No arithmetic and no literal figure anywhere in the component.
    expect(CODE).not.toMatch(/remainingAfter/u);
    expect(CODE).not.toMatch(/\d+ of \d+/u);
    expect(CODE).not.toMatch(/allowance\.(limit|used|remaining)\s*[-+<>]/u);
  });

  it('cannot fire without a cost stated, and cannot fire on a spent allowance', () => {
    expect(CODE).toContain('disabled={cost === null || !cost.spendable || firing}');
    expect(CODE).toContain(
      'if (token === null || target === null || cost === null || !cost.spendable) return;',
    );
    expect(CODE).toContain('parentCopy.topicDrillDown.spent');
  });

  it('fires one practice test through the existing request, with the server’s label', () => {
    // The count is the shared constant, the upload and the label are the API's, and the
    // request is Story 4.2's unchanged.
    expect(CODE).toContain('target.sourceTestId');
    expect(CODE).toContain('DRILL_DOWN_GENERATION_COUNT');
    expect(CODE).toContain('target.weightedTopic');
    // No topic picker and no count picker: one tap, the topic already chosen.
    expect(CODE).not.toMatch(/generationTopics|countOptions|defaultCount/u);
  });

  it('hands the parent to the existing progress screen on acceptance', () => {
    expect(CODE).toContain('router.push(`/parent/generate/${target.sourceTestId}`)');
  });

  it('offers no control at all when no upload carries the topic', () => {
    expect(CODE).toContain('target === null ? (');
    expect(CODE).toContain('parentCopy.topicDrillDown.noTarget(address.name)');
  });

  it('names no account plan and offers nothing to buy', () => {
    // Over the **code** rather than the whole source, so a comment explaining why no
    // plan is named does not satisfy the rule about not naming one. Anchored on whole
    // words, so "frontier" is not a tier — and covering the ways a plan actually gets
    // named, which a bare `/tier/` would miss.
    expect(CODE).not.toMatch(
      /\b(tier|tiers|upgrade|upgrading|downgrade|premium|paid|subscription|plan|plans)\b/iu,
    );
    expect(CODE).not.toMatch(/\b(price|priced|pricing|cost in|\$|£|€)/iu);
    expect(CODE).not.toMatch(/\b(buy|purchase|checkout|billing)\b/iu);
  });

  it('keeps every word a parent reads in the copy module', () => {
    // No user-facing literal in the component (UX-DR31, AD-32). Asserted on the places a
    // literal can actually reach a parent — a JSX text child, and the attributes that
    // are announced — rather than on one capitalised-two-word shape that a lowercase
    // literal or an `aria-label` would have walked straight past.
    const jsxText = CODE.match(/>\s*[A-Za-z][^<>{}\n]{2,}</gu) ?? [];
    expect(jsxText).toEqual([]);
    for (const attribute of ['aria-label', 'placeholder', 'title', 'alt', 'aria-description']) {
      // Only a literal is forbidden; `aria-label={heading}` is a value passed in.
      expect(CODE).not.toMatch(new RegExp(`${attribute}="[^"]`, 'u'));
    }
    expect(CODE).toContain('parentCopy.topicDrillDown.');
  });

  it('has a way back that does not depend on any read', () => {
    expect(CODE).toContain('href="/parent/analytics"');
    expect(CODE).toContain('parentCopy.topicDrillDown.back');
  });
});

describe('the drill-down’s copy', () => {
  it('names no account plan and offers nothing to buy', () => {
    const words = JSON.stringify(parentCopy.topicDrillDown);
    expect(words).not.toMatch(/tier|upgrade|free plan|price/iu);
  });

  it('states every sentence about the student as a function of the subject', () => {
    // Third person by name. A literal here would be a child addressed as "you" on a
    // parent's screen, or a parent addressed as their own child.
    for (const key of [
      'title',
      'scope',
      'blanksExplained',
      'missedHeading',
      'unansweredHeading',
      'missedNone',
      'unansweredNone',
      'empty',
      'noTarget',
    ] as const) {
      expect(typeof parentCopy.topicDrillDown[key]).toBe('function');
    }
  });

  it('denominates every cost line in practice tests', () => {
    expect(parentCopy.topicDrillDown.costSpend(1)).toContain('practice test');
    expect(parentCopy.topicDrillDown.costRemaining(2)).toContain('practice tests');
    expect(parentCopy.topicDrillDown.costAfter(0)).toContain('practice tests');
    // Never credits, tokens or an abstract unit.
    const words = JSON.stringify(parentCopy.topicDrillDown);
    expect(words).not.toMatch(/credit|token/iu);
  });

  it('states the figure and the blank count in the dashboard’s own words', () => {
    // The two screens state the same figure about the same window, so they cannot drift.
    expect(parentCopy.topicDrillDown.figure(40, 5)).toBe(parentCopy.analytics.masteryFigure(40, 5));
    expect(parentCopy.topicDrillDown.figureNone).toBe(parentCopy.analytics.masteryNone);
    expect(parentCopy.topicDrillDown.blanks(3)).toBe(parentCopy.analytics.unansweredNote(3));
    expect(parentCopy.topicDrillDown.blanksNone).toBe(parentCopy.analytics.unansweredNone);
  });
});
