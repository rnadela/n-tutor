'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { BookOpen, GraduationCap } from 'lucide-react';
import { studentCopy } from '@/copy/student';
import { PracticeTestList } from '../_components/PracticeTestList';
import { deviceIsUnbound } from '../page';
import {
  parentApi,
  type PracticeTestRunsView,
  type StudentPracticeTestSummary,
} from '@/lib/parent-api';
import { runsById } from '@/lib/practice-test-runs';
import { completedTests } from '@/lib/student-results';
import { comfortableDensity, rounded } from '@/theme/tokens';

/**
 * Student Mode's finished tests, in one place.
 *
 * Home is one flat list in the server's order — everything still to do, then
 * everything finished — which is what FR-16 asks of it and what it keeps being.
 * This screen is the shortcut past the first band: the same two reads, filtered
 * to what is finished, rendered by the same row.
 *
 * It reads `GET /api/student/practice-tests` and
 * `GET /api/student/practice-test-runs` and nothing else. No new endpoint, no
 * session read, no profile id in any request and no bearer: both answer from the
 * binding cookie, which names the child server-side.
 *
 * The two reads settle **independently**, with Home's reasoning and Home's
 * `requestId` guard: the list *is* the screen, so its own failure is an inline
 * alert with a control that re-issues both and never routes anyone; the run read
 * is an annotation on rows that are fully usable without it, so when it fails
 * this screen says nothing at all — no alert, no timer, no second attempt.
 * `deviceIsUnbound` stays the one failure that routes, because the binding is
 * what both reads share and a refusal of it is about neither of them.
 *
 * **Nothing here decides the order.** `completedTests` filters and preserves the
 * server's band-2 order (most recently submitted first); `StudentPracticeTestSummary`
 * carries no timestamp, so the only client sort available would key off a run
 * figure that is allowed to be missing — and the order of the screen must not
 * depend on a read permitted to fail silently.
 *
 * Each row opens `/student/tests/{id}`, which is already where a finished test's
 * results live: this screen is a way to those, never a second rendering of them.
 * No score, percentage, denominator or ranking is computed anywhere on it.
 */
export default function StudentResultsPage() {
  const router = useRouter();
  /**
   * The released practice tests, or `null` while the read has not answered.
   *
   * Held apart from an empty array for Home's reason: "you have not finished one
   * yet" is a claim only an answered read may make, and saying it beside a read
   * that never came back would be one of the two untrue.
   */
  const [tests, setTests] = useState<StudentPracticeTestSummary[] | null>(null);
  /** The list read's own failure: the one thing on this screen worth an alert. */
  const [testsError, setTestsError] = useState<string | null>(null);
  /**
   * Each test's finished runs, by practice test id, or `null` while the read has
   * not answered — **and also after it failed**. There is deliberately no error
   * state beside it: the one honest rendering of "we could not get the figures"
   * is the row that has never had one.
   */
  const [runs, setRuns] = useState<ReadonlyMap<string, PracticeTestRunsView> | null>(null);
  // A response is applied only while it is still the most recent request, so a
  // read superseded by Retry cannot resolve afterwards and overwrite it.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const thisRequest = (requestId.current += 1);
    setTests(null);
    setTestsError(null);
    setRuns(null);

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
        // said where the list would have been, with a control that re-issues
        // both reads, and it never routes a child anywhere.
        setTestsError(cause instanceof Error ? cause.message : studentCopy.resultsList.failed);
      },
    );

    parentApi.practiceTestRuns().then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setRuns(runsById(value));
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        // The binding refusal is the one failure both reads act on, and they act
        // on it the same way: it is not about the figures.
        if (deviceIsUnbound(cause)) router.replace('/auth/sign-in');
        // And nothing else is stated. The rows render exactly as they do without it.
      },
    );
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const finished = tests === null ? null : completedTests(tests);

  return (
    <Box
      sx={{
        maxWidth: 640,
        mx: 'auto',
        display: 'grid',
        gap: `${comfortableDensity.gap}px`,
      }}
    >
      <Typography component="h1" variant="cardTitle">
        {studentCopy.resultsList.heading}
      </Typography>

      {/* The list's own failure. Retryable, and it never routes the child away —
          the heading above it stays exactly where it is. */}
      {testsError !== null && (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          data-testid="student-results-error"
          action={
            <Button onClick={load} sx={{ minHeight: comfortableDensity.tapTarget }}>
              {studentCopy.retry}
            </Button>
          }
        >
          {testsError}
        </Alert>
      )}

      {/* While the read has not answered and has not failed, the screen says it is
          still asking — never the empty state, which is a claim about this child's
          finished tests. */}
      {finished === null && testsError === null && (
        <Alert severity="info" role="status" variant="outlined">
          {studentCopy.resultsList.loading}
        </Alert>
      )}

      {finished !== null &&
        (finished.length === 0 ? (
          <Box
            sx={{
              display: 'grid',
              justifyItems: 'center',
              gap: `${comfortableDensity.gap}px`,
              py: `${comfortableDensity.sectionMargin * 1.5}px`,
              px: `${comfortableDensity.cardPadding}px`,
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: `${rounded.control}px`,
              color: 'text.secondary',
              textAlign: 'center',
            }}
          >
            <BookOpen size={36} aria-hidden="true" />
            <Typography data-testid="student-results-empty">
              {studentCopy.resultsList.empty}
            </Typography>
          </Box>
        ) : (
          // Home's own list component and Home's own row, un-forked: same Subject
          // line, same state word, same run line, same destination — which for a
          // finished test is already its results.
          <PracticeTestList tests={finished} runs={runs ?? undefined} />
        ))}

      {/* The way back, rendered only from `lg` up: below it the bar's Home tab is
          that control, and two controls for one destination is one too many. */}
      <Button
        startIcon={<GraduationCap size={18} aria-hidden="true" />}
        color="inherit"
        component={NextLink}
        href="/student"
        variant="text"
        sx={{
          justifySelf: 'start',
          minHeight: comfortableDensity.tapTarget,
          display: { xs: 'none', lg: 'inline-flex' },
        }}
      >
        {studentCopy.resultsList.backToPractice}
      </Button>
    </Box>
  );
}
