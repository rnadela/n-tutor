'use client';

import { useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { parentApi } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

export default function RequestPasswordResetPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await parentApi.requestPasswordReset(email);
      // Confirmed only on a successful response. Confirming in a `finally`
      // would claim a link was sent when the request never landed.
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.reset.title}
        </Typography>
        <Typography sx={{ mb: `${density.gap}px` }}>{parentCopy.reset.intro}</Typography>
        {sent ? (
          // The same confirmation whether or not the email is registered.
          <Alert severity="success" role="status" variant="outlined">
            {parentCopy.reset.sent}
          </Alert>
        ) : (
          <Box
            component="form"
            onSubmit={onSubmit}
            sx={{ display: 'grid', gap: `${density.gap}px` }}
            noValidate
          >
            <TextField
              id="parent-email"
              label={parentCopy.reset.emailLabel}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            {error && (
              <Alert severity="error" role="alert" variant="outlined">
                {error}
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? parentCopy.reset.submitting : parentCopy.reset.submit}
            </Button>
          </Box>
        )}
        <Box sx={{ mt: `${density.gap}px` }}>
          <Link href="/auth/sign-in">{parentCopy.reset.backToSignIn}</Link>
        </Box>
      </CardContent>
    </Card>
  );
}
