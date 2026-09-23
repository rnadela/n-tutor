'use client';

import MuiButton, { type ButtonProps } from '@mui/material/Button';

export type AppButtonProps = Omit<ButtonProps, 'variant' | 'color'>;

// In both buttons `{...props}` is spread FIRST and the enforced `variant` and
// `color` last: the whole point of these two is that the intent they carry
// cannot be overridden from a call site.

/**
 * The primary action on a screen. A real `<button>` with a `type`, at the
 * surface's tap-target floor and the control radius — every figure from the
 * theme (UX-DR26).
 */
export function PrimaryButton({ type = 'button', ...props }: AppButtonProps) {
  return <MuiButton type={type} {...props} variant="contained" color="primary" />;
}

/**
 * Destructive intent, carried by the label text plus an outlined error-colour
 * border — never a filled red button (UX-DR26). A filled red control reads as
 * the loudest thing on the screen and invites the press it is warning about;
 * the outline states the consequence without competing for the tap.
 */
export function DestructiveButton({ type = 'button', ...props }: AppButtonProps) {
  return <MuiButton type={type} {...props} variant="outlined" color="error" />;
}
