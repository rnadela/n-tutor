import { describe, expect, it } from 'vitest';
import {
  colorModeSwitchShown,
  effectiveScheme,
  nextScheme,
  syncThemeColor,
  themeColorFor,
  THEME_COLOR_SELECTOR,
  type ColorSchemeChoice,
  type ThemeColorDocument,
} from './color-mode';
import { colorTokens } from '@/theme/tokens';

/** A `document` with `count` theme-colour metas and nothing else in it. */
function documentWith(count: number): {
  doc: ThemeColorDocument;
  contents: () => (string | null)[];
  selectors: () => string[];
} {
  const written: (string | null)[] = Array.from({ length: count }, () => null);
  const asked: string[] = [];
  return {
    doc: {
      querySelectorAll(selector: string) {
        asked.push(selector);
        return written.map((_, at) => ({
          setAttribute(name: string, value: string) {
            expect(name).toBe('content');
            written[at] = value;
          },
        }));
      },
    },
    contents: () => written,
    selectors: () => asked,
  };
}

describe('the scheme in effect', () => {
  it('is the device preference on a device whose switch has never been used', () => {
    // Both halves of the matrix's "never used" pair: nothing about today's
    // behaviour changes until somebody presses the thing.
    expect(effectiveScheme('system', 'light')).toBe('light');
    expect(effectiveScheme('system', 'dark')).toBe('dark');
  });

  it('is the held choice once there is one', () => {
    expect(effectiveScheme('light', 'light')).toBe('light');
    expect(effectiveScheme('dark', 'dark')).toBe('dark');
  });

  it('ignores a device preference that changed after the choice', () => {
    // The whole point of the story: a choice is not overridden later by the
    // device, in either direction.
    expect(effectiveScheme('light', 'dark')).toBe('light');
    expect(effectiveScheme('dark', 'light')).toBe('dark');
  });

  it('is unresolved on the server render and the hydration render', () => {
    // `mode` is `undefined` on both, so a switch that guessed "light" would
    // announce the wrong next press for the first frame on a dark device.
    expect(effectiveScheme(undefined, undefined)).toBeNull();
    expect(effectiveScheme(undefined, 'dark')).toBeNull();
  });

  it('is unresolved while following a device preference nobody has read yet', () => {
    expect(effectiveScheme('system', undefined)).toBeNull();
  });
});

describe('what a press offers', () => {
  it('is always the other scheme', () => {
    expect(nextScheme('light')).toBe('dark');
    expect(nextScheme('dark')).toBe('light');
  });

  it('is the opposite of what is showing, even on the first press off the device', () => {
    // The matrix's "first press off the device": `mode: 'system'` on a dark
    // device lands on light, not on dark-again.
    const showing = effectiveScheme('system', 'dark');
    expect(showing).not.toBeNull();
    expect(nextScheme(showing as ColorSchemeChoice)).toBe('light');
  });

  it('returns to where it started after two presses', () => {
    expect(nextScheme(nextScheme('light'))).toBe('light');
  });
});

describe('where the switch may appear', () => {
  it('stays off the camera capture screen and everything under it', () => {
    expect(colorModeSwitchShown('/parent/capture')).toBe(false);
    expect(colorModeSwitchShown('/parent/capture/')).toBe(false);
    expect(colorModeSwitchShown('/parent/capture/review')).toBe(false);
  });

  it('stays off an in-progress Attempt and everything under it', () => {
    expect(colorModeSwitchShown('/student/tests')).toBe(false);
    expect(colorModeSwitchShown('/student/tests/')).toBe(false);
    expect(colorModeSwitchShown('/student/tests/abc-123')).toBe(false);
    expect(colorModeSwitchShown('/student/tests/abc-123/')).toBe(false);
  });

  it('appears on every other screen, including the ones it is placed on', () => {
    for (const path of [
      '/',
      '/auth/sign-in',
      '/auth/sign-up',
      '/parent',
      '/parent/',
      '/parent/students',
      '/student',
      '/student/',
      '/admin/subjects',
    ]) {
      expect(colorModeSwitchShown(path), path).toBe(true);
    }
  });

  it('is not fooled by a screen whose name merely starts like an excluded one', () => {
    // `startsWith` on the bare prefix would swallow these.
    expect(colorModeSwitchShown('/parent/captures')).toBe(true);
    expect(colorModeSwitchShown('/student/testsuite')).toBe(true);
  });
});

describe('the colour the browser paints its own chrome', () => {
  it('is the brand ink for the scheme, from the tokens', () => {
    expect(themeColorFor('light')).toBe(colorTokens.brandInk.light);
    expect(themeColorFor('dark')).toBe(colorTokens.brandInk.dark);
  });

  it('writes the scheme into every theme-colour meta in the document', () => {
    // Both, because the browser applies the first whose `media` matches and the
    // media-scoped pair is emitted above anything we could append.
    const two = documentWith(2);
    syncThemeColor(two.doc, 'dark');
    expect(two.contents()).toEqual([colorTokens.brandInk.dark, colorTokens.brandInk.dark]);
    expect(two.selectors()).toEqual([THEME_COLOR_SELECTOR]);
  });

  it('writes the one meta a document with only one carries', () => {
    const one = documentWith(1);
    syncThemeColor(one.doc, 'light');
    expect(one.contents()).toEqual([colorTokens.brandInk.light]);
  });

  it('does nothing, and throws nothing, in a document that has none', () => {
    const none = documentWith(0);
    expect(() => syncThemeColor(none.doc, 'dark')).not.toThrow();
    expect(none.contents()).toEqual([]);
  });
});
