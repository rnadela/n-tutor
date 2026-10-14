import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentTheme, studentTheme } from '@/theme/theme';
import { comfortableDensity, density } from '@/theme/tokens';
import { QuestionGrid, type QuestionGridCell } from './QuestionGrid';

const CELLS: QuestionGridCell[] = [
  {
    key: 'q-1',
    ordinal: 1,
    glyph: createElement('span', { 'aria-hidden': 'true', 'data-testid': 'probe-glyph' }, '●'),
    sentence: 'Question 1, first sentence',
    current: false,
    tone: 'done',
    data: { 'data-state': 'first' },
  },
  {
    key: 'q-2',
    ordinal: 2,
    glyph: createElement('span', { 'aria-hidden': 'true', 'data-testid': 'probe-glyph' }, '○'),
    sentence: 'Question 2, second sentence',
    current: true,
    tone: 'idle',
    data: { 'data-state': 'second' },
  },
  {
    key: 'q-3',
    ordinal: 3,
    glyph: createElement('span', { 'aria-hidden': 'true', 'data-testid': 'probe-glyph' }, '◐'),
    sentence: 'Question 3, third sentence',
    current: false,
    tone: 'done',
    data: { 'data-state': 'third' },
  },
];

function render(theme: Theme = studentTheme, cells: readonly QuestionGridCell[] = CELLS): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme },
      createElement(QuestionGrid, {
        cells,
        onJump: () => {},
        testId: 'probe-grid',
        cellTestId: 'probe-cell',
      }),
    ),
  );
}

/** The markup with the emotion `<style>` blocks removed. */
function body(markup: string): string {
  return markup.replace(/<style[\s\S]*?<\/style>/gu, '');
}

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'QuestionGrid.tsx'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('the shared cell geometry', () => {
  it('draws one real button per cell, and no div carrying the action', () => {
    const markup = render();
    expect(markup.match(/<button/gu)).toHaveLength(CELLS.length);
    expect(markup.match(/type="button"/gu)).toHaveLength(CELLS.length);
    expect(markup.match(/data-testid="probe-cell"/gu)).toHaveLength(CELLS.length);
  });

  it('takes its tap target and its grid rule from the theme, not from a constant', () => {
    // This is the whole reason one grid serves both surfaces: the same component is
    // 48px in Student Mode and 44px in Parent View, with no prop and no branch.
    expect(render(studentTheme)).toContain(`${comfortableDensity.tapTarget}px`);
    expect(render(parentTheme)).toContain(`${density.tapTarget}px`);
    expect(render(studentTheme)).not.toContain(`minmax(${density.tapTarget}px`);
    expect(render(parentTheme)).not.toContain(`minmax(${comfortableDensity.tapTarget}px`);
    // And the figures are read off the theme in the source rather than imported.
    expect(CODE).toContain('theme.density.tapTarget');
    expect(CODE).toContain('theme.density.gap / 2');
    expect(CODE).not.toContain('comfortableDensity');
    expect(CODE).not.toMatch(/import \{[^}]*\bdensity\b[^}]*\} from '@\/theme\/tokens'/u);
  });

  it('auto-fills the grid rather than fixing a column count', () => {
    expect(render()).toContain('repeat(auto-fill, minmax(');
  });

  it('restores the list semantics `listStyle: none` strips in Safari', () => {
    const markup = render();
    expect(markup).toContain('role="list"');
    expect(markup.match(/role="listitem"/gu)).toHaveLength(CELLS.length);
    expect(markup).toContain('data-testid="probe-grid"');
  });

  it('marks exactly the current cell, and no other', () => {
    const markup = render();
    expect(markup.match(/aria-current="true"/gu)).toHaveLength(1);
    // On the cell the caller named, which is the second one here.
    const current = markup.slice(markup.indexOf('aria-current="true"') - 200);
    expect(current).toContain('data-ordinal="2"');
  });

  it('makes the caller’s sentence the whole accessible name', () => {
    const markup = render();
    for (const cell of CELLS) expect(markup).toContain(cell.sentence);
    // The digit and the glyph are both hidden, so the name is the sentence and never
    // the number twice.
    expect(markup.match(/aria-hidden="true"/gu)!.length).toBeGreaterThanOrEqual(CELLS.length * 2);
    expect(markup).not.toContain('aria-label');
  });

  it('writes the ordinal and every carrier the caller handed it onto the button', () => {
    const markup = render();
    const ordinals = [...markup.matchAll(/data-ordinal="(\d+)"/gu)].map((match) => match[1]);
    expect(ordinals).toEqual(['1', '2', '3']);
    for (const state of ['first', 'second', 'third']) {
      expect(markup).toContain(`data-state="${state}"`);
    }
  });

  it('draws the cells in the order it was given, never re-sorted here', () => {
    expect(CODE).not.toMatch(/\.sort\(|\.reverse\(|toSorted|groupBy/u);
  });

  it('wires every cell’s press to the caller’s onJump with that cell’s own index', () => {
    // Markup alone cannot observe a click's effect, so this pins the one line that
    // makes a press mean anything: each button's handler closes over its own index,
    // not the caller's cells by ordinal or key.
    expect(CODE).toContain('onClick={() => onJump(index)}');
    expect(CODE).not.toMatch(/onClick=\{.*cell\.(ordinal|key)/u);
  });

  it('knows no vocabulary at all: no glyph table, no heading, no summary, no legend', () => {
    // Progress may not say a correctness word before a hand-in and a results map says
    // nothing else, so a single component serving both moments could satisfy neither
    // one's spec. The split is between the drawing and the words.
    const markup = body(render());
    for (const forbidden of [
      /answered/iu,
      /\bcorrect/iu,
      /\bgrade/iu,
      /legend/iu,
      /summary/iu,
      /%/u,
    ]) {
      expect(markup.replace(/probe-\w+/gu, '')).not.toMatch(forbidden);
    }
    expect(CODE).not.toMatch(/studentCopy|parentCopy|commonCopy/u);
    expect(CODE).not.toMatch(/GLYPH|<h[1-6]/u);
  });

  it('holds no state and reaches for no router', () => {
    // Hookless is what keeps it assertable as a markup string, exactly as
    // `AnswerKeyRow` is.
    expect(CODE).not.toMatch(/\buse[A-Z]\w*\(/u);
    expect(CODE).not.toMatch(/useRouter|parentApi/u);
  });

  it('renders an empty grid for an empty run rather than nothing at all', () => {
    const markup = render(studentTheme, []);
    expect(markup).toContain('data-testid="probe-grid"');
    expect(markup).not.toContain('<button');
  });
});
