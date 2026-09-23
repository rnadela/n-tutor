'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import { ParentApiError, parentApi, type StudentSession } from '@/lib/parent-api';
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
 * It reads one endpoint, `GET /api/student/session`, which answers from the
 * binding cookie alone — nothing here names a profile id, and no parent-scoped
 * call exists on this page. The one control leads to the PIN gate, which is the
 * only way out.
 */
export default function StudentModePage() {
  const router = useRouter();
  const [session, setSession] = useState<StudentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A response is applied only while it is still the most recent request, so a
  // read superseded by Retry cannot resolve afterwards and overwrite it.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const thisRequest = (requestId.current += 1);
    setLoading(true);
    setError(null);
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
            <Typography>{studentCopy.empty}</Typography>
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
