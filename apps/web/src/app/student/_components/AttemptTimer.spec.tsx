import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { WARNING_THRESHOLDS_MS } from '@/lib/attempt-clock';
import { studentTheme } from '@/theme/theme';
import { AttemptTimer } from './AttemptTimer';

function render(remainingMs: number | null, warning: number | null = null): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(AttemptTimer, { remainingMs, warning }),
    ),
  );
}

/**
 * The markup with the emotion `<style>` blocks removed.
 *
 * Generated CSS carries `right`, `100%` and plenty else that has nothing to do
 * with what this clock states, and asserting over it would fail about a width
 * rule. The style blocks are asserted over separately and deliberately, where
 * the claim is about them.
 */
function body(markup: string): string {
  return markup.replace(/<style[\s\S]*?<\/style>/gu, '');
}

describe('the countdown as a timer', () => {
  it('is a real timer with a unit-bearing accessible name', () => {
    const markup = body(render(5 * 60_000));
    expect(markup).toContain('role="timer"');
    // The figure alone would be announced as a bare number.
    expect(markup).toContain('aria-label="Time left: 5 minutes"');
    expect(markup).toContain('>5:00<');
  });

  it('says the units in the label and never beside the figure', () => {
    const markup = body(render(90_000));
    expect(markup).toContain('aria-label="Time left: 1 minute and 30 seconds"');
    // The visible value is the clock alone: the units are the label's, and
    // repeating them would make every tick read twice.
    expect(markup).toContain('>1:30<');
    expect(markup).not.toContain('>1:30 minutes<');
  });

  it('renders nothing at all for an untimed Attempt', () => {
    // Not a dash and not a disabled clock: there is no timer on this test. The
    // theme's own `<style>` block is all that is left of the render.
    expect(body(render(null)).trim()).toBe('');
    expect(body(render(null, 60_000)).trim()).toBe('');
  });

  it('never shows a negative or a zero with time still on it', () => {
    expect(body(render(0))).toContain('>0:00<');
    expect(body(render(1))).toContain('>0:01<');
    // No minus sign on the figure itself. Asserted on the value rather than the
    // markup, whose generated class names are full of hyphens.
    expect(body(render(0))).toMatch(/data-testid="attempt-timer-value">0:00</u);
    expect(body(render(-5_000))).toMatch(/data-testid="attempt-timer-value">0:00</u);
  });
});

describe('steady state', () => {
  it('shows no warning sentence and raises no live region', () => {
    const markup = body(render(12 * 60_000));
    expect(markup).not.toContain('attempt-timer-warning');
    expect(markup).not.toContain('You have');
    // A live region on the value itself would read the clock aloud every second.
    expect(markup).not.toContain('aria-live');
  });
});

describe('the three thresholds', () => {
  it('shows a visible sentence at each, and raises the region only then', () => {
    for (const threshold of WARNING_THRESHOLDS_MS) {
      const markup = body(render(threshold, threshold));
      expect(markup).toContain('data-testid="attempt-timer-warning"');
      expect(markup).toContain('aria-live="polite"');
      // A visible text change, not colour and not motion: the sentence is there in
      // words for anybody who cannot see a treatment at all.
      expect(markup).toMatch(/You have .* left\./u);
    }
  });

  it('renders identically at all three, with nothing escalating', () => {
    // The markup with the figure normalised away: what is left is the *treatment*,
    // and it has to be the same at twenty seconds as at five minutes. A different
    // element, a different attribute or an extra node at the last threshold would
    // be an escalation.
    const shapes = WARNING_THRESHOLDS_MS.map((threshold) =>
      body(render(threshold, threshold))
        .replace(/\d+:\d\d/gu, 'T')
        .replace(/\d+ (minute|second)s?( and \d+ seconds?)?/gu, 'D'),
    );
    expect(new Set(shapes).size).toBe(1);
  });

  it('carries no animation, transition or per-tick motion of any kind', () => {
    // The whole markup, style blocks included: a transition on a countdown is a
    // per-tick animation, which is exactly what UX-DR37 forbids here.
    for (const threshold of [null, ...WARNING_THRESHOLDS_MS]) {
      const markup = render(threshold ?? 12 * 60_000, threshold);
      expect(markup).not.toMatch(/transition|animation|@keyframes|transform/iu);
    }
  });

  it('says nothing about being right, at any threshold or in steady state', () => {
    for (const [remaining, warning] of [
      [12 * 60_000, null],
      [300_000, 300_000],
      [60_000, 60_000],
      [20_000, 20_000],
      [0, null],
    ] as const) {
      const markup = body(render(remaining, warning));
      expect(markup).not.toMatch(/correct|wrong|score|grade|right|%/iu);
      expect(markup).not.toContain('!');
    }
  });
});
