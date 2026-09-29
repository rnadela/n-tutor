'use client';

import { useId, useState } from 'react';
import MuiDialog, { type DialogProps } from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import { commonCopy } from '@/copy/common';
import { DestructiveButton } from './Button';
import { TextField } from './TextField';

export type AppDialogProps = Omit<DialogProps, 'title' | 'onClose' | 'children'> & {
  open: boolean;
  title: string;
  onClose(): void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * The id of the element inside the dialog that carries the sentence a reader
   * needs on arrival, wired to `aria-describedby`.
   *
   * Stated as a prop rather than left to the props spread because a dialog whose
   * whole point is one sentence — a count, a consequence, a figure — announces
   * only its title without it, and "the title is the accessible name" is exactly
   * the reason that sentence would otherwise go unread. Omitted for a dialog whose
   * body is a set of controls rather than a statement: describing a grid of
   * buttons as prose reads worse than not describing it at all.
   */
  describedBy?: string;
};

/**
 * The dialog primitive (UX-DR27): separated from what is behind it by the
 * scrim plus a 1px divider border, with `boxShadow: none` — both applied by the
 * theme's `MuiDialog` paper override, so nothing here carries a style.
 *
 * Extra MUI Dialog props pass straight through, so a caller can set a width —
 * or a test can mount the overlay inline instead of through a portal.
 */
export function AppDialog({
  open,
  title,
  onClose,
  children,
  actions,
  describedBy,
  ...rest
}: AppDialogProps) {
  const titleId = useId();
  return (
    <MuiDialog
      {...rest}
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      // Absent rather than empty when no caller named one: an `aria-describedby`
      // pointing at nothing is a description that silently never arrives.
      aria-describedby={describedBy}
      fullWidth
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      {actions == null ? null : <DialogActions>{actions}</DialogActions>}
    </MuiDialog>
  );
}

/** Whether the confirm control may fire. The whole gate, as a pure function. */
export function canConfirmDestructive(password: string): boolean {
  return password.trim().length > 0;
}

/**
 * What the password field holds after the dialog's `open` changes.
 *
 * Closing empties it. The component stays mounted across `open` toggles, so
 * without this a cancel-then-reopen would show the confirm control already
 * enabled against a password the parent typed and then backed out of.
 */
export function passwordOnToggle(open: boolean, password: string): string {
  return open ? password : '';
}

export interface DestructiveActionsProps {
  password: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * The confirmation's two controls. Split out from the dialog so the
 * disabled-until-password rule is assertable on rendered markup rather than on
 * the dialog's internal state.
 */
export function DestructiveActions({
  password,
  busy,
  onCancel,
  onConfirm,
}: DestructiveActionsProps) {
  const confirmable = canConfirmDestructive(password) && !busy;
  return (
    <>
      <Button type="button" onClick={onCancel} disabled={busy}>
        {commonCopy.destructive.cancel}
      </Button>
      <DestructiveButton onClick={onConfirm} disabled={!confirmable}>
        {commonCopy.destructive.confirm}
      </DestructiveButton>
    </>
  );
}

export type ConfirmDestructiveDialogProps = Omit<
  AppDialogProps,
  'title' | 'onClose' | 'actions' | 'children' | 'describedBy'
> & {
  open: boolean;
  /** The question, naming what goes. */
  title: string;
  /** The one sentence a reader needs on arrival: what goes, and what stays. */
  body: string;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
};

/**
 * A destructive confirmation that asks for **no password** (UX-DR27, FR-33).
 *
 * A separate component rather than a `requirePassword={false}` flag on
 * `DestructiveConfirmDialog`: the password there is the safeguard on deleting a
 * Student Profile or a Parent Account, and a flag that switches it off is a flag
 * that can be passed to those by mistake. This one is reachable only by callers
 * that went looking for it.
 *
 * It exists for the one action where re-authentication would be theatre: the
 * photographs of a Source Test are removed, and nothing built from them is — so
 * there is no loss for a password to stand in front of. The elevation the parent
 * already proved is the whole authorization.
 *
 * It does **not** close itself. The caller keeps `open` true until the write
 * settles, which is what makes `busy` reach the controls at all; a dialog that
 * closed on confirm would leave its own in-flight lock permanently unreachable.
 */
export function ConfirmDestructiveDialog({
  open,
  title,
  body,
  busy = false,
  onCancel,
  onConfirm,
  ...rest
}: ConfirmDestructiveDialogProps) {
  const bodyId = useId();
  // Guards the gap between a fast double-tap on confirm and the caller's `busy`
  // prop actually re-rendering this component disabled.
  const [firing, setFiring] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const [wasBusy, setWasBusy] = useState(busy);

  if (wasOpen !== open) {
    setWasOpen(open);
    setFiring(false);
  }
  // Released once the caller's request settles, or a failed delete would leave
  // the confirm control disabled for ever.
  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (!busy) setFiring(false);
  }

  const locked = busy || firing;
  return (
    <AppDialog
      {...rest}
      open={open}
      title={title}
      // The body is the whole point of this dialog — a count and a consequence
      // — and without this the overlay announces only its title on arrival.
      describedBy={bodyId}
      // Escape and a backdrop click both route through `onClose`; ignoring it
      // while the delete is in flight keeps the confirmation from being
      // dismissed out from under the request it is gating.
      onClose={() => {
        if (!busy) onCancel();
      }}
      actions={
        <>
          <Button type="button" onClick={onCancel} disabled={locked}>
            {commonCopy.destructive.cancel}
          </Button>
          {/* Enabled on arrival: there is nothing to type, and a control
              disabled until some field is filled would be waiting on a field
              this dialog deliberately does not have. */}
          <DestructiveButton
            onClick={() => {
              setFiring(true);
              onConfirm();
            }}
            disabled={locked}
          >
            {commonCopy.destructive.confirm}
          </DestructiveButton>
        </>
      }
    >
      <DialogContentText id={bodyId}>{body}</DialogContentText>
    </AppDialog>
  );
}

export type DestructiveConfirmDialogProps = Omit<
  AppDialogProps,
  'title' | 'onClose' | 'actions'
> & {
  open: boolean;
  /** Exactly what will be destroyed, named in the copy rather than implied. */
  subject: string;
  busy?: boolean;
  onCancel(): void;
  /** Fires only once a password has been entered. */
  onConfirm(password: string): void;
};

/**
 * The destructive confirmation (UX-DR27).
 *
 * It names the subject being destroyed, states that the action cannot be
 * undone, asks for the **account password** — re-authentication, not the Parent
 * PIN — and keeps its confirm control disabled while that field is empty.
 */
export function DestructiveConfirmDialog({
  open,
  subject,
  busy = false,
  onCancel,
  onConfirm,
  ...rest
}: DestructiveConfirmDialogProps) {
  // An empty subject renders a headless "Delete ?" — the same silent
  // wrong-copy failure `resolveAddress` refuses for the same reason.
  const trimmedSubject = subject.trim();
  if (trimmedSubject === '') {
    throw new Error(
      'DestructiveConfirmDialog needs the subject being destroyed, and was given none.',
    );
  }

  const [password, setPassword] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  // Guards the gap between a fast double-click/double-tap on confirm and the
  // parent's `busy` prop actually re-rendering this component disabled.
  const [firing, setFiring] = useState(false);
  const [wasBusy, setWasBusy] = useState(busy);

  // React's documented "adjust state when a prop changes" pattern: it runs in
  // the render phase, so the field is already empty on the render that reopens
  // the dialog rather than one paint later.
  if (wasOpen !== open) {
    setWasOpen(open);
    setPassword(passwordOnToggle(open, password));
    setFiring(false);
  }
  // `firing` only needs to hold until `busy` catches up; once the caller's
  // request settles (success or failure) it must release the confirm control
  // again, or a failed delete would leave it disabled forever.
  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (!busy) setFiring(false);
  }

  return (
    <AppDialog
      {...rest}
      open={open}
      title={commonCopy.destructive.title(trimmedSubject)}
      // Escape and a backdrop click both route through `onClose`; ignoring it
      // while a delete is in flight keeps the confirmation from being
      // dismissed out from under the request it is gating.
      onClose={() => {
        if (!busy) onCancel();
      }}
      actions={
        <DestructiveActions
          password={password}
          busy={busy || firing}
          onCancel={onCancel}
          onConfirm={() => {
            setFiring(true);
            onConfirm(password);
          }}
        />
      }
    >
      <DialogContentText>{commonCopy.destructive.irreversible(trimmedSubject)}</DialogContentText>
      <TextField
        type="password"
        autoComplete="current-password"
        label={commonCopy.destructive.passwordLabel}
        helperText={commonCopy.destructive.passwordHint}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
    </AppDialog>
  );
}
