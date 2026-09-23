'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import {
  LOCKED_STATUS,
  ParentApiError,
  lockLiftsAt,
  parentApi,
  type AuthPolicy,
  type PinStatus,
} from '@/lib/parent-api';
import { density } from '@/theme/tokens';

/**
 * The gate. It is the only way into `/parent`, and it is reached again by every
 * reload, because the elevation token it mints lives in memory alone.
 */
export default function ParentPinPage() {
  const router = useRouter();
  const { setElevation } = useElevation();
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([parentApi.policy(), parentApi.pinStatus()]).then(
      ([loadedPolicy, loadedStatus]) => {
        setPolicy(loadedPolicy);
        setStatus(loadedStatus);
        setLockedUntil(loadedStatus.lockedUntil);
        setLoading(false);
      },
      (cause: unknown) => {
        // A rejected session goes back to sign-in; a request that never landed
        // is a connection problem and must not look like a signed-out account.
        if (cause instanceof ParentApiError && cause.status === 401) {
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

  const locked = lockedUntil !== null && new Date(lockedUntil).getTime() > Date.now();

  /**
   * The cool-down ends on the clock, so the form has to re-open on it too. The
   * copy names the instant the lock lifts; without this the field would stay
   * shut past it until the parent happened to reload the page.
   */
  useEffect(() => {
    if (lockedUntil === null) return;
    const remaining = new Date(lockedUntil).getTime() - Date.now();
    if (remaining <= 0) {
      setLockedUntil(null);
      return;
    }
    const timer = setTimeout(() => setLockedUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Setting a PIN does not elevate on its own: the crossing is what mints
      // the token, so the first PIN is set and then immediately crossed.
      if (status && !status.pinSet) await parentApi.setPin(pin);
      const elevation = await parentApi.verifyPin(pin);
      setElevation(elevation);
      // Only on success: routing from a `finally` would claim a gate that had
      // refused the entry had opened.
      router.replace('/parent');
    } catch (cause) {
      await onFailure(cause);
    }
  }

  /**
   * Re-reads the account's PIN state before rendering the form again.
   *
   * The first-PIN path is two calls: if the set lands and the crossing does not
   * — a lock, a rate limit, a dropped connection — the screen would otherwise
   * keep offering to set a PIN that now exists, and every retry would 409 into
   * a generic failure with no way forward. The server's own state decides which
   * form comes back, and a 409 is exactly that state having moved on.
   */
  async function onFailure(cause: unknown) {
    const rejection = cause instanceof ParentApiError ? cause : null;
    const refreshed = await parentApi.pinStatus().catch(() => null);
    if (refreshed) {
      setStatus(refreshed);
      setLockedUntil(refreshed.lockedUntil);
    } else if (rejection?.status === LOCKED_STATUS) {
      setLockedUntil(rejection.lockedUntil);
    }

    // A conflict is not a failure the parent can act on: it means the PIN is
    // already set, which the refreshed status now says, so the enter form is
    // the answer rather than an error line.
    const stale = rejection?.status === 409 && refreshed !== null;
    setError(stale ? null : cause instanceof Error ? cause.message : parentCopy.errors.generic);
    setPin('');
    setBusy(false);
  }

  const settingFirstPin = status !== null && !status.pinSet;

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {settingFirstPin ? parentCopy.pin.setTitle : parentCopy.pin.enterTitle}
        </Typography>
        {loading ? (
          <Alert severity="info" role="status" variant="outlined">
            {parentCopy.pin.loading}
          </Alert>
        ) : !status || !policy ? (
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
          >
            {error ?? parentCopy.errors.generic}
          </Alert>
        ) : (
          <Box
            component="form"
            onSubmit={onSubmit}
            sx={{ display: 'grid', gap: `${density.gap}px` }}
            noValidate
          >
            <Typography>
              {settingFirstPin ? parentCopy.pin.setIntro : parentCopy.pin.enterIntro}
            </Typography>
            <TextField
              id="parent-pin"
              label={parentCopy.pin.pinLabel}
              // Obscured like any other secret, and numeric on a phone keypad.
              type="password"
              inputMode="numeric"
              autoComplete="off"
              helperText={parentCopy.pin.pinShape(policy.pinLength)}
              slotProps={{ htmlInput: { maxLength: policy.pinLength } }}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              disabled={locked}
              required
            />
            {locked && (
              <Alert severity="warning" role="alert" variant="outlined">
                {lockedUntil === null
                  ? parentCopy.pin.lockedUnknown
                  : parentCopy.pin.locked(lockLiftsAt(lockedUntil))}
              </Alert>
            )}
            {error && !locked && (
              <Alert severity="error" role="alert" variant="outlined">
                {error}
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={busy || locked}>
              {busy
                ? settingFirstPin
                  ? parentCopy.pin.saving
                  : parentCopy.pin.submitting
                : settingFirstPin
                  ? parentCopy.pin.setSubmit
                  : parentCopy.pin.enterSubmit}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
