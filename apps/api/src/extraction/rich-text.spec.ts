import { describe, expect, it } from 'vitest';
import {
  RICH_TEXT_FIGURE_ALT_EMPTY,
  RICH_TEXT_FIGURE_ALT_INVALID,
  RICH_TEXT_FIGURE_MISSING,
  type FigureSegment,
  isRichText,
  parseRichText,
  plainTextOf,
  richTextFromPlainText,
} from './rich-text.js';

/** A legible printed circle, exactly as a model would write it. */
const CIRCLE =
  '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="black"/></svg>';
const SANITIZED_CIRCLE =
  '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor"/></svg>';

const figure = (svg: string, alt: string) => [{ kind: 'figure' as const, svg, alt }];

describe('parsing', () => {
  it('takes a run of plain text', () => {
    expect(parseRichText([{ kind: 'text', value: 'What is the answer?' }])).toEqual([
      { kind: 'text', value: 'What is the answer?' },
    ]);
  });

  it('takes a fraction as structure', () => {
    const rich = parseRichText([{ kind: 'fraction', whole: null, numerator: 3, denominator: 4 }]);
    expect(rich[0]).toMatchObject({ kind: 'fraction', numerator: 3, denominator: 4 });
  });

  it('refuses a fraction with no whole part stated at all', () => {
    // `whole` is nullable and required, never optional: strict Structured
    // Outputs has no other way to express "may be absent", and two spellings of
    // an absent whole part is how a renderer ends up with a special case.
    expect(() => parseRichText([{ kind: 'fraction', numerator: 3, denominator: 4 }])).toThrow();
  });

  it('takes a mixed number', () => {
    expect(() =>
      parseRichText([{ kind: 'fraction', whole: 2, numerator: 1, denominator: 3 }]),
    ).not.toThrow();
  });

  it('refuses a denominator of zero', () => {
    expect(() =>
      parseRichText([{ kind: 'fraction', whole: null, numerator: 1, denominator: 0 }]),
    ).toThrow();
  });

  it('refuses a fraction whose parts are not whole numbers', () => {
    expect(() =>
      parseRichText([{ kind: 'fraction', whole: null, numerator: 1.5, denominator: 2 }]),
    ).toThrow();
  });

  it('refuses an empty array, which is a field claimed and not filled', () => {
    expect(() => parseRichText([])).toThrow();
  });

  it('refuses a plain string, which is the shape AD-32 exists to prevent', () => {
    expect(isRichText('1/2')).toBe(false);
    expect(isRichText([{ kind: 'latex', value: '\\frac{1}{2}' }])).toBe(false);
  });
});

describe('a figure', () => {
  it('comes back with its SVG rewritten, so the parse is a normalizer and not a guard', () => {
    // The point of sanitizing here rather than at a call site: the value a
    // caller stores is this one, whatever it handed in.
    const rich = parseRichText(figure(CIRCLE, 'A circle'));
    expect(rich).toEqual([{ kind: 'figure', svg: SANITIZED_CIRCLE, alt: 'A circle' }]);
    expect(rich[0]).not.toMatchObject({ svg: CIRCLE });
  });

  it('refuses a blank or whitespace-only text alternative', () => {
    // It is the figure's only spoken form and the only form `plainTextOf` can
    // project; without it the drawing is unreachable to anything but a screen.
    expect(() => parseRichText(figure(CIRCLE, ''))).toThrow(RICH_TEXT_FIGURE_ALT_EMPTY);
    expect(() => parseRichText(figure(CIRCLE, '   '))).toThrow(RICH_TEXT_FIGURE_ALT_EMPTY);
  });

  it('refuses a text alternative carrying a bidi-override or zero-width character', () => {
    // A right-to-left override or a zero-width joiner can make an `aria-label`
    // or the plain-text projection read differently than it is stored — the
    // same unspeakable-character concern a C0 control already refuses.
    expect(() => parseRichText(figure(CIRCLE, 'A circle‮'))).toThrow(RICH_TEXT_FIGURE_ALT_INVALID);
    expect(() => parseRichText(figure(CIRCLE, 'A​circle'))).toThrow(RICH_TEXT_FIGURE_ALT_INVALID);
  });

  it('refuses an SVG the sanitizer does not admit, through the same one parse', () => {
    for (const svg of [
      '<svg viewBox="0 0 1 1"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>',
      '<svg viewBox="0 0 1 1"><circle cx="1" cy="1" r="1" onload="x()"/></svg>',
      '<svg viewBox="0 0 1 1"><circle cx="1" cy="1" r="1" stroke="url(#grad)"/></svg>',
      '<svg><circle cx="1" cy="1" r="1"/></svg>',
      '[A half-circle figure is shown.]',
    ]) {
      expect(() => parseRichText(figure(svg, 'A shape'))).toThrow();
      expect(isRichText(figure(svg, 'A shape'))).toBe(false);
    }
  });

  it('is content, so a field holding only a figure is not an unfilled field', () => {
    expect(isRichText(figure(CIRCLE, 'A circle'))).toBe(true);
  });

  it('renders as its text alternative, in place, in order', () => {
    expect(
      plainTextOf([
        { kind: 'text', value: 'What shape? ' },
        { kind: 'figure', svg: SANITIZED_CIRCLE, alt: 'A half-circle' },
      ]),
    ).toBe('What shape? [Figure: A half-circle]');
    expect(plainTextOf(figure(SANITIZED_CIRCLE, 'A circle'))).toBe('[Figure: A circle]');
  });

  it('stays text when a parent types the token into a field holding no figure', () => {
    // The editor is not an authoring surface for drawings (Story 4.8): only the
    // figures already stored on the field can come back as figures.
    expect(richTextFromPlainText('[Figure: A circle]')).toEqual([
      { kind: 'text', value: '[Figure: A circle]' },
    ]);
  });
});

describe('an edit around a stored figure', () => {
  const stored = (alt: string): FigureSegment => {
    const [segment] = parseRichText(figure(CIRCLE, alt));
    if (segment === undefined || segment.kind !== 'figure') throw new Error('not a figure');
    return segment;
  };

  it('grafts the stored figure back at its token, byte-identical', () => {
    const drawing = stored('A half-circle');
    expect(richTextFromPlainText('Which shape? [Figure: A half-circle]', [drawing])).toEqual([
      { kind: 'text', value: 'Which shape? ' },
      drawing,
    ]);
    expect(drawing.svg).toBe(SANITIZED_CIRCLE);
  });

  it('leaves an already-sanitized figure untouched, which is what makes it byte-identical', () => {
    // The grafted segment goes back through `parseRichText`, which re-runs the
    // sanitizer on it — so "the stored figure is reused unchanged" holds only
    // because the canonical form of a canonical figure is itself. Pinned here
    // rather than assumed, because every other case in this block is fed a
    // value the sanitizer already produced.
    const canonical = { kind: 'figure' as const, svg: SANITIZED_CIRCLE, alt: 'A circle' };
    const [grafted] = richTextFromPlainText('[Figure: A circle]', [canonical]);
    expect(grafted).toEqual(canonical);
    expect((grafted as { svg: string }).svg).toBe(SANITIZED_CIRCLE);
  });

  it('is a no-op on the segments when the prefill is saved untouched', () => {
    const rich = parseRichText([
      { kind: 'text', value: 'What shape? ' },
      { kind: 'figure', svg: CIRCLE, alt: 'A half-circle' },
      { kind: 'text', value: ' Choose one.' },
    ]);
    const figures = rich.filter((segment): segment is FigureSegment => segment.kind === 'figure');
    expect(richTextFromPlainText(plainTextOf(rich), figures)).toEqual(rich);
  });

  it('keeps two figures of one field in their stored order', () => {
    const first = stored('A circle');
    const second = stored('A square');
    expect(
      richTextFromPlainText('[Figure: A circle] then [Figure: A square]', [first, second]),
    ).toEqual([first, { kind: 'text', value: ' then ' }, second]);
  });

  it('refuses the edit when a token is dropped, reordered or altered', () => {
    const first = stored('A circle');
    const second = stored('A square');
    const figures = [first, second];
    expect(() => richTextFromPlainText('Only one left [Figure: A circle]', figures)).toThrow(
      RICH_TEXT_FIGURE_MISSING,
    );
    // Order is enforced by searching each token from the end of the previous
    // one, so a swap reads as the second token being absent.
    expect(() =>
      richTextFromPlainText('[Figure: A square] then [Figure: A circle]', figures),
    ).toThrow(RICH_TEXT_FIGURE_MISSING);
    expect(() =>
      richTextFromPlainText('[Figure: a circle] then [Figure: A square]', figures),
    ).toThrow(RICH_TEXT_FIGURE_MISSING);
  });

  it('round-trips an alternative that itself holds a bracket', () => {
    // Split on the literal projection rather than a pattern, which is what
    // makes this exact.
    const drawing = stored('A circle [shaded]');
    const rich = parseRichText([
      { kind: 'text', value: 'Look: ' },
      { kind: 'figure', svg: CIRCLE, alt: 'A circle [shaded]' },
    ]);
    expect(richTextFromPlainText(plainTextOf(rich), [drawing])).toEqual(rich);
  });

  it('reads fractions in the text around a figure exactly as it does without one', () => {
    const drawing = stored('A circle');
    expect(richTextFromPlainText('Shade 1/2 of [Figure: A circle]', [drawing])).toEqual([
      { kind: 'text', value: 'Shade ' },
      { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
      { kind: 'text', value: ' of ' },
      drawing,
    ]);
  });
});

describe('plain rendering', () => {
  it('joins segments without inventing separators', () => {
    expect(
      plainTextOf([
        { kind: 'text', value: 'What is ' },
        { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
        { kind: 'text', value: ' of 8?' },
      ]),
    ).toBe('What is 1/2 of 8?');
  });

  it('writes a mixed number the way it is written on paper', () => {
    expect(plainTextOf([{ kind: 'fraction', whole: 2, numerator: 1, denominator: 4 }])).toBe(
      '2 1/4',
    );
  });

  it('treats a null whole part as no whole part', () => {
    expect(plainTextOf([{ kind: 'fraction', whole: null, numerator: 1, denominator: 4 }])).toBe(
      '1/4',
    );
  });
});

describe('plain text back to segments', () => {
  it('keeps a fraction as structure rather than the glyph the schema avoids', () => {
    expect(richTextFromPlainText('What is 1/2 of 8?')).toEqual([
      { kind: 'text', value: 'What is ' },
      { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
      { kind: 'text', value: ' of 8?' },
    ]);
  });

  it('reads a mixed number as one fraction with its whole part', () => {
    expect(richTextFromPlainText('2 3/4')).toEqual([
      { kind: 'fraction', whole: 2, numerator: 3, denominator: 4 },
    ]);
  });

  it('leaves text that holds no fraction as one run of text', () => {
    expect(richTextFromPlainText('Half of four is two.')).toEqual([
      { kind: 'text', value: 'Half of four is two.' },
    ]);
  });

  it('is the exact inverse of the plain rendering, for every fraction shape', () => {
    // The round trip is what makes editing lossless: prefill an editor with
    // the plain rendering, save it back untouched, and the stored segments are
    // the ones that were already there.
    for (const rich of [
      [{ kind: 'fraction', whole: null, numerator: 1, denominator: 2 }],
      [{ kind: 'fraction', whole: 2, numerator: 1, denominator: 4 }],
      [
        { kind: 'text', value: 'Add ' },
        { kind: 'fraction', whole: null, numerator: 3, denominator: 8 },
        { kind: 'text', value: ' to ' },
        { kind: 'fraction', whole: 1, numerator: 1, denominator: 8 },
        { kind: 'text', value: '.' },
      ],
    ] as const) {
      expect(richTextFromPlainText(plainTextOf([...rich]))).toEqual([...rich]);
    }
  });

  it('documents its one known cost: 24/7 in prose is read as a fraction', () => {
    // It renders as "24/7" either way; only its spoken reading differs, and
    // that is a better failure than storing every parent-edited fraction as a
    // glyph string.
    expect(richTextFromPlainText('Open 24/7')).toEqual([
      { kind: 'text', value: 'Open ' },
      { kind: 'fraction', whole: null, numerator: 24, denominator: 7 },
    ]);
  });

  it('does not read half of a date or a path as a fraction', () => {
    expect(richTextFromPlainText('On 1/2/2026')).toEqual([{ kind: 'text', value: 'On 1/2/2026' }]);
  });

  it('keeps the fraction when only the whole part is too large to carry', () => {
    // The span is consumed by the scan either way, so dropping it whole would
    // lose the fraction for good. The digits stay text; the bare fraction is
    // still structure.
    expect(richTextFromPlainText('99999999999999999999 1/2')).toEqual([
      { kind: 'text', value: '99999999999999999999 ' },
      { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
    ]);
  });

  it('leaves a numerator or denominator too large to carry as plain text', () => {
    // Storing it would store a number that is not the one that was typed.
    expect(richTextFromPlainText('1/99999999999999999999')).toEqual([
      { kind: 'text', value: '1/99999999999999999999' },
    ]);
    expect(richTextFromPlainText('Take 99999999999999999999/2 of it')).toEqual([
      { kind: 'text', value: 'Take 99999999999999999999/2 of it' },
    ]);
  });

  it('refuses a zero denominator, exactly as a generated field is refused', () => {
    expect(() => richTextFromPlainText('1/0')).toThrow();
  });

  it('refuses an empty or whitespace-only field rather than storing it', () => {
    expect(() => richTextFromPlainText('')).toThrow();
    expect(() => richTextFromPlainText('   ')).toThrow();
  });
});
