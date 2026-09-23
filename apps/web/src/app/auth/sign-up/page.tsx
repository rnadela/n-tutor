'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { deviceTimeZone, parentApi, type AuthPolicy } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

export default function SignUpPage() {
  const router = useRouter();
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedNotice, setAcceptedNotice] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPolicy = useCallback(async () => {
    setPolicyError(null);
    try {
      setPolicy(await parentApi.policy());
    } catch (cause) {
      // A failed load must never leave submit permanently disabled with no way
      // forward: the screen offers a retry instead.
      setPolicy(null);
      setPolicyError(cause instanceof Error ? cause.message : parentCopy.errors.generic);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    // Checked here so a short password is named as such, rather than coming
    // back as the endpoint's one generic "could not be created" message.
    if (password.length < policy.passwordMinLength) {
      setError(parentCopy.signUp.passwordMinimum(policy.passwordMinLength));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await parentApi.signUp({
        email,
        password,
        timezone: deviceTimeZone(),
        termsVersion: policy.termsVersion,
        noticeVersion: policy.noticeVersion,
      });
      router.replace('/auth/signed-in');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : parentCopy.signUp.failed);
      // The rejection may be a stale version: re-fetch and make the parent
      // accept again, so there is always a path forward.
      setAcceptedTerms(false);
      setAcceptedNotice(false);
      await loadPolicy();
    } finally {
      setBusy(false);
    }
  }

  const ready = policy !== null && acceptedTerms && acceptedNotice;

  return (
    <Card sx={{ maxWidth: 520, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.signUp.title}
        </Typography>
        <Typography sx={{ mb: `${density.gap}px` }}>{parentCopy.signUp.intro}</Typography>

        {policyError && (
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            sx={{ mb: `${density.gap}px` }}
            action={<Button onClick={() => void loadPolicy()}>{parentCopy.errors.retry}</Button>}
          >
            {policyError}
          </Alert>
        )}

        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{ display: 'grid', gap: `${density.gap}px` }}
          noValidate
        >
          <TextField
            id="parent-email"
            label={parentCopy.signUp.emailLabel}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <TextField
            id="parent-password"
            label={parentCopy.signUp.passwordLabel}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            // The minimum is stated before submission, and it comes from the API.
            helperText={
              policy ? parentCopy.signUp.passwordMinimum(policy.passwordMinLength) : undefined
            }
            required
          />

          <Box>
            <Button type="button" onClick={() => setShowTerms((shown) => !shown)}>
              {showTerms ? parentCopy.signUp.hideTerms : parentCopy.signUp.showTerms}
            </Button>
            {showTerms && policy && (
              <Typography sx={{ mt: `${density.gap}px` }}>{policy.termsText}</Typography>
            )}
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                id="accept-terms"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
              />
            }
            label={parentCopy.signUp.termsLabel}
          />

          <Box>
            <Button type="button" onClick={() => setShowNotice((shown) => !shown)}>
              {showNotice ? parentCopy.signUp.hideNotice : parentCopy.signUp.showNotice}
            </Button>
            {showNotice && policy && (
              <Typography sx={{ mt: `${density.gap}px` }}>{policy.noticeText}</Typography>
            )}
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                id="accept-notice"
                checked={acceptedNotice}
                onChange={(event) => setAcceptedNotice(event.target.checked)}
              />
            }
            label={parentCopy.signUp.noticeLabel}
          />

          {error && (
            <Alert severity="error" role="alert" variant="outlined">
              {error}
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={busy || !ready}>
            {busy ? parentCopy.signUp.submitting : parentCopy.signUp.submit}
          </Button>
          <Link href="/auth/sign-in">{parentCopy.signUp.haveAccount}</Link>
        </Box>
      </CardContent>
    </Card>
  );
}
