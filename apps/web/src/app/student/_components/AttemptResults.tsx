'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAnnounce } from '@/components/LiveRegion';
import { studentCopy } from '@/copy/student';
import { parentApi, type AttemptResultsView } from '@/lib/parent-api';
import { newlyGradedCount, summaryOf } from '@/lib/results-summary';
import { comfortableDensity, typeRoles } from '@/theme/tokens';
import { deviceIsUnbound } from '../page';
import { AnswerKeyRow } from './AnswerKeyRow';

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
 */
export function AttemptResults({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [results, setResults] = useState<AttemptResultsView | null>(null);
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
          <AnswerKeyRow key={row.questionId} row={row} />
        ))}
      </Box>
    </Box>
  );
}
