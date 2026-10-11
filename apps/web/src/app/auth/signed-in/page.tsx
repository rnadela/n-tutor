'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { ArrowRight, CircleCheck, Globe, LogOut, Mail } from 'lucide-react';
import { AuthBrand } from '../_components/AuthBrand';
import { parentCopy } from '@/copy/parent';
import { NETWORK_STATUS, ParentApiError, parentApi, type ParentSession } from '@/lib/parent-api';
import { density, rounded } from '@/theme/tokens';

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
    <Box sx={{ maxWidth: 420, mx: 'auto' }}>
      <AuthBrand />
      <Card>
        <CardContent>
          <Box
            sx={{
              display: 'grid',
              justifyItems: 'center',
              gap: `${density.gap}px`,
              mb: `${density.gap * 2}px`,
            }}
          >
            {session && (
              <Box component="span" sx={{ color: 'success.main', display: 'inline-flex' }}>
                <CircleCheck size={32} aria-hidden="true" />
              </Box>
            )}
            <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, textAlign: 'center' }}>
              {parentCopy.signedIn.title}
            </Typography>
            {session && (
              <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                {parentCopy.signedIn.intro}
              </Typography>
            )}
          </Box>
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
            <Box sx={{ display: 'grid', gap: `${density.gap * 2}px` }}>
              <Box component="dl" sx={{ display: 'grid', gap: `${density.gap}px`, m: 0 }}>
                <DetailRow
                  icon={<Mail size={18} aria-hidden="true" />}
                  label={parentCopy.signedIn.emailLabel}
                >
                  {session.email}
                </DetailRow>
                <DetailRow
                  icon={<Globe size={18} aria-hidden="true" />}
                  label={parentCopy.signedIn.timezoneLabel}
                >
                  {session.timezone}
                </DetailRow>
              </Box>
              {/* The gate is reachable straight from here, which narrows the
                  window on a shared device between signing up and setting a
                  PIN. */}
              <Button
                href="/parent/pin"
                variant="contained"
                endIcon={<ArrowRight size={18} aria-hidden="true" />}
              >
                {parentCopy.signedIn.enterParentView}
              </Button>
              {error && (
                <Alert severity="error" role="alert" variant="outlined">
                  {error}
                </Alert>
              )}
              <Divider />
              <Button
                type="button"
                variant="text"
                color="secondary"
                startIcon={<LogOut size={18} aria-hidden="true" />}
                onClick={() => void onSignOut()}
                disabled={busy}
                sx={{ justifySelf: 'center' }}
              >
                {busy ? parentCopy.signedIn.signingOut : parentCopy.signedIn.signOut}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

/** One account fact: an icon, its label and the value, as a `<dt>`/`<dd>` pair. */
function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        columnGap: `${density.gap * 1.5}px`,
        alignItems: 'center',
        paddingBlock: `${density.gap}px`,
        paddingInline: `${density.cardPadding}px`,
        bgcolor: 'action.hover',
        borderRadius: `${rounded.control}px`,
      }}
    >
      <Box sx={{ gridRow: 'span 2', display: 'inline-flex', color: 'text.secondary' }}>{icon}</Box>
      <Typography component="dt" variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}
