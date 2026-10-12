import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentTheme, studentTheme } from '@/theme/theme';
import { comfortableDensity, density } from '@/theme/tokens';
import { CardField, CardList, TableCard, TableOnDesktop } from './TableCards';

/**
 * The one card-list pattern every data table goes through below `lg` (UX-DR44).
 *
 * `apps/web` runs vitest with `environment: 'node'` and ships no DOM testing
 * library, so the rule this pattern exists to enforce — *which* layout is drawn at
 * *which* width, decided by a breakpoint and never by a hook — is asserted over
 * the markup and the stylesheet emotion emits beside it.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'TableCards.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

function render(node: ReactElement, theme: Theme = parentTheme): string {
  return renderToStaticMarkup(createElement(ThemeProvider, { theme }, node));
}

/**
 * Just the CSS emotion emitted for a render, with the markup dropped.
 *
 * **Asserted non-empty here rather than at every call site.** Emotion inserts its
 * stylesheet into the markup during SSR; if it ever stopped, every *negative*
 * assertion below — no `repeat(2`, no tabular figures, no `undefined` — would pass
 * on an empty string and this file would be green while asserting nothing.
 */
function css(markup: string): string {
  const sheet = (markup.match(/<style[^>]*>([\s\S]*?)<\/style>/gu) ?? []).join('\n');
  expect(sheet.length, 'emotion emitted no stylesheet').toBeGreaterThan(0);
  return sheet;
}

/** MUI's own defaults, named rather than restated: `sm` is 600 and `lg` is 1200. */
const SM = parentTheme.breakpoints.values.sm;
const LG = parentTheme.breakpoints.values.lg;

describe('which layout is drawn at which width', () => {
  it('states the cutoff as a breakpoint key and never as a viewport hook', () => {
    // A hook that reads the viewport renders the phone layout first on every
    // device and then swaps: a visible reflow on the slowest device we run on.
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\.inner/u);
    // And never a media query written by hand, which would pin a figure the
    // theme already owns.
    expect(CODE).not.toContain('@media');
    expect(CODE).toContain("display: { xs: 'none', lg: 'block' }");
    expect(CODE).toContain("display: { xs: 'grid', lg: 'none' }");
  });

  it('hides the table below the desktop breakpoint and draws it from there up', () => {
    const sheet = css(render(<TableOnDesktop>table</TableOnDesktop>));
    expect(sheet).toContain('display:none');
    expect(sheet).toMatch(new RegExp(`@media \\(min-width:${LG}px\\)[^}]*display:block`, 'u'));
  });

  it('draws the card list below that breakpoint and hides it from there up', () => {
    const sheet = css(render(<CardList label="Students">cards</CardList>));
    expect(sheet).toContain('display:grid');
    expect(sheet).toMatch(new RegExp(`@media \\(min-width:${LG}px\\)[^}]*display:none`, 'u'));
  });

  it('removes the hidden layout from the accessibility tree rather than clipping it', () => {
    // Both layouts are the same rows, so a duplicate that is merely invisible is
    // every row announced twice. `visuallyHidden`'s clip rectangle is the answer
    // to a different question — hiding a *column* whose header the cells need.
    expect(CODE).not.toContain('visuallyHidden');
    expect(CODE).not.toContain('clipPath');
    expect(CODE).not.toContain('aria-hidden');
  });
});

describe('how many columns the card list has', () => {
  it('is one column on a phone and two from the tablet breakpoint', () => {
    const sheet = css(render(<CardList label="Students">cards</CardList>));
    expect(sheet).toContain('grid-template-columns:1fr');
    expect(sheet).toMatch(
      new RegExp(`@media \\(min-width:${SM}px\\)[^}]*grid-template-columns:repeat\\(2`, 'u'),
    );
  });

  it('stays one column at every width when the order is the answer', () => {
    // A ranked list reads top-to-bottom: two columns turn weakest-first into a
    // reading order a parent has to reconstruct.
    const sheet = css(
      render(
        <CardList label="Topics" ranked>
          cards
        </CardList>,
      ),
    );
    expect(sheet).toContain('grid-template-columns:1fr');
    expect(sheet).not.toContain('repeat(2');
  });
});

describe('what a card list is made of', () => {
  it('keeps the list semantics `listStyle: none` strips in Safari/VoiceOver', () => {
    // The announcement a list role buys — "list, 6 items" — is how a reader knows
    // how much there is. `listStyle: none` silently removes it in WebKit.
    const markup = render(
      <CardList label="Students">
        <TableCard title="Ada">body</TableCard>
      </CardList>,
    );
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
  });

  it('contributes no heading, so a rename cannot reshape the page outline', () => {
    // `titleContent` replaces the title while a row is renamed. A heading that
    // comes and goes with a rename is an outline that changes as a row is edited,
    // and the Mastery card — whose title is a link — would have had none at all.
    const plain = render(<TableCard title="Ada">body</TableCard>);
    const renaming = render(
      <TableCard title="Ada" titleContent={<form>rename</form>}>
        body
      </TableCard>,
    );
    for (const markup of [plain, renaming]) {
      expect(markup).not.toMatch(/<h[1-6][\s>]/u);
    }
    expect(CODE).not.toContain('h3');
  });

  it('refuses to let a caller reach the card’s own attributes through the data slot', () => {
    // `dataAttributes` is spread first, so the card's `data-testid` wins; and the
    // type admits `data-*` keys alone, so `id`, `role` and `className` are not
    // reachable through it at all.
    const markup = render(
      <TableCard
        title="Ada"
        testId="student-card"
        dataAttributes={{ 'data-testid': 'hijacked', 'data-name': 'Ada' }}
      >
        body
      </TableCard>,
    );
    expect(markup).toContain('data-testid="student-card"');
    expect(markup).not.toContain('hijacked');
    expect(markup).toContain('data-name="Ada"');
  });

  it('wraps a long unbreakable title instead of pushing past the card’s edge', () => {
    // An account's email is one word as far as line breaking is concerned.
    expect(
      css(render(<TableCard title="a.very.long.address@example.test">body</TableCard>)),
    ).toContain('overflow-wrap:anywhere');
  });

  it('is a real ul of real li cards, each named by its own row', () => {
    const markup = render(
      <CardList label="Students">
        <TableCard title="Ada">body</TableCard>
      </CardList>,
    );
    expect(markup).toContain('<ul');
    expect(markup).toContain('aria-label="Students"');
    expect(markup).toContain('<li');
    expect(markup).toContain('aria-label="Ada"');
    // The name is the row's own value, carried as a label rather than through a
    // second per-row id that would then have to be unique across both layouts.
    expect(markup).not.toContain('aria-labelledby');
  });

  it('cannot ship a card list with no accessible name', () => {
    // The table it replaces always has one, and a list of rows with no name is a
    // region a screen-reader user cannot tell from the next. The prop is required,
    // which the type below asserts and the markup confirms.
    // @ts-expect-error — `label` is required on `CardList`.
    const markup = render(<CardList>cards</CardList>);
    expect(markup).toContain('<ul');
  });

  it('renders an empty ul for an empty row set, and no placeholder card', () => {
    const markup = render(<CardList label="Students">{[]}</CardList>);
    expect(markup).toContain('<ul');
    expect(markup).not.toContain('<li');
  });

  it('lets a rename replace the title in place rather than sit under it', () => {
    const markup = render(
      <TableCard title="Ada" titleContent={<form>rename</form>}>
        body
      </TableCard>,
    );
    expect(markup).toContain('<form');
    // The title text itself is gone from the card body: the form is where the
    // name was. The accessible name stays, so the card is still the same row.
    expect(markup).toContain('aria-label="Ada"');
    expect(markup).not.toContain('>Ada<');
  });

  it('puts the row’s actions in the card header, unchanged', () => {
    const markup = render(
      <TableCard title="Ada" actions={<button type="button">More actions for Ada</button>}>
        <CardField label="Status" value="Active" />
      </TableCard>,
    );
    expect(markup).toContain('More actions for Ada');
    // In its own named area, so a phone-width E2E can measure the card's actions
    // the way it used to measure the table's action cell.
    expect(markup).toContain('data-testid="card-actions"');
    // Before the fields, so it reads as the row's header and not as a last field.
    expect(markup.indexOf('More actions for Ada')).toBeLessThan(markup.indexOf('Active'));
  });

  it('carries the card-side testid the screen’s own spec counts, not the table’s', () => {
    const markup = render(
      <CardList label="Students" testId="student-cards">
        <TableCard title="Ada" testId="student-card" dataAttributes={{ 'data-name': 'Ada' }}>
          body
        </TableCard>
      </CardList>,
    );
    expect(markup).toContain('data-testid="student-cards"');
    expect(markup).toContain('data-testid="student-card"');
    expect(markup).toContain('data-name="Ada"');
  });
});

describe('what a card field states', () => {
  it('states the column’s own header as the label, beside the value', () => {
    const markup = render(<CardField label="Grade level" value="Year 5" />);
    expect(markup).toContain('Grade level');
    expect(markup).toContain('Year 5');
    expect(markup.indexOf('Grade level')).toBeLessThan(markup.indexOf('Year 5'));
  });

  it('associates the label with the value, rather than leaving two adjacent strings', () => {
    // The table associated a cell with its column through `<th scope="col">`. A
    // card has no column, so the field is a named group — and named by
    // `aria-label`, because an `aria-labelledby` would need a per-row id that then
    // has to be unique across both layouts.
    const markup = render(<CardField label="Grade level" value="Year 5" />);
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Grade level"');
    expect(markup).not.toContain('aria-labelledby');
  });

  it('aligns figures only where the value is a number', () => {
    expect(css(render(<CardField label="Left blank" value={7} tabular />))).toContain(
      'font-variant-numeric:tabular-nums',
    );
    expect(css(render(<CardField label="Status" value="Active" />))).not.toContain(
      'font-variant-numeric:tabular-nums',
    );
  });

  it('keeps the label with the value even where there is no value to state', () => {
    // A withdrawn grade level, a null mastery percent: the fallback is the
    // table's own string, and the field still says which column it is.
    const markup = render(<CardField label="How much is right" value="Not answered yet" />);
    expect(markup).toContain('How much is right');
    expect(markup).toContain('Not answered yet');
  });
});

describe('where the pattern’s figures come from', () => {
  it('states no colour, spacing figure or tap target of its own', () => {
    expect(CODE).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/u);
    expect(CODE).not.toMatch(/\b(?!1px)\d+px\b/u);
    // Anchored both sides: `\b(44|48)\b` reads the `44` inside a `440` as a tap
    // target and the `48` inside a `1480` as one too, so the sweep would fire on
    // a figure that is neither — and a reviewer would learn to ignore it.
    expect(CODE).not.toMatch(/(?<!\d)(44|48)(?!\d)/u);
    // The sweep has to be able to fail: a figure that *is* one must trip it.
    expect('minHeight: 44').toMatch(/(?<!\d)(44|48)(?!\d)/u);
    expect('maxHeight: 440').not.toMatch(/(?<!\d)(44|48)(?!\d)/u);
    // Every gutter is the mounted theme's density, read at render.
    expect(CODE).toContain('theme.density ?? density');
  });

  it('takes its gutters from the surface’s density and not from a breakpoint', () => {
    expect(css(render(<CardList label="Students">cards</CardList>, parentTheme))).toContain(
      `gap:${density.gap}px`,
    );
    expect(css(render(<CardList label="Students">cards</CardList>, studentTheme))).toContain(
      `gap:${comfortableDensity.gap}px`,
    );
  });

  it('falls back to the compact density under a theme that carries none', () => {
    // `theme.density` is optional on `ThemeOptions`; without the fallback every
    // gutter would resolve to `undefinedpx`.
    const markup = render(<CardList label="Students">cards</CardList>, createTheme() as Theme);
    expect(markup).not.toContain('undefined');
    expect(css(markup)).toContain(`gap:${density.gap}px`);
  });

  it('draws the card as the theme’s own flat bordered surface', () => {
    // `MuiCard` is already elevation 0 on a 1px divider border and
    // `MuiCardContent` already pads by the density: the pattern restates none of it.
    const markup = render(<TableCard title="Ada">body</TableCard>);
    expect(markup).toContain('MuiCard-root');
    expect(markup).toContain('MuiCardContent-root');
    expect(CODE).not.toContain('borderColor');
    expect(CODE).not.toContain('background.paper');
  });
});
