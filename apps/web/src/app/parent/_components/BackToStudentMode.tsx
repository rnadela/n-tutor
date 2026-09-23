'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { ParentApiError, parentApi, type StudentProfileView } from '@/lib/parent-api';
import { density } from '@/theme/tokens';
import { endsParentView } from '../students/page';

/**
 * Whether the parent has to be asked which child the device is handed to.
 *
 * With exactly one active profile there is nothing to choose, so the exit binds
 * straight to it and the parent is not made to confirm a decision that has only
 * one answer. With none there is no Student Mode to hand the device to at all,
 * and the dialog says so rather than offering an empty list.
 */
export function needsProfilePrompt(profiles: StudentProfileView[]): boolean {
  return profiles.length > 1;
}

/**
 * Which profile the prompt opens on: the one this device is already bound to,
 * or the first when the binding names none of them (an unbound device, or one
 * bound to a profile that has since been archived).
 */
export function defaultSelection(profiles: StudentProfileView[], boundId: string | null): string {
  if (boundId !== null && profiles.some((profile) => profile.id === boundId)) return boundId;
  return profiles[0]?.id ?? '';
}

/**
 * The always-present exit from Parent View, mounted on every Parent View
 * surface by the layout.
 *
 * Leaving Parent View is handing the device to a child, so this control — not a
 * generic "leave" — is the exit: it binds the device, then navigates into
 * Student Mode.
 *
 * It deliberately does **not** call `clearElevation()` first. Clearing while
 * the Parent View screens are still mounted makes each of them re-run its "no
 * token" branch and fire its own `router.replace('/parent/pin')`, which races —
 * and wins against — the exit the parent asked for. Navigating out of the
 * `/parent` route group unmounts `ElevationProvider`, which destroys the token
 * unconditionally, so the credential still stops existing at the exit.
 */
export function BackToStudentMode() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const token = elevation?.token ?? null;

  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<StudentProfileView[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announced, setAnnounced] = useState('');
  const requestId = useRef(0);

  /** The elevation guard's own refusal is the only thing that ends Parent View. */
  const leaveToPin = useCallback(() => {
    requestId.current += 1;
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  /**
   * Binds and goes. The navigation leaves the route group, so the provider
   * holding the token unmounts and the credential stops existing — without the
   * explicit clear that would race the Parent View screens' own redirect.
   */
  const bindAndLeave = useCallback(
    async (profileId: string, name: string) => {
      // The elevation token can disappear while the dialog is open (a
      // concurrent `leaveToPin`, say). A silent no-op would leave the confirm
      // button looking dead; this surfaces the same failure copy the other
      // exit failures use.
      if (token === null) {
        setError(parentCopy.parentView.exitFailed);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await parentApi.bindStudentMode(token, profileId);
        setAnnounced(parentCopy.parentView.boundTo(name));
        router.replace('/student');
      } catch (cause: unknown) {
        if (endsParentView(cause)) {
          leaveToPin();
          return;
        }
        setBusy(false);
        setError(
          cause instanceof ParentApiError ? cause.message : parentCopy.parentView.exitFailed,
        );
      }
    },
    [token, router, leaveToPin],
  );

  /**
   * Opening is a read: the active profiles, plus what the device is bound to
   * right now so the prompt can preselect it. The binding read is allowed to
   * fail — an unbound device answers 401, which is not an error here but the
   * ordinary state of a device that has never been handed over.
   */
  async function onOpen() {
    if (token === null) return;
    const thisRequest = (requestId.current += 1);
    setBusy(true);
    setError(null);
    try {
      const active = await parentApi.selectableStudents(token);
      if (requestId.current !== thisRequest) return;

      if (!needsProfilePrompt(active)) {
        const only = active[0];
        if (only === undefined) {
          // No child on the account: there is nothing to hand the device to.
          setProfiles([]);
          setOpen(true);
          setBusy(false);
          return;
        }
        await bindAndLeave(only.id, only.displayName);
        return;
      }

      const bound = await parentApi
        .studentSession()
        .then((session) => session.profile.id)
        .catch(() => null);
      if (requestId.current !== thisRequest) return;

      setProfiles(active);
      setChosen(defaultSelection(active, bound));
      setOpen(true);
      setBusy(false);
    } catch (cause: unknown) {
      if (requestId.current !== thisRequest) return;
      if (endsParentView(cause)) {
        leaveToPin();
        return;
      }
      setBusy(false);
      setError(cause instanceof ParentApiError ? cause.message : parentCopy.parentView.exitFailed);
    }
  }

  /** A close is ignored while a bind is in flight: the exit is already running. */
  function onClose() {
    if (busy) return;
    requestId.current += 1;
    setOpen(false);
    setError(null);
  }

  function onConfirm() {
    const profile = profiles.find((candidate) => candidate.id === chosen);
    if (profile === undefined) {
      // The listed choice is no longer one this account can be handed to — a
      // concurrent archive, or nothing selected at all. Saying so beats a
      // confirm button that swallows the press and leaves the parent guessing.
      setError(parentCopy.parentView.exitFailed);
      return;
    }
    void bindAndLeave(profile.id, profile.displayName);
  }

  // Parent View's own control: without elevation there is no Parent View to
  // leave, and the screens have already sent the parent back to the PIN.
  if (token === null) return null;

  return (
    <Box sx={{ mb: `${density.sectionMargin}px` }}>
      <Button
        type="button"
        variant="outlined"
        onClick={() => void onOpen()}
        disabled={busy}
        sx={{ minHeight: density.tapTarget }}
      >
        {busy && !open ? parentCopy.parentView.exiting : parentCopy.parentView.backToStudent}
      </Button>
      {/* The outcome, announced with the same sentence the screen shows.
          Mounted only once there is something to announce: an always-present
          empty live region is a second `status` on every Parent View surface,
          which makes "the region on this screen" an ambiguous thing to address
          — for a screen reader as much as for a test. */}
      {announced === '' ? null : (
        <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 0 }}>
          {announced}
        </Box>
      )}
      {!open && error !== null ? (
        <Alert severity="error" role="alert" variant="outlined" sx={{ mt: `${density.gap}px` }}>
          {error}
        </Alert>
      ) : null}

      <Dialog open={open} onClose={onClose} aria-labelledby="back-to-student-title">
        <DialogTitle id="back-to-student-title">
          {profiles.length === 0
            ? parentCopy.parentView.backToStudent
            : parentCopy.parentView.chooseProfileTitle}
        </DialogTitle>
        <DialogContent>
          {profiles.length === 0 ? (
            <DialogContentText>{parentCopy.parentView.noProfiles}</DialogContentText>
          ) : (
            <>
              <DialogContentText sx={{ mb: `${density.gap}px` }}>
                {parentCopy.parentView.chooseProfileIntro}
              </DialogContentText>
              <FormControl>
                <FormLabel id="back-to-student-choice">
                  {parentCopy.parentView.chooseProfileLabel}
                </FormLabel>
                <RadioGroup
                  aria-labelledby="back-to-student-choice"
                  value={chosen}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {profiles.map((profile) => (
                    <FormControlLabel
                      key={profile.id}
                      value={profile.id}
                      control={<Radio />}
                      label={profile.displayName}
                      sx={{ minHeight: density.tapTarget }}
                    />
                  ))}
                </RadioGroup>
              </FormControl>
            </>
          )}
          {/* The failure is shown where the parent is standing — inside the
              dialog — rather than behind it on a screen they cannot see. */}
          {error !== null ? (
            <Alert severity="error" role="alert" variant="outlined" sx={{ mt: `${density.gap}px` }}>
              {error}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose} disabled={busy}>
            {parentCopy.parentView.cancel}
          </Button>
          {profiles.length === 0 ? (
            // An account with no child has no Student Mode to be handed to, so
            // the exit here leaves Parent View without binding anything.
            <Button
              type="button"
              variant="contained"
              onClick={() => router.replace('/auth/signed-in')}
            >
              {parentCopy.parentView.leaveWithoutHandover}
            </Button>
          ) : (
            <Button type="button" variant="contained" onClick={onConfirm} disabled={busy}>
              {busy ? parentCopy.parentView.exiting : parentCopy.parentView.confirmExit}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
