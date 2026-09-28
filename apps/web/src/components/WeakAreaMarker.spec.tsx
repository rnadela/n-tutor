import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { parentTheme } from '@/theme/theme';
import { WeakAreaMarker } from './WeakAreaMarker';

/**
 * The Weak Area marker, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so "this verdict is still
 * distinguishable with colour stripped" is a claim about the markup rather than
 * about a stylesheet — which is exactly what the mirrored `data-` attributes are
 * for, and what these assertions read.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'WeakAreaMarker.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the Weak Area marker draws', () => {
  it('carries the verdict on three non-colour carriers, each mirrored as data', () => {
    // Colour is never the only carrier, and the attributes are how a DOM-less
    // spec can say so.
    expect(CODE).toContain('data-frame="triangle"');
    expect(CODE).toContain('data-border="solid"');
    expect(CODE).toContain('data-glyph="!"');
  });

  it('draws a triangle, which is neither shape the grade markers use', () => {
    expect(CODE).toContain('clipPath');
    expect(CODE).toContain('polygon(50% 0%, 100% 100%, 0% 100%)');
  });

  it('uses the warning colour and no other intent', () => {
    expect(CODE).toContain('palette.warning.main');
    expect(CODE).not.toMatch(/palette\.(error|success|info)\./u);
  });

  it('hides the glyph and makes the label real text', () => {
    // A tick read out beside the word it means says the same thing twice; and
    // the shown string and the spoken one must be the same string (WCAG 2.5.3).
    expect(CODE).toContain('aria-hidden="true"');
    expect(CODE).toContain('parentCopy.analytics.weakArea');
    expect(CODE).not.toMatch(/aria-label/u);
    expect(CODE).not.toMatch(/visuallyHidden|srOnly/u);
  });

  it('writes the words in exactly one place, the copy module', () => {
    expect(parentCopy.analytics.weakArea).toBe('Weak Area');
    // And never as a literal in the component.
    expect(CODE).not.toMatch(/['"`]Weak Area['"`]/u);
  });

  it('takes no counts, no percentage and no threshold', () => {
    // A component that could compare a figure would be a second classifier. The
    // caller renders this or renders nothing; there is no "not weak" state here.
    // Whole identifiers: a bare `value` alternative matched `fontVariantNumeric`
    // and any other word containing it, so it could not fail for its own reason.
    expect(CODE).not.toMatch(
      /\b(value|percent|answered|unanswered|ceilingPercent|answeredFloor|isWeakArea|attemptsCounted)\b/u,
    );
  });

  it('has no hooks in it, so it can be read back on its own', () => {
    expect(CODE).not.toMatch(/\buse[A-Z]\w*\(/u);
  });
});

/**
 * And the same marker rendered, under the parent theme it is shown in.
 *
 * `apps/web` runs `environment: 'node'`, so this is `renderToStaticMarkup` and no
 * DOM — exactly the precedent `GradeStateMarker.spec.tsx` set. Source assertions
 * say what the file contains; these say what a parent's browser is actually sent.
 */
function render(): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: parentTheme }, createElement(WeakAreaMarker)),
  );
}

/** The markup with every colour, class and inline style taken away. */
function colourless(markup: string): string {
  return markup
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\sstyle="[^"]*"/gu, '')
    .replace(/\scolor="[^"]*"/gu, '');
}

describe('what the rendered Weak Area marker shows', () => {
  it('renders the words as real text', () => {
    expect(render()).toContain(parentCopy.analytics.weakArea);
  });

  it('is still identifiable with every colour, class and style stripped', () => {
    const markup = colourless(render());
    expect(markup).toContain(parentCopy.analytics.weakArea);
    expect(markup).toContain('data-frame="triangle"');
    expect(markup).toContain('data-border="solid"');
    expect(markup).toContain('data-glyph="!"');
  });

  it('hides the glyph and puts no label over the visible words', () => {
    const markup = render();
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('aria-label');
  });
});
