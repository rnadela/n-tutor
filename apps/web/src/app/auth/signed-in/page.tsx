'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { NETWORK_STATUS, ParentApiError, parentApi, type ParentSession } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

/**
 * A minimal authenticated landing, so "signed in with a persistent session" is
 * observable before Parent View exists (Story 1.2 owns that surface).
 */
export default function SignedInPage() {
  const router = useRouter();
  const [session, setSession] = useState<ParentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    parentApi.me().then(
      (value) => {
        setSession(value);
        setLoading(false);
      },
      (cause: unknown) => {
        // Only a rejected session sends the parent back to sign-in. A request
        // that never landed is a connection problem, not a signed-out account,
        // and must not look like one.
        if (cause instanceof ParentApiError && cause.status !== NETWORK_STATUS) {
          router.replace('/auth/sign-in');
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
      },
    );
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSignOut() {
    setBusy(true);
    setError(null);
    try {
      await parentApi.signOut();
      // Only on success: leaving for sign-in from a `finally` would claim the
      // session had ended while the cookie was still live.
      router.replace('/auth/sign-in');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
      setBusy(false);
    }
  }

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.signedIn.title}
        </Typography>
        {loading ? (
          <Alert severity="info" role="status" variant="outlined">
            {parentCopy.signedIn.loading}
          </Alert>
        ) : !session ? (
          // The request never landed: a retry, never a silent sign-out.
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
          >
            {error ?? parentCopy.errors.generic}
          </Alert>
        ) : (
          <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
            <Typography>{parentCopy.signedIn.intro}</Typography>
            <Typography>
              {parentCopy.signedIn.emailLabel}: {session.email}
            </Typography>
            <Typography>
              {parentCopy.signedIn.timezoneLabel}: {session.timezone}
            </Typography>
            <Button
              type="button"
              variant="contained"
              onClick={() => void onSignOut()}
              disabled={busy}
            >
              {busy ? parentCopy.signedIn.signingOut : parentCopy.signedIn.signOut}
            </Button>
            {error && (
              <Alert severity="error" role="alert" variant="outlined">
                {error}
              </Alert>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
