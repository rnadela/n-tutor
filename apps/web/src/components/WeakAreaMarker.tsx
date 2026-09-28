'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { comfortableDensity, rounded, typeRoles } from '@/theme/tokens';

/**
 * The Weak Area marker: one verdict, drawn on four carriers at once, with no hooks
 * in it.
 *
 * Built to `GradeStateMarker`'s pattern, for the same reasons and with the same
 * rules:
 *
 * **The label is real text, and it is the announcement.** There is no `aria-label`
 * over the top of it and no visually-hidden duplicate — the same string is what is
 * shown and what is spoken, so the two cannot come apart (WCAG 2.5.3).
 *
 * **The glyph is `aria-hidden`.** An exclamation mark read out beside the words
 * "Weak Area" says the same thing twice, and a glyph has no reading of its own
 * worth having.
 *
 * **Colour is never the only carrier.** The triangular frame, the solid border and
 * the glyph each say it independently, and every non-colour carrier is also written
 * as a `data-` attribute — not decoration: `apps/web` runs its specs without a DOM
 * and with every colour, class and inline style stripped, so the attributes are how
 * "this is still distinguishable without colour" is a claim a test can make about
 * the markup rather than about a stylesheet.
 *
 * **It decides nothing.** It renders a verdict the API resolved and takes no
 * counts, no percentage and no threshold: a component that could compare a figure
 * would eventually be a second classifier. There is no `isWeakArea` prop either —
 * the caller renders this or renders nothing, so there is no "not weak" state for
 * this to draw.
 *
 * Shared from `components/` rather than living beside the table, because Story 7.5's
 * drill-down states the same verdict and two markers for one fact is two chances to
 * draw it differently.
 */
export function WeakAreaMarker() {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${comfortableDensity.gap / 2}px`,
      }}
      data-testid="weak-area-marker"
      // The three non-colour carriers, mirrored so a DOM-less spec can read them.
      data-frame="triangle"
      data-border="solid"
      data-glyph="!"
    >
      <Box
        component="span"
        aria-hidden="true"
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: comfortableDensity.gap * 1.5,
          height: comfortableDensity.gap * 1.5,
          // A triangle and not a circle or a square: the two shapes the grade
          // markers use are taken, and a fourth shape is what keeps this legible
          // beside one of them in the same row.
          clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
          borderRadius: `${rounded.paper / 2}px`,
          backgroundColor: theme.vars.palette.warning.main,
          color: theme.vars.palette.warning.contrastText,
          fontSize: typeRoles.label.fontSize,
          fontWeight: 700,
          lineHeight: 1,
          // The glyph sits low inside a triangle, so it is nudged off the apex
          // rather than being centred in a box it does not fill.
          paddingTop: `${comfortableDensity.gap / 3}px`,
        })}
      >
        !
      </Box>
      {/* The words themselves. The one place they are rendered, from the one place
          they are written. */}
      <Typography
        component="span"
        sx={(theme) => ({ ...typeRoles.label, color: theme.vars.palette.warning.main })}
        data-testid="weak-area-label"
      >
        {parentCopy.analytics.weakArea}
      </Typography>
    </Box>
  );
}
