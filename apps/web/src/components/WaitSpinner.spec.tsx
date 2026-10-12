import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentTheme } from '@/theme/theme';
import { WAIT_SPINNER_MIN_SIZE, WaitSpinner } from './WaitSpinner';

/** The spinner as a parent actually receives it: rendered, under the parent theme. */
function render(size?: number): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: parentTheme },
      createElement(WaitSpinner, size === undefined ? {} : { size }),
    ),
  );
}

/** The emotion class one named node actually carries. */
function classOf(markup: string, testid: string): string {
  const node = new RegExp(`<div class="([^"]*)" data-testid="${testid}"`, 'u').exec(markup);
  expect(node, testid).toBeTruthy();
  const emitted = node![1]!.split(' ').find((name) => name.startsWith('css-'));
  expect(emitted, testid).toBeTruthy();
  return emitted!;
}

/**
 * One node's own declarations, and its own reduced-motion declarations.
 *
 * Tied to the class the node carries rather than matched by wildcard: a
 * wildcard proves that *some* rule hides *something*, which stays true with the
 * two `sx` blocks swapped — the ring visible only under reduced motion and
 * nothing visible otherwise. The point of the swap is which node wins when, so
 * that is what is read here.
 */
function rulesFor(markup: string, testid: string): { base: string; reduced: string } {
  const cls = classOf(markup, testid);
  const base = new RegExp(`\\.${cls}\\{([^}]*)\\}`, 'u').exec(markup);
  const reduced = new RegExp(
    `@media \\(prefers-reduced-motion: reduce\\)\\{\\.${cls}\\{([^}]*)\\}\\}`,
    'u',
  ).exec(markup);
  expect(base, `${testid}: base rule`).toBeTruthy();
  expect(reduced, `${testid}: reduced-motion rule`).toBeTruthy();
  return { base: base![1]!, reduced: reduced![1]! };
}

describe('how large the wait mark is', () => {
  it('is at least 48px, which is the figure the floor resolves to', () => {
    // Named rather than written: the floor is the parent tap target plus half a
    // gap, and the acceptance criterion is about the resolved figure.
    expect(WAIT_SPINNER_MIN_SIZE).toBeGreaterThanOrEqual(48);
    const markup = render();
    expect(markup).toContain(`data-size="${WAIT_SPINNER_MIN_SIZE}"`);
    // The rotating ring takes its size inline, so the figure that actually
    // reaches the browser is readable here. Interpolated and not written: a
    // change to the token is a decision about the floor, not a failure of this
    // criterion.
    expect(markup).toContain(
      `style="width:${WAIT_SPINNER_MIN_SIZE}px;height:${WAIT_SPINNER_MIN_SIZE}px`,
    );
    // And the static ring is the same size, from its own stylesheet.
    expect(rulesFor(markup, 'wait-spinner-static').base).toContain(
      `width:${WAIT_SPINNER_MIN_SIZE}px`,
    );
  });

  it('grows to circle a larger mark when a caller asks', () => {
    // The tally sizes it to its sheet cell: one component, two sizes.
    const larger = WAIT_SPINNER_MIN_SIZE * 2;
    expect(render(larger)).toContain(`data-size="${larger}"`);
    expect(render(larger)).toContain(`style="width:${larger}px;height:${larger}px`);
  });

  it('refuses a size below the floor rather than shrinking', () => {
    // A caller sizing this to a smaller glyph would otherwise silently drop it
    // under the size the acceptance criterion names.
    const tiny = Math.round(WAIT_SPINNER_MIN_SIZE / 3);
    expect(render(tiny)).toContain(`data-size="${WAIT_SPINNER_MIN_SIZE}"`);
    expect(render(tiny)).not.toContain(`width:${tiny}px`);
  });

  it('falls back to the floor for a size that is not a figure at all', () => {
    // `width: NaNpx` renders nothing, which would take the whole "something is
    // happening" claim with it — and an arithmetic slip in a caller is exactly
    // how a `NaN` arrives.
    for (const size of [Number.NaN, Infinity, -Infinity]) {
      const markup = render(size);
      expect(markup, String(size)).toContain(`data-size="${WAIT_SPINNER_MIN_SIZE}"`);
      expect(markup, String(size)).not.toContain('NaN');
      expect(markup, String(size)).not.toContain('Infinity');
    }
  });
});

describe('what the wait mark says to a screen reader', () => {
  it('says nothing at all', () => {
    const markup = render();
    expect(markup).toContain('aria-hidden="true"');
    // The surface's one polite region is mounted once in `ThemeRegistry`; the
    // status sentence beside this spinner is already being read out, and a
    // second region would read it twice.
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('aria-live');
    expect(markup).not.toContain('aria-label');
  });

  it('states no progress figure anywhere, in either state', () => {
    // Nothing here knows how far along either wait is. A determinate arc would
    // read as a percentage for the length of the wait, and would say it out
    // loud through `aria-valuenow` as well.
    const markup = render();
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).not.toContain('MuiCircularProgress-determinate');
  });
});

describe('what reduced motion gets instead of a rotation', () => {
  it('renders both marks, so neither has to be chosen in JavaScript', () => {
    const markup = render();
    expect(markup).toContain('data-testid="wait-spinner-moving"');
    expect(markup).toContain('data-testid="wait-spinner-static"');
    expect(markup).toContain('MuiCircularProgress-indeterminate');
  });

  it('hides the rotating mark under reduced motion, and only then', () => {
    const { base, reduced } = rulesFor(render(), 'wait-spinner-moving');
    expect(base).toContain('inline-flex');
    expect(base).not.toContain('display:none');
    expect(reduced).toBe('display:none;');
  });

  it('shows the static mark under reduced motion, and only then', () => {
    // The whole reason the component carries its own query: `theme.ts` zeroes
    // every animation globally, which stops the rotation but leaves an
    // indeterminate ring frozen on whatever keyframe it happened to reach.
    // "The static mark is shown" is a positive claim, and this is where it is
    // made — on the node that makes it.
    const { base, reduced } = rulesFor(render(), 'wait-spinner-static');
    expect(base).toContain('display:none;');
    expect(reduced).toContain('inline-flex');
    expect(reduced).not.toContain('display:none');
  });

  it('draws the static mark as the same ring, whole and dotted', () => {
    // The mockup's own reduced-motion answer, and the accent the rotating ring
    // uses — one mark in two states rather than two marks. The colour is the
    // theme's variable, never a literal.
    const { base } = rulesFor(render(), 'wait-spinner-static');
    expect(base).toContain('border-radius:50%');
    expect(base).toContain('border-style:dotted');
    expect(base).toContain('border-color:var(--mui-palette-primary-main)');
    expect(base).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/u);
  });
});
