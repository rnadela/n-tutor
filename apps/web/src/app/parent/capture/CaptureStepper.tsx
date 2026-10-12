'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import { PrimaryButton } from '@/components/Button';
import { parentCopy } from '@/copy/parent';
import {
  CAPTURE_STEPS,
  canAdvance,
  isStepComplete,
  nextStep,
  previousStep,
  stepIndex,
  type CaptureStep,
  type CaptureStepState,
} from '@/lib/capture-step';
import { density } from '@/theme/tokens';

/** One step's own word, as the rail labels it and as its heading reads. */
export function stepLabel(step: CaptureStep): string {
  return parentCopy.capture.steps[step];
}

export interface CaptureStepperProps {
  /** The step being shown. Which step is *allowed* is `capture-step.ts`'s. */
  step: CaptureStep;
  /** The draft's saved state, which is what the rail's marks and Next read. */
  state: CaptureStepState;
  /** A write is in flight, so neither control is offered for the duration. */
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}

/**
 * The rail that shows where in the upload the parent is, and the two controls
 * that move them.
 *
 * Presentational, for the reason `PageStrip` is: it holds no state, issues no
 * request and decides nothing about whether a step is reachable, so the rail
 * and both controls are assertable on rendered markup in a workspace whose
 * unit tests have no DOM.
 *
 * The rail is display-only — MUI's tappable step variant stays out — because
 * the flow is already sequential and Back/Next are the navigation. A tappable
 * rail would be a second, differently-gated way through the same state, and
 * nothing in the intent says what a tap on a future step should do.
 */
export function CaptureStepper({ step, state, busy, onBack, onNext }: CaptureStepperProps) {
  const previous = previousStep(step);
  const next = nextStep(step);
  const copy = parentCopy.capture.steps;

  return (
    <Box sx={{ display: 'grid', gap: `${density.gap * 1.5}px` }}>
      <Stepper activeStep={stepIndex(step)} alternativeLabel>
        {CAPTURE_STEPS.map((candidate) => (
          <Step key={candidate} completed={isStepComplete(candidate, state)}>
            <StepLabel>{stepLabel(candidate)}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* The same fact as the rail, in a sentence: the rail is a picture, and a
          parent who cannot see it is still told which step they are on. */}
      <Typography
        component="p"
        data-testid="capture-step-position"
        sx={{ color: 'text.secondary' }}
      >
        {copy.position(stepIndex(step) + 1, CAPTURE_STEPS.length, stepLabel(step))}
      </Typography>

      <Box sx={{ display: 'flex', gap: `${density.gap}px`, flexWrap: 'wrap' }}>
        <Button
          disabled={previous === null || busy}
          sx={{ minHeight: density.tapTarget }}
          onClick={onBack}
          data-testid="capture-step-back"
          // Nowhere to go back to, so the name says only what the button is
          // rather than naming the step the parent is already standing on.
          aria-label={previous === null ? copy.back : copy.backTo(stepLabel(previous))}
        >
          {copy.back}
        </Button>
        <PrimaryButton
          disabled={next === null || !canAdvance(step, state) || busy}
          sx={{ minHeight: density.tapTarget }}
          onClick={onNext}
          data-testid="capture-step-next"
          aria-label={next === null ? copy.next : copy.nextTo(stepLabel(next))}
        >
          {copy.next}
        </PrimaryButton>
      </Box>
    </Box>
  );
}
