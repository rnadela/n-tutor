import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'AttemptResults.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this component is
 * required to explain at length why nothing polls, why the read is the retry and why
 * it routes nowhere — and a bare `not.toContain('sort')` over the raw source would
 * make writing that explanation a test failure.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * Asserted over the component's own source, because `apps/web` runs its specs with
 * `environment: 'node'` and no router: a component that reads, announces and holds
 * state cannot be rendered here, so the claims that matter about it are claims about
 * what the file does. The rendered claims live in `AnswerKeyRow.spec.tsx` and
 * `GradeStateMarker.spec.tsx`, which need neither.
 */
describe('what reads the answer key', () => {
  it('makes exactly two student-scoped calls, and no third', () => {
    // **Two reads and no third: the answer key from `grading`, and which Explanations a
    // parent removed from `explanation`. Never one per Question, and never one per press.**
    // The second is attempt-scoped for exactly that reason — the panel is mounted per row,
    // so learning suppression at press time would leave a child one tap from undoing their
    // parent's decision, and asking per Question would be one request per row on load.
    expect(CODE).toContain('parentApi.attemptResults(attemptId)');
    expect(CODE).toContain('parentApi.suppressedExplanations(attemptId)');
    expect(CODE.match(/parentApi\./gu)).toHaveLength(2);
    // No bearer and no parent-scoped member: the binding names the child.
    expect(CODE).not.toMatch(/Authorization|elevat/iu);
  });

  it('reads suppression in its own effect, and lets it fail silently', () => {
    // The two reads settle independently: the answer key is the screen and must not wait on,
    // or fail with, a list of ids that only decides whether a control is drawn. And the
    // failure is swallowed on purpose — the set stays empty, the control is drawn, and the
    // API's serve-time check refuses the press without generating or charging anything, which
    // is exactly why that check exists and is not a cache trick.
    expect(CODE).toMatch(/\}, \[attemptId, reload\]\);/u);
    const suppression = CODE.slice(CODE.indexOf('parentApi.suppressedExplanations(attemptId)'));
    expect(suppression).toContain('() => {},');
    expect(suppression.slice(0, 400)).not.toContain('setError');
    expect(suppression.slice(0, 400)).not.toContain('deviceIsUnbound');
  });

  it('hands each row its own answer, off the one attempt-scoped read', () => {
    expect(CODE).toContain('suppressed={suppressed.has(row.questionId)}');
    // Empty until it lands and empty if it fails, from one frozen value rather than a fresh
    // set per render: a new identity would be a new prop identity on every row of a paper.
    expect(CODE).toContain('EMPTY_SUPPRESSION');
  });

  it('reads once per Attempt, keyed on the Attempt and a person’s retry', () => {
    // Keyed on the id, so a re-render, a clock tick or a state change elsewhere does
    // not re-ask — and a re-ask is a provider call the account is billed for.
    expect(CODE).toMatch(/\}, \[attemptId, reload, router\]\);/u);
    expect(CODE.match(/attemptResults\(/gu)).toHaveLength(1);
  });

  it('never polls, never queues and never retries on its own', () => {
    // FR-22 makes viewing the trigger. The only second read is a person pressing.
    expect(CODE).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|poll/iu);
    expect(CODE).toContain('setReload((value) => value + 1)');
    expect(CODE.match(/setReload\(/gu)).toHaveLength(1);
  });

  it('renders the rows exactly as they arrive, with no second order of its own', () => {
    // The order is the order the child met the Questions in, decided by the server.
    // A results screen that grouped the wrong answers would be re-writing the paper.
    expect(CODE).toContain('results.questions.map(');
    for (const forbidden of [/\.sort\(/u, /\.reverse\(/u, /toSorted/u, /\.filter\(/u, /groupBy/u]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('says which test the results are of, from the two facts the API sent', () => {
    // Reached from history as well as from a hand-in, so the Subject and the length
    // are the only things on the screen that say which test this is.
    expect(CODE).toContain(
      'studentCopy.results.testMeta(results.subjectName, results.questionCount)',
    );
  });

  it('says nothing rather than two zeroes when the paper is perfect', () => {
    // `0 not correct · 0 unanswered` is a line about nothing, and it is exactly the
    // line a child who got everything right would be shown.
    expect(CODE).toMatch(/summary\.incorrect === 0 && summary\.unanswered === 0\s*\?\s*null/u);
    expect(CODE).toContain('{meta !== null && (');
  });

  it('picks the gap sentence that matches whether a figure was stated at all', () => {
    // With a zero denominator the header says `nothingToScore` instead of a fraction,
    // so a sentence pointing at "the figure above" would point at nothing.
    expect(CODE).toContain('studentCopy.results.ungradedGapOnly(score.excludedUngraded)');
    expect(CODE).toContain('studentCopy.results.ungradedGap(score.excludedUngraded)');
  });

  it('states the server’s score and computes no denominator of its own', () => {
    // FR-37's denominator arrives in `score`. There is no division anywhere here and
    // no percentage: a second derivation would be a second answer.
    expect(CODE).toContain('score.denominator === 0');
    expect(CODE).toContain('score.excludedUngraded > 0');
    expect(CODE).not.toMatch(/Math\.round|\/\s*100|toFixed|percent/iu);
    // The two counts it does derive come from the one module that derives them.
    expect(CODE).toContain('summaryOf(results.questions)');
    expect(CODE).toContain('newlyGradedCount(results.questions)');
  });

  it('announces with the same copy constant it renders, once per read', () => {
    expect(CODE).toContain('announce(studentCopy.results.newlyGradedAnnouncement(resolved))');
    // Rendered from the same constant, so what is spoken and what is shown cannot
    // come apart.
    expect(CODE).toContain('{studentCopy.results.newlyGradedAnnouncement(resolved)}');
    // Latched on the response object, so the same read never announces twice — and
    // a read that resolved nothing announces nothing at all.
    expect(CODE).toContain('announced.current === results');
    expect(CODE).toMatch(/if \(resolved === 0\) return;/u);
    expect(CODE.match(/announce\(/gu)).toHaveLength(1);
  });

  it('routes nowhere on a failed read but the guard’s own refusal', () => {
    // A 404, a 500 or a dropped connection is a bad moment, not Student Mode taken
    // away. The sole exception is `deviceIsUnbound`, as everywhere on this surface.
    expect(CODE).toMatch(
      /if \(deviceIsUnbound\(cause\)\) \{\s*router\.replace\('\/auth\/sign-in'\)/u,
    );
    expect(CODE.match(/router\.replace/gu)).toHaveLength(1);
    expect(CODE.match(/deviceIsUnbound\(cause\)/gu)).toHaveLength(1);
    expect(CODE).not.toMatch(/router\.(push|back|forward)/u);
  });

  it('offers a stated failure and a way to ask again', () => {
    expect(CODE).toContain('data-testid="attempt-results-error"');
    expect(CODE).toContain('data-testid="attempt-results-retry"');
    expect(CODE).toContain('{studentCopy.retry}');
  });

  it('holds nothing this story is not', () => {
    // Retake and the attempt-count line are Story 5.7's, on the page rather than here; a
    // rationale, a Topic and any money figure are parent-scoped and have no field to travel
    // in. **Disputing left this list in Story 6.5** — the control is a slot's, exactly as
    // explaining is, and the case below pins that it is a slot and not state held here.
    for (const forbidden of [
      /rationale/iu,
      /retake/iu,
      /\btopic/iu,
      /allowance|tier|costMicros/iu,
      // The workings of how a mark is reached, in any spelling: a child is shown the mark
      // and one plain line, never a comparison between what anything decided.
      /override|aiState|overriddenAt/iu,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('hands disputing to a slot and keeps none of its state', () => {
    // The dispute control is a sibling of the explanation panel in the row's `grade` slot,
    // for the same reason: a failed objection must not be able to take the answer key down,
    // and this file must keep its "two reads and no third" invariant literally true. So
    // there is no dispute request here, no dispute state and no dispute copy — only the
    // panel, handed a boolean off the row that already arrived.
    expect(CODE).toContain('<DisputePanel');
    expect(CODE).toContain('disputed={row.disputed}');
    // The refreshed view is handed straight back into the screen's own state: the API
    // answers the whole run, so the score and the rows always describe one read.
    expect(CODE).toContain('onDisputed={setResults}');
    // No request of its own, and no state of its own.
    expect(CODE).not.toMatch(/parentApi\.disputeGrade/u);
    expect(CODE).not.toMatch(/useState[^\n]*[Dd]ispute/u);
  });

  it('states the score as a change only when the server said there was one', () => {
    // One denominator (FR-37): the change is stated from the server's two figures through
    // the one function that decides whether there is a change at all, and this file
    // subtracts nothing and compares nothing.
    expect(CODE).toContain('scoreChangeOf(score, results.originalScore)');
    expect(CODE).toContain('data-testid="attempt-results-score-change"');
    expect(CODE).toContain('{scoreChange !== null &&');
    expect(CODE).not.toMatch(/originalScore\.correct\s*[-<>]/u);
  });

  it('hands explaining to a slot and keeps none of its state', () => {
    // Since Story 6.1 each row carries an `ExplainPanel`, and this file's whole
    // involvement is constructing one with three facts it already has. No press, no
    // request, no outcome and no copy of its own — which is what keeps the single
    // `parentApi.` call above true and keeps a failed explanation from taking the
    // answer key down with it.
    expect(CODE).toMatch(/<ExplainPanel\s+attemptId=\{results\.attemptId\}/u);
    expect(CODE.match(/<ExplainPanel/gu)).toHaveLength(1);
    expect(CODE).not.toMatch(/explainQuestion|explainDecision|studentCopy\.results\.explain/u);
  });

  it('appears with no flourish', () => {
    // No count-up, no reveal, no celebration and no per-tick motion: a result is
    // information, and a child who got most of a paper wrong should not have it
    // animated at them.
    expect(CODE).not.toMatch(/Confetti|celebrat|animate|Fade|Grow|Collapse|Zoom|transition/iu);
  });
});

describe('what the results say', () => {
  it('states the score over graded questions while anything is excluded', () => {
    expect(studentCopy.results.scorePartial(3, 4)).toContain('graded questions');
    expect(studentCopy.results.score(3, 4)).not.toContain('graded questions');
    expect(studentCopy.results.score(3, 4)).toContain('3 out of 4');
  });

  it('says something true about an Attempt nothing could grade, rather than dividing', () => {
    expect(studentCopy.results.nothingToScore).toMatch(/nothing/iu);
    expect(studentCopy.results.nothingToScore).not.toContain('0 out of 0');
  });

  it('names the gap, says it is not counted, and says why the total may go up', () => {
    const sentence = studentCopy.results.ungradedGap(2);
    expect(sentence).toContain('2 questions');
    expect(sentence).toContain('not counted');
    expect(sentence).toMatch(/may go up/u);
    // A score that grows between two visits looks like the work changed, and it did
    // not — the grading finished.
    expect(studentCopy.results.ungradedGap(1)).toContain('1 question has');
    expect(studentCopy.results.ungradedGap(1)).not.toContain('1 questions');
  });

  it('names the test by its Subject and length, and drops a Subject it was not given', () => {
    expect(studentCopy.results.testMeta('Mathematics', 8)).toBe('Mathematics · 8 questions');
    expect(studentCopy.results.testMeta('Mathematics', 1)).toBe('Mathematics · 1 question');
    // A test whose Subject does not resolve keeps its place and loses its label,
    // exactly as on Student Home — never a dangling separator.
    expect(studentCopy.results.testMeta(null, 8)).toBe('8 questions');
    expect(studentCopy.results.testMeta('   ', 8)).toBe('8 questions');
    expect(studentCopy.results.testMeta(null, 8)).not.toContain('·');
  });

  it('names the gap without pointing at a figure when none was stated', () => {
    const only = studentCopy.results.ungradedGapOnly(2);
    expect(only).toContain('2 questions');
    // The one thing it must not do: refer to a figure the header never gave.
    expect(only).not.toMatch(/figure above|not counted/u);
    expect(studentCopy.results.ungradedGapOnly(1)).toContain('1 question has');
    expect(studentCopy.results.ungradedGapOnly(1)).not.toContain('1 questions');
    // And the ordinary variant still does refer to it, because there it exists.
    expect(studentCopy.results.ungradedGap(2)).toContain('figure above');
  });

  it('says `1 not correct` rather than `1 not corrects`, and the same of blanks', () => {
    expect(studentCopy.results.metaIncorrect(1)).toBe('1 not correct');
    expect(studentCopy.results.metaIncorrect(3)).toBe('3 not correct');
    expect(studentCopy.results.metaUnanswered(1)).toBe('1 unanswered');
    expect(studentCopy.results.metaUnanswered(3)).toBe('3 unanswered');
  });

  it('addresses the child, with no exclamation mark and no error code anywhere', () => {
    const sentences = [
      studentCopy.results.heading,
      studentCopy.results.score(1, 2),
      studentCopy.results.scorePartial(1, 2),
      studentCopy.results.nothingToScore,
      studentCopy.results.questionsHeading,
      studentCopy.results.question(1),
      studentCopy.results.yourAnswer,
      studentCopy.results.correctAnswer,
      studentCopy.results.noAnswer,
      studentCopy.results.answerUnavailable,
      studentCopy.results.ungradedGap(1),
      studentCopy.results.ungradedGap(2),
      studentCopy.results.ungradedGapOnly(1),
      studentCopy.results.ungradedGapOnly(2),
      studentCopy.results.testMeta('Mathematics', 8),
      studentCopy.results.testMeta(null, 1),
      studentCopy.results.rowUngraded,
      studentCopy.results.rowNewlyGraded,
      studentCopy.results.newlyGradedAnnouncement(1),
      studentCopy.results.newlyGradedAnnouncement(2),
      studentCopy.results.failed,
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toContain('!');
      expect(sentence).not.toMatch(/\b(4\d\d|5\d\d)\b/u);
    }
    expect(studentCopy.results.failed).toBe('Your results could not be loaded.');
  });

  it('leaves the take-test vocabulary with no grade word in it', () => {
    // Correctness is something only a hand-in can claim, and `takeTest` is read while
    // the child is still working.
    const serialized = JSON.stringify(studentCopy.takeTest);
    expect(serialized).not.toMatch(/unanswered|correct|wrong|score|grade/iu);
  });
});
