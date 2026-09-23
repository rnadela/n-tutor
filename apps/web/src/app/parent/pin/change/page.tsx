'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { NETWORK_STATUS, ParentApiError, parentApi, type AuthPolicy } from '@/lib/parent-api';
import { density } from '@/theme/tokens';

type Confirmation = 'pin' | 'password';

/**
 * Changing the PIN from inside Parent View. Elevation-guarded: the screen is
 * reachable only with a token in memory, and the call carries it as a bearer.
 */
export default function ChangePinPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>('pin');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const token = elevation?.token ?? null;

  useEffect(() => {
    if (token === null) router.replace('/parent/pin');
  }, [token, router]);

  const loadPolicy = useCallback(() => {
    parentApi.policy().then(setPolicy, () => setPolicy(null));
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) return;
    // Caught here so one typo does not set a new PIN the parent does not know —
    // the same mistake DW-37 records for the first-set screen, closed here
    // because the confirmation costs nothing extra on the change path.
    if (newPin !== confirmNewPin) {
      setError(parentCopy.pin.pinMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await parentApi.changePin(token, {
        newPin,
        // Exactly one credential travels; the API refuses both or neither.
        ...(confirmation === 'pin' ? { currentPin } : { password }),
      });
      setDone(true);
      setCurrentPin('');
      setPassword('');
      setNewPin('');
      setConfirmNewPin('');
    } catch (cause) {
      // A wrong credential and an ended Parent View are both 401s here, and
      // only the server can tell them apart — so it says which. Elevation that
      // has expired, or that a password reset ended, goes back to the gate
      // rather than being reported as a mistyped PIN.
      if (cause instanceof ParentApiError && cause.notElevated) {
        clearElevation();
        router.replace('/parent/pin');
        return;
      }
      if (cause instanceof ParentApiError && cause.status === NETWORK_STATUS) {
        setError(cause.message);
      } else {
        // One generic line for a wrong PIN and a wrong password alike.
        setError(cause instanceof Error ? cause.message : parentCopy.pin.incorrect);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto' }}>
      <CardContent>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, mb: `${density.gap}px` }}>
          {parentCopy.pin.changeTitle}
        </Typography>
        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{ display: 'grid', gap: `${density.gap}px` }}
          noValidate
        >
          <Typography>{parentCopy.pin.changeIntro}</Typography>
          <TextField
            id="parent-new-pin"
            label={parentCopy.pin.newPinLabel}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            {...(policy
              ? {
                  helperText: parentCopy.pin.pinShape(policy.pinLength),
                  slotProps: { htmlInput: { maxLength: policy.pinLength } },
                }
              : {})}
            value={newPin}
            onChange={(event) => setNewPin(event.target.value)}
            required
          />
          <TextField
            id="parent-confirm-new-pin"
            label={parentCopy.pin.confirmNewPinLabel}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            {...(policy ? { slotProps: { htmlInput: { maxLength: policy.pinLength } } } : {})}
            value={confirmNewPin}
            onChange={(event) => setConfirmNewPin(event.target.value)}
            required
          />
          <RadioGroup
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value as Confirmation)}
          >
            <FormControlLabel
              value="pin"
              control={<Radio />}
              label={parentCopy.pin.useCurrentPin}
            />
            <FormControlLabel
              value="password"
              control={<Radio />}
              label={parentCopy.pin.usePassword}
            />
          </RadioGroup>
          {confirmation === 'pin' ? (
            <TextField
              id="parent-current-pin"
              label={parentCopy.pin.currentPinLabel}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              {...(policy ? { slotProps: { htmlInput: { maxLength: policy.pinLength } } } : {})}
              value={currentPin}
              onChange={(event) => setCurrentPin(event.target.value)}
              required
            />
          ) : (
            <TextField
              id="parent-account-password"
              label={parentCopy.pin.passwordLabel}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          )}
          {error && (
            <Alert severity="error" role="alert" variant="outlined">
              {error}
            </Alert>
          )}
          {done && (
            <Alert severity="success" role="status" variant="outlined">
              {parentCopy.pin.changed}
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? parentCopy.pin.saving : parentCopy.pin.changeSubmit}
          </Button>
          <Link component={NextLink} href="/parent">
            {parentCopy.pin.back}
          </Link>
        </Box>
      </CardContent>
    </Card>
  );
}
