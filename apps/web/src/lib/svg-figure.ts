/**
 * The browser's own figure sanitizer: a hand-written mirror of
 * `apps/api/src/extraction/svg-figure.ts`.
 *
 * **Defence in depth, and a deliberate duplicate.** A figure reaching here has
 * already been sanitized on the way into storage, and it is parsed again anyway
 * before anything is drawn: neither side trusts the other, and the read casts
 * stored JSON rather than re-validating it, so a row written by an older build
 * — or by a path a later story adds — arrives here unvetted. The cost of the
 * second parse is a few microseconds; the cost of skipping it is that one
 * mis-sanitized row becomes script execution in a parent's browser.
 *
 * It is hand-written rather than imported for the same reason `plainTextOf` is
 * (`apps/web/src/lib/rich-text.ts`): there is no shared package, and `apps/web`
 * runs its unit suite with `environment: 'node'`, so a sanitizer that needed a
 * DOM would be a sanitizer no unit test could state a rule about. No runtime
 * dependency on either side — no DOMPurify, no XML parser, no jsdom.
 *
 * **The two allowlists must be changed together.** `svg-figure.spec.ts` asserts
 * that both allowlists, both ceilings, every rejection reason and the whole
 * shared malicious corpus behave identically on the two sides, by importing the
 * API module and the shared fixtures, so a change on one side alone fails the
 * suite rather than opening a gap.
 *
 * This side holds no serializer: the canonical string form is the API's, and
 * what this one produces is a tree plus an attribute → React-prop map, so
 * `RichText` builds real React elements and the raw-HTML escape hatch is absent
 * from the design rather than merely unused.
 */
/** Every element the grammar admits. Anything else is a rejection. */
export const FIGURE_ELEMENTS = [
  'svg',
  'g',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
] as const;

/** Every attribute the grammar admits, on any element. Anything else is a rejection. */
export const FIGURE_ATTRIBUTES = [
  'viewBox',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'd',
  'stroke-width',
  'stroke-dasharray',
  'fill',
  'stroke',
  'font-size',
  'text-anchor',
  'dominant-baseline',
] as const;

/**
 * The elements that put ink on the page — and each of them only when it carries
 * the geometry it is drawn from; see `shapeDraws` below.
 *
 * A figure made only of `svg` and `g` draws nothing, which makes it an empty
 * box where a shape was promised — worse than a rejection, because the question
 * still claims to need it. So does a `circle` with no radius.
 */
export const FIGURE_DRAWABLE_ELEMENTS = [
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
] as const;

/**
 * The drawable elements that are a *drawing* rather than a caption.
 *
 * A figure must hold at least one of these. A figure built only out of `text`
 * is the bracketed prose description this story exists to remove — `"[A
 * half-circle figure is shown.]"` with angle brackets around it — and it would
 * pass every other rule in this module while telling the child nothing it
 * could look at. Words may *label* a drawing; they may not be the drawing.
 */
export const FIGURE_SHAPE_ELEMENTS = [
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'path',
] as const;

/** The only elements that may hold character data. */
export const FIGURE_TEXT_ELEMENTS = ['text', 'tspan'] as const;

/**
 * The attributes whose value must be a number, and the subset of those for
 * which a negative number means nothing at all.
 *
 * `d` and `transform` are deliberately **not** validated beyond the escape and
 * external-reference checks every value gets: a path data string and a
 * transform list are real grammars, and re-implementing either here would be a
 * second parser to keep correct for no safety gained — nothing in them can
 * reach outside the figure once `url(`, `javascript:` and markup characters are
 * refused. A malformed `d` draws a wrong shape; it does not run.
 */
export const FIGURE_NUMERIC_ATTRIBUTES = [
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'stroke-width',
  'font-size',
] as const;

/** A length, a radius or a type size below zero is not a smaller one. */
export const FIGURE_NON_NEGATIVE_ATTRIBUTES = [
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'stroke-width',
  'font-size',
] as const;

/** The attributes whose value is a whitespace- or comma-separated number list. */
export const FIGURE_NUMBER_LIST_ATTRIBUTES = ['points', 'stroke-dasharray'] as const;

/**
 * The byte cap, in the spirit of `MAX_PAGE_BYTES`: a bound a route carrying
 * model-authored bytes must have, because without one the model decides how
 * much memory and how many stored bytes one figure spends. 16 KB is far above
 * any minimal shape drawn with basic primitives.
 */
export const MAX_FIGURE_SVG_BYTES = 16 * 1024;

/**
 * The element ceiling, in the spirit of `MAX_DECODED_PIXELS`: the byte cap does
 * not bound this on its own, because 16 KB of markup can still be thousands of
 * one-character elements, and every element becomes a React element on render.
 */
export const MAX_FIGURE_SVG_ELEMENTS = 500;

/** One constant per rejection reason, so a spec names the reason it asserts. */
export const FIGURE_SVG_BLANK = 'A figure carries no SVG.';
export const FIGURE_SVG_TOO_LARGE = 'A figure is larger than a drawn shape can plausibly be.';
export const FIGURE_SVG_TOO_MANY_ELEMENTS = 'A figure holds more elements than a shape can need.';
export const FIGURE_SVG_UNPARSEABLE = 'A figure is not well-formed SVG markup.';
export const FIGURE_SVG_ROOT_NOT_SVG = 'A figure does not begin with an svg element.';
export const FIGURE_SVG_VIEWBOX_REQUIRED = 'A figure has no viewBox to be drawn in.';
export const FIGURE_SVG_VIEWBOX_INVALID =
  'A figure viewBox is not four numbers describing a box with area.';
export const FIGURE_SVG_ELEMENT_FORBIDDEN = 'A figure uses an element the grammar does not admit.';
export const FIGURE_SVG_ATTRIBUTE_FORBIDDEN =
  'A figure uses an attribute the grammar does not admit.';
export const FIGURE_SVG_EXTERNAL_REFERENCE = 'A figure refers to something outside itself.';
export const FIGURE_SVG_MARKUP_FORBIDDEN =
  'A figure holds a comment, doctype, processing instruction or CDATA section.';
export const FIGURE_SVG_TEXT_MISPLACED = 'A figure holds characters outside a text element.';
export const FIGURE_SVG_ATTRIBUTE_VALUE_INVALID =
  'A figure attribute does not hold the kind of value it is drawn from.';
export const FIGURE_SVG_NO_DRAWABLE_CONTENT = 'A figure draws nothing.';
export const FIGURE_SVG_WORDS_ONLY = 'A figure is written in words rather than drawn.';

export type FigureTag = (typeof FIGURE_ELEMENTS)[number];

/** One element of the parsed figure. Attributes are in the order they survived. */
export interface FigureElement {
  kind: 'element';
  tag: FigureTag;
  attributes: Record<string, string>;
  children: FigureNode[];
}

/** Character data, only ever inside a `text` or `tspan`. */
export interface FigureTextNode {
  kind: 'text';
  value: string;
}

export type FigureNode = FigureElement | FigureTextNode;

/**
 * Allowlisted attribute → the React prop that sets it, stated exhaustively.
 *
 * The renderer reads props out of this map and nowhere else, so it can only
 * ever set a prop that is on the allowlist — an attribute that survived the
 * parse but has no mapping is simply never spread onto an element. One table,
 * so "what may be drawn" and "what may be set" cannot drift into two answers.
 */
export const FIGURE_ATTRIBUTE_PROPS: Readonly<Record<string, string>> = {
  viewBox: 'viewBox',
  transform: 'transform',
  x: 'x',
  y: 'y',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  width: 'width',
  height: 'height',
  points: 'points',
  d: 'd',
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  fill: 'fill',
  stroke: 'stroke',
  'font-size': 'fontSize',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
};

const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set(FIGURE_ELEMENTS);
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set(FIGURE_ATTRIBUTES);
const SHAPE_ELEMENTS: ReadonlySet<string> = new Set(FIGURE_SHAPE_ELEMENTS);
const TEXT_ELEMENTS: ReadonlySet<string> = new Set(FIGURE_TEXT_ELEMENTS);
const NUMERIC_ATTRIBUTES: ReadonlySet<string> = new Set(FIGURE_NUMERIC_ATTRIBUTES);
const NON_NEGATIVE_ATTRIBUTES: ReadonlySet<string> = new Set(FIGURE_NON_NEGATIVE_ATTRIBUTES);
const NUMBER_LIST_ATTRIBUTES: ReadonlySet<string> = new Set(FIGURE_NUMBER_LIST_ATTRIBUTES);

/**
 * The size a figure's SVG costs in storage, counted in bytes rather than in
 * UTF-16 units: the cap is about bytes written, and one glyph can be four.
 *
 * `TextEncoder` and not `Buffer`, so this counts exactly what the API counted.
 */
export function figureSvgByteLength(svg: string): number {
  return new TextEncoder().encode(svg).length;
}

/**
 * Parse an SVG figure, or throw.
 *
 * The result is a tree, not a string: the renderer walks it into real React
 * elements, so no step of drawing a figure ever hands markup to the DOM.
 */
export function parseFigureSvg(svg: string): FigureElement {
  if (typeof svg !== 'string' || svg.trim() === '') throw new Error(FIGURE_SVG_BLANK);
  if (figureSvgByteLength(svg) > MAX_FIGURE_SVG_BYTES) throw new Error(FIGURE_SVG_TOO_LARGE);

  const open: FigureElement[] = [];
  let root: FigureElement | null = null;
  let elements = 0;
  let cursor = 0;

  while (cursor < svg.length) {
    const next = svg.indexOf('<', cursor);
    if (next === -1) {
      takeCharacters(svg.slice(cursor), open);
      break;
    }
    if (next > cursor) takeCharacters(svg.slice(cursor, next), open);

    // A comment, doctype, processing instruction or CDATA section is markup
    // this grammar has no node for, and "ignore what you do not understand" is
    // how `<!--<script>-->` reaches a browser that understands it differently.
    if (svg.startsWith('<!', next) || svg.startsWith('<?', next)) {
      throw new Error(FIGURE_SVG_MARKUP_FORBIDDEN);
    }

    if (svg.startsWith('</', next)) {
      cursor = takeCloseTag(svg, next, open);
      continue;
    }

    const parent = open[open.length - 1];
    const isRoot = root === null;
    const tag = readTagName(svg, next + 1);
    if (isRoot) {
      if (tag.name !== 'svg') throw new Error(FIGURE_SVG_ROOT_NOT_SVG);
    } else {
      // Two roots is not a document, and an element after the root closed is
      // markup the grammar cannot place.
      if (parent === undefined) throw new Error(FIGURE_SVG_UNPARSEABLE);
      // A nested `svg` is a viewport of its own: `width`/`height` are stripped
      // on the root alone, so an inner one would keep them and draw itself at
      // whatever pixel size the model asked for, inside a figure whose whole
      // sizing contract is that the page decides.
      if (tag.name === 'svg') throw new Error(FIGURE_SVG_ELEMENT_FORBIDDEN);
      if (!ALLOWED_ELEMENTS.has(tag.name)) throw new Error(FIGURE_SVG_ELEMENT_FORBIDDEN);
    }

    elements += 1;
    if (elements > MAX_FIGURE_SVG_ELEMENTS) throw new Error(FIGURE_SVG_TOO_MANY_ELEMENTS);

    const element: FigureElement = {
      kind: 'element',
      tag: tag.name as FigureTag,
      attributes: {},
      children: [],
    };
    const after = takeAttributes(svg, tag.end, isRoot, element.attributes);
    if (parent === undefined) root = element;
    else parent.children.push(element);
    if (!after.selfClosing) open.push(element);
    cursor = after.end;
  }

  if (root === null) throw new Error(FIGURE_SVG_ROOT_NOT_SVG);
  if (open.length > 0) throw new Error(FIGURE_SVG_UNPARSEABLE);
  // The viewBox is what makes the figure scale into whatever box the page gives
  // it; without one it draws at whatever size the markup happened to state,
  // which is the size the root `width`/`height` were just stripped for.
  if (root.attributes.viewBox === undefined) throw new Error(FIGURE_SVG_VIEWBOX_REQUIRED);
  requireViewBox(root.attributes.viewBox);
  requireDrawing(root);
  return root;
}

// --- Internals -----------------------------------------------------------

function isNameStart(character: string): boolean {
  return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z');
}

function isNameChar(character: string): boolean {
  return (
    isNameStart(character) ||
    (character >= '0' && character <= '9') ||
    character === '-' ||
    character === '_' ||
    character === ':' ||
    character === '.'
  );
}

function isSpace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

function readTagName(svg: string, from: number): { name: string; end: number } {
  if (from >= svg.length || !isNameStart(svg[from]!)) throw new Error(FIGURE_SVG_UNPARSEABLE);
  let end = from;
  while (end < svg.length && isNameChar(svg[end]!)) end += 1;
  return { name: svg.slice(from, end), end };
}

/**
 * Attributes up to the tag's `>` or `/>`.
 *
 * Every attribute must be `name="value"` or `name='value'`: a bare attribute
 * and an unquoted value are HTML's forgiveness, not XML's, and accepting them
 * would mean guessing where a value ends.
 */
function takeAttributes(
  svg: string,
  from: number,
  isRoot: boolean,
  attributes: Record<string, string>,
): { end: number; selfClosing: boolean } {
  let cursor = from;
  // XML forbids a repeated attribute name outright, and last-wins would mean
  // the value this module judged is not the value a reader of the markup would
  // have expected — `viewBox="0 0 1 1" viewBox="0 0 9 9"` is two claims about
  // the same box.
  const stated = new Set<string>();
  for (;;) {
    while (cursor < svg.length && isSpace(svg[cursor]!)) cursor += 1;
    if (cursor >= svg.length) throw new Error(FIGURE_SVG_UNPARSEABLE);
    if (svg[cursor] === '>') return { end: cursor + 1, selfClosing: false };
    if (svg[cursor] === '/') {
      if (svg[cursor + 1] !== '>') throw new Error(FIGURE_SVG_UNPARSEABLE);
      return { end: cursor + 2, selfClosing: true };
    }

    const name = readTagName(svg, cursor);
    if (stated.has(name.name)) throw new Error(FIGURE_SVG_UNPARSEABLE);
    stated.add(name.name);
    cursor = name.end;
    while (cursor < svg.length && isSpace(svg[cursor]!)) cursor += 1;
    if (svg[cursor] !== '=') throw new Error(FIGURE_SVG_UNPARSEABLE);
    cursor += 1;
    while (cursor < svg.length && isSpace(svg[cursor]!)) cursor += 1;
    const quote = svg[cursor];
    if (quote !== '"' && quote !== "'") throw new Error(FIGURE_SVG_UNPARSEABLE);
    const close = svg.indexOf(quote, cursor + 1);
    if (close === -1) throw new Error(FIGURE_SVG_UNPARSEABLE);
    takeAttribute(name.name, svg.slice(cursor + 1, close), isRoot, attributes);
    cursor = close + 1;
  }
}

/** One attribute, admitted as-is, admitted rewritten, dropped, or refused. */
function takeAttribute(
  name: string,
  raw: string,
  isRoot: boolean,
  attributes: Record<string, string>,
): void {
  // The root's own namespace declaration is the single attribute outside the
  // allowlist that is tolerated, and it is dropped rather than kept: React
  // writes the SVG namespace itself, and the stored form needs no declaration
  // because nothing parses it as a standalone document. A namespace anywhere
  // else — `xmlns:xlink`, a prefixed attribute — is a rejection.
  if (isRoot && name === 'xmlns') return;
  if (!ALLOWED_ATTRIBUTES.has(name)) throw new Error(FIGURE_SVG_ATTRIBUTE_FORBIDDEN);

  // Decoded before it is judged, so `javascript&#58;` is the same rejection
  // `javascript:` is.
  const value = decodeCharacterData(raw);
  const lowered = value.toLowerCase();
  if (lowered.includes('url(') || lowered.includes('javascript:')) {
    throw new Error(FIGURE_SVG_EXTERNAL_REFERENCE);
  }
  if (value.includes('<') || value.includes('>')) throw new Error(FIGURE_SVG_UNPARSEABLE);

  // The root's own size is the page's to decide: kept, it would pin the figure
  // to whatever pixel figure the model wrote, and the renderer's responsive
  // width would have nothing to work with.
  if (isRoot && (name === 'width' || name === 'height')) return;

  // Every paint is the current text colour or nothing at all. This is the whole
  // of dark mode for a figure: a colour literal that survived here would be
  // invisible on one of the two grounds, and no token could reach it.
  if (name === 'fill' || name === 'stroke') {
    attributes[name] = value.trim().toLowerCase() === 'none' ? 'none' : 'currentColor';
    return;
  }

  // A geometry attribute that is not a number is not geometry. Unvalidated, it
  // reaches the renderer as a prop, draws nothing, and leaves a figure that
  // passed every rule here as an empty box on the page.
  if (NUMERIC_ATTRIBUTES.has(name)) {
    const number = asNumber(value);
    if (number === null) throw new Error(FIGURE_SVG_ATTRIBUTE_VALUE_INVALID);
    if (NON_NEGATIVE_ATTRIBUTES.has(name) && number < 0) {
      throw new Error(FIGURE_SVG_ATTRIBUTE_VALUE_INVALID);
    }
  } else if (NUMBER_LIST_ATTRIBUTES.has(name)) {
    requireNumberList(name, value);
  }

  attributes[name] = value;
}

/** A number as SVG writes one, or `null`. Hex, `Infinity` and prose are not. */
function asNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  for (const character of trimmed) {
    const numeric =
      (character >= '0' && character <= '9') ||
      character === '+' ||
      character === '-' ||
      character === '.' ||
      character === 'e' ||
      character === 'E';
    if (!numeric) return null;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

/**
 * A whitespace- or comma-separated run of numbers.
 *
 * `points` is coordinate *pairs*, so an odd count is a point with no second
 * half — the shape would be drawn to a coordinate the markup never stated.
 * Every dash length is non-negative for the same reason a stroke width is.
 */
function requireNumberList(name: string, value: string): void {
  const parts = value
    .split(/[\s,]+/u)
    .filter((part) => part !== '')
    .map((part) => asNumber(part));
  if (parts.length === 0 || parts.some((part) => part === null)) {
    throw new Error(FIGURE_SVG_ATTRIBUTE_VALUE_INVALID);
  }
  if (name === 'points' && parts.length % 2 !== 0) {
    throw new Error(FIGURE_SVG_ATTRIBUTE_VALUE_INVALID);
  }
  if (name === 'stroke-dasharray' && parts.some((part) => part! < 0)) {
    throw new Error(FIGURE_SVG_ATTRIBUTE_VALUE_INVALID);
  }
}

function takeCloseTag(svg: string, at: number, open: FigureElement[]): number {
  const name = readTagName(svg, at + 2);
  let cursor = name.end;
  while (cursor < svg.length && isSpace(svg[cursor]!)) cursor += 1;
  if (svg[cursor] !== '>') throw new Error(FIGURE_SVG_UNPARSEABLE);
  const element = open.pop();
  if (element === undefined || element.tag !== name.name) throw new Error(FIGURE_SVG_UNPARSEABLE);
  return cursor + 1;
}

/**
 * Character data, kept only where the grammar has a node for it.
 *
 * Whitespace between elements is formatting and is dropped. Anything else
 * outside a `text` or `tspan` is content the renderer would have nowhere to put
 * — and before the root, it is not an SVG document at all.
 */
function takeCharacters(raw: string, open: readonly FigureElement[]): void {
  const parent = open[open.length - 1];
  if (parent === undefined) {
    if (raw.trim() !== '') throw new Error(FIGURE_SVG_ROOT_NOT_SVG);
    return;
  }
  if (!TEXT_ELEMENTS.has(parent.tag)) {
    if (raw.trim() !== '') throw new Error(FIGURE_SVG_TEXT_MISPLACED);
    return;
  }
  parent.children.push({ kind: 'text', value: decodeCharacterData(raw) });
}

/**
 * The four numbers a figure is drawn inside.
 *
 * `viewBox=""` and `viewBox="nonsense"` both satisfy "a viewBox is present"
 * while describing no box at all, and a box with no width or no height has
 * nowhere to put the shape it contains — the figure would occupy its responsive
 * width on the page and draw nothing in it.
 */
function requireViewBox(value: string): void {
  const parts = value
    .split(/[\s,]+/u)
    .filter((part) => part !== '')
    .map((part) => asNumber(part));
  if (parts.length !== 4 || parts.some((part) => part === null)) {
    throw new Error(FIGURE_SVG_VIEWBOX_INVALID);
  }
  if (parts[2]! <= 0 || parts[3]! <= 0) throw new Error(FIGURE_SVG_VIEWBOX_INVALID);
}

/**
 * Whether the figure is a drawing, and the two ways it can fail to be one.
 *
 * **Presence is not ink.** `<circle/>` with no radius, `<rect/>` with no size
 * and `<text></text>` with no characters are all admitted by the allowlist and
 * all draw nothing, so "it holds a drawable element" is the wrong question;
 * "does any element carry the geometry it is drawn from" is the right one.
 *
 * **And words are not a drawing.** A figure whose only ink is `text` is the
 * bracketed prose description this story exists to remove, smuggled back in
 * between angle brackets. It gets its own rejection reason because it is a
 * different mistake from an empty figure and wants a different fix: draw the
 * shape, or leave it in `uninterpretable`.
 */
function requireDrawing(root: FigureElement): void {
  let shapes = 0;
  let labels = 0;
  const count = (element: FigureElement): void => {
    if (SHAPE_ELEMENTS.has(element.tag)) {
      if (shapeDraws(element)) shapes += 1;
    } else if (TEXT_ELEMENTS.has(element.tag) && labelDraws(element)) {
      labels += 1;
    }
    for (const child of element.children) if (child.kind === 'element') count(child);
  };
  count(root);
  if (shapes > 0) return;
  throw new Error(labels > 0 ? FIGURE_SVG_WORDS_ONLY : FIGURE_SVG_NO_DRAWABLE_CONTENT);
}

/** Whether a shape carries the geometry its own tag is drawn from. */
function shapeDraws(element: FigureElement): boolean {
  const { attributes: a } = element;
  switch (element.tag) {
    case 'circle':
      return positive(a.r);
    case 'ellipse':
      // Either radius at zero collapses the ellipse to no area at all — a
      // circle needs one radius, but an ellipse needs both.
      return positive(a.rx) && positive(a.ry);
    case 'rect':
      return positive(a.width) && positive(a.height);
    // Unstated endpoints default to zero; a line only draws when its two
    // endpoints actually differ, the same zero-area rule as the ellipse above.
    case 'line': {
      const x1 = numberOr(a.x1, 0);
      const y1 = numberOr(a.y1, 0);
      const x2 = numberOr(a.x2, 0);
      const y2 = numberOr(a.y2, 0);
      return x1 !== x2 || y1 !== y2;
    }
    case 'polyline':
    case 'polygon':
      return hasDistinctPoints(a.points);
    case 'path':
      // A lone `moveto` (and an optional `closepath` back to the same point)
      // positions a pen without drawing anything; a real path needs one of the
      // commands that actually paints a line or curve — or, lacking any
      // command letter at all, a second coordinate pair, which SVG treats as
      // an implicit lineto from the one before it.
      return a.d !== undefined && pathDraws(a.d);
    default:
      return false;
  }
}

const PATH_DRAW_COMMAND = /[lhvcsqta]/iu;

function pathDraws(d: string): boolean {
  if (PATH_DRAW_COMMAND.test(d)) return true;
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu) ?? [];
  return numbers.length > 2;
}

/** `value` parsed as a number, or `fallback` when it is unstated or unparseable. */
function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = asNumber(value);
  return parsed ?? fallback;
}

/** Whether a `points` list carries at least two distinct coordinate pairs. */
function hasDistinctPoints(points: string | undefined): boolean {
  if (points === undefined) return false;
  const numbers = points
    .split(/[\s,]+/u)
    .filter((part) => part !== '')
    .map((part) => asNumber(part));
  if (numbers.length < 4 || numbers.some((value) => value === null)) return false;
  const first = `${numbers[0]},${numbers[1]}`;
  for (let index = 2; index + 1 < numbers.length; index += 2) {
    if (`${numbers[index]},${numbers[index + 1]}` !== first) return true;
  }
  return false;
}

/** Whether a `text` or `tspan` actually says anything. */
function labelDraws(element: FigureElement): boolean {
  return element.children.some(
    (child) =>
      (child.kind === 'text' && child.value.trim() !== '') ||
      (child.kind === 'element' && labelDraws(child)),
  );
}

/** A stated length that is greater than zero. Values are already numbers here. */
function positive(value: string | undefined): boolean {
  if (value === undefined) return false;
  const number = asNumber(value);
  return number !== null && number > 0;
}

/**
 * The five named references and numeric references, and nothing else.
 *
 * Decoding is what lets the escape check above see what the value actually
 * says; re-escaping on the way out is what keeps the round trip exact. An `&`
 * that does not begin a reference this understands is not well-formed markup,
 * and guessing it was a literal ampersand would be the one guess this module
 * exists to refuse.
 */
function decodeCharacterData(raw: string): string {
  if (!raw.includes('&')) return raw;
  let out = '';
  let cursor = 0;
  for (;;) {
    const amp = raw.indexOf('&', cursor);
    if (amp === -1) return out + raw.slice(cursor);
    out += raw.slice(cursor, amp);
    const semicolon = raw.indexOf(';', amp);
    if (semicolon === -1) throw new Error(FIGURE_SVG_UNPARSEABLE);
    out += resolveReference(raw.slice(amp + 1, semicolon));
    cursor = semicolon + 1;
  }
}

function resolveReference(reference: string): string {
  if (reference === 'amp') return '&';
  if (reference === 'lt') return '<';
  if (reference === 'gt') return '>';
  if (reference === 'quot') return '"';
  if (reference === 'apos') return "'";
  if (!reference.startsWith('#')) throw new Error(FIGURE_SVG_UNPARSEABLE);
  const hex = reference[1] === 'x' || reference[1] === 'X';
  const digits = hex ? reference.slice(2) : reference.slice(1);
  if (digits === '' || !digits.split('').every((digit) => isDigit(digit, hex))) {
    throw new Error(FIGURE_SVG_UNPARSEABLE);
  }
  const code = Number.parseInt(digits, hex ? 16 : 10);
  // A lone surrogate half (`&#55296;`) is not a code point `fromCodePoint`
  // refuses — it would silently produce unpaired UTF-16, corrupting whatever
  // reads the decoded string next.
  if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    throw new Error(FIGURE_SVG_UNPARSEABLE);
  }
  return String.fromCodePoint(code);
}

function isDigit(character: string, hex: boolean): boolean {
  if (character >= '0' && character <= '9') return true;
  if (!hex) return false;
  const lowered = character.toLowerCase();
  return lowered >= 'a' && lowered <= 'f';
}
