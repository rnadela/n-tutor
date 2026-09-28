'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { AnswerKeyRow, type AnswerKeyRowLabels } from '@/components/AnswerKeyRow';
import { Screen } from '@/components/Screen';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { explanationsByQuestion } from '@/lib/explanation-review';
import {
  parentApi,
  ParentApiError,
  type AttemptResultsView,
  type ParentExplanationView,
} from '@/lib/parent-api';
import {
  announcedText,
  applyIfCurrent,
  endsParentView,
  NOTHING_ANNOUNCED,
  type Announcement,
} from '@/lib/parent-view';
import { ExplanationReview } from '../../_components/ExplanationReview';

/**
 * The words a parent reads on every answer-key row.
 *
 * Built here from `parentCopy.attempts`, once, and handed to the same component the
 * child's results screen renders: the layout is shared and the person is a parameter,
 * so the state's five redundant carriers cannot come to disagree between the two
 * surfaces. Module-level rather than per render — it is a constant, and a fresh object
 * per render would be a new prop identity on every row of a long paper.
 */
/**
 * The empty list a Question nobody asked about is handed.
 *
 * Module-level rather than a fresh `[]` per row: it is a constant, and a new identity on
 * every render would be a new prop identity on every row of a long paper.
 */
const NOTHING_EXPLAINED: readonly ParentExplanationView[] = [];

const PARENT_ROW_LABELS: AnswerKeyRowLabels = {
  question: parentCopy.attempts.question,
  format: parentCopy.attempts.format,
  studentAnswer: parentCopy.attempts.studentAnswer,
  noAnswer: parentCopy.attempts.noAnswer,
  correctAnswer: parentCopy.attempts.correctAnswer,
  answerUnavailable: parentCopy.attempts.answerUnavailable,
  rowUngraded: parentCopy.attempts.rowUngraded,
  rowNewlyGraded: parentCopy.attempts.rowNewlyGraded,
};

/**
 * One handed-in run, as the parent reads it: the score, every Question's answer key,
 * and beneath each Question whatever their child was told about it.
 *
 * **Two reads, and they settle independently.** The answer key is the screen; the
 * Explanations are what each row says underneath. Failing them together would blank a
 * paper that came back perfectly well because the prose could not be looked up — so a
 * failed Explanation read is a sentence beside the answer key, and the key still
 * renders. Neither read generates anything: opening this screen consumes no
 * Explanation Allowance, and a Question the child never asked about says so.
 *
 * **A failed prose read says nothing about the child.** The rows' regions are not
 * rendered at all in that case: from inside one, prose nobody asked for and prose that
 * could not be read are the same `undefined`, and the sentence it would draw is a
 * claim about what the child asked. So the failure is stated once, by the screen,
 * with its own Retry — not twenty times, as a fact about the child.
 *
 * **The score is the server's.** `AttemptResultsView` carries the one figure FR-37
 * allows, computed over exactly the rows in the same response. Nothing here counts
 * states.
 *
 * **One live region, owned here.** Flag outcomes are announced through it with the
 * exact sentence the row displays, which is why `ExplanationReview` takes `announce`
 * as a prop rather than reaching for a region of its own: one surface, one region.
 *
 * The Attempt id comes off the URL and nothing is stored: a reload, a returning parent
 * and an idle expiry all resume from the address bar. A foreign, unknown or still-open
 * Attempt is one sentence from the API, and this screen states it with the way back
 * beside it.
 */
export default function ParentAttemptDetailPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId;
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [results, setResults] = useState<AttemptResultsView | null>(null);
  const [explanations, setExplanations] = useState<ParentExplanationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The Explanation read's own failure, stated beside a paper that still renders. */
  const [proseError, setProseError] = useState<string | null>(null);
  /**
   * Whether the Explanations read has actually answered, success or failure.
   *
   * The two reads settle independently and the results read is often the faster of
   * the two, so `loading` can already be false while the prose is still in flight.
   * Without this flag, `explain` would render in that window with `explanations`
   * still `[]` — indistinguishable from a Question the child never asked about — and
   * a row would tell a parent nothing was explained about a Question whose prose
   * simply has not arrived yet.
   */
  const [proseLoaded, setProseLoaded] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement>(NOTHING_ANNOUNCED);
  /** Every announcement is a change, repeats included. */
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => ({ text, seq: previous.seq + 1 })),
    [],
  );
  /** Bumped by Retry, so a load that stopped on an error re-issues. */
  const [attempt, setAttempt] = useState(0);

  const requestId = useRef(0);
  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  useEffect(() => {
    const issued = (requestId.current += 1);
    current.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    setProseError(null);
    setProseLoaded(false);
    // **Both held lists are dropped as the read re-issues**, and that is not
    // housekeeping. Two runs of one Practice Test present the *same Question ids*, so
    // a paper left in state while the next run loads would draw the previous run's
    // prose — and its flagged state — under the new run's Questions. Dropping them
    // here means the worst this screen can show is nothing yet.
    setResults(null);
    setExplanations([]);
    // A prior run's flag outcome does not describe this run's Questions.
    setAnnouncement(NOTHING_ANNOUNCED);

    parentApi.parentAttemptResults(token, attemptId).then(
      applyIfCurrent(current.current, issued, (view: AttemptResultsView) => {
        setResults(view);
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        // Nothing to render beside the refusal. A paper left standing under "that
        // practice test could not be found" would be two statements, one of them
        // untrue — and after a Retry that failed, the one on screen is the stale one.
        setResults(null);
        setError(
          cause instanceof ParentApiError && cause.status === 404
            ? parentCopy.attempts.notFound
            : cause instanceof Error
              ? cause.message
              : parentCopy.attempts.detailFailed,
        );
      }),
    );

    // The prose the child was shown, read separately and failing separately: a paper
    // that came back is a paper worth rendering, whatever happened to the
    // Explanations beside it.
    parentApi.attemptExplanations(token, attemptId).then(
      applyIfCurrent(current.current, issued, (found: ParentExplanationView[]) => {
        setExplanations(found);
        setProseLoaded(true);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setProseError(parentCopy.attempts.explanationsFailed);
        setProseLoaded(true);
      }),
    );
  }, [token, attemptId, attempt, leave, router]);

  /**
   * This Attempt's Explanations, grouped by the Question each is about.
   *
   * Rebuilt per render from the list in state, which is cheap and always true: a write
   * replaces entries in that list, and a map cached across renders would be the one
   * thing holding the old state.
   *
   * A **list** per Question since Story 6.4: an explanation a parent removed and the
   * replacement that followed it are two entries of one Question, and the region renders
   * both.
   */
  const byQuestion = explanationsByQuestion(explanations);

  /**
   * Replaces one generation with the state a flag or a decision answered with.
   *
   * Matched on `(questionId, generation)` and no longer on the Question id alone, which now
   * matches several rows: a replace by Question id would rewrite a removed explanation with
   * the state of its replacement, and the parent would watch their own decision vanish off
   * the screen.
   */
  const onFlagged = useCallback((view: ParentExplanationView) => {
    setExplanations((previous) =>
      previous.map((held) =>
        held.questionId === view.questionId && held.generation === view.generation ? view : held,
      ),
    );
  }, []);

  /**
   * Replaces **every** entry for one Question with the array a removal or a replacement
   * answered with.
   *
   * Its own handler beside `onFlagged`, and not a widening of it, because these two writes
   * change the history rather than one row: a removal changes one generation but the screen
   * must redraw the lot, and a replacement *adds* one — which a replace-by-generation
   * handler would drop on the floor, because there is nothing on screen yet for it to match.
   *
   * The Question's old entries are dropped and the answer's are appended **at the end of the
   * list**, in the API's own order, which states a Question's generations oldest first. So this
   * *does* move that Question's entries relative to the other Questions' — and that is safe
   * because nothing reads this list's order: the rows are rendered from the answer key, in the
   * order the child met the Questions, and each row looks its own entries up by Question id
   * through `explanationsByQuestion`. What has to hold is that a Question's generations stay in
   * ordinal order relative to *each other*, which appending the API's array whole is exactly
   * what preserves.
   *
   * Appending rather than splicing in place for that reason: a splice would be a second opinion
   * about an order nothing consults, written to look tidy in a state dump.
   */
  const onGenerations = useCallback((views: readonly ParentExplanationView[]) => {
    const questionId = views[0]?.questionId;
    if (questionId === undefined) return;
    setExplanations((previous) => [
      ...previous.filter((held) => held.questionId !== questionId),
      ...views,
    ]);
  }, []);

  return (
    <Screen>
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
        {parentCopy.attempts.detailTitle}
      </Typography>

      {/* One region for this surface. Every outcome is announced with the same words
          the row shows. */}
      <Box
        role="status"
        aria-live="polite"
        sx={{ minHeight: 0 }}
        data-testid="parent-attempt-announcement"
      >
        {announcedText(announcement)}
      </Box>

      {error !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="parent-attempt-error"
          action={
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {parentCopy.attempts.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading ? (
        <Typography component="p" data-testid="parent-attempt-loading">
          {parentCopy.attempts.loading}
        </Typography>
      ) : (
        results !== null && (
          <>
            <Typography component="h2" variant="cardTitle" data-testid="parent-attempt-subject">
              {results.subjectName ?? parentCopy.attempts.unknownSubject}
            </Typography>
            {/* The server's two figures, over exactly the rows below. The browser
                counts nothing (FR-37). */}
            <Typography component="p" data-testid="parent-attempt-score">
              {parentCopy.attempts.score(results.score.correct, results.score.denominator)}
            </Typography>
            {results.score.excludedUngraded > 0 && (
              <Typography component="p" data-testid="parent-attempt-excluded">
                {parentCopy.attempts.excluded(results.score.excludedUngraded)}
              </Typography>
            )}

            {proseError !== null && (
              // The answer key still renders. This sentence is about the prose beneath
              // it and nothing else — and it carries its **own** Retry, because the
              // only other one on this screen belongs to the answer-key failure and is
              // not rendered when the key came back. An instruction to try again with
              // nothing to press would be a dead end.
              <Alert
                severity="error"
                variant="outlined"
                data-testid="parent-attempt-prose-error"
                action={
                  <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
                    {parentCopy.attempts.retry}
                  </Button>
                }
              >
                {proseError}
              </Alert>
            )}

            <Typography
              component="h3"
              sx={{ fontSize: 16, fontWeight: 700 }}
              data-testid="parent-attempt-questions"
            >
              {parentCopy.attempts.questionsHeading}
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
                  // The parent's own words, about their child and never to them.
                  labels={PARENT_ROW_LABELS}
                  // Beneath the Question it is about (UX-DR16), in the row's own
                  // slot: the row stays hookless and gains no notion of explaining,
                  // and every press, state and sentence lives in the region itself.
                  //
                  // **No region at all while the prose read has failed.** An absent
                  // Explanation and an Explanation that could not be read look
                  // identical from inside the region — both are `undefined` — and the
                  // sentence it would draw is "the student did not ask about this
                  // question", which is a claim about the child that a screen whose
                  // read failed is in no position to make, repeated once per row. The
                  // one true sentence is the screen's, stated above with its Retry.
                  //
                  // **Nothing renders until the prose read has actually settled.**
                  // While it is still in flight, an absent Explanation and one that
                  // simply has not arrived yet look identical from inside the region —
                  // rendering early would draw "the student did not ask" about a
                  // Question whose prose is still on its way.
                  explain={
                    token === null || proseError !== null || !proseLoaded ? null : (
                      <ExplanationReview
                        attemptId={results.attemptId}
                        questionId={row.questionId}
                        ordinal={row.ordinal}
                        explanations={byQuestion.get(row.questionId) ?? NOTHING_EXPLAINED}
                        token={token}
                        announce={announce}
                        onFlagged={onFlagged}
                        onGenerations={onGenerations}
                        onElevationLost={leave}
                      />
                    )
                  }
                />
              ))}
            </Box>
          </>
        )
      )}

      <Link component={NextLink} href="/parent/attempts">
        {parentCopy.attempts.backToList}
      </Link>
    </Screen>
  );
}
