import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { barOffsetCss, bottomNavShown } from '@/lib/bottom-nav';
import { spacing } from '@/theme/tokens';

/**
 * Where the snackbar sits relative to the bottom navigation bar.
 *
 * Source-read rather than rendered: the offset is decided by `usePathname`,
 * which this workspace has no router for, so a render here would always take
 * the no-bar branch and assert nothing. What the snackbar *says* and when it
 * announces is asserted in `primitives.spec.tsx`, where it can be rendered.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'Snackbar.tsx'), 'utf8');
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/u.test(line))
  .join('\n');

describe('where a message sits when the bar is on screen', () => {
  it('lifts by the bar’s own offset below `lg` and returns to MUI’s from there up', () => {
    // A message that covers the navigation is a message that hides where you
    // are. The figure is the shared `calc()`, so it cannot drift from the
    // bar's actual height.
    expect(CODE).toContain('barOffsetCss');
    expect(CODE).toContain('{ bottom: { xs: barOffsetCss, lg: `${spacing[3]}px` } }');
    expect(barOffsetCss).toContain('env(safe-area-inset-bottom)');
    expect(spacing[3]).toBeGreaterThan(0);
  });

  it('lifts only on the routes that actually carry the bar', () => {
    // Many screens mount this and a few of them — the PIN gate, the Attempt —
    // have no bar; a message floating a bar's height above nothing reads as a
    // mistake.
    expect(CODE).toContain('bottomNavShown(pathname)');
    expect(CODE).toContain('liftedOverBar');
    expect(CODE).toContain(': undefined');
    expect(bottomNavShown('/parent/drafts')).toBe(true);
    expect(bottomNavShown('/parent/pin')).toBe(false);
  });

  it('does not lift over a bar the viewfinder has already hidden', () => {
    // `/parent/capture` carries the bar by route, but the live camera screen
    // suppresses it. Lifting anyway would leave a gap over nothing.
    expect(CODE).toContain('useCaptureOpen()');
    expect(CODE).toContain('!captureOpen');
  });

  it('survives rendering outside a router rather than throwing on a null pathname', () => {
    // `usePathname` is `null` with no router above it, which is every unit
    // render in this workspace — and "no router" is also "no bar".
    expect(CODE).toContain("typeof pathname === 'string'");
  });

  it('states the breakpoint as a key and never reads a viewport width', () => {
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\.inner/u);
    expect(CODE).not.toContain('@media');
  });
});
