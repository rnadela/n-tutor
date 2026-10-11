'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { AuthBrand } from '../../_components/AuthBrand';
import { useAnnounce } from '@/components/LiveRegion';
import { parentCopy } from '@/copy/parent';
import { parentApi, type AuthPolicy } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

function ConfirmPasswordResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The surface's one polite region; a second `role="status"` here would make
  // "the region on this screen" ambiguous (see LiveRegion).
  const { announce } = useAnnounce();

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
      announce(parentCopy.resetConfirm.done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : parentCopy.resetConfirm.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 420, mx: 'auto' }}>
      <AuthBrand />
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: `${density.gap}px` }}>
            <KeyRound size={28} aria-hidden="true" />
          </Box>
          <Typography
            component="h1"
            sx={{ fontSize: 20, fontWeight: 700, textAlign: 'center', mb: `${density.gap * 2}px` }}
          >
            {parentCopy.resetConfirm.title}
          </Typography>

          {token === '' ? (
            <Alert severity="error" role="alert" variant="outlined">
              {parentCopy.resetConfirm.missingToken}
            </Alert>
          ) : done ? (
            <Alert severity="success" role="none" variant="outlined">
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
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                helperText={
                  policy ? parentCopy.signUp.passwordMinimum(policy.passwordMinLength) : undefined
                }
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
              <Button
                type="submit"
                variant="contained"
                disabled={busy}
                sx={{ minHeight: density.tapTarget }}
              >
                {busy ? parentCopy.resetConfirm.submitting : parentCopy.resetConfirm.submit}
              </Button>
            </Box>
          )}

          <Divider sx={{ my: `${density.gap * 1.5}px` }} />
          <Box sx={{ display: 'grid', gap: `${density.gap / 2}px`, justifyItems: 'center' }}>
            <Link
              href="/auth/sign-in"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              {parentCopy.reset.backToSignIn}
            </Link>
            <Link href="/auth/reset">{parentCopy.resetConfirm.requestAnother}</Link>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function ConfirmPasswordResetPage() {
  return (
    <Suspense>
      <ConfirmPasswordResetForm />
    </Suspense>
  );
}
