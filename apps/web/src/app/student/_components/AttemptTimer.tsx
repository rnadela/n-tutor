'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import { formatRemaining } from '@/lib/attempt-clock';
import { comfortableDensity, typeRoles } from '@/theme/tokens';

export interface AttemptTimerProps {
  /** How much time is left. `null` for an untimed Attempt, which renders nothing. */
  remainingMs: number | null;
  /**
   * The threshold currently being warned about, or `null` in steady state.
   *
   * Handed in rather than derived here, because a crossing is a comparison
   * between two readings and this component only ever sees one. The rule lives in
   * `attempt-clock`, where it is testable without a render.
   */
  warning: number | null;
}

/**
 * The countdown, in one place.
 *
 * **One component, so the rail and the Question column cannot render two
 * different clocks.** Take Test shows the map in two forms at two breakpoints and
 * a second copy of the timer beside either of them would be a second reading of
 * the same deadline for the two to drift apart on.
 *
 * Purely presentational: it takes a figure and a warning and renders them. It
 * holds no interval, reads no clock, decides no expiry and knows nothing about the
 * network — every one of those is the screen's or `attempt-clock`'s, which is what
 * makes the markup and the ARIA below assertable in a static render.
 *
 * **`role="timer"` with a unit-bearing `aria-label`.** The displayed value is the
 * `m:ss` figure alone; the label says what the figure is and in what units, so it
 * is never announced as a bare number. The value itself carries **no `aria-live`
 * at all** — `role="timer"` is implicitly off, and raising it here would read the
 * countdown aloud once a second, which is noise rather than information.
 *
 * The one live region is the **warning sentence**, which exists only while a
 * warning is showing. Its text is written from the *threshold*, not from the
 * ticking figure, so it changes exactly three times in a run: one announcement per
 * crossing and none between. A sentence carrying the live remaining time would
 * re-announce every second, which is the same noise by another route.
 *
 * **Each threshold carries a visible sentence, and the three are identical.** Same
 * sentence, same element, same treatment: nothing escalates, nothing is colour or
 * motion alone, and there is no transition or animation on any of it — the figure
 * changes in place. A countdown that got louder as it ran out would be pressure on
 * a child rather than a statement about a clock.
 *
 * Nothing here says anything about being right. It is a clock.
 */
export function AttemptTimer({ remainingMs, warning }: AttemptTimerProps) {
  // An untimed Attempt has no deadline to render and none to reach. Nothing at
  // all, rather than a dash or a disabled clock: there is no timer on this test.
  if (remainingMs === null) return null;

  const { display, spoken } = formatRemaining(remainingMs);

  return (
    <Box
      data-testid="attempt-timer"
      sx={{
        display: 'grid',
        gap: `${comfortableDensity.gap}px`,
        justifyItems: 'start',
      }}
    >
      <Typography
        component="p"
        role="timer"
        // The figure alone would be announced as a bare number. The label is what
        // says it is a time and in what units.
        aria-label={studentCopy.takeTest.timerLabel(spoken)}
        data-testid="attempt-timer-value"
        // The scale's own timer role, whose `tabular` flag is what keeps the
        // figures from shifting width as they tick (UX-DR7). No transition and no
        // animation property anywhere: the figure changes in place, and a per-tick
        // animation on a countdown is exactly what UX-DR37 exists to prevent.
        sx={{ ...typeRoles.timer }}
      >
        {studentCopy.takeTest.timerRemaining(display)}
      </Typography>

      {/* The visible half of every warning, rendered identically at all three
          thresholds. Never colour or motion alone, and never a different treatment
          at the last one than at the first. */}
      {warning !== null && (
        <Typography
          component="p"
          // Raised only while a warning is showing, and carrying a sentence
          // written from the threshold rather than from the ticking figure — so it
          // announces once per crossing and never between.
          aria-live="polite"
          data-testid="attempt-timer-warning"
          sx={{ ...typeRoles.caption }}
        >
          {studentCopy.takeTest.timerWarning(formatRemaining(warning).spoken)}
        </Typography>
      )}
    </Box>
  );
}
