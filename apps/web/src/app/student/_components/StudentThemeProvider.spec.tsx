import { renderToStaticMarkup } from 'react-dom/server';
import { useTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { comfortableDensity, type DensitySet } from '@/theme/tokens';
import { StudentThemeProvider } from './StudentThemeProvider';

/** What a Student Mode component sees when it reads the density. */
function densityInScope(): DensitySet {
  let seen: DensitySet | null = null;
  function Probe() {
    seen = useTheme().density;
    return null;
  }
  renderToStaticMarkup(
    <StudentThemeProvider>
      <Probe />
    </StudentThemeProvider>,
  );
  if (seen === null) throw new Error('The provider rendered no child.');
  return seen;
}

describe('the Student Mode theme provider', () => {
  it('hands every control on the surface the comfortable density set', () => {
    // Reverting this provider to `baseTheme` would silently put Student Mode
    // back on the 44px floor, which is exactly what UX-DR10 forbids.
    expect(densityInScope()).toEqual(comfortableDensity);
  });

  it('carries the larger tap-target floor with it', () => {
    expect(densityInScope().tapTarget).toBe(comfortableDensity.tapTarget);
    expect(densityInScope().tapTarget).toBeGreaterThan(44);
  });
});
