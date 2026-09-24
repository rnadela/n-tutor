import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { parentTheme } from '@/theme/theme';
import type { RichTextSegment } from '@/lib/parent-api';
import { RichText } from './RichText';

function render(segments: RichTextSegment[]): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={parentTheme}>
      <RichText segments={segments} />
    </ThemeProvider>,
  );
}

describe('a run of text', () => {
  it('renders exactly what was stored, in order', () => {
    const markup = render([
      { kind: 'text', value: 'What is ' },
      { kind: 'text', value: 'left?' },
    ]);
    expect(markup).toContain('What is ');
    expect(markup).toContain('left?');
    expect(markup.indexOf('What is ')).toBeLessThan(markup.indexOf('left?'));
  });

  it('adds no heading, label or role of its own', () => {
    // It renders content and nothing else: where the text sits and what
    // announces it belong to the screen placing it.
    const markup = render([{ kind: 'text', value: 'Plain.' }]);
    expect(markup).not.toContain('role=');
    expect(markup).not.toContain('<h');
  });
});

describe('a fraction', () => {
  const half: RichTextSegment = {
    kind: 'fraction',
    whole: null,
    numerator: 1,
    denominator: 2,
  };

  it('renders as structure, never as the glyph', () => {
    // The schema kept the parts apart on purpose (AD-32). Flattening them here
    // would throw away the reading one story after it was preserved.
    const markup = render([half]);
    expect(markup).toContain('<sup>1</sup>');
    expect(markup).toContain('<sub>2</sub>');
    expect(markup).not.toContain('1/2');
  });

  it('carries one spoken reading, built from copy rather than concatenated', () => {
    const markup = render([half]);
    expect(markup).toContain(`aria-label="${parentCopy.drafts.fractionReading(half)}"`);
    // `role="math"` replaces the subtree for a screen reader; read part by
    // part, a superscript and a subscript are two disconnected numbers.
    expect(markup).toContain('role="math"');
  });

  it('keeps a mixed number whole part beside its fraction, and in the reading', () => {
    const mixed: RichTextSegment = {
      kind: 'fraction',
      whole: 2,
      numerator: 3,
      denominator: 4,
    };
    const markup = render([mixed]);
    expect(markup).toContain('2');
    expect(markup).toContain('<sup>3</sup>');
    expect(markup).toContain('<sub>4</sub>');
    expect(markup).toContain(`aria-label="${parentCopy.drafts.fractionReading(mixed)}"`);
    expect(parentCopy.drafts.fractionReading(mixed)).toBe('2 and 3 over 4');
  });

  it('is not what an unrecognized segment kind renders as', () => {
    // The read casts stored JSON rather than re-parsing it, so a kind this
    // build has never heard of is reachable. Drawn as a fraction it would read
    // "undefined over undefined" to a screen reader — a sentence about nothing.
    const markup = render([
      { kind: 'text', value: 'Before ' },
      { kind: 'diagram', value: 'x' } as unknown as RichTextSegment,
      { kind: 'text', value: ' after.' },
    ]);
    expect(markup).not.toContain('role="math"');
    // Not the reading either. Checked against `aria-label` rather than the
    // whole markup: Emotion inlines a stylesheet that says "undefined" on its
    // own account, which has nothing to do with this.
    expect(markup).not.toContain('aria-label');
    expect(markup).not.toContain('<sup>');
    // The segments around it are untouched.
    expect(markup).toContain('Before ');
    expect(markup).toContain(' after.');
  });

  it('renders inside a run of text without swallowing either side', () => {
    const markup = render([
      { kind: 'text', value: 'Add ' },
      half,
      { kind: 'text', value: ' to it.' },
    ]);
    expect(markup).toContain('Add ');
    expect(markup).toContain(' to it.');
    expect(markup).toContain('role="math"');
  });
});
