'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import { parentApi } from '@/lib/parent-api';
import { deviceIsUnbound } from './student/page';
import { comfortableDensity } from '@/theme/tokens';

/**
 * The device's front door.
 *
 * Student Mode is the default state of a bound device, so the first question is
 * not "who is signed in" but "what is this device set up for": ask the API what
 * the binding names, then go to Student Mode or to sign-in. It renders a status
 * line while deciding and never any parent-scoped data — the binding is
 * httpOnly, so only the server can answer this.
 */
export default function HomePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // The same staleness guard Student Mode uses: a response is acted on only
  // while it is still the most recent request. Without it a read superseded by
  // Retry could resolve afterwards and route, or set an error, on top of the
  // newer one's answer.
  const requestId = useRef(0);

  const decide = useCallback(() => {
    const thisRequest = (requestId.current += 1);
    setError(null);
    parentApi.studentSession().then(
      () => {
        if (requestId.current !== thisRequest) return;
        router.replace('/student');
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        // Only "this device is not set up" is a reason to go to sign-in. A
        // dropped connection is not an unbound device, and must not look like
        // one to a child standing in front of it.
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setError(cause instanceof Error ? cause.message : studentCopy.failed);
      },
    );
  }, [router]);

  useEffect(() => {
    decide();
  }, [decide]);

  return (
    <Box
      component="main"
      sx={{ maxWidth: 560, mx: 'auto', padding: `${comfortableDensity.cardPadding}px` }}
    >
      {/* A heading of its own, so the document a screen reader lands on while
          the decision is in flight is not a headingless page. */}
      <Typography
        component="h1"
        sx={{ fontSize: 20, fontWeight: 700, mb: `${comfortableDensity.gap}px` }}
      >
        {studentCopy.frontDoorTitle}
      </Typography>
      {error === null ? (
        <Alert severity="info" role="status" variant="outlined">
          {studentCopy.loading}
        </Alert>
      ) : (
        <Alert
          severity="error"
          role="alert"
          variant="outlined"
          action={
            <Button onClick={decide} sx={{ minHeight: comfortableDensity.tapTarget }}>
              {studentCopy.retry}
            </Button>
          }
        >
          {error}
        </Alert>
      )}
    </Box>
  );
}
