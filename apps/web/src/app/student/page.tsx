'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import type { Route } from 'next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Link from '@mui/material/Link';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import {
  ParentApiError,
  parentApi,
  type StudentPracticeTestSummary,
  type StudentSession,
} from '@/lib/parent-api';
import { comfortableDensity } from '@/theme/tokens';

/**
 * Whether a failure means this device is not set up for a child at all, as
 * opposed to something transient the reader could try again.
 *
 * Only the Student Mode guard's own refusal sends anyone to sign-in. A 500, a
 * 429 or a dropped connection is a bad moment, not an unbound device, and
 * routing a child away on one would make a flaky network look like a Student
 * Mode that had been taken away from them.
 *
 * Exported so the rule is testable as a rule, not only through a render.
 */
export function deviceIsUnbound(cause: unknown): boolean {
  return cause instanceof ParentApiError && cause.notBound;
}

/**
 * Student Mode: the device's default state, and the whole of what a child sees.
 *
 * It reads two endpoints, `GET /api/student/session` and
 * `GET /api/student/practice-tests`, both of which answer from the binding cookie
 * alone — nothing here names a profile id, and no parent-scoped call exists on
 * this page. The one control leads to the PIN gate, which is the only way out.
 *
 * The two reads settle **independently**. The session read is the screen; the
 * practice-test read fills it. One failing read must not blank what the other
 * answered, which is the reason Pending drafts gives for the same arrangement —
 * and each carries its **own** failure state with its own way to try again, so a
 * bad moment on one is never a child left holding a greeting and no way forward.
 *
 * What a released practice test shows is an identifier's worth: how many
 * questions it holds. There is nothing to open, because taking one is Epic 5's —
 * and a student-scoped read carrying prompts and correct answers would hand a
 * child the answer key the whole quality gate exists to keep from them.
 */
export default function StudentModePage() {
  const router = useRouter();
  const [session, setSession] = useState<StudentSession | null>(null);
  /**
   * The released practice tests, or `null` while the read has not answered.
   *
   * Held apart from an empty array, because "there is nothing to practise yet" is
   * a claim this screen cannot make when it never heard back — and saying it
   * beside a failed read would be one of the two untrue.
   */
  const [tests, setTests] = useState<StudentPracticeTestSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The list read's own failure, held apart from the session's.
   *
   * Without it, a 500 or a dropped connection on this read alone would leave the
   * list unanswered *and* nothing said: no rows, no "nothing yet" sentence — that
   * one is a claim only an answered read can make — and no error either, since the
   * retry control renders from a failure. A child would be left on a greeting with
   * nothing to act on. It is the list's own alert, so the greeting the session read
   * answered stays on screen beside it.
   */
  const [testsError, setTestsError] = useState<string | null>(null);
  // A response is applied only while it is still the most recent request, so a
  // read superseded by Retry cannot resolve afterwards and overwrite it.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const thisRequest = (requestId.current += 1);
    setLoading(true);
    setError(null);
    setTests(null);
    setTestsError(null);
    parentApi.studentSession().then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setSession(value);
        setLoading(false);
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : studentCopy.failed);
      },
    );

    // Settled on its own, and deliberately not as one `Promise.all` with the
    // session: a list that could not be read must not blank a greeting that came
    // back perfectly well. An unbound device is the one failure this read also
    // acts on, and it acts on it the same way — the binding is what both reads
    // share, so a refusal of it is not about the list.
    parentApi.studentPracticeTests().then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setTests(value);
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        // Anything else is a bad moment, not a Student Mode taken away: it is
        // said where the list would have been, with a control that re-issues both
        // reads, and it never routes a child anywhere.
        setTestsError(cause instanceof Error ? cause.message : studentCopy.failed);
      },
    );
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card sx={{ maxWidth: 560, mx: 'auto' }}>
      <CardContent sx={{ padding: `${comfortableDensity.cardPadding}px` }}>
        <Typography
          component="h1"
          sx={{ fontSize: 24, fontWeight: 700, mb: `${comfortableDensity.gap}px` }}
        >
          {studentCopy.title}
        </Typography>
        {loading || session === null ? (
          error === null ? (
            <Alert severity="info" role="status" variant="outlined">
              {studentCopy.loading}
            </Alert>
          ) : (
            <Alert
              severity="error"
              role="alert"
              variant="outlined"
              action={
                <Button onClick={load} sx={{ minHeight: comfortableDensity.tapTarget }}>
                  {studentCopy.retry}
                </Button>
              }
            >
              {error}
            </Alert>
          )
        ) : (
          <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap}px` }}>
            <Typography>{studentCopy.greeting(session.profile.displayName)}</Typography>
            <Typography>{studentCopy.gradeLevel(session.profile.gradeLevelName)}</Typography>

            {/* The list's own failure, beside a greeting that came back perfectly
                well. Retryable, and it never routes the child away. */}
            {testsError !== null && (
              <Alert
                severity="error"
                role="alert"
                variant="outlined"
                data-testid="student-tests-error"
                action={
                  <Button onClick={load} sx={{ minHeight: comfortableDensity.tapTarget }}>
                    {studentCopy.retry}
                  </Button>
                }
              >
                {testsError}
              </Alert>
            )}

            {/* Only once the list has actually answered. "There is nothing to
                practise yet" is a claim about this child's practice tests, and a
                read that never came back is in no position to make it. */}
            {tests !== null &&
              (tests.length === 0 ? (
                <Typography data-testid="student-empty">{studentCopy.empty}</Typography>
              ) : (
                <>
                  <Typography component="h2" sx={{ fontWeight: 700 }}>
                    {studentCopy.practiceTestsTitle}
                  </Typography>
                  <Box
                    component="ul"
                    // `listStyle: 'none'` strips list semantics in
                    // Safari/VoiceOver, and the item count with them — which is
                    // the one thing a child scanning what is waiting needs
                    // announced. Put back by hand, as `PageStrip.tsx` does.
                    role="list"
                    sx={{ display: 'grid', gap: `${comfortableDensity.gap}px`, p: 0, m: 0 }}
                  >
                    {tests.map((test) => (
                      <Typography
                        key={test.id}
                        component="li"
                        role="listitem"
                        sx={{ listStyle: 'none' }}
                        data-testid="student-practice-test"
                      >
                        {/* The row *is* the link, and the sentence **is** its
                            accessible name — no `aria-label` over the top of it.
                            A label would read identically on every row, hiding
                            the one thing that tells them apart, and would replace
                            the visible words for anyone speaking them (WCAG
                            2.5.3). A client-side navigation, because Take Test is
                            inside Student Mode rather than past it. */}
                        <Link
                          component={NextLink}
                          href={`/student/tests/${test.id}` as Route}
                          sx={{ minHeight: comfortableDensity.tapTarget }}
                        >
                          {studentCopy.practiceTest(test.questionCount)}
                        </Link>
                      </Typography>
                    ))}
                  </Box>
                </>
              ))}
            {/* A client-side link on purpose: leaving Student Mode means
                reaching the PIN gate, never anything past it. */}
            <Button
              component={NextLink}
              href="/parent/pin"
              variant="outlined"
              sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
            >
              {studentCopy.parent}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
