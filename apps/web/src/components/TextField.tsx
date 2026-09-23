'use client';

import MuiTextField, { type TextFieldProps } from '@mui/material/TextField';

/**
 * The text field primitive (UX-DR23).
 *
 * `{...props}` is spread FIRST: the control role is what this primitive exists
 * to enforce, so a caller passing `variant="standard"` must not be able to
 * silently drop the divider border and the radius it carries.
 *
 * Control role throughout: the 8px radius, the 1px divider border, the single
 * focus ring and the surface's tap-target floor all arrive from the theme, so
 * nothing here restates a colour, a radius or a pixel figure. It renders a real
 * `<input>` carrying its own label — never a styled `div`.
 */
export function TextField(props: TextFieldProps) {
  return <MuiTextField {...props} variant="outlined" fullWidth />;
}
