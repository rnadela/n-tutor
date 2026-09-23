'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { parentApi, type AuthPolicy } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

function ConfirmPasswordResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Best effort: the minimum is stated when it is known, and its absence
    // never blocks the form — the API validates either way.
    parentApi.policy().then(setPolicy, () => setPolicy(null));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Checked here so a password below the minimum is not reported as a bad
    // link, which is what the API's one generic message would say.
    if (policy && password.length < policy.passwordMinLength) {
      setError(parentCopy.signUp.passwordMinimum(policy.passwordMinLength));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await parentApi.confirmPasswordReset(token, password);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : parentCopy.resetConfirm.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.resetConfirm.title}
        </Typography>

        {token === '' ? (
          <Alert severity="error" role="alert" variant="outlined">
            {parentCopy.resetConfirm.missingToken}
          </Alert>
        ) : done ? (
          <Alert severity="success" role="status" variant="outlined">
            {parentCopy.resetConfirm.done}
          </Alert>
        ) : (
          <Box
            component="form"
            onSubmit={onSubmit}
            sx={{ display: 'grid', gap: `${density.gap}px` }}
            noValidate
          >
            <TextField
              id="parent-password"
              label={parentCopy.resetConfirm.passwordLabel}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              helperText={
                policy ? parentCopy.signUp.passwordMinimum(policy.passwordMinLength) : undefined
              }
              required
            />
            {error && (
              <Alert severity="error" role="alert" variant="outlined">
                {error}
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? parentCopy.resetConfirm.submitting : parentCopy.resetConfirm.submit}
            </Button>
          </Box>
        )}

        <Box sx={{ display: 'grid', gap: `${density.gap}px`, mt: `${density.gap}px` }}>
          <Link href="/auth/sign-in">{parentCopy.reset.backToSignIn}</Link>
          <Link href="/auth/reset">{parentCopy.resetConfirm.requestAnother}</Link>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function ConfirmPasswordResetPage() {
  return (
    <Suspense>
      <ConfirmPasswordResetForm />
    </Suspense>
  );
}
