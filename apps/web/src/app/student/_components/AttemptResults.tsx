'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { AnswerKeyRow, type AnswerKeyRowLabels } from '@/components/AnswerKeyRow';
import { useAnnounce } from '@/components/LiveRegion';
import { studentCopy } from '@/copy/student';
import { parentApi, type AttemptResultsView } from '@/lib/parent-api';
import { scoreChangeOf } from '@/lib/grade-dispute';
import { newlyGradedCount, summaryOf } from '@/lib/results-summary';
import { comfortableDensity, typeRoles } from '@/theme/tokens';
import { deviceIsUnbound } from '../page';
import { DisputePanel } from './DisputePanel';
import { ExplainPanel } from './ExplainPanel';

/**
 * The words the child reads on every answer-key row.
 *
 * Built here, once, from `studentCopy` — the row itself imports no copy at all, so
 * that the parent's Attempt detail can render the identical layout in the third
 * person. Module-level rather than per render: it is a constant, and a fresh object
 * per render would be a new prop identity on every row of a long paper.
 */
const STUDENT_ROW_LABELS: AnswerKeyRowLabels = {
  question: studentCopy.results.question,
  format: studentCopy.takeTest.format,
  studentAnswer: studentCopy.results.yourAnswer,
  noAnswer: studentCopy.results.noAnswer,
  correctAnswer: studentCopy.results.correctAnswer,
  answerUnavailable: studentCopy.results.answerUnavailable,
  rowUngraded: studentCopy.results.rowUngraded,
  rowNewlyGraded: studentCopy.results.rowNewlyGraded,
  // The one line the child is told about a mark a grown-up set. It is true of a row nobody
  // disputed too — a parent may set a mark their child never objected to — which is why it
  // is a row label and not part of the dispute control's own region.
  rowParentAdjusted: studentCopy.results.dispute.reviewed,
};

/**
 * The empty suppression set, as one frozen value.
 *
 * Module-level rather than a fresh `new Set()` per render or per read: it is the initial
 * state and the reset, and a new identity each time would be a new prop identity on every
 * row of a long paper.
 */
const EMPTY_SUPPRESSION: ReadonlySet<string> = new Set<string>();

/**
 * The answer key: what one handed-in Attempt came to, every Question of it.
 *
 * **Reading it is the retry.** FR-22 makes viewing the trigger, so the one `GET`
 * this makes is what re-asks the provider for anything nothing has judged. Nothing
 * here polls, nothing is queued and nothing retries on a timer — the only second
 * read is a child pressing `Try again` after a failure, which is a person asking
 * rather than a loop.
 *
 * **One read per Attempt.** The effect is keyed on the Attempt id, so a re-render, a
 * tick of the clock or a state change elsewhere on the screen does not re-ask and
 * cannot bill a second provider call.
 *
 * **The rows are rendered exactly as they arrive.** No sort, no filter, no grouping:
 * the order is the order the child met the Questions in, which the server already
 * decided, and putting the wrong answers together would be re-writing the paper.
 *
 * **The score is the server's one figure.** FR-37's denominator arrives in `score`
 * and nothing here computes a second one — while anything is unjudged the sentence
 * says what the fraction is *over*, and a zero denominator is stated in words rather
 * than divided.
 *
 * **It routes nowhere on a failed read.** A 404, a 500 or a dropped connection is a
 * bad moment, not Student Mode taken away; the one exception is the guard's own
 * refusal, `deviceIsUnbound`, which is the same exception every other read on this
 * surface makes.
 *
 * **Nothing appears with a flourish.** No count-up, no reveal, no celebration and no
 * per-tick motion. The one thing announced is a Question this read just resolved,
 * and it is announced with the very sentence that is displayed.
 *
 * **Explaining is somebody else's state.** Since Story 6.1 each row carries an
 * `ExplainPanel` in its own slot, and this component neither knows nor can act on
 * what it does: the panel owns its press, its request and its outcomes, which is why a
 * failed explanation cannot take the answer key down with it.
 *
 * **Two reads and no third: the answer key from `grading`, and which Explanations a parent
 * removed from `explanation`. Never one per Question, and never one per press.** Story 6.4
 * added the second, and it is attempt-scoped for exactly that reason: the panel is mounted
 * per row, so learning suppression at press time would leave a child one tap from undoing
 * their parent's decision — and on a Free account, one allowance unit spent doing it — while
 * asking per Question would be one request per row on load. `grading` is deliberately not
 * the carrier: a suppression fact in `AnswerKeyRowView` would put an `explanation` column in
 * the module that owns grades.
 *
 * **A failed or still-pending suppression read renders the control as usual**, and degrades
 * to the API's serve-time check — which answers 200 suppressed, generating nothing and
 * charging nothing. That is exactly why that check exists and why it is not a cache trick,
 * and it is why this read has no error state and no retry of its own: there is nothing for a
 * child to do about it and nothing at stake in it failing.
 *
 * **`footer` is a slot and nothing more.** Since Story 5.7 the page renders a control
 * beneath the rows, and it passes it in rather than this component growing a notion of
 * retaking: what a retake replaces is the run state the *page* holds, and a component
 * that owns one Attempt's read has no business starting a second one.
 */
export function AttemptResults({
  attemptId,
  footer,
}: {
  attemptId: string;
  /**
   * Rendered after the rows, once there are rows.
   *
   * A slot rather than a prop with a meaning: this component keeps owning its own
   * read, its own loading state and its own failure, and **gains no knowledge of
   * retaking** — it does not know what is in here and cannot act on it. Nothing is
   * rendered in the loading or failure branches, because a control that replaces a
   * finished run belongs under a run that was actually read.
   */
  footer?: ReactNode;
}) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [results, setResults] = useState<AttemptResultsView | null>(null);
  /**
   * The Question ids a parent has removed the explanation for, as a set for lookup.
   *
   * Empty until the read lands and empty if it fails, deliberately: an empty set draws the
   * control, and a press then answers 200 suppressed with nothing generated and nothing
   * charged. There is no error state and no retry for it, because there is nothing for a
   * child to do about it — and a sentence about a read they never asked for would be the
   * screen narrating its own housekeeping at them.
   */
  const [suppressed, setSuppressed] = useState<ReadonlySet<string>>(EMPTY_SUPPRESSION);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Guards the retry button so a second click cannot fire a second `GET` — and a
  // second billed re-ask — before the first read has settled.
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let live = true;
    // Cleared before the read, so a retry after a failure does not state the old
    // failure over the new answer — and so a different Attempt never shows the
    // previous one's rows for a frame.
    setResults(null);
    setError(null);
    setPending(true);
    parentApi.attemptResults(attemptId).then(
      (value) => {
        if (!live) return;
        setPending(false);
        setResults(value);
      },
      (cause: unknown) => {
        if (!live) return;
        // The one refusal that is about the binding rather than about this Attempt.
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setPending(false);
        setError(cause instanceof Error ? cause.message : studentCopy.results.failed);
      },
    );
    return () => {
      live = false;
    };
  }, [attemptId, reload, router]);

  /**
   * Which Explanations a parent removed, read once per Attempt, beside the answer key.
   *
   * Its own effect rather than a chained `then`, so the two reads settle independently: the
   * answer key is the screen and must not wait on, or fail with, a list of ids that only
   * decides whether a control is drawn.
   *
   * **Every failure is swallowed on purpose**, and it is the only read on this surface that
   * swallows one — including `deviceIsUnbound`, which the answer-key read beside it already
   * acts on. Nothing here is a fact the child needs and nothing here is a fact this screen
   * can act on: the set stays empty, the control is drawn, and the API refuses the press
   * without generating or charging anything.
   */
  useEffect(() => {
    let live = true;
    setSuppressed(EMPTY_SUPPRESSION);
    parentApi.suppressedExplanations(attemptId).then(
      (ids) => {
        if (live) setSuppressed(new Set(ids));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [attemptId, reload]);

  /**
   * Announced once per read, and never twice for the same one.
   *
   * Latched on the response object itself rather than on a count: two reads that
   * resolved the same number of Questions are two different facts, and a count-keyed
   * guard would silently swallow the second.
   */
  const announced = useRef<AttemptResultsView | null>(null);
  useEffect(() => {
    if (results === null || announced.current === results) return;
    announced.current = results;
    const resolved = newlyGradedCount(results.questions);
    if (resolved === 0) return;
    // The same string that is rendered below, so what is spoken and what is shown
    // cannot come apart.
    announce(studentCopy.results.newlyGradedAnnouncement(resolved));
  }, [results, announce]);

  if (error !== null) {
    return (
      <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap}px` }}>
        <Alert
          severity="error"
          role="status"
          variant="outlined"
          data-testid="attempt-results-error"
        >
          {error}
        </Alert>
        {/* A person asking again. Nothing re-issues this read on its own. */}
        <Button
          variant="outlined"
          disabled={pending}
          onClick={() => setReload((value) => value + 1)}
          sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
          data-testid="attempt-results-retry"
        >
          {studentCopy.retry}
        </Button>
      </Box>
    );
  }

  if (results === null) {
    return (
      <Alert severity="info" role="status" variant="outlined" data-testid="attempt-results-loading">
        {studentCopy.results.loading}
      </Alert>
    );
  }

  const { score } = results;
  /**
   * The two figures a changed score is stated as, or null when there is no change.
   *
   * Derived by the one pure function that decides it, so the rule — null when the server
   * sent no prior figure, and null for a pair that cannot be stated over one denominator —
   * is asserted without a DOM rather than living inside this render.
   */
  const scoreChange = scoreChangeOf(score, results.originalScore);
  const summary = summaryOf(results.questions);
  const resolved = newlyGradedCount(results.questions);
  // Suppressed rather than rendered as two zeroes: `0 not correct · 0 unanswered` is
  // a line about nothing, and it is exactly the line a child who got everything right
  // would be shown. Nothing to say, so nothing is said.
  const meta =
    summary.incorrect === 0 && summary.unanswered === 0
      ? null
      : [
          studentCopy.results.metaIncorrect(summary.incorrect),
          studentCopy.results.metaUnanswered(summary.unanswered),
        ].join(' · ');

  return (
    <Box
      component="section"
      sx={{ display: 'grid', gap: `${comfortableDensity.gap}px` }}
      data-testid="attempt-results"
    >
      <Typography
        component="h2"
        sx={{ ...typeRoles.cardTitle }}
        data-testid="attempt-results-heading"
      >
        {studentCopy.results.heading}
      </Typography>

      {/* Which test this is. Reached from history as well as from a hand-in, so the
          Subject and the length are the only things on screen that say which one. */}
      <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="attempt-results-test">
        {studentCopy.results.testMeta(results.subjectName, results.questionCount)}
      </Typography>

      {/* One sentence, chosen by what the server stated. A zero denominator is said
          in words: `0 out of 0` is not a sentence and dividing by it is not a thing
          this screen does. */}
      <Typography
        component="p"
        sx={{ ...typeRoles.dashboardBody }}
        data-testid="attempt-results-score"
      >
        {score.denominator === 0
          ? studentCopy.results.nothingToScore
          : score.excludedUngraded > 0
            ? studentCopy.results.scorePartial(score.correct, score.denominator)
            : studentCopy.results.score(score.correct, score.denominator)}
      </Typography>

      {/* The same two figures stated as a change, once a grown-up has set a mark — and
          never instead of the fraction above, which is still what the paper came to. Both
          counts and the one denominator are the server's; this screen divides nothing and
          subtracts nothing (FR-37).

          Null when the server sent no prior figure, which is the whole of "nothing was
          adjusted": comparing two fractions here and deciding for ourselves whether that
          counts as a change would be a second derivation of a fact the server already
          stated. */}
      {scoreChange !== null && (
        <Typography
          component="p"
          sx={{ ...typeRoles.caption }}
          data-testid="attempt-results-score-change"
        >
          {studentCopy.results.dispute.scoreChanged(
            scoreChange.before,
            scoreChange.after,
            scoreChange.denominator,
          )}
        </Typography>
      )}

      {meta !== null && (
        <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="attempt-results-meta">
          {meta}
        </Typography>
      )}

      {/* The gap: how many are excluded, that they are not in the figure above, and
          that the total may go up next time — because that is the grading finishing
          and not the work changing.

          The variant is chosen by whether there **was** a figure. With a zero
          denominator the header said `nothingToScore` instead of a fraction, so a
          sentence pointing at "the figure above" would be pointing at nothing. */}
      {score.excludedUngraded > 0 && (
        <Alert severity="info" role="status" variant="outlined" data-testid="attempt-results-gap">
          {score.denominator === 0
            ? studentCopy.results.ungradedGapOnly(score.excludedUngraded)
            : studentCopy.results.ungradedGap(score.excludedUngraded)}
        </Alert>
      )}

      {/* Displayed as well as announced, with the one string both come from. */}
      {resolved > 0 && (
        <Typography
          component="p"
          sx={{ ...typeRoles.dashboardBody }}
          data-testid="attempt-results-newly-graded"
        >
          {studentCopy.results.newlyGradedAnnouncement(resolved)}
        </Typography>
      )}

      <Typography
        component="h3"
        sx={{ ...typeRoles.label }}
        data-testid="attempt-results-questions"
      >
        {studentCopy.results.questionsHeading}
      </Typography>
      <Box
        component="ul"
        role="list"
        sx={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}
      >
        {results.questions.map((row) => (
          <AnswerKeyRow
            key={row.questionId}
            row={row}
            // The child's own words. The row states no person of its own, which is
            // what lets the parent's Attempt detail render this same layout about
            // their child instead of to them.
            labels={STUDENT_ROW_LABELS}
            // The row's own `grade` slot, before the explanation: a mark is what the
            // row is about, and asking why is a thing done afterwards. Handed as a
            // slot for the same reason `explain` is — neither this component nor the
            // row gains a notion of disputing, and a failed objection cannot take the
            // answer key down.
            //
            // **No third read.** The reported state is a field on the row that
            // arrived with the answer key, and a press answers the whole refreshed
            // view — so nothing here asks per Question and nothing asks per press
            // beyond the press itself.
            grade={
              <DisputePanel
                attemptId={results.attemptId}
                questionId={row.questionId}
                ordinal={row.ordinal}
                disputed={row.disputed}
                // The API answers the whole view, so the screen re-renders from one
                // response rather than patching a row — which is what keeps the score
                // and the rows describing the same read.
                onDisputed={setResults}
              />
            }
            // Handed to the row as a slot, so neither this component nor the row
            // gains a notion of explaining: all the state, the press, the request
            // and the four outcomes live in `ExplainPanel`, which is what keeps the
            // one-read invariant above literally true and keeps the row hookless.
            explain={
              <ExplainPanel
                attemptId={results.attemptId}
                questionId={row.questionId}
                ordinal={row.ordinal}
                // Per row, off the one attempt-scoped read. `false` while that read is in
                // flight or after it failed, which draws the control and leaves the refusal
                // to the API's serve-time check.
                suppressed={suppressed.has(row.questionId)}
              />
            }
          />
        ))}
      </Box>
      {/* Whatever the page put here, after everything this component owns. The
          control that opens another run is the **page's**, because only the page
          holds the run state a retake replaces. */}
      {footer}
    </Box>
  );
}
