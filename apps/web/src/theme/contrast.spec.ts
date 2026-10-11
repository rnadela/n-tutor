import { describe, expect, it } from 'vitest';
import { colorTokens, type ColorScheme, type ColorTokenName } from './tokens';

/**
 * DESIGN.md's measured-contrast table, pinned by computation.
 *
 * Every pair here is named by *token name* and read through `colorTokens`, never
 * pasted as a hex. A spec that stored the ratios as numbers would pass forever;
 * this one recomputes them from the live palette, so any future token edit that
 * drops a pair below its WCAG floor fails CI instead of shipping.
 *
 * Floors: 4.5:1 for text pairs (SC 1.4.3), and 3:1 under SC 1.4.11 for the
 * non-text pairs this file asserts — the divider against all four grounds it
 * draws on, which is the entire boundary of every control. The focus ring is
 * always evaluated against the surface *behind* the control, so its pairs are
 * the accent-on-ground rows already in `TEXT_PAIRS`; DESIGN.md's table lists no
 * accent-on-tint pair, so none is asserted here.
 */
const schemes = ['light', 'dark'] as const satisfies readonly ColorScheme[];

const TEXT_FLOOR = 4.5;
const NON_TEXT_FLOOR = 3;

/** WCAG 2.1 relative luminance, per channel. */
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const COEFFICIENTS = [0.2126, 0.7152, 0.0722] as const;

const luminance = (hex: string) =>
  [1, 3, 5]
    .map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
    .reduce((sum, c, i) => sum + COEFFICIENTS[i]! * c, 0);

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const ratio = (a: ColorTokenName, b: ColorTokenName, scheme: ColorScheme) =>
  contrastRatio(colorTokens[a][scheme], colorTokens[b][scheme]);

type Pair = readonly [ColorTokenName, ColorTokenName];

/** Text pairs: foreground token, ground token. Floor 4.5:1. */
const TEXT_PAIRS: readonly Pair[] = [
  // `question-body` and every other content role resolve to `textPrimary`.
  ['textPrimary', 'backgroundPaper'],
  // The app's most-rendered pair, and both of its values moved in this story:
  // 13.62:1 light / 15.29:1 dark.
  ['textPrimary', 'backgroundDefault'],
  ['success', 'backgroundPaper'],
  ['error', 'backgroundPaper'],
  ['warning', 'backgroundPaper'],
  ['info', 'backgroundPaper'],
  ['secondary', 'backgroundPaper'],
  ['textSecondary', 'backgroundPaper'],
  ['textSecondary', 'backgroundDefault'],
  ['textPrimary', 'tintHover'],
  ['textPrimary', 'tintSelected'],
  ['primaryStudent', 'backgroundPaper'],
  ['primaryStudent', 'backgroundDefault'],
  ['primaryParent', 'backgroundPaper'],
  ['primaryParent', 'backgroundDefault'],
  ['onPrimary', 'primaryStudent'],
  ['onPrimary', 'primaryParent'],
  // `WeakAreaMarker` fills with `warning.main` and paints its `!` glyph in
  // `warning.contrastText`, which `theme.ts` maps to `onPrimary` — a rendered
  // text pair whose dark value this story moved. 5.93:1 light / 9.47:1 dark.
  ['onPrimary', 'warning'],
  ['success', 'tintSelected'],
];

/**
 * Non-text pairs: the divider against all four grounds it ever draws on. Floor
 * 3:1, because the 1px border is the whole boundary of the control — shadows are
 * banned and the paper→default step is a reading cue, not an edge.
 */
const NON_TEXT_PAIRS: readonly Pair[] = [
  ['divider', 'backgroundPaper'],
  ['divider', 'backgroundDefault'],
  ['divider', 'tintHover'],
  ['divider', 'tintSelected'],
];

/**
 * The camera viewfinder's own set, against the single inverted ground. There is
 * one ground only: an inverted surface is dark in both schemes, so these are not
 * measured per scheme.
 */
const INVERTED_PAIRS = [
  ['primaryOnInverted', NON_TEXT_FLOOR],
  ['dividerOnInverted', NON_TEXT_FLOOR],
  ['textOnInverted', TEXT_FLOOR],
] as const satisfies readonly (readonly [ColorTokenName, number])[];

/**
 * The Clear Room palette, superseded 2026-10-11. Nineteen retired hexes plus the
 * one rejected dark-selected candidate. `#0F6E78`, `#71C3CE`, `#FFFFFF`,
 * `#B3261E`, `#F19B94`, `#8A5A00`, `#E3B457`, `#2E6E9E` and `#8CC0E4` are
 * deliberately absent from this list: they survive into Reading Room (the two
 * retired Student-accent values became `success`).
 */
const SUPERSEDED_HEXES = [
  '#0B5FA5',
  '#7FB6E8',
  '#0E1620',
  '#4A6072',
  '#9DB2C4',
  '#0F6B4F',
  '#6FD1AC',
  '#F6F8FA',
  '#16202C',
  '#10202E',
  '#E7EEF5',
  '#4E6070',
  '#A3B3C2',
  '#7C8894',
  '#6A747E',
  '#EEF3F5',
  '#1C2836',
  '#E8F1F2',
  '#0D2A33',
  // Rejected during the Reading Room revision: measured exactly 3.00:1 against
  // the dark divider, so the tint moved — never the divider.
  '#163027',
] as const;

describe('contrastRatio', () => {
  it('is 21:1 between black and white, and 1:1 with itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    // An arbitrary mid-tone that is deliberately not a token value, so this
    // reference case cannot go stale behind a palette revision.
    expect(contrastRatio('#808080', '#808080')).toBeCloseTo(1, 10);
  });
});

describe('text pairs clear SC 1.4.3 in both schemes', () => {
  it.each(TEXT_PAIRS.flatMap(([fg, bg]) => schemes.map((scheme) => ({ fg, bg, scheme }))))(
    '$fg on $bg, $scheme',
    ({ fg, bg, scheme }) => {
      const measured = ratio(fg, bg, scheme);
      expect(
        measured,
        `${fg} on ${bg} (${scheme}) measures ${measured.toFixed(2)}:1, below the ${TEXT_FLOOR}:1 text floor`,
      ).toBeGreaterThanOrEqual(TEXT_FLOOR);
    },
  );
});

describe('non-text pairs clear SC 1.4.11 in both schemes', () => {
  it.each(NON_TEXT_PAIRS.flatMap(([fg, bg]) => schemes.map((scheme) => ({ fg, bg, scheme }))))(
    '$fg on $bg, $scheme',
    ({ fg, bg, scheme }) => {
      const measured = ratio(fg, bg, scheme);
      expect(
        measured,
        `${fg} on ${bg} (${scheme}) measures ${measured.toFixed(2)}:1, below the ${NON_TEXT_FLOOR}:1 non-text floor`,
      ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
    },
  );
});

describe('the camera chrome clears its floors on the one inverted ground', () => {
  it.each(INVERTED_PAIRS.map(([name, floor]) => ({ name, floor })))(
    '$name on backgroundInverted',
    ({ name, floor }) => {
      // One ground only, so `light` and `dark` hold the same value by design.
      expect(colorTokens[name].light, `${name} must not track the scheme`).toBe(
        colorTokens[name].dark,
      );
      expect(colorTokens.backgroundInverted.light).toBe(colorTokens.backgroundInverted.dark);

      const measured = ratio(name, 'backgroundInverted', 'light');
      expect(
        measured,
        `${name} on backgroundInverted measures ${measured.toFixed(2)}:1, below ${floor}:1`,
      ).toBeGreaterThanOrEqual(floor);
    },
  );

  it('keeps the shutter label readable as text, not merely visible as a shape', () => {
    // The shutter *fills* with `primaryOnInverted` and sets its label in
    // `backgroundInverted` (`CameraViewfinder.tsx`), at the label role's normal
    // size — so this is the capture screen's primary action as a text pair under
    // SC 1.4.3, not a 3:1 non-text one. 7.21:1. Asserted separately because a
    // re-value to a mid-tone accent would clear 3:1 and still be unreadable.
    const measured = ratio('backgroundInverted', 'primaryOnInverted', 'light');
    expect(
      measured,
      `the shutter label measures ${measured.toFixed(2)}:1, below the ${TEXT_FLOOR}:1 text floor`,
    ).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  it('pins the four duplications `tokens.ts` forbids collapsing', () => {
    // These identities are the documented rule, not an invitation to alias: the
    // comment in `tokens.ts` says never to collapse them, and this is what makes
    // breaking the duplication fail rather than drift silently.
    expect(colorTokens.backgroundInverted.light).toBe(colorTokens.textPrimary.light);
    expect(colorTokens.primaryOnInverted.light).toBe(colorTokens.primaryParent.dark);
    expect(colorTokens.dividerOnInverted.light).toBe(colorTokens.divider.dark);
    expect(colorTokens.textOnInverted.light).toBe(colorTokens.onPrimary.light);
  });

  it('pins `brandGround` as byte-identical to light `backgroundPaper`', () => {
    // The icon's own ground must not move when the palette does — `tokens.ts`
    // names this duplication deliberate and forbids aliasing or collapsing it.
    expect(colorTokens.brandGround.light).toBe(colorTokens.backgroundPaper.light);
  });

  it('still cannot use the light parent primary, which is why the duplicate exists', () => {
    // 1.87:1. If this ever clears 3:1 the comment in `tokens.ts` has gone stale
    // and the deliberate duplication needs re-arguing rather than silently
    // keeping.
    const measured = ratio('primaryParent', 'backgroundInverted', 'light');
    expect(
      measured,
      `light primaryParent now measures ${measured.toFixed(2)}:1 on the inverted ground`,
    ).toBeLessThan(NON_TEXT_FLOOR);
  });
});

describe('the ground step is a reading cue, not a boundary', () => {
  it.each(schemes)(
    'backgroundDefault → backgroundPaper is a real but small step in %s',
    (scheme) => {
      // 1.10 light / 1.09 dark. Bounded on both sides: above 1.2 it would start
      // reading as a boundary the divider is supposed to carry alone, and at 1.00
      // the two grounds have collapsed and the reading cue is gone entirely.
      const measured = ratio('backgroundDefault', 'backgroundPaper', scheme);
      const message = `the ${scheme} ground step measures ${measured.toFixed(2)}:1`;
      expect(measured, message).toBeLessThan(1.2);
      expect(measured, message).toBeGreaterThan(1.05);
    },
  );
});

describe('the superseded Clear Room palette is gone', () => {
  it.each(SUPERSEDED_HEXES)('%s appears in no token', (hex) => {
    // Both sides normalised, so a lowercase entry added to the list later still
    // matches rather than silently passing.
    const retired = hex.toUpperCase();
    const offenders = Object.entries(colorTokens).flatMap(([name, pair]) =>
      schemes.filter((scheme) => pair[scheme].toUpperCase() === retired).map((s) => `${name}.${s}`),
    );
    expect(offenders, `superseded ${hex} survives at ${offenders.join(', ')}`).toEqual([]);
  });
});
