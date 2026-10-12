import { describe, expect, it } from 'vitest';
import {
  FIGURE_ATTRIBUTES,
  FIGURE_ATTRIBUTE_PROPS,
  FIGURE_DRAWABLE_ELEMENTS,
  FIGURE_ELEMENTS,
  FIGURE_NON_NEGATIVE_ATTRIBUTES,
  FIGURE_NUMBER_LIST_ATTRIBUTES,
  FIGURE_NUMERIC_ATTRIBUTES,
  FIGURE_SHAPE_ELEMENTS,
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
  FIGURE_TEXT_ELEMENTS,
  MAX_FIGURE_SVG_BYTES,
  MAX_FIGURE_SVG_ELEMENTS,
  type FigureNode,
  parseFigureSvg,
} from './svg-figure';
import * as api from '../../../api/src/extraction/svg-figure';
import {
  MALICIOUS_FIGURES,
  SANITIZED_FIGURES,
  figureOfCircles,
  oversizeFigure,
  type FigureRejection,
} from '../../../api/src/extraction/svg-figure.fixtures';

/**
 * This side's own wording for each reason the shared corpus names.
 *
 * The corpus itself lives in `apps/api/src/extraction/svg-figure.fixtures.ts`
 * and is imported by both specs, so a case can never be added to one side
 * alone — which is the one failure mode a hand-written mirror has. The messages
 * stay per-side (each module owns its constants) and the agreement block below
 * asserts they are identical.
 */
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

/**
 * A parsed figure as plain data, for comparing two trees without comparing two
 * types.
 *
 * Structural rather than a cast: the point of the comparison is that the two
 * parsers produce the *same tree* for the same input, and a cast would assert
 * nothing at all.
 */
function shapeOf(node: FigureNode): unknown {
  if (node.kind === 'text') return { text: node.value };
  return {
    tag: node.tag,
    attributes: Object.entries(node.attributes),
    children: node.children.map(shapeOf),
  };
}

describe('what the browser mirror refuses', () => {
  for (const { what, svg, reason } of MALICIOUS_FIGURES) {
    it(`refuses ${what}`, () => {
      expect(() => parseFigureSvg(svg)).toThrow(REASONS[reason]);
    });
  }

  it('refuses a figure over the byte cap', () => {
    expect(() => parseFigureSvg(oversizeFigure(MAX_FIGURE_SVG_BYTES))).toThrow(
      FIGURE_SVG_TOO_LARGE,
    );
  });

  it('refuses a figure over the element ceiling', () => {
    expect(() => parseFigureSvg(figureOfCircles(MAX_FIGURE_SVG_ELEMENTS + 1))).toThrow(
      FIGURE_SVG_TOO_MANY_ELEMENTS,
    );
  });

  it('refuses every case the API refuses, for the same stated reason', () => {
    // Stated as a property as well as per case: the mirror exists because the
    // read casts stored JSON, so a row this build did not write arrives here
    // unvetted. A case the two disagreed about would be a hole exactly the size
    // of that case.
    for (const { svg, reason } of MALICIOUS_FIGURES) {
      expect(() => parseFigureSvg(svg)).toThrow(REASONS[reason]);
      expect(() => api.parseFigureSvg(svg)).toThrow(REASONS[reason]);
    }
  });
});

describe('what the browser mirror keeps', () => {
  it('parses the API-sanitized form into the very same tree', () => {
    // The stored form is the API's canonical serialization, so the mirror
    // parsing it has to be a no-op rather than a second opinion — compared as
    // structure, with no cast between the two modules' types.
    for (const [input] of SANITIZED_FIGURES) {
      const stored = api.sanitizeFigureSvg(input);
      expect(shapeOf(parseFigureSvg(stored))).toEqual(shapeOf(api.parseFigureSvg(stored)));
    }
  });

  it('keeps the viewBox and the inner geometry', () => {
    const root = parseFigureSvg(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="black"/></svg>',
    );
    expect(root.tag).toBe('svg');
    expect(root.attributes.viewBox).toBe('0 0 10 10');
    expect(root.children[0]).toMatchObject({
      kind: 'element',
      tag: 'circle',
      attributes: { cx: '5', cy: '5', r: '4', fill: 'none', stroke: 'currentColor' },
    });
  });

  it('rewrites a colour literal to the current text colour even on a stored figure', () => {
    const root = parseFigureSvg(
      '<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="red"/></svg>',
    );
    expect(root.children[0]).toMatchObject({ attributes: { fill: 'currentColor' } });
  });

  it('strips the root sizing while leaving inner shapes their own', () => {
    const root = parseFigureSvg(
      '<svg viewBox="0 0 8 8" width="200" height="200"><rect x="1" y="1" width="6" height="6"/></svg>',
    );
    expect(root.attributes.width).toBeUndefined();
    expect(root.attributes.height).toBeUndefined();
    expect(root.children[0]).toMatchObject({ attributes: { width: '6', height: '6' } });
  });

  it('keeps character data only inside a text element, decoded', () => {
    const root = parseFigureSvg(
      '<svg viewBox="0 0 6 6"><line x1="0" y1="0" x2="6" y2="6"/><text x="1" y="1" text-anchor="middle">1 &lt; 2</text></svg>',
    );
    const label = root.children[1];
    expect(label).toMatchObject({ kind: 'element', tag: 'text' });
    expect(label!.kind === 'element' && label.children[0]).toEqual({
      kind: 'text',
      value: '1 < 2',
    });
  });
});

describe('the agreement between the two sanitizers', () => {
  it('admits exactly the same elements and attributes', () => {
    // The hand mirror is only safe while it is a mirror (AD-32). Compared by
    // content rather than by order, because neither list's order is a rule.
    expect([...FIGURE_ELEMENTS].sort()).toEqual([...api.FIGURE_ELEMENTS].sort());
    expect([...FIGURE_ATTRIBUTES].sort()).toEqual([...api.FIGURE_ATTRIBUTES].sort());
    expect([...FIGURE_DRAWABLE_ELEMENTS].sort()).toEqual([...api.FIGURE_DRAWABLE_ELEMENTS].sort());
    expect([...FIGURE_SHAPE_ELEMENTS].sort()).toEqual([...api.FIGURE_SHAPE_ELEMENTS].sort());
    expect([...FIGURE_TEXT_ELEMENTS].sort()).toEqual([...api.FIGURE_TEXT_ELEMENTS].sort());
  });

  it('validates exactly the same attribute values', () => {
    expect([...FIGURE_NUMERIC_ATTRIBUTES].sort()).toEqual(
      [...api.FIGURE_NUMERIC_ATTRIBUTES].sort(),
    );
    expect([...FIGURE_NON_NEGATIVE_ATTRIBUTES].sort()).toEqual(
      [...api.FIGURE_NON_NEGATIVE_ATTRIBUTES].sort(),
    );
    expect([...FIGURE_NUMBER_LIST_ATTRIBUTES].sort()).toEqual(
      [...api.FIGURE_NUMBER_LIST_ATTRIBUTES].sort(),
    );
  });

  it('holds the same ceilings', () => {
    expect(MAX_FIGURE_SVG_BYTES).toBe(api.MAX_FIGURE_SVG_BYTES);
    expect(MAX_FIGURE_SVG_ELEMENTS).toBe(api.MAX_FIGURE_SVG_ELEMENTS);
  });

  it('words every rejection reason identically', () => {
    expect(REASONS).toEqual({
      blank: api.FIGURE_SVG_BLANK,
      tooLarge: api.FIGURE_SVG_TOO_LARGE,
      tooMany: api.FIGURE_SVG_TOO_MANY_ELEMENTS,
      unparseable: api.FIGURE_SVG_UNPARSEABLE,
      rootNotSvg: api.FIGURE_SVG_ROOT_NOT_SVG,
      viewBoxRequired: api.FIGURE_SVG_VIEWBOX_REQUIRED,
      viewBoxInvalid: api.FIGURE_SVG_VIEWBOX_INVALID,
      element: api.FIGURE_SVG_ELEMENT_FORBIDDEN,
      attribute: api.FIGURE_SVG_ATTRIBUTE_FORBIDDEN,
      attributeValue: api.FIGURE_SVG_ATTRIBUTE_VALUE_INVALID,
      external: api.FIGURE_SVG_EXTERNAL_REFERENCE,
      markup: api.FIGURE_SVG_MARKUP_FORBIDDEN,
      textMisplaced: api.FIGURE_SVG_TEXT_MISPLACED,
      noDrawableContent: api.FIGURE_SVG_NO_DRAWABLE_CONTENT,
      wordsOnly: api.FIGURE_SVG_WORDS_ONLY,
    });
  });
});

describe('the attribute to React prop map the renderer reads from', () => {
  it('covers every allowlisted attribute', () => {
    // The renderer sets props out of this map and nowhere else, so an
    // allowlisted attribute with no mapping is an attribute that parses and
    // then silently fails to draw.
    for (const attribute of FIGURE_ATTRIBUTES) {
      expect(FIGURE_ATTRIBUTE_PROPS[attribute]).toBeTypeOf('string');
    }
  });

  it('maps nothing outside the allowlist', () => {
    // The other direction is what makes the map a control rather than a
    // convenience: a prop here that no attribute can produce would be a prop
    // the renderer could set from a value nothing vetted.
    expect(Object.keys(FIGURE_ATTRIBUTE_PROPS).sort()).toEqual([...FIGURE_ATTRIBUTES].sort());
    for (const forbidden of ['style', 'class', 'href', 'xlink:href', 'onload', 'id']) {
      expect(FIGURE_ATTRIBUTE_PROPS[forbidden]).toBeUndefined();
    }
  });

  it('spells each hyphenated attribute as its camelCase React prop', () => {
    expect(FIGURE_ATTRIBUTE_PROPS['stroke-width']).toBe('strokeWidth');
    expect(FIGURE_ATTRIBUTE_PROPS['stroke-dasharray']).toBe('strokeDasharray');
    expect(FIGURE_ATTRIBUTE_PROPS['font-size']).toBe('fontSize');
    expect(FIGURE_ATTRIBUTE_PROPS['text-anchor']).toBe('textAnchor');
    expect(FIGURE_ATTRIBUTE_PROPS['dominant-baseline']).toBe('dominantBaseline');
    // `viewBox` is already the prop React wants, and is the one attribute whose
    // capitalization the parse preserves.
    expect(FIGURE_ATTRIBUTE_PROPS.viewBox).toBe('viewBox');
  });
});
