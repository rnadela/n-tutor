import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type { GenerationJobView } from '@/lib/parent-api';
import { type SheetState, sheetStates } from '@/lib/sheet-tally';
import { parentTheme } from '@/theme/theme';
import { SheetTally } from './SheetTally';

interface Job {
  producedCount: number;
  requestedCount: number;
  status: GenerationJobView['status'];
}

/** The row as a parent actually receives it: rendered, under the parent theme. */
function render(job: Job): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: parentTheme }, createElement(SheetTally, job)),
  );
}

/**
 * The markup with every colour taken away.
 *
 * `GradeStateMarker.spec.tsx`'s helper, plus the emitted `<style>` elements:
 * this component's colours reach the browser through emotion's stylesheet
 * rather than only through attributes, so leaving those in would leave the
 * colours in.
 */
function colourless(markup: string): string {
  return markup
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gu, '')
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\sstyle="[^"]*"/gu, '')
    .replace(/\scolor="[^"]*"/gu, '');
}

/** The states the row drew, in the order it drew them. */
function drawn(markup: string): string[] {
  return [...markup.matchAll(/data-state="([a-zA-Z]+)"/gu)].map((match) => match[1]!);
}

const RUNNING: Job = { producedCount: 3, requestedCount: 5, status: 'Running' };
const PARTIAL: Job = { producedCount: 3, requestedCount: 5, status: 'PartiallyComplete' };

/** One sheet in each state, on its own, for the per-state shape assertions. */
const ONLY: Record<SheetState, Job> = {
  ready: { producedCount: 1, requestedCount: 1, status: 'Succeeded' },
  making: { producedCount: 0, requestedCount: 1, status: 'Running' },
  waiting: { producedCount: 0, requestedCount: 2, status: 'Running' },
  notMade: { producedCount: 0, requestedCount: 1, status: 'Failed' },
};

describe('how many sheets the row draws, and in what order', () => {
  it('draws exactly one sheet per requested practice test', () => {
    expect(drawn(render(RUNNING))).toHaveLength(5);
  });

  it('draws them in the order the rule resolves, not an order of its own', () => {
    // The row never decides which sheet is which — a second answer here is a
    // second chance to put the spinner on the wrong sheet.
    expect(drawn(render(RUNNING))).toEqual(sheetStates(RUNNING));
    expect(drawn(render(PARTIAL))).toEqual(sheetStates(PARTIAL));
    expect(drawn(render(RUNNING))).toEqual(['ready', 'ready', 'ready', 'making', 'waiting']);
  });

  it('draws nothing at all for a request of none', () => {
    // Not an empty row with a gap in it, and not a panel with a hole above the
    // sentence. (The theme's own stylesheet is still emitted around it; the row
    // itself is what is absent.)
    const markup = render({ producedCount: 0, requestedCount: 0, status: 'Running' });
    expect(markup).not.toContain('data-testid="sheet-tally"');
    expect(markup).not.toContain('data-testid="sheet"');
    expect(markup).not.toContain('<ul');
  });
});

describe('telling the four states apart with every colour stripped', () => {
  it('gives each state a shape of its own', () => {
    const glyphs = new Set<string>();
    for (const state of ['ready', 'making', 'waiting', 'notMade'] as const) {
      // Read off the sheet carrying that state rather than the first sheet in
      // the row: a `waiting` sheet never appears without a `making` one beside
      // it, so there is no single-sheet render that isolates it.
      const markup = colourless(render(ONLY[state]));
      const found = [...markup.matchAll(/data-state="([a-zA-Z]+)" data-glyph="([^"]+)"/gu)].find(
        (match) => match[1] === state,
      );
      expect(found, state).toBeTruthy();
      glyphs.add(found![2]!);
    }
    // Four states, four shapes — not one shape painted four ways.
    expect(glyphs.size).toBe(4);
  });

  it('draws the ready sheet with a check', () => {
    const markup = colourless(render(ONLY.ready));
    expect(markup).toContain('data-glyph="check"');
    expect(markup).toContain('d="m9 15 2 2 4-4"');
  });

  it('draws the sheet that was never made with a cross', () => {
    const markup = colourless(render(ONLY.notMade));
    expect(markup).toContain('data-glyph="×"');
    expect(markup).toContain('d="m14.5 12.5-5 5"');
    expect(markup).toContain('d="m9.5 12.5 5 5"');
  });

  it('draws the sheet still to come with a dashed outline, as an attribute', () => {
    // An attribute and not a CSS rule, which is the whole reason this survives
    // the strip: a dash declared in a stylesheet is a dash a colourless reader
    // never sees.
    const markup = colourless(render(ONLY.waiting));
    expect(markup).toContain('data-glyph="dashed"');
    expect(markup).toContain('stroke-dasharray="3 3"');
  });

  it('draws the sheet being made with the shared spinner as its ring', () => {
    const markup = colourless(render(ONLY.making));
    expect(markup).toContain('data-glyph="ring"');
    // The same component both waits use, sized to circle the 56px cell — which
    // is what makes the generate screen's spinner and the capture screen's one
    // mark rather than two.
    expect(markup).toContain('data-testid="wait-spinner"');
    expect(markup).toContain('data-size="56"');
    // And it is not also the dashed sheet: the two share their ruled lines, so
    // the ring and the dash are what separate them.
    expect(markup).not.toContain('stroke-dasharray="3 3"');
  });

  it('puts the spinner on exactly one sheet while the job runs, and none once it is over', () => {
    const running = render(RUNNING);
    expect([...running.matchAll(/data-testid="wait-spinner"/gu)]).toHaveLength(1);
    expect(render(PARTIAL)).not.toContain('data-testid="wait-spinner"');
    expect(render(ONLY.ready)).not.toContain('data-testid="wait-spinner"');
  });
});

describe('what the row says to a screen reader', () => {
  it('says nothing: no text, and no second polite region', () => {
    const markup = render(RUNNING);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('aria-live');
    expect(markup).not.toContain('aria-label');
    // No words of its own. The sentence beneath it is the announcement, in the
    // words it displays (UX-DR33).
    const text = colourless(markup)
      .replace(/<[^>]*>/gu, '')
      .trim();
    expect(text).toBe('');
  });

  it('hides the row itself, not just the sheets inside it', () => {
    // A row left in the tree with every child hidden is still a list of five
    // items to land on.
    expect(render(RUNNING)).toMatch(/<ul[^>]*aria-hidden="true"/u);
  });
});

describe('what reduced motion takes off the ready sheet', () => {
  it('turns off both the draw-in and the scale, in CSS', () => {
    // Stated in the component as well as globally in `theme.ts`: with the
    // animation off the check rests at a dash offset of 0 and the cell at its
    // own scale, so "it is simply there" is a claim about this stylesheet.
    const markup = render(ONLY.ready);
    expect(markup).toContain('sheetLand');
    expect(markup).toContain('sheetMarkDraw');
    // Two of them: the cell's landing and the check's draw-in.
    expect([
      ...markup.matchAll(
        /@media \(prefers-reduced-motion: reduce\)\{\.[\w-]+\{[^}]*animation:none;\}\}/gu,
      ),
    ]).toHaveLength(2);
  });
});
