import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { studentCopy } from '@/copy/student';

const PAGE_SOURCE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');
/** The screen's source with its prose stripped, so a comment cannot fail an assertion. */
const CODE = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * One handed-in run, as the parent reads it.
 *
 * `apps/web` runs its unit tests without a DOM, so this screen's rules are asserted on
 * the source that states them, exactly as the draft review screen's spec does. What the
 * rendered answer key says is proved by `components/AnswerKeyRow.spec.tsx`, which needs
 * no DOM either, and what a press does is proved in the browser by
 * `e2e/tests/parent-explanation-review.spec.ts`.
 */
describe('a parent reading one handed-in run', () => {
  it('reads the answer key and the Explanations as two independent calls', () => {
    // The answer key is the screen; the Explanations are what each row says underneath.
    // One `Promise.all` would blank a paper that came back perfectly well because the
    // prose could not be looked up.
    expect(PAGE_SOURCE).toContain('parentApi.parentAttemptResults(token, attemptId)');
    expect(PAGE_SOURCE).toContain('parentApi.attemptExplanations(token, attemptId)');
    expect(PAGE_SOURCE).not.toContain('Promise.all([');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.explanationsFailed');
    expect(PAGE_SOURCE).toContain('data-testid="parent-attempt-prose-error"');
  });

  it('generates nothing: there is no path from this screen to an Explanation being written', () => {
    // A parent opening an Attempt with ten unexplained Questions must not bill ten
    // provider calls against their own Explanation Allowance (AD-14).
    expect(PAGE_SOURCE).not.toMatch(/explainQuestion|ExplainPanel/u);
  });

  it('renders the shared answer-key row with the parent’s own words', () => {
    // One layout, two persons: the row imports no copy, so the child reads "You
    // answered" and the parent reads about their child in the third person.
    expect(PAGE_SOURCE).toContain("from '@/components/AnswerKeyRow'");
    expect(PAGE_SOURCE).toContain('labels={PARENT_ROW_LABELS}');
    expect(PAGE_SOURCE).toContain('question: parentCopy.attempts.question');
    expect(PAGE_SOURCE).toContain('studentAnswer: parentCopy.attempts.studentAnswer');
    // And none of the child's second-person wording is reachable from here.
    expect(PAGE_SOURCE).not.toMatch(/studentCopy/u);
    expect(parentCopy.attempts.studentAnswer).not.toBe(studentCopy.results.yourAnswer);
  });

  it('puts each Explanation in the row’s own slot, beneath its Question', () => {
    // UX-DR16: the prose belongs directly beneath the Question it is about, inside the
    // row's content column — never a modal and never a route of its own.
    expect(PAGE_SOURCE).toContain('explain={');
    expect(PAGE_SOURCE).toContain('<ExplanationReview');
    expect(PAGE_SOURCE).toContain(
      'explanations={byQuestion.get(row.questionId) ?? NOTHING_EXPLAINED}',
    );
    // The confirmation for the one irreversible act is the region's own, beneath the row it
    // is about — this screen opens no dialog and holds no modal of its own.
    expect(PAGE_SOURCE).not.toMatch(/Dialog|Modal/u);
  });

  it('drops both held lists as the read re-issues, so no run wears another’s prose', () => {
    // Two runs of one Practice Test present the *same Question ids*. A paper left in
    // state while the next run loads would draw the previous run's prose — and its
    // flagged state — under the new run's Questions.
    expect(CODE).toContain('setResults(null)');
    expect(CODE).toContain('setExplanations([])');
    // And the results-failure arm clears it too: a stale answer key under "that practice
    // test could not be found" would be two statements with one of them untrue.
    const failureArm = CODE.slice(
      CODE.indexOf('setLoading(false)', CODE.indexOf('endsParentView')),
    );
    expect(failureArm).toContain('setResults(null)');
  });

  it('drops a prior run’s flag announcement as the read re-issues', () => {
    // This page instance is reused across an attemptId navigation, exactly as the two
    // held lists are — so a flag announced on one run must not still read out under the
    // next run's Questions.
    const setupBlock = CODE.slice(
      CODE.indexOf('const issued = (requestId.current += 1)'),
      CODE.indexOf('parentApi.parentAttemptResults'),
    );
    expect(setupBlock).toContain('setAnnouncement(NOTHING_ANNOUNCED)');
  });

  it('never lets a failed or still-pending prose read read as “the child never asked”', () => {
    // From inside a row's region, prose nobody asked for, prose that could not be read,
    // and prose that has not arrived yet are all the same `undefined` — and the sentence
    // it draws is a claim about what the child asked. So the regions are not rendered at
    // all in any of those cases, and the failure is stated once, by the screen.
    expect(CODE).toContain('token === null || proseError !== null || !proseLoaded ? null : (');
    expect(CODE).toContain('setProseLoaded(false)');
    expect(CODE).toContain('setProseLoaded(true)');
    // With its own Retry, because the other one belongs to the answer-key failure and is
    // not on screen when the key came back. An instruction with nothing to press is a
    // dead end.
    const proseAlert = CODE.slice(
      CODE.indexOf('data-testid="parent-attempt-prose-error"'),
      CODE.indexOf('parent-attempt-questions'),
    );
    expect(proseAlert).toContain('parentCopy.attempts.retry');
    expect(proseAlert).toContain('setAttempt((value) => value + 1)');
  });

  it('keys the flat Explanation list onto the rows with the pure function', () => {
    // The join, and the state each row is in, are pure functions with their own spec:
    // this screen has no DOM to assert them through.
    expect(PAGE_SOURCE).toContain("from '@/lib/explanation-review'");
    expect(PAGE_SOURCE).toContain('explanationsByQuestion(explanations)');
  });

  it('shows the server’s score and counts nothing itself', () => {
    // FR-37's one figure, computed over exactly the rows in the same response.
    expect(PAGE_SOURCE).toContain(
      'parentCopy.attempts.score(results.score.correct, results.score.denominator)',
    );
    expect(PAGE_SOURCE).toContain('results.score.excludedUngraded > 0');
    expect(PAGE_SOURCE).not.toMatch(/\.filter\(.*Correct/u);
  });

  it('owns the one live region this surface has', () => {
    // One region per surface, and the flag outcome is announced through it with the
    // exact sentence the row displays. The region is the screen's, which is why
    // `announce` is handed down as a prop.
    expect(PAGE_SOURCE).toContain('role="status"');
    expect(PAGE_SOURCE).toContain('aria-live="polite"');
    expect(PAGE_SOURCE).toContain('announcedText(announcement)');
    expect(PAGE_SOURCE).toContain('announce={announce}');
    expect((PAGE_SOURCE.match(/aria-live/gu) ?? []).length).toBe(1);
  });

  it('keeps its copy of the Explanation true after a flag, without re-reading', () => {
    // The write answers with the new state, so the screen holds what the server said
    // rather than a second read of rows it already has.
    expect(PAGE_SOURCE).toContain('onFlagged={onFlagged}');
    // Matched on `(questionId, generation)` and no longer on the Question id alone, which
    // now matches several rows: a replace by Question id would rewrite a removed explanation
    // with the state of its replacement, and the parent would watch their own decision
    // vanish off the screen.
    expect(PAGE_SOURCE).toContain(
      'held.questionId === view.questionId && held.generation === view.generation ? view : held',
    );
  });

  it('appends a new generation rather than dropping it on the floor', () => {
    // Its own handler beside `onFlagged`, because a removal and a replacement change the
    // history rather than one row: a replacement *adds* a generation, and a
    // replace-by-generation handler would have nothing on screen to match it against.
    expect(PAGE_SOURCE).toContain('onGenerations={onGenerations}');
    expect(PAGE_SOURCE).toContain('previous.filter((held) => held.questionId !== questionId)');
    expect(PAGE_SOURCE).toContain('...views,');
    // And still no second read *for the prose*: the writes answer with every generation of
    // that Question. The screen's three reads are named exactly in the Story 6.5 case below.
    expect(PAGE_SOURCE).not.toMatch(/attemptExplanations[\s\S]{0,400}attemptExplanations/u);
  });

  it('states a refusal as the one sentence, with the way back beside it', () => {
    // A foreign, unknown or still-open Attempt is one sentence from the API, and this
    // screen does not try to tell them apart.
    expect(PAGE_SOURCE).toContain('cause.status === 404');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.notFound');
    expect(PAGE_SOURCE).toContain('parentCopy.attempts.backToList');
  });

  it('ends Parent View only on the guard’s own refusal, on either read', () => {
    expect((PAGE_SOURCE.match(/endsParentView\(cause\)/gu) ?? []).length).toBe(2);
    expect(PAGE_SOURCE).toContain('onElevationLost={leave}');
  });

  it('resumes from the address bar and stores nothing', () => {
    expect(PAGE_SOURCE).toContain('useParams<{ attemptId: string }>()');
    expect(PAGE_SOURCE).not.toContain('localStorage');
    expect(PAGE_SOURCE).not.toContain('sessionStorage');
  });

  it('carries no cost, tier, model or allowance anywhere', () => {
    // Over the code, not the prose: the doc above states that this screen consumes no
    // Explanation Allowance, which is the claim being made and not a violation of it.
    //
    // **The rationale left this list in Story 6.5.** It is the evidence an adjustment is
    // decided on, so a parent reads it — but this screen still never touches it: the field is
    // on the row and the region that draws it is `GradeReview`, which is why `rationale` does
    // not appear here either. The case below pins that as the positive claim.
    for (const forbidden of [/allowance/iu, /\btier\b/iu, /costMicros/iu, /\bmodel\b/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  // --- Story 6.5: the mark, its evidence and the one remedy --------------

  it('reads the parent’s own superset shape and not the child’s', () => {
    // One type serving both audiences would put the reason one nullable field away from a
    // child's screen; two types make the student's response incapable of carrying it.
    expect(CODE).toContain('ParentAttemptResultsView');
    expect(CODE).not.toMatch(/useState<AttemptResultsView/u);
  });

  it('hands the mark to the row’s grade slot and draws none of it itself', () => {
    expect(CODE).toContain('<GradeReview');
    expect(CODE).toContain('grade={');
    // Every field the region needs arrived on the answer key, so unlike the prose region this
    // one needs no read to have settled and has no window in which it could say something
    // untrue about the child.
    expect(CODE).not.toMatch(/proseLoaded[^\n]*GradeReview/u);
    expect(CODE).not.toMatch(/rationale/iu);
  });

  it('adds no read for the mark, the reason or the dispute', () => {
    // The answer key now carries the recorded mark, the reason, the dispute and the
    // adjustment, so **nothing was added to learn any of them**: the two reads this screen
    // always made are still its two.
    expect(CODE).toContain('parentApi.parentAttemptResults(token, attemptId)');
    expect(CODE).toContain('parentApi.attemptExplanations(token, attemptId)');
  });

  it('reads the retained picks once for the run, not once per Question', () => {
    // `GradeReview` is mounted per row, so a read of its own would be one identical
    // account-scoped request per Question on mount — fifteen on a fifteen-Question paper,
    // every one of them answering the same list. So the screen makes it, and every row
    // filters the same array by its own per-Question scope.
    expect(CODE.match(/parentApi\.uncommittedState/gu)).toHaveLength(1);
    expect(CODE).toContain('retainedSlots={retainedSlots}');
    // Keyed on the profile the *run* named, never on one guessed from the URL: the slots
    // are per Student Profile server-side.
    expect(CODE).toContain('parentApi.uncommittedState(token, studentProfileId)');
    expect(CODE).toContain('results?.studentProfileId ?? null');
    // And the component that used to make it no longer does.
    const review = readFileSync(
      path.resolve(import.meta.dirname, '..', '..', '_components', 'GradeReview.tsx'),
      'utf8',
    );
    expect(review).not.toMatch(/parentApi\s*\.\s*uncommittedState/u);
  });

  it('never lets the retained-pick read block, fail or end anything', () => {
    // A retained pick is a convenience under a decision the parent has not made yet. It is
    // the one read here that swallows every failure, `endsParentView` included — an empty
    // list is exactly what "nothing picked" looks like, and the two reads that *are* the
    // screen still end Parent View when the guard refuses them.
    expect(CODE.match(/endsParentView\(cause\)/gu)).toHaveLength(2);
    expect(CODE).toMatch(/uncommittedState\([\s\S]{0,260}\(\) => \{\},/u);
    // Dropped as the run re-issues, like the other two held lists.
    expect(CODE).toContain('setRetainedSlots(NOTHING_RETAINED)');
  });

  it('hands the whole recalculated run back into its own state', () => {
    // The API commits the mark and the score together and answers the view, so the score and
    // the rows always describe one read — and this screen patches no row of its own.
    expect(CODE).toContain('onAdjusted={setResults}');
  });

  it('keys the retained slot to the child whose run this is', () => {
    // The slot is keyed per Student Profile server-side. A screen that guessed would restore
    // one child's decision onto another's paper.
    expect(CODE).toContain('studentProfileId={results.studentProfileId}');
  });

  it('states the score as a change through the one function that decides there is one', () => {
    // Prior, then adjusted, with "adjusted by parent" saying why — never one figure replacing
    // another, and never a second denominator computed here (FR-37).
    expect(CODE).toContain('scoreChangeOf(results.score, results.originalScore)');
    expect(CODE).toContain('parentCopy.attempts.override.scoreChanged(');
    expect(CODE).toContain('scoreChange === null');
    expect(CODE).not.toMatch(/originalScore\.correct\s*[-<>]/u);
  });

  it('announces an override through the one region it already owns', () => {
    // One surface, one region: `GradeReview` takes `announce` rather than reaching for one.
    expect(CODE.match(/aria-live/gu)).toHaveLength(1);
    // The pager's own position sentence goes straight through, since Story 5.8 — the same
    // region rather than a second one of its own.
    expect(CODE.match(/announce=\{announce\}/gu)).toHaveLength(1);
    // The grade region and the explanation region are mounted on every row, hidden or not
    // (UX-DR34/39/47), so a hidden row's `announce` is dropped rather than forwarded: a
    // reader paged away before an adjustment or a regeneration settled must not hear an
    // outcome sentence for a Question that is no longer on screen.
    expect(CODE.match(/announce=\{paging\.hidden \? noopAnnounce : announce\}/gu)).toHaveLength(
      2,
    );
  });

  // --- Story 5.8: one Question at a time, with the rest mounted and hidden ---

  it('reads `?q=` behind a Suspense boundary, as its sibling drill-down does', () => {
    // `useSearchParams` opts a route out of static prerendering otherwise, and which
    // Question is shown arrives as a query parameter — which is the whole reason it is
    // read at all.
    expect(CODE).toContain('<Suspense fallback={null}>');
    expect(CODE).toContain('<ParentAttemptDetail />');
    expect(CODE).toContain('export default function ParentAttemptDetailPage()');
    expect(CODE).toContain('function ParentAttemptDetail()');
    expect(CODE).toContain('useSearchParams()');
  });

  it('keeps the heading and the way back outside the boundary', () => {
    // So a parent always has both, even while the reads are in flight or after they
    // failed — and the way back sits below the pager, which puts it under every
    // Question rather than only under the last one.
    const shell = CODE.slice(CODE.indexOf('export default function ParentAttemptDetailPage()'));
    expect(shell).toContain('parentCopy.attempts.detailTitle');
    expect(shell).toContain('parentCopy.attempts.backToList');
    expect(shell).toContain('<Suspense fallback={null}>');
    // And the live region stays inside it, because the state that feeds it does.
    expect(shell).not.toContain('aria-live');
  });

  it('clamps the parameter with the one pure function that decides it', () => {
    expect(CODE).toContain("from '@/lib/answer-key-paging'");
    expect(CODE).toContain('ordinalFromQuery(search.get(QUESTION_PARAM), ordinals)');
    // Against this run's stored ordinals, never an array position: a row whose stored
    // Question could no longer be read carries `ordinal: 0` and keeps its place.
    expect(CODE).toContain('(results?.questions ?? []).map((row) => row.ordinal)');
  });

  it('writes the Question back with a client-side replace, never a push', () => {
    // Back returns to the Grade disputes list a parent came from rather than walking
    // twenty Questions backwards — and client-side, because a document navigation would
    // drop the provider holding the elevation bearer and ask for the PIN again (AD-18).
    expect(CODE).toContain('next.set(QUESTION_PARAM, String(ordinal))');
    expect(CODE).toContain('scroll: false');
    expect(CODE).not.toMatch(/router\.push|window\.location/u);
  });

  it('pages one Question at a time with every row still mounted', () => {
    // `ExplanationReview` holds nine pieces of purely local state with no persistence,
    // four of them failure strings a parent may not have read. Slicing the array would
    // unmount them and a parent who paged away mid-decision would lose it silently.
    expect(CODE).toContain('<AnswerKeyPager');
    expect(CODE).toContain('items={results.questions.map((row) => ({');
    expect(CODE).toContain('{...paging}');
    expect(CODE).not.toMatch(/\.slice\(/u);
    // The two regions stay in the row's own slots, with their guards verbatim.
    expect(CODE).toContain('token === null || proseError !== null || !proseLoaded ? null : (');
    expect(CODE).toContain('<GradeReview');
    expect(CODE).toContain('<ExplanationReview');
  });

  it('pages nothing for a run that presented no Question at all', () => {
    // `Question 0 of 0` over an empty map and an empty legend is a position about
    // nothing. The score and the excluded count above already say what there is to say.
    expect(CODE).toContain('results.questions.length === 0 ? (');
    expect(CODE).toContain('data-testid="parent-attempt-no-questions"');
  });

  it('adds no read for paging: the three reads this screen made are still its three', () => {
    expect(CODE.match(/parentApi\./gu)).toHaveLength(3);
  });

  it('hands the pager the parent’s own words, in the third person', () => {
    expect(CODE).toContain('labels={PARENT_PAGER_LABELS}');
    expect(CODE).toContain('mapLabels={PARENT_MAP_LABELS}');
    expect(CODE).toContain('position: parentCopy.attempts.pager.position');
    expect(CODE).not.toMatch(/studentCopy/u);
    // Two blocks, deliberately duplicated: a shared one would have to pick a person,
    // and the one it picked would be the one the other surface shipped by mistake.
    expect(parentCopy.attempts.pager.mapHeading).not.toBe(studentCopy.results.pager.mapHeading);
    expect(parentCopy.attempts.pager.cellState(1, 'Correct', true, false)).not.toBe(
      studentCopy.results.pager.cellState(1, 'Correct', true, false),
    );
  });

  it('says a cell’s whole sentence about the child, never to them', () => {
    const pager = parentCopy.attempts.pager;
    expect(pager.position(2, 12)).toBe('Question 2 of 12');
    expect(pager.positionAnnouncement(2, 12)).toBe(pager.position(2, 12));
    expect(pager.cellState(3, 'Correct', true, false)).toContain('shown now');
    expect(pager.cellState(3, 'Correct', false, true)).toContain('just graded');
    expect(pager.cellState(3, 'Correct', true, false)).not.toMatch(/\byou\b/iu);
    // No percentage and no tally: the score is the header's one figure (FR-37).
    expect(JSON.stringify(pager)).not.toMatch(/%|out of|score/iu);
  });

  it('gives the row the parent’s own word for a mark they set', () => {
    expect(CODE).toContain('rowParentAdjusted: parentCopy.attempts.override.rowParentAdjusted');
  });
});
