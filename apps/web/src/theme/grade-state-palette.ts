import type { Theme } from '@mui/material/styles';
import { gradeStateMarker } from './tokens';
import type { GradeState } from '@/lib/parent-api';

/**
 * Exactly the colour tokens `gradeStateMarker` names, as a union.
 *
 * Derived from the table rather than written out, so the two cannot drift: adding a
 * fifth token to a marker widens this union, and `GRADE_PALETTE` below is then
 * missing a key — a compile error at the one place the mapping lives, rather than a
 * lookup that returns `undefined` at render time.
 */
export type GradeColorToken = (typeof gradeStateMarker)[GradeState]['color'];

/**
 * How a marker's colour token is reached on the theme, and the **only** place that
 * mapping exists.
 *
 * `theme.vars` rather than a resolved value, so dark mode is a CSS variable rather
 * than a second render — and `text.secondary` is not under a `main` the way the
 * three intents are, which is the whole reason a mapping is needed at all instead of
 * an index into `palette`.
 *
 * Keyed on `GradeColorToken`, so this is total by construction: there is no
 * `Record<string, …>` to look a missing key up in and no non-null assertion standing
 * in for one. Both the marker and the row's left rule read it, so a token added to
 * the table cannot be drawn one way in one place and throw in the other.
 */
export const GRADE_PALETTE: Record<GradeColorToken, (theme: Theme) => string> = {
  success: (theme) => theme.vars.palette.success.main,
  error: (theme) => theme.vars.palette.error.main,
  textSecondary: (theme) => theme.vars.palette.text.secondary,
  info: (theme) => theme.vars.palette.info.main,
};
