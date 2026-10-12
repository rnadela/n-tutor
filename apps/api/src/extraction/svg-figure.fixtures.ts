/**
 * The malicious corpus, once, for both sanitizers.
 *
 * Every row is a construct a browser would happily execute, fetch or draw
 * wrong, and the reason the sanitizer is an allowlist parse rather than a
 * pattern strip: not one of these needed a rule of its own — they are rejected
 * because the grammar has no node for them.
 *
 * **Not a spec file, and that is the point.** `apps/api/src/extraction/
 * svg-figure.spec.ts` and `apps/web/src/lib/svg-figure.spec.ts` both import
 * this table, so a case can never be added to one side alone — which was the
 * exact drift the hand-written mirror is otherwise exposed to. It holds no
 * `describe` or `it` of its own, so importing it from the browser workspace
 * does not drag the API's suite in with it.
 *
 * Each row names its reason **symbolically** rather than by message, because
 * each side owns its own copy of the message constants; the two specs map the
 * name onto their own module's constant, and asserting those messages are
 * identical is a separate test.
 */

/** One rejection reason, named rather than quoted. */
export type FigureRejection =
  | 'blank'
  | 'tooLarge'
  | 'tooMany'
  | 'unparseable'
  | 'rootNotSvg'
  | 'viewBoxRequired'
  | 'viewBoxInvalid'
  | 'element'
  | 'attribute'
  | 'attributeValue'
  | 'external'
  | 'markup'
  | 'textMisplaced'
  | 'noDrawableContent'
  | 'wordsOnly';

export interface FigureCase {
  /** How the case reads in a test name: "refuses <what>". */
  what: string;
  svg: string;
  reason: FigureRejection;
}

/** A drawable shape to pad a case whose point is something other than the shape. */
const SHAPE = '<circle cx="1" cy="1" r="1"/>';

export const MALICIOUS_FIGURES: readonly FigureCase[] = [
  {
    what: 'a script element',
    svg: `<svg viewBox="0 0 2 2"><script>alert(1)</script>${SHAPE}</svg>`,
    reason: 'element',
  },
  {
    what: 'an event handler',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" onload="x()"/></svg>',
    reason: 'attribute',
  },
  {
    what: 'a foreignObject smuggling HTML',
    svg: `<svg viewBox="0 0 2 2"><foreignObject><p>hi</p></foreignObject>${SHAPE}</svg>`,
    reason: 'element',
  },
  {
    what: 'an embedded image',
    svg: `<svg viewBox="0 0 2 2"><image x="0" y="0" width="1" height="1"/>${SHAPE}</svg>`,
    reason: 'element',
  },
  {
    what: 'a use element',
    svg: `<svg viewBox="0 0 2 2"><use x="0" y="0"/>${SHAPE}</svg>`,
    reason: 'element',
  },
  {
    what: 'a style element',
    svg: `<svg viewBox="0 0 2 2"><style>circle{fill:red}</style>${SHAPE}</svg>`,
    reason: 'element',
  },
  {
    what: 'a nested svg carrying a viewport of its own',
    svg: `<svg viewBox="0 0 2 2"><svg width="9999" height="9999">${SHAPE}</svg></svg>`,
    reason: 'element',
  },
  {
    what: 'a style attribute',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" style="fill:red"/></svg>',
    reason: 'attribute',
  },
  {
    what: 'an href',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" href="https://example.test/x"/></svg>',
    reason: 'attribute',
  },
  {
    what: 'an xlink:href',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" xlink:href="#x"/></svg>',
    reason: 'attribute',
  },
  {
    what: 'a namespace declaration beyond the root',
    svg: `<svg viewBox="0 0 2 2"><g xmlns:xlink="http://www.w3.org/1999/xlink">${SHAPE}</g></svg>`,
    reason: 'attribute',
  },
  {
    what: 'a javascript: URL in an admitted attribute',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" fill="javascript:alert(1)"/></svg>',
    reason: 'external',
  },
  {
    what: 'a javascript: URL hidden behind a numeric reference',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" fill="javascript&#58;alert(1)"/></svg>',
    reason: 'external',
  },
  {
    what: 'a CSS url() in a paint attribute',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" stroke="url(#grad)"/></svg>',
    reason: 'external',
  },
  {
    what: 'a comment',
    svg: `<svg viewBox="0 0 2 2"><!-- <script>alert(1)</script> -->${SHAPE}</svg>`,
    reason: 'markup',
  },
  {
    what: 'a doctype',
    svg: `<!DOCTYPE svg><svg viewBox="0 0 2 2">${SHAPE}</svg>`,
    reason: 'markup',
  },
  {
    what: 'a processing instruction',
    svg: `<?xml version="1.0"?><svg viewBox="0 0 2 2">${SHAPE}</svg>`,
    reason: 'markup',
  },
  {
    what: 'a CDATA section',
    svg: '<svg viewBox="0 0 2 2"><text><![CDATA[<script>alert(1)</script>]]></text></svg>',
    reason: 'markup',
  },
  {
    what: 'an unknown element',
    svg: `<svg viewBox="0 0 2 2"><marquee/>${SHAPE}</svg>`,
    reason: 'element',
  },
  {
    what: 'an unknown attribute',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" class="shape"/></svg>',
    reason: 'attribute',
  },
  {
    what: 'a repeated attribute name',
    svg: `<svg viewBox="0 0 2 2" viewBox="0 0 9 9">${SHAPE}</svg>`,
    reason: 'unparseable',
  },
  {
    what: 'a geometry attribute holding prose',
    svg: '<svg viewBox="0 0 2 2"><circle cx="hello world" cy="1" r="1"/></svg>',
    reason: 'attributeValue',
  },
  {
    what: 'a negative radius',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="-5"/></svg>',
    reason: 'attributeValue',
  },
  {
    what: 'a negative type size',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" font-size="-3"/></svg>',
    reason: 'attributeValue',
  },
  {
    what: 'a points list with an odd number of coordinates',
    svg: '<svg viewBox="0 0 2 2"><polyline points="0,0 1,1 2"/></svg>',
    reason: 'attributeValue',
  },
  {
    what: 'a points list holding prose',
    svg: '<svg viewBox="0 0 2 2"><polygon points="over there"/></svg>',
    reason: 'attributeValue',
  },
  {
    what: 'a dash pattern holding a negative length',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" stroke-dasharray="2 -1"/></svg>',
    reason: 'attributeValue',
  },
  {
    what: 'a missing viewBox',
    svg: `<svg>${SHAPE}</svg>`,
    reason: 'viewBoxRequired',
  },
  {
    what: 'an empty viewBox',
    svg: `<svg viewBox="">${SHAPE}</svg>`,
    reason: 'viewBoxInvalid',
  },
  {
    what: 'a viewBox that is not four numbers',
    svg: `<svg viewBox="nonsense">${SHAPE}</svg>`,
    reason: 'viewBoxInvalid',
  },
  {
    what: 'a viewBox with three numbers',
    svg: `<svg viewBox="0 0 2">${SHAPE}</svg>`,
    reason: 'viewBoxInvalid',
  },
  {
    what: 'a viewBox describing a box with no area',
    svg: `<svg viewBox="0 0 0 10">${SHAPE}</svg>`,
    reason: 'viewBoxInvalid',
  },
  { what: 'a non-svg root', svg: `<div>${SHAPE}</div>`, reason: 'rootNotSvg' },
  { what: 'bare text', svg: 'A half-circle is shown.', reason: 'rootNotSvg' },
  {
    what: 'an unbalanced tag',
    svg: `<svg viewBox="0 0 2 2"><g>${SHAPE}</svg>`,
    reason: 'unparseable',
  },
  {
    what: 'an unquoted attribute value',
    svg: '<svg viewBox="0 0 2 2"><circle cx=1 cy="1" r="1"/></svg>',
    reason: 'unparseable',
  },
  {
    what: 'a bare attribute with no value',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" fill/></svg>',
    reason: 'unparseable',
  },
  {
    what: 'characters outside a text element',
    svg: `<svg viewBox="0 0 2 2"><g>loose words${SHAPE}</g></svg>`,
    reason: 'textMisplaced',
  },
  {
    what: 'no drawable content',
    svg: '<svg viewBox="0 0 2 2"><g></g></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a shape with none of the geometry it is drawn from',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a rectangle with no size',
    svg: '<svg viewBox="0 0 2 2"><rect x="0" y="0"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a circle whose radius is zero',
    svg: '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="0"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a text element with no characters in it',
    svg: '<svg viewBox="0 0 2 2"><text x="1" y="1"></text></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'an ellipse with one radius zero',
    svg: '<svg viewBox="0 0 2 2"><ellipse cx="1" cy="1" rx="1" ry="0"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a polyline naming the same point twice',
    svg: '<svg viewBox="0 0 2 2"><polyline points="1,1 1,1"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a polygon with only one point',
    svg: '<svg viewBox="0 0 2 2"><polygon points="1,1"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a path that only moves the pen',
    svg: '<svg viewBox="0 0 2 2"><path d="M1 1"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a line whose two endpoints are the same point',
    svg: '<svg viewBox="0 0 2 2"><line x1="1" y1="1" x2="1" y2="1"/></svg>',
    reason: 'noDrawableContent',
  },
  {
    what: 'a lone surrogate numeric character reference',
    svg: `<svg viewBox="0 0 2 2"><text x="0" y="1">&#55296;</text>${SHAPE}</svg>`,
    reason: 'unparseable',
  },
  {
    what: 'a figure written in words instead of drawn',
    svg: '<svg viewBox="0 0 2 2"><text x="0" y="1">A half-circle figure is shown.</text></svg>',
    reason: 'wordsOnly',
  },
  {
    what: 'a caption with no shape beside it',
    svg: '<svg viewBox="0 0 2 2"><g><text x="0" y="1">Figure 2</text><tspan>cm</tspan></g></svg>',
    reason: 'wordsOnly',
  },
  { what: 'blank input', svg: '   ', reason: 'blank' },
  { what: 'an empty string', svg: '', reason: 'blank' },
];

/**
 * Figures that must survive, as `[input, what the canonical form must be]`.
 *
 * Shared for the same reason the rejections are: a positive case the two sides
 * disagree about is a figure that stores on one and renders as nothing on the
 * other.
 */
export const SANITIZED_FIGURES: readonly [string, string][] = [
  [
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="black"/></svg>',
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor"/></svg>',
  ],
  [
    '<svg viewBox="0 0 8 8" width="200" height="200"><rect x="1" y="1" width="6" height="6"/></svg>',
    '<svg viewBox="0 0 8 8"><rect x="1" y="1" width="6" height="6"/></svg>',
  ],
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></svg>',
    '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></svg>',
  ],
  [
    '<svg viewBox="0 0 2 2">\n  <circle cx="1" cy="1" r="1"/>\n</svg>',
    '<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></svg>',
  ],
  [
    '<svg viewBox="0 0 8 8"><g transform="translate(1,1)"><polyline points="0,0 2,2" stroke-width="0.5" stroke-dasharray="1 1"/></g></svg>',
    '<svg viewBox="0 0 8 8"><g transform="translate(1,1)"><polyline points="0,0 2,2" stroke-width="0.5" stroke-dasharray="1 1"/></g></svg>',
  ],
  [
    '<svg viewBox="0 0 10 10"><path d="M0 5A5 5 0 0 1 10 5" fill="none" stroke="#333"/><text x="5" y="9" font-size="3" text-anchor="middle" dominant-baseline="central">A &amp; B</text></svg>',
    '<svg viewBox="0 0 10 10"><path d="M0 5A5 5 0 0 1 10 5" fill="none" stroke="currentColor"/><text x="5" y="9" font-size="3" text-anchor="middle" dominant-baseline="central">A &amp; B</text></svg>',
  ],
  [
    '<svg viewBox="0 0 6 6"><line x1="0" y1="0" x2="6" y2="6"/><text x="1" y="1">1 &lt; 2</text></svg>',
    '<svg viewBox="0 0 6 6"><line x1="0" y1="0" x2="6" y2="6"/><text x="1" y="1">1 &lt; 2</text></svg>',
  ],
  [
    // A bare `moveto` followed by a second coordinate pair with no command
    // letter: SVG reads the second pair as an implicit lineto, so this draws
    // a line even though `PATH_DRAW_COMMAND` finds no draw-command letter.
    '<svg viewBox="0 0 10 10"><path d="M0 0 10 10"/></svg>',
    '<svg viewBox="0 0 10 10"><path d="M0 0 10 10"/></svg>',
  ],
];

/** A figure of `count` circles, for the element ceiling on either side. */
export function figureOfCircles(count: number): string {
  const shapes = Array.from({ length: count }, () => SHAPE).join('');
  return `<svg viewBox="0 0 2 2">${shapes}</svg>`;
}

/** A figure whose markup is deliberately far past any byte cap. */
export function oversizeFigure(bytes: number): string {
  return `<svg viewBox="0 0 2 2"><path d="${'M0 0'.repeat(bytes)}"/></svg>`;
}
