'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { isPageReadable } from '@/lib/legibility';
import { canMoveDown, canMoveUp, type MoveDirection } from '@/lib/page-order';
import type { PageImageView } from '@/lib/parent-api';
import { density, focusRing, rounded } from '@/theme/tokens';

/**
 * Every strip control is a real control at the parent tap-target floor, with a
 * visible focus ring. Both figures come from the theme; neither is written as a
 * number here (UX-DR9, UX-DR10).
 */
export const controlSx = {
  minHeight: density.tapTarget,
  minWidth: density.tapTarget,
  borderRadius: `${rounded.control}px`,
  '&:focus-visible': {
    outline: `${focusRing.width}px solid`,
    outlineOffset: `${focusRing.offset}px`,
  },
} as const;

/** The `<h2>` the ordered list is named by, rather than repeating its words. */
export const ORDER_HEADING_ID = 'capture-order-heading';

/**
 * The caption a removed page carries.
 *
 * Fixed `en-GB` in UTC rather than the viewer's locale: this is the one date on
 * the strip, it is a retention fact rather than an appointment, and a date that
 * renders differently per machine is a date no test can pin. The plain sentence
 * is used when the row has no date — a row written before the column existed —
 * and when the date will not parse.
 */
function deletedCaption(bytesDeletedAt: string | null): string {
  if (bytesDeletedAt === null) return parentCopy.capture.photoDeleted;
  const instant = new Date(bytesDeletedAt);
  // A timestamp that will not parse is the API's problem, not the parent's:
  // "Photo deleted on Invalid Date" is worse than the plain sentence, which is
  // true either way.
  if (!Number.isFinite(instant.getTime())) return parentCopy.capture.photoDeleted;
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(instant);
  return parentCopy.capture.photoDeletedOn(formatted);
}

export interface PageStripProps {
  pages: readonly PageImageView[];
  /**
   * Whether the pages may still be changed. False for a submitted Source Test,
   * which is shown but is terminal: every write against it answers 409, so
   * offering the controls would only be a way of collecting that refusal.
   */
  editable: boolean;
  /** A write is in flight; the whole strip locks rather than one row. */
  busy: boolean;
  onMove(pageId: string, ordinal: number, direction: MoveDirection): void;
  onRetake(pageId: string, file: File): void;
  onDelete(pageId: string, ordinal: number): void;
}

/**
 * The strip itself, as a component with no hooks in it.
 *
 * Separated from the screen so that what the accessibility criterion is about —
 * an ordered list, a real focusable control per action, each named by the page
 * ordinal it acts on, each at the 44px floor — can be rendered and asserted on.
 * `apps/web` runs its tests without a DOM and without a router, so a rule
 * reachable only through the whole page is a rule no test can state.
 */
export function PageStrip({ pages, editable, busy, onMove, onRetake, onDelete }: PageStripProps) {
  return (
    // An ordered list, so the strip is exposed as one: the ordinal a page
    // carries is structural, not merely painted on.
    //
    // `role="list"` and `role="listitem"` are re-applied by hand because
    // `list-style: none` is the exact construct that strips list semantics from
    // the accessibility tree in WebKit — and "it is an ordered list" is the
    // acceptance criterion, not a styling preference.
    //
    // Named by the heading above it rather than by its own `aria-label`: the
    // same words in both would be announced twice.
    <Box
      component="ol"
      role="list"
      aria-labelledby={ORDER_HEADING_ID}
      sx={{ display: 'grid', gap: `${density.gap}px`, listStyle: 'none', p: 0, m: 0 }}
    >
      {pages.map((page, index) => (
        <Box
          component="li"
          role="listitem"
          key={page.id}
          data-testid="page-row"
          data-page-id={page.id}
          data-ordinal={page.ordinal}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: `${density.gap}px`,
            minHeight: density.tapTarget,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: `${rounded.control}px`,
            p: `${density.cardPadding}px`,
          }}
        >
          {/* The ordinal in text, as the UX requires — not only in the
              controls' accessible names. */}
          <Typography component="span" sx={{ fontWeight: 700 }}>
            {parentCopy.capture.pageLabel(page.ordinal)}
          </Typography>

          {/* A removed photograph is a designed state, not a failure: the
              caption says what happened, in the row's own place in the order,
              and nothing else is offered. No image element (there never was
              one — bytes are never served), no error colour (nothing went
              wrong), no retry and no edit control, because every write against
              the submitted Source Test that holds it would answer 409.

              It is rendered instead of the legibility badge rather than beside
              it: a verdict about how readable a photograph was reads as a
              judgement on a photograph that no longer exists. */}
          {page.state === 'Deleted' && (
            <Typography component="span" data-testid={`page-deleted-${page.ordinal}`}>
              {deletedCaption(page.bytesDeletedAt)}
            </Typography>
          )}

          {/* The row's legibility state, once the check has run over this page
              set: the strip is the ordered list that names each page's ordinal
              *and* its readability.

              Glyph **and** text, never colour alone — the glyph is hidden from
              assistive technology and the word beside it is what is read, so a
              parent who cannot tell the two colours apart still gets the
              verdict. Absent before the check, because nothing has judged the
              page and a badge would be inventing a verdict. */}
          {page.state !== 'Deleted' && page.legibility !== null && (
            <Typography
              component="span"
              data-testid={`legibility-badge-${page.ordinal}`}
              sx={{ color: isPageReadable(page) ? 'text.primary' : 'error.main' }}
            >
              <Box component="span" aria-hidden="true">
                {isPageReadable(page) ? '\u2713 ' : '\u0021 '}
              </Box>
              {parentCopy.capture.legibility.verdictFor(
                page.ordinal,
                isPageReadable(page)
                  ? parentCopy.capture.legibility.readable
                  : parentCopy.capture.legibility.blurry,
              )}
            </Typography>
          )}

          {editable && page.state !== 'Deleted' && (
            <>
              <Button
                type="button"
                disabled={busy || !canMoveUp(index)}
                aria-label={parentCopy.capture.moveUpFor(page.ordinal)}
                sx={controlSx}
                onClick={() => onMove(page.id, page.ordinal, 'up')}
              >
                {parentCopy.capture.moveUp}
              </Button>
              <Button
                type="button"
                disabled={busy || !canMoveDown(index, pages.length)}
                aria-label={parentCopy.capture.moveDownFor(page.ordinal)}
                sx={controlSx}
                onClick={() => onMove(page.id, page.ordinal, 'down')}
              >
                {parentCopy.capture.moveDown}
              </Button>

              {/* The retake affordance is the same plain file input the add
                  control is, scoped to this page alone. Its visible label reads
                  "Retake"; its accessible name names the page, which is what
                  the strip's rule asks for. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
                <Typography component="label" htmlFor={`capture-retake-${page.id}`}>
                  {parentCopy.capture.retake}
                </Typography>
                <Box
                  component="input"
                  id={`capture-retake-${page.id}`}
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  aria-label={parentCopy.capture.retakeFor(page.ordinal)}
                  sx={controlSx}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    // Cleared so retaking the same photo twice still fires a
                    // change event the second time.
                    event.target.value = '';
                    if (file) onRetake(page.id, file);
                  }}
                />
              </Box>

              <Button
                type="button"
                variant="outlined"
                color="error"
                disabled={busy}
                aria-label={parentCopy.capture.deleteFor(page.ordinal)}
                sx={controlSx}
                onClick={() => onDelete(page.id, page.ordinal)}
              >
                {parentCopy.capture.delete}
              </Button>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}
