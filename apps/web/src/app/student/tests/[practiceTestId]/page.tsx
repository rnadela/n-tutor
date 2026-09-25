'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { AppDialog } from '@/components/Dialog';
import { RichText } from '@/components/RichText';
import { Screen } from '@/components/Screen';
import { studentCopy } from '@/copy/student';
import { progressOf } from '@/lib/answers';
import { parentApi, type StudentPracticeTestView } from '@/lib/parent-api';
import { comfortableDensity, measure, rounded, typeRoles } from '@/theme/tokens';
import { deviceIsUnbound } from '../../page';
import { AnswerInput } from '../../_components/AnswerInput';
import { QuestionMap } from '../../_components/QuestionMap';

/**
 * Take Test: one Question at a time, with a map of the whole test beside it.
 *
 * **The URL names the practice test and nothing else.** Which child it belongs
 * to is the binding cookie's answer, server-side, so a child holding a sibling's
 * id learns only that there is nothing there.
 *
 * The answers live in this component's state and nowhere else. Nothing is
 * written to any browser storage API and no request leaves this screen after the
 * read: persistence, the time limit and handing the work in are Stories
 * 5.3–5.4, and a half-built version of any of them would be work a child
 * believed was saved.
 *
 * **Nothing here says anything about being right.** The view it renders carries
 * no answer key — the API never selected one — and the map states only Answered
 * or Not answered. A tally of right answers is not something this screen is in a
 * position to show, and showing one before the work is handed in would be
 * marking it while the child is still doing it.
 *
 * Navigation is linear *and* random-access: Back and Next walk the test, and the
 * map is the escape hatch (UX-DR39). The map is a persistent rail from the `md`
 * breakpoint up and an overlay below it — decided in CSS, both forms rendered,
 * so the first paint agrees with the server's. This screen is one of the two
 * `Screen.tsx` names as the deliberate breakpoint exception, which is why the
 * split is written here. The Question column stays capped at the 34rem measure
 * at every width; the rail takes the surplus (UX-DR15/34).
 */
export default function TakeTestPage() {
  const router = useRouter();
  const params = useParams<{ practiceTestId: string }>();
  const practiceTestId = params.practiceTestId;

  const [test, setTest] = useState<StudentPracticeTestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the retry control, so a read that stopped on a failure re-issues. */
  const [attempt, setAttempt] = useState(0);

  /**
   * What the child has answered, by Question id.
   *
   * A Question nobody has touched is **absent**, never `''` — so "never
   * answered" and "answered then cleared" are one state, because to a child they
   * are. Held here for the page's lifetime and held nowhere else.
   */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** Which Question is on screen, as an index into the stored order. */
  const [index, setIndex] = useState(0);
  /** Whether the overlay form of the map is open. Below `md` only. */
  const [mapOpen, setMapOpen] = useState(false);

  // A response is applied only while it is still the most recent request, so a
  // read superseded by Retry cannot resolve afterwards and overwrite it.
  const requestId = useRef(0);

  /**
   * Which practice test the state below belongs to.
   *
   * Everything this screen holds — the answers, the place in the test, whether
   * the map is open — is *about one practice test*, and a client-side move to a
   * different one has to leave all of it behind. Without this, opening a shorter
   * test from a longer one keeps an `index` past the end, so a perfectly
   * successful read renders the failure alert, and the previous test's answers
   * are still held against the new test's Question ids.
   *
   * Keyed on the id and **not** on `attempt`: a retry is the same test asked for
   * again, and discarding a child's answers because the network dropped once
   * would be this screen throwing away their work.
   *
   * React's documented "adjust state when a prop changes" pattern: it runs in
   * the render phase, so the reset is already applied on the render that moved,
   * rather than one paint later.
   */
  const [loadedTestId, setLoadedTestId] = useState(practiceTestId);
  if (loadedTestId !== practiceTestId) {
    setLoadedTestId(practiceTestId);
    setTest(null);
    setError(null);
    setAnswers({});
    setIndex(0);
    setMapOpen(false);
  }

  useEffect(() => {
    const thisRequest = (requestId.current += 1);
    setLoading(true);
    setError(null);
    parentApi.studentPracticeTest(practiceTestId).then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setTest(value);
        setLoading(false);
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        // The Student Mode guard's own refusal is the one failure that routes
        // anywhere. A 500, a 429, a 404 or a dropped connection is a bad moment,
        // not a Student Mode taken away, and routing a child away on one would
        // make a flaky network look like their practice being withdrawn.
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setLoading(false);
        // Cleared before the failure is stated, or a read that fails *after* one
        // succeeded would leave the previous answer on screen with nothing said
        // about it: the error branch below is reached only while there is no
        // test, so a stale one would swallow the alert entirely.
        setTest(null);
        setError(cause instanceof Error ? cause.message : studentCopy.takeTest.failed);
      },
    );
  }, [practiceTestId, attempt, router]);

  const questions = test?.questions ?? [];
  /**
   * How many Questions there are, counted from the Questions themselves.
   *
   * Not from the stored `questionCount` column: the counter and the Next control
   * have to be reading the same figure, and sourcing one from the column and the
   * other from the array is how a screen ends up saying "Question 3 of 5" with
   * Next already disabled.
   */
  const total = questions.length;
  /**
   * Every Question's progress state, in the order the server gave them.
   *
   * Derived on every render from the answers themselves, so the map cannot
   * disagree with the controls: there is no second copy of "is this answered"
   * for the two to drift apart on.
   */
  const progress = useMemo(() => progressOf(questions, answers), [questions, answers]);

  const question = questions[index];

  const jumpTo = useCallback((next: number) => {
    setIndex(next);
    setMapOpen(false);
  }, []);

  if (loading || (test === null && error === null)) {
    return (
      <Screen component="section" measured>
        <Alert severity="info" role="status" variant="outlined">
          {studentCopy.takeTest.loading}
        </Alert>
      </Screen>
    );
  }

  if (test === null || question === undefined) {
    return (
      <Screen component="section" measured>
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="take-test-error"
          action={
            <Button
              onClick={() => setAttempt((value) => value + 1)}
              sx={{ minHeight: comfortableDensity.tapTarget }}
            >
              {studentCopy.retry}
            </Button>
          }
        >
          {error ?? studentCopy.takeTest.failed}
        </Alert>
      </Screen>
    );
  }

  const promptId = `question-prompt-${question.id}`;
  const answer = answers[question.id] ?? '';
  const setAnswer = (next: string) =>
    setAnswers((previous) => ({ ...previous, [question.id]: next }));

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: `${comfortableDensity.gap}px`,
      }}
    >
      <Screen component="section" measured>
        <Typography data-testid="take-test-counter" sx={{ ...typeRoles.label }}>
          {studentCopy.takeTest.counter(question.ordinal, total)}
        </Typography>
        <Typography data-testid="take-test-format" sx={{ ...typeRoles.caption }}>
          {studentCopy.takeTest.format[question.format]}
        </Typography>

        {/* The paper role: near-square radius, the generated-content type role,
            and the 34rem measure the column already carries (UX-DR12/15). */}
        <Box
          data-testid="take-test-question"
          sx={(theme) => ({
            borderRadius: `${rounded.paper}px`,
            border: `1px solid ${theme.vars.palette.divider}`,
            backgroundColor: theme.vars.palette.background.paper,
            padding: `${comfortableDensity.cardPadding}px`,
            maxWidth: measure.questionMaxWidth,
            display: 'grid',
            gap: `${comfortableDensity.gap}px`,
          })}
        >
          <Typography id={promptId} component="p" sx={{ ...typeRoles.questionBody }}>
            <RichText segments={question.prompt} />
          </Typography>
          <AnswerInput
            question={question}
            value={answer}
            onChange={setAnswer}
            labelledBy={promptId}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: `${comfortableDensity.gap}px`, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            data-testid="take-test-back"
            disabled={index === 0}
            onClick={() => jumpTo(index - 1)}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {studentCopy.takeTest.back}
          </Button>
          <Button
            variant="outlined"
            data-testid="take-test-next"
            disabled={index >= questions.length - 1}
            onClick={() => jumpTo(index + 1)}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {studentCopy.takeTest.next}
          </Button>
          {/* The overlay's opener. Hidden from `md` up in CSS, where the rail is
              already on screen — never by a JS media query, which would make the
              first paint disagree with the server's. */}
          <Button
            variant="outlined"
            data-testid="take-test-map-open"
            onClick={() => setMapOpen(true)}
            sx={{
              minHeight: comfortableDensity.tapTarget,
              display: { xs: 'inline-flex', md: 'none' },
            }}
          >
            {studentCopy.takeTest.openMap}
          </Button>
        </Box>
      </Screen>

      {/* The rail: the same component the overlay holds, so the two forms can
          never drift into saying different things about the same test. */}
      <Box
        data-testid="take-test-map-rail"
        component="aside"
        sx={{
          display: { xs: 'none', md: 'block' },
          paddingBlock: `${comfortableDensity.sectionMargin}px`,
          paddingInline: `${comfortableDensity.cardPadding}px`,
        }}
      >
        <QuestionMap progress={progress} currentIndex={index} onJump={jumpTo} />
      </Box>

      <AppDialog
        open={mapOpen}
        title={studentCopy.takeTest.mapHeading}
        onClose={() => setMapOpen(false)}
        actions={
          <Button
            data-testid="take-test-map-close"
            onClick={() => setMapOpen(false)}
            sx={{ minHeight: comfortableDensity.tapTarget }}
          >
            {studentCopy.takeTest.closeMap}
          </Button>
        }
      >
        <QuestionMap progress={progress} currentIndex={index} onJump={jumpTo} />
      </AppDialog>
    </Box>
  );
}
