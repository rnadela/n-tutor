'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { attemptStorage, clearAll } from '@/lib/attempt-store';
import { parentApi } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await parentApi.signIn(email, password);
      // A sign-in is a mode-gate crossing, and AD-26 says a crossing clears the
      // client-held answers. `clearAll` rather than `retainOnly`: nobody is a child
      // here, so there is no profile whose work it would be right to keep — and a
      // device signed into by a different parent must not be holding the previous
      // household's schoolwork.
      clearAll(attemptStorage());
      router.replace('/auth/signed-in');
    } catch (cause) {
      // One message for a wrong password and for an unknown email alike.
      setError(cause instanceof Error ? cause.message : parentCopy.signIn.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.signIn.title}
        </Typography>
        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{ display: 'grid', gap: `${density.gap}px` }}
          noValidate
        >
          <TextField
            id="parent-email"
            label={parentCopy.signIn.emailLabel}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <TextField
            id="parent-password"
            label={parentCopy.signIn.passwordLabel}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && (
            <Alert severity="error" role="alert" variant="outlined">
              {error}
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? parentCopy.signIn.submitting : parentCopy.signIn.submit}
          </Button>
          <Link href="/auth/reset">{parentCopy.signIn.forgot}</Link>
          <Link href="/auth/sign-up">{parentCopy.signIn.noAccount}</Link>
        </Box>
      </CardContent>
    </Card>
  );
}
