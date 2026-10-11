import { describe, expect, it } from 'vitest';
import manifest from './manifest';
import { commonCopy } from '@/copy/common';
import { colorTokens } from '@/theme/tokens';

describe('manifest', () => {
  it('names the app from the copy module, for both name and short_name', () => {
    // Asserted against the copy module rather than against `'n-tutor'` so a
    // rename lands in one place and this spec follows it — the point of the
    // route reading copy at all.
    const result = manifest();
    expect(result.name).toBe(commonCopy.appName);
    expect(result.short_name).toBe(commonCopy.appName);
  });

  it('claims the whole app as its scope and opens standalone', () => {
    // The three fields a browser weighs when deciding whether this is an app
    // it can install, and the ones that make a link inside n-tutor stay in the
    // installed window instead of kicking out to a browser tab.
    const result = manifest();
    expect(result.start_url).toBe('/');
    expect(result.scope).toBe('/');
    expect(result.display).toBe('standalone');
  });

  it('takes both colours from the design tokens rather than from literals', () => {
    const result = manifest();
    expect(result.theme_color).toBe(colorTokens.primaryStudent.light);
    expect(result.background_color).toBe(colorTokens.backgroundDefault.light);
  });

  it('offers 192, 512 and a maskable 512, all self-hosted', () => {
    const icons = manifest().icons ?? [];

    const any192 = icons.find((icon) => icon.sizes === '192x192');
    const any512 = icons.find((icon) => icon.sizes === '512x512' && icon.purpose !== 'maskable');
    const maskable = icons.find((icon) => icon.purpose === 'maskable');

    expect(any192?.type).toBe('image/png');
    expect(any512?.type).toBe('image/png');
    expect(maskable?.sizes).toBe('512x512');
    expect(maskable?.type).toBe('image/png');

    // The maskable entry must be its *own* art, not the same file wearing a
    // different purpose: the un-inset glyph would be clipped by the platform's
    // mask.
    expect(maskable?.src).not.toBe(any512?.src);

    // UX-DR5: nothing is fetched from a CDN at runtime.
    for (const icon of icons) {
      expect(icon.src.startsWith('/')).toBe(true);
    }
  });
});
