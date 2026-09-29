'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { DestructiveConfirmDialog } from '@/components/Dialog';
import { parentCopy } from '@/copy/parent';
import { useElevation } from '@/lib/elevation';
import { parentApi, type AccountDeletionPreview } from '@/lib/parent-api';
import { applyIfCurrent, endsParentView, refusalText } from '@/lib/parent-view';
import { density } from '@/theme/tokens';

/**
 * Re-exported rather than defined here, exactly as the Students screen does it:
 * the rule lives in `@/lib/parent-view` because both screens gate a destructive
 * action behind the same 409, and the name stays reachable here because that is
 * where this screen's spec addresses it.
 */
export { refusalText } from '@/lib/parent-view';

/** The id the section's note carries, and the id its control describes itself by. */
export const deleteAccountNoteId = 'account-delete-note';

/**
 * The sentence that says what deleting the account costs, rendered as text.
 *
 * Not a `title` and not only the dialog's body: a parent deciding whether to open
 * the confirmation at all has to be able to read what the control does, and a
 * tooltip does not exist on touch. Its own component so that requirement is
 * assertable without standing up the screen, its router and its elevation.
 */
export function DataAndDeletionNote() {
  return (
    <Typography
      id={deleteAccountNoteId}
      component="p"
      sx={{ fontSize: 13, color: 'text.secondary' }}
    >
      {parentCopy.settings.deleteAccountNote}
    </Typography>
  );
}

/** The Settings screen: Data & deletion, and the account delete inside it. */
export default function SettingsPage() {
  const router = useRouter();
  const { elevation, clearElevation } = useElevation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * The counts the open confirmation names.
   *
   * Set only by `onDeleteRequested`, from a read it makes itself: FR-33 requires
   * the sentence the parent confirms against to name what will be destroyed, and
   * a figure read when the screen mounted is a figure that may have moved since —
   * a child added or an upload committed in another tab would leave the dialog
   * asserting numbers that were true minutes ago. So the dialog's counts and the
   * dialog's existence are one piece of state, and there is no window in which it
   * is open against something else.
   */
  const [confirming, setConfirming] = useState<AccountDeletionPreview | null>(null);
  /** True while the preview for a confirmation is in flight. */
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /**
   * Why the last confirm was refused, shown inside the dialog rather than on the
   * page: the page's own alert sits under the modal backdrop.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  const token = elevation?.token ?? null;
  const requestId = useRef(0);
  /** The same object identity across renders, so the guard reads live state. */
  const current = useRef({ value: 0 });
  current.current.value = requestId.current;

  const leave = useCallback(() => {
    clearElevation();
    router.replace('/parent/pin');
  }, [clearElevation, router]);

  /**
   * Proves the elevation is still good before the screen offers to destroy the
   * account, and reports a fault the parent can retry from where they stand.
   *
   * It deliberately does **not** keep what it read: the confirmation reads its own
   * counts when it opens. This load is what turns "the screen rendered" into "the
   * screen is usable", which is why the control waits on it.
   */
  const load = useCallback(() => {
    const issued = (requestId.current += 1);
    current.current.value = issued;
    if (token === null) {
      // No token in memory: a reload, a new tab, or a parent who has left.
      router.replace('/parent/pin');
      return;
    }
    setLoading(true);
    setError(null);
    parentApi.accountDeletionPreview(token).then(
      applyIfCurrent(current.current, issued, () => {
        setLoading(false);
      }),
      applyIfCurrent(current.current, issued, (cause: unknown) => {
        if (endsParentView(cause)) {
          leave();
          return;
        }
        setLoading(false);
        setError(refusalText(cause, parentCopy.settings.deleteAccountFailed));
      }),
    );
  }, [token, router, leave]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Reads what would go, then opens the confirmation naming it.
   *
   * Guarded and staleness-checked like every other read on a parent screen: a
   * second tap would otherwise issue a second read whose later response would
   * swap the counts out from under a parent already reading them. A failure opens
   * **nothing** and shows the refusal on the page — a dialog with no numbers in
   * it is a dialog that is confirmable against nothing.
   */
  async function onDeleteRequested(): Promise<void> {
    if (token === null || previewing || deleting || confirming !== null) return;
    setError(null);
    setRefusal(null);
    setPreviewing(true);
    const issued = (requestId.current += 1);
    current.current.value = issued;
    try {
      const counts = await parentApi.accountDeletionPreview(token);
      applyIfCurrent(current.current, issued, (fresh: AccountDeletionPreview) =>
        setConfirming(fresh),
      )(counts);
    } catch (cause) {
      if (endsParentView(cause)) {
        leave();
        return;
      }
      setError(refusalText(cause, parentCopy.settings.deleteAccountFailed));
    } finally {
      setPreviewing(false);
    }
  }

  /**
   * The delete itself.
   *
   * A refusal leaves the dialog open with the reason **in** it: the parent
   * mistyped a password, and closing the field they were typing into would make
   * them start again. On success the account no longer exists — the API has
   * already cleared both cookies — so the in-memory elevation goes too and the
   * screen is `replace`d with sign-in rather than pushed, so Back cannot return to
   * a Parent View for an account that is gone.
   *
   * Nothing is announced on the way out, and `deleting` is deliberately **not**
   * reset on the two paths that navigate: this component is unmounted in the same
   * tick, so a live region would never be read and either setState would be a
   * write to a component that is gone.
   */
  async function onDeleteConfirmed(password: string): Promise<void> {
    if (confirming === null || token === null || deleting) return;
    setDeleting(true);
    // A stale refusal must never sit beside a fresh attempt.
    setRefusal(null);
    try {
      await parentApi.deleteAccount(token, password);
    } catch (cause) {
      if (endsParentView(cause)) {
        leave();
        return;
      }
      setRefusal(refusalText(cause, parentCopy.settings.deleteAccountFailed));
      setDeleting(false);
      return;
    }
    // The delete already committed: nothing past this point may report a
    // refusal, or a successful deletion would read to the parent as failed.
    clearElevation();
    router.replace('/auth/sign-in');
  }

  /** Closing the confirmation drops the refusal with it. */
  function onDeleteCancelled(): void {
    setConfirming(null);
    setRefusal(null);
  }

  return (
    <Card component="section" sx={{ maxWidth: 840, mx: 'auto' }}>
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
          {parentCopy.settings.title}
        </Typography>
        <Typography>{parentCopy.settings.intro}</Typography>

        {error !== null && (
          <Alert
            severity="error"
            role="alert"
            variant="outlined"
            action={<Button onClick={load}>{parentCopy.errors.retry}</Button>}
          >
            {error}
          </Alert>
        )}

        <Box
          component="section"
          aria-labelledby="data-and-deletion-heading"
          sx={{ display: 'grid', gap: `${density.gap}px` }}
        >
          <Typography
            id="data-and-deletion-heading"
            component="h2"
            sx={{ fontSize: 18, fontWeight: 700 }}
          >
            {parentCopy.settings.dataAndDeletion}
          </Typography>
          <DataAndDeletionNote />
          {/* While either read is in flight the control is disabled, so the
              screen has to say why: a disabled button with nothing beside it
              reads as a broken screen, and a screen reader is told nothing at
              all. */}
          {(loading || previewing) && (
            <Typography role="status" component="p" sx={{ color: 'text.secondary' }}>
              {loading ? parentCopy.settings.loading : parentCopy.settings.preparing}
            </Typography>
          )}
          {/* Disabled until the screen has proved it can read the account, and
              while a confirmation's counts are being read: the confirmation's
              sentence is the gate's content, and it cannot name what has not
              been read. */}
          <Button
            type="button"
            color="error"
            disabled={loading || previewing || deleting || confirming !== null || token === null}
            aria-describedby={deleteAccountNoteId}
            sx={{ minHeight: density.tapTarget, justifySelf: 'start' }}
            onClick={() => {
              void onDeleteRequested();
            }}
          >
            {parentCopy.settings.deleteAccount}
          </Button>
        </Box>

        {/* The account password, never the Parent PIN, and a body that names
            every count and kind rather than "everything on this account". */}
        {confirming !== null && (
          <DestructiveConfirmDialog
            open
            subject={parentCopy.settings.deleteAccountSubject}
            body={parentCopy.settings.deleteAccountBody(confirming)}
            refusal={refusal}
            busy={deleting}
            onCancel={onDeleteCancelled}
            onConfirm={(password) => {
              void onDeleteConfirmed(password);
            }}
          />
        )}

        {/* Client-side, so the provider holding the token stays mounted. */}
        <Link component={NextLink} href="/parent">
          {parentCopy.settings.back}
        </Link>
      </CardContent>
    </Card>
  );
}
