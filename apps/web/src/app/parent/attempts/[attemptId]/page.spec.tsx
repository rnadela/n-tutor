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
    expect(PAGE_SOURCE).toContain('explanation={byQuestion.get(row.questionId)}');
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
    expect(PAGE_SOURCE).toContain('held.questionId === view.questionId ? view : held');
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

  it('carries no rationale, cost, tier, model or allowance anywhere', () => {
    // The grading rationale is Story 6.5's, and `AttemptResultsView` has no field it
    // could travel in (AD-20, AD-26).
    // Over the code, not the prose: the doc above states that this screen consumes no
    // Explanation Allowance, which is the claim being made and not a violation of it.
    for (const forbidden of [/rationale/iu, /allowance/iu, /\btier\b/iu, /costMicros/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });
});
