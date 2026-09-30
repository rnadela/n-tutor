'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { AuthBrand } from '../_components/AuthBrand';
import { parentCopy } from '@/copy/parent';
import { attemptStorage, clearAll } from '@/lib/attempt-store';
import { parentApi } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <Box sx={{ maxWidth: 420, mx: 'auto' }}>
      <AuthBrand />
      <Card>
        <CardContent>
          <Typography
            component="h1"
            sx={{ fontSize: 20, fontWeight: 700, textAlign: 'center', mb: `${density.gap}px` }}
          >
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
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Mail size={18} aria-hidden="true" />
                    </InputAdornment>
                  ),
                },
              }}
              required
            />
            <TextField
              id="parent-password"
              label={parentCopy.signIn.passwordLabel}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock size={18} aria-hidden="true" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((shown) => !shown)}
                        edge="end"
                      >
                        {showPassword ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
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
            <Divider />
            <Stack sx={{ gap: `${density.gap / 2}px`, alignItems: 'center' }}>
              <Link href="/auth/reset">{parentCopy.signIn.forgot}</Link>
              <Link href="/auth/sign-up">{parentCopy.signIn.noAccount}</Link>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
