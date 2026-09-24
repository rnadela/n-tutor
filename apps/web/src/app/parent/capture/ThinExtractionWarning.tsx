'use client';

import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { AppDialog, type AppDialogProps } from '@/components/Dialog';
import { parentCopy } from '@/copy/parent';
import { density } from '@/theme/tokens';
import { controlSx } from './PageStrip';

export type ThinExtractionWarningProps = Omit<
  AppDialogProps,
  'title' | 'onClose' | 'children' | 'actions'
> & {
  open: boolean;
  /** Both figures come from the status read; neither is computed here. */
  usableQuestionCount: number;
  pageCount: number;
  /** A write is in flight — the retake's fresh draft is being opened. */
  busy: boolean;
  onContinue(): void;
  onRetake(): void;
  /**
   * Escape, or a tap on the scrim. A cancel, as it is everywhere else in this
   * app — never a quiet third way of continuing.
   */
  onDismiss(): void;
};

/**
 * What a parent is told when the Extraction found less than expected for the
 * pages submitted, and the two ways out of it.
 *
 * Presentational, and only that: it holds no state, makes no request, and does
 * not decide whether it should be open — the verdict is the server's and the
 * gate is `warningNeeded`. Split out of the screen for the same reason
 * `PageStrip` is: the three facts the requirement names and the two controls
 * are then assertable on rendered markup.
 *
 * It is an `AppDialog` with two plain buttons rather than a destructive
 * confirmation (UX-DR27): nothing here is destroyed, and neither choice costs
 * anything. Continue is never disabled by the verdict — the warning informs, it
 * does not block.
 */
export function ThinExtractionWarning({
  open,
  usableQuestionCount,
  pageCount,
  busy,
  onContinue,
  onRetake,
  onDismiss,
  ...rest
}: ThinExtractionWarningProps) {
  const copy = parentCopy.capture.generate;
  return (
    <AppDialog
      {...rest}
      open={open}
      title={copy.warningTitle}
      // Dismissing closes the warning and nothing else: an accidental Escape
      // or scrim tap must not advance the flow, and must not announce that the
      // upload is ready. The parent is left on the proceed control.
      onClose={onDismiss}
      actions={
        <>
          <Button
            type="button"
            variant="outlined"
            disabled={busy}
            sx={controlSx}
            onClick={onRetake}
            data-testid="thin-retake"
          >
            {copy.retakePages}
          </Button>
          {/* Never disabled by the verdict: a genuinely short quiz is valid. */}
          <Button
            type="button"
            variant="contained"
            sx={controlSx}
            onClick={onContinue}
            data-testid="thin-continue"
          >
            {copy.continueAnyway}
          </Button>
        </>
      }
    >
      <Typography component="p" data-testid="thin-counts" sx={{ mb: `${density.gap}px` }}>
        {copy.counts(usableQuestionCount, pageCount)}
      </Typography>
      {/* Said before the choice is made, not after it: the parent is deciding
          whether retaking is worth it, and what it costs is the deciding fact. */}
      <Typography component="p" data-testid="thin-no-charge">
        {copy.noGenerationCharge}
      </Typography>
    </AppDialog>
  );
}
