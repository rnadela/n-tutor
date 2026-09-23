'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { NETWORK_STATUS, ParentApiError, parentApi, type ElevatedSession } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

/**
 * The minimal elevation-gated landing. It exists to make the gate observable —
 * real Parent View content belongs to later epics — and it is the page that
 * proves the token is memory-only: with nothing in context it sends the parent
 * back to the PIN, which is what a reload does.
 *
 * Leaving Parent View is not this page's control any more: `BackToStudentMode`
 * in the layout is the one exit, on every Parent View surface, because leaving
 * means handing the device to a child rather than merely closing a screen.
 */
export default function ParentViewPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [session, setSession] = useState<ElevatedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = elevation?.token ?? null;
  // Bumped on every load() call; a response is applied only if it is still the
  // most recent request. Without this, a stale in-flight request superseded by
  // Retry could resolve after the fact and overwrite fresher state.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const thisRequest = (requestId.current += 1);
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    parentApi.parentSession(token).then(
      (value) => {
        if (requestId.current !== thisRequest) return;
        setSession(value);
        setLoading(false);
      },
      (cause: unknown) => {
        if (requestId.current !== thisRequest) return;
        if (cause instanceof ParentApiError && cause.status !== NETWORK_STATUS) {
          clearElevation();
          router.replace('/parent/pin');
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
      },
    );
  }, [token, router, clearElevation]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card sx={{ maxWidth: 480, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.parentView.title}
        </Typography>
        {loading || !session ? (
          error === null ? (
            <Alert severity="info" role="status" variant="outlined">
              {parentCopy.parentView.loading}
            </Alert>
          ) : (
            <Alert
              severity="error"
              role="alert"
              variant="outlined"
              action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
            >
              {error}
            </Alert>
          )
        ) : (
          <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
            <Typography>{parentCopy.parentView.intro}</Typography>
            <Typography>
              {parentCopy.parentView.emailLabel}: {session.email}
            </Typography>
            <Typography>
              {parentCopy.parentView.expiresLabel}: {new Date(session.expiresAt).toLocaleString()}
            </Typography>
            <Typography>
              {parentCopy.parentView.ceilingLabel}: {new Date(session.ceilingAt).toLocaleString()}
            </Typography>
            {/* A client-side navigation on purpose: a full page load would
                unmount the provider holding the token, and the change screen
                would find itself unelevated before it rendered. */}
            <Link component={NextLink} href="/parent/students">
              {parentCopy.parentView.students}
            </Link>
            <Link component={NextLink} href="/parent/pin/change">
              {parentCopy.parentView.changePin}
            </Link>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
