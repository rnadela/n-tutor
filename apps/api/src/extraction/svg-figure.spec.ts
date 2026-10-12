import { describe, expect, it } from 'vitest';
import {
  MALICIOUS_FIGURES,
  SANITIZED_FIGURES,
  figureOfCircles,
  oversizeFigure,
  type FigureRejection,
} from './svg-figure.fixtures.js';
import {
  FIGURE_SVG_ATTRIBUTE_FORBIDDEN,
  FIGURE_SVG_ATTRIBUTE_VALUE_INVALID,
  FIGURE_SVG_BLANK,
  FIGURE_SVG_ELEMENT_FORBIDDEN,
  FIGURE_SVG_EXTERNAL_REFERENCE,
  FIGURE_SVG_MARKUP_FORBIDDEN,
  FIGURE_SVG_NO_DRAWABLE_CONTENT,
  FIGURE_SVG_ROOT_NOT_SVG,
  FIGURE_SVG_TEXT_MISPLACED,
  FIGURE_SVG_TOO_LARGE,
  FIGURE_SVG_TOO_MANY_ELEMENTS,
  FIGURE_SVG_UNPARSEABLE,
  FIGURE_SVG_VIEWBOX_INVALID,
  FIGURE_SVG_VIEWBOX_REQUIRED,
  FIGURE_SVG_WORDS_ONLY,
  MAX_FIGURE_SVG_BYTES,
  MAX_FIGURE_SVG_ELEMENTS,
  figureSvgByteLength,
  parseFigureSvg,
  sanitizeFigureSvg,
} from './svg-figure.js';

/** This side's own wording for each reason the shared corpus names. */
const REASONS: Record<FigureRejection, string> = {
  blank: FIGURE_SVG_BLANK,
  tooLarge: FIGURE_SVG_TOO_LARGE,
  tooMany: FIGURE_SVG_TOO_MANY_ELEMENTS,
  unparseable: FIGURE_SVG_UNPARSEABLE,
  rootNotSvg: FIGURE_SVG_ROOT_NOT_SVG,
  viewBoxRequired: FIGURE_SVG_VIEWBOX_REQUIRED,
  viewBoxInvalid: FIGURE_SVG_VIEWBOX_INVALID,
  element: FIGURE_SVG_ELEMENT_FORBIDDEN,
  attribute: FIGURE_SVG_ATTRIBUTE_FORBIDDEN,
  attributeValue: FIGURE_SVG_ATTRIBUTE_VALUE_INVALID,
  external: FIGURE_SVG_EXTERNAL_REFERENCE,
  markup: FIGURE_SVG_MARKUP_FORBIDDEN,
  textMisplaced: FIGURE_SVG_TEXT_MISPLACED,
  noDrawableContent: FIGURE_SVG_NO_DRAWABLE_CONTENT,
  wordsOnly: FIGURE_SVG_WORDS_ONLY,
};

describe('what the sanitizer refuses', () => {
  for (const { what, svg, reason } of MALICIOUS_FIGURES) {
    it(`refuses ${what}`, () => {
      expect(() => sanitizeFigureSvg(svg)).toThrow(REASONS[reason]);
    });
  }

  it('refuses a figure over the byte cap', () => {
    const padded = oversizeFigure(MAX_FIGURE_SVG_BYTES);
    expect(figureSvgByteLength(padded)).toBeGreaterThan(MAX_FIGURE_SVG_BYTES);
    expect(() => sanitizeFigureSvg(padded)).toThrow(FIGURE_SVG_TOO_LARGE);
  });

  it('refuses a figure whose escaping pushes the stored form over the cap', () => {
    // Escaping is the one step that can make the canonical form *longer* than
    // what arrived: a `"` inside a single-quoted attribute costs one byte in
    // and six out. Stored, such a figure would be one the browser mirror
    // refuses on read and draws as nothing at all, so it is refused here, while
    // the whole payload is still rejectable.
    const quotes = '"'.repeat(4_000);
    const figure = `<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/><path d='${quotes}'/></svg>`;
    expect(figureSvgByteLength(figure)).toBeLessThan(MAX_FIGURE_SVG_BYTES);
    expect(() => sanitizeFigureSvg(figure)).toThrow(FIGURE_SVG_TOO_LARGE);
  });

  it('refuses a figure over the element ceiling, which the byte cap does not bound', () => {
    // 16 KB of markup is still hundreds of one-shape elements, and every
    // element becomes a React element on render.
    const many = figureOfCircles(MAX_FIGURE_SVG_ELEMENTS + 1);
    expect(figureSvgByteLength(many)).toBeLessThan(MAX_FIGURE_SVG_BYTES);
    expect(() => sanitizeFigureSvg(many)).toThrow(FIGURE_SVG_TOO_MANY_ELEMENTS);
  });

  it('takes a figure exactly at the element ceiling', () => {
    // The root counts, so the ceiling admits the root plus the shapes under it.
    expect(() => sanitizeFigureSvg(figureOfCircles(MAX_FIGURE_SVG_ELEMENTS - 1))).not.toThrow();
  });
});

describe('what the sanitizer keeps', () => {
  for (const [input, expected] of SANITIZED_FIGURES) {
    it(`sanitizes to the canonical form: ${expected.slice(0, 60)}…`, () => {
      expect(sanitizeFigureSvg(input)).toBe(expected);
    });
  }

  it('rewrites every colour literal to the current text colour', () => {
    const sanitized = sanitizeFigureSvg(
      '<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="#ff0000" stroke="rgb(0,0,255)"/></svg>',
    );
    // Nothing but `currentColor` and `none` survives, which is the whole of
    // dark mode for a figure: a literal here could not be reached by a token.
    expect(sanitized).toContain('fill="currentColor"');
    expect(sanitized).toContain('stroke="currentColor"');
    expect(sanitized).not.toContain('#ff0000');
    expect(sanitized).not.toContain('rgb');
  });

  it('keeps an explicit "none" as none rather than painting it', () => {
    expect(
      sanitizeFigureSvg(
        '<svg viewBox="0 0 4 4"><path d="M0 0L4 4" fill="NONE" stroke="black"/></svg>',
      ),
    ).toBe('<svg viewBox="0 0 4 4"><path d="M0 0L4 4" fill="none" stroke="currentColor"/></svg>');
  });

  it('takes a line stated by one endpoint alone, which is a real line', () => {
    // The unstated coordinates default to zero; that is a line from the origin,
    // not an absence of one.
    expect(() =>
      sanitizeFigureSvg('<svg viewBox="0 0 4 4"><line x2="4" y2="4"/></svg>'),
    ).not.toThrow();
  });

  it('takes a shape labelled by words beside it, which words-only is not', () => {
    expect(() =>
      sanitizeFigureSvg(
        '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="5"/><text x="5" y="9">half</text></svg>',
      ),
    ).not.toThrow();
  });

  it('is idempotent: sanitizing a sanitized figure changes nothing', () => {
    for (const [input] of SANITIZED_FIGURES) {
      const once = sanitizeFigureSvg(input);
      expect(sanitizeFigureSvg(once)).toBe(once);
    }
  });

  it('returns a tree the renderer can walk, not a string it has to trust', () => {
    const root = parseFigureSvg(
      '<svg viewBox="0 0 4 4"><g><circle cx="1" cy="1" r="1"/><text x="1" y="2">Two</text></g></svg>',
    );
    expect(root.tag).toBe('svg');
    expect(root.attributes.viewBox).toBe('0 0 4 4');
    const group = root.children[0];
    expect(group).toMatchObject({ kind: 'element', tag: 'g' });
    expect(group!.kind === 'element' && group.children[1]).toMatchObject({
      kind: 'element',
      tag: 'text',
    });
  });
});
