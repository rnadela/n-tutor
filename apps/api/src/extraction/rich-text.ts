import { z } from 'zod';
import { sanitizeFigureSvg } from './svg-figure.js';

/**
 * The one mechanism every text-bearing field in an Extraction uses (AD-32,
 * UX-DR8).
 *
 * A fraction read off a page is carried as structure, never as `"1/2"`: a
 * question prompt, a choice and a passage all need it, and a plain string
 * throws away the only reading of "one half" a spoken alternative could
 * recover. One segment array, one Zod parser, one plain rendering — so no call
 * site ever decides for itself how a fraction is stored.
 *
 * **The Zod schema below is also a wire contract.** `zodTextFormat` turns it
 * into the JSON schema the Responses API is given, and strict Structured
 * Outputs supports a deliberately small subset: every property must be
 * `required` (`nullable` is how "may be absent" is expressed), and `minItems`,
 * `maxLength` and `refine` are not expressible at all. So the *shape* lives
 * here and every *constraint* — a non-empty array, a non-zero denominator —
 * lives in `isRichText`, which the post-hoc pass runs on every field (AD-30).
 * A constraint stated in the schema and silently dropped on the wire would be
 * a rule nothing enforces.
 */

/** A run of ordinary text. */
export const TextSegment = z.object({
  kind: z.literal('text'),
  value: z.string(),
});

/**
 * A fraction, with the whole part a mixed number carries. Every part is an
 * integer: a fraction whose numerator is itself a decimal is not something read
 * off a paper test, it is a parse that went wrong.
 *
 * `whole` is `nullable` and **required**, never optional: a bare fraction says
 * `whole: null`. That is the only way "may be absent" survives strict
 * Structured Outputs, and it keeps one spelling of an absent whole part rather
 * than two.
 */
export const FractionSegment = z.object({
  kind: z.literal('fraction'),
  whole: z.number().int().nullable(),
  numerator: z.number().int(),
  denominator: z.number().int(),
});

/**
 * A printed shape or diagram a question needs, as drawing plus one reading.
 *
 * The same argument as `FractionSegment`, one step further: a half-circle
 * photographed on a page cannot be recovered from the sentence
 * `"[A half-circle figure is shown.]"`, and in early-grade Math the figure *is*
 * the question. So the drawing travels as SVG and the reading travels beside
 * it.
 *
 * Both fields are plain required strings, because that is all strict Structured
 * Outputs expresses. The two constraints that matter — `alt` is not blank, and
 * `svg` is something the sanitizer admits — live in `parseRichText`, and `svg`
 * is **replaced** there by the sanitizer's own output: what is stored is never
 * what was received.
 *
 * `alt` is required rather than nullable because it is the figure's only spoken
 * form and the only form `plainTextOf` can project, which is what keeps
 * grading, dedupe, explanation and topic prompts working on text alone.
 */
export const FigureSegment = z.object({
  kind: z.literal('figure'),
  svg: z.string(),
  alt: z.string(),
});

export type FigureSegment = z.infer<typeof FigureSegment>;

export const RichTextSegment = z.discriminatedUnion('kind', [
  TextSegment,
  FractionSegment,
  FigureSegment,
]);

/** The shape. The constraints are `isRichText`'s; see the note above. */
export const RichText = z.array(RichTextSegment);

/**
 * The same primitive with figures withheld: what a *narrowed* generated field
 * may be.
 *
 * Since Story 4.8 a generated question prompt and a Multiple Choice option body
 * carry the full `RichText`: the generation prompt shows the model each source
 * figure and asks it to draw new ones, and `practice-test-payload.ts` bounds and
 * sanitizes what comes back exactly as extraction does.
 *
 * Two places stay narrowed, and both for a reason that is not caution:
 *
 * - A generated `answer`. Grading compares `plainTextOf` strings, so an answer
 *   whose only content is a drawing is an answer nothing can be graded against.
 * - The explanation schema and its prompt. An explanation is text; a figure
 *   reaches that model as its `[Figure: <alt>]` projection, which is all a
 *   sentence about a shape needs.
 *
 * It is a narrowing of the wire only. Those paths still normalize through
 * `parseRichText` on the way into storage, so the sanitizing does not depend on
 * the narrowing — defence in depth, not a substitute for it.
 */
export const GeneratedRichText = z.array(
  z.discriminatedUnion('kind', [TextSegment, FractionSegment]),
);

export type GeneratedRichText = z.infer<typeof GeneratedRichText>;

export type RichTextSegment = z.infer<typeof RichTextSegment>;
export type RichText = z.infer<typeof RichText>;

/** What a rich-text field may not be, beyond its shape. */
export const RICH_TEXT_EMPTY = 'A text field holds no segments.';
export const RICH_TEXT_ZERO_DENOMINATOR = 'A fraction denominator cannot be zero.';
export const RICH_TEXT_FIGURE_ALT_EMPTY = 'A figure carries no text alternative.';
export const RICH_TEXT_FIGURE_ALT_INVALID =
  'A figure text alternative holds characters that cannot be spoken.';
/**
 * An edit did not restate a figure the field already holds.
 *
 * The same shape of rule as `CHOICES_MISMATCHED`: an edit either restates what
 * is there or it is not an edit of it. Naming the token rather than the figure
 * is deliberate — the token is the only thing the parent can see.
 */
export const RICH_TEXT_FIGURE_MISSING =
  'An edit must keep every [Figure: …] text written as it is, in the order they are stored in, for its picture to stay.';

/**
 * The parse every stored rich-text field goes through, wherever it came from:
 * the shape, then the constraints the wire schema cannot carry.
 *
 * An empty array is not "no text" — it is a field the model declined to fill
 * while claiming to have filled it, and storing it would produce a question
 * with no prompt. A zero denominator is arithmetic nonsense that renders as a
 * division by zero wherever it is finally shown. A figure with no text
 * alternative is a drawing with no spoken form, which no projection can carry.
 *
 * **This is a normalizer, not only a validator**, and that is deliberate. Every
 * figure's `svg` is replaced by `sanitizeFigureSvg`'s output here, because this
 * is the one function every stored rich-text field already passes through from
 * every source — extraction now, generation and edit later. Put anywhere else,
 * "sanitized from any source" would be three call sites remembering; put here,
 * it is true by construction. The cost is that a caller must **store what this
 * returns**: one that keeps the old guard-then-store shape would persist the
 * SVG it was handed.
 */
export function parseRichText(value: unknown): RichText {
  const rich = RichText.parse(value);
  if (rich.length === 0) throw new Error(RICH_TEXT_EMPTY);
  let hasContent = false;
  const normalized = rich.map((segment): RichTextSegment => {
    if (segment.kind === 'fraction') {
      if (segment.denominator === 0) throw new Error(RICH_TEXT_ZERO_DENOMINATOR);
      hasContent = true;
      return segment;
    }
    if (segment.kind === 'figure') {
      // Trimmed because the alt is read out loud and written into
      // `[Figure: …]`: leading space or a newline in it would reach an
      // `aria-label` and a grading prompt as the whitespace it is. A control
      // character cannot be spoken at all, so it is a rejection rather than
      // something to strip — stripping would store a different alternative from
      // the one the model wrote without saying so.
      const alt = segment.alt.trim();
      if (alt === '') throw new Error(RICH_TEXT_FIGURE_ALT_EMPTY);
      if (hasControlCharacter(alt)) throw new Error(RICH_TEXT_FIGURE_ALT_INVALID);
      // A figure is content: a field holding one figure and no text is a
      // question that asks about a shape, not an unfilled field.
      hasContent = true;
      return { ...segment, alt, svg: sanitizeFigureSvg(segment.svg) };
    }
    if (segment.value.trim() !== '') hasContent = true;
    return segment;
  });
  // Segments that are all present but all blank are the same "declined to
  // fill it" case an empty array is — just spelled with whitespace instead.
  if (!hasContent) throw new Error(RICH_TEXT_EMPTY);
  return normalized;
}

/**
 * Anything a screen reader could not say, or could say deceptively: C0, DEL,
 * the C1 range, and the zero-width/bidi-control characters that can make an
 * `alt` read or display differently from how it is stored (BOM, ZWSP/ZWNJ/ZWJ,
 * LRM/RLM, the embedding/override and isolate controls).
 */
function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

/** The same check, without throwing — for the post-hoc validation pass. */
export function isRichText(value: unknown): value is RichText {
  try {
    parseRichText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A plain rendering, one call away and never the stored form.
 *
 * A mixed number renders with a space between the whole part and the fraction,
 * which is how it is written on paper; a bare fraction renders as
 * `numerator/denominator`.
 *
 * A figure renders as `[Figure: <alt>]`, byte-identically to the browser's
 * `plainTextOf`. Grading, dedupe, the explanation prompt and the topic prompts
 * all work on this string alone, so a figure that projected to nothing would
 * quietly turn "what shape is this?" into "what shape is?".
 */
export function plainTextOf(rich: RichText): string {
  return rich
    .map((segment) => {
      if (segment.kind === 'text') return segment.value;
      if (segment.kind === 'figure') return `[Figure: ${segment.alt}]`;
      const fraction = `${segment.numerator}/${segment.denominator}`;
      return segment.whole === null ? fraction : `${segment.whole} ${fraction}`;
    })
    .join('');
}

/**
 * The fraction `plainTextOf` writes: `n/d`, or `w n/d` for a mixed number.
 *
 * The lookbehind and lookahead are what keep it from reading half of something
 * else: a slash on either side (`1/2/3`) is a date or a path, not a fraction,
 * and a word character before the whole part would make "page3 1/2" claim a
 * whole part that belongs to the word.
 */
const PLAIN_FRACTION = /(?<![\w/])(?:(\d+) )?(\d+)\/(\d+)(?![\d/])/gu;

/** Whether a captured run of digits is a number this can honestly carry. */
function wholeNumber(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * The exact inverse of `plainTextOf`, and the **only** place plain text becomes
 * segments (AD-32).
 *
 * A parent edits text; the schema stores structure. Without one shared inverse
 * every call site would invent its own, and a fraction typed into an edit would
 * silently become the glyph string the schema exists to keep apart — one story
 * after generation went to the trouble of keeping it as `numerator` and
 * `denominator`. So the browser sends what was typed, this converts it once,
 * and the stored segments are the only account of what a Question is.
 *
 * Losslessness is the point of writing it as the inverse rather than as a
 * parser of its own: prefill an editor with `plainTextOf(stored)`, save it back
 * untouched, and the fractions come out identical.
 *
 * Two costs, documented rather than defended away:
 *
 * - `24/7` in prose becomes a fraction. It renders as `24/7` either way; only
 *   its spoken reading differs, and that is a better failure than storing every
 *   parent-edited fraction as a glyph.
 * - A part too large to be a safe integer is left as the text it was typed as,
 *   because storing it would store a number that is not the one written.
 * - **A `[Figure: …]` a parent types themselves stays text, by design.** The
 *   figures handed in are the ones already stored on the field being edited;
 *   nothing else can become a drawing, because the editor is not an authoring
 *   surface for figures (Story 4.8). So a parent who types the token into a
 *   field that holds no figure gets the literal text they typed, which is the
 *   only honest reading of it.
 * - Adjacent runs of text collapse into one text segment, and a number sitting
 *   immediately before a fraction is read as its whole part. Neither changes
 *   what is written; both are consequences of plain text being the thing a
 *   parent can actually type.
 *
 * The result goes through `parseRichText`, so an empty field and a zero
 * denominator are refused here exactly as they are refused on a generated one.
 *
 * **Figures are grafted, not re-parsed.** `figures` is the stored field's own
 * figure segments, in stored order. The typed text is split on each one's exact
 * `[Figure: <alt>]` projection — the literal string `plainTextOf` wrote, not a
 * pattern, because an `alt` may itself contain brackets — and each stored
 * segment is interleaved back **unchanged**, so "the figure is kept as it was"
 * is literally true rather than reconstructed. Each token is searched from the
 * end of the previous one, which is what makes stored order an enforced order
 * rather than a coincidence; a token that is absent, reordered or altered
 * throws `RICH_TEXT_FIGURE_MISSING` and the whole edit is refused. Putting the
 * drawing back where the parent deleted it was the alternative, and it would
 * store a field that differs from the field they saved.
 */
export function richTextFromPlainText(
  text: string,
  figures: readonly FigureSegment[] = [],
): RichText {
  const segments: RichTextSegment[] = [];
  let cursor = 0;
  for (const figure of figures) {
    const token = `[Figure: ${figure.alt}]`;
    const at = text.indexOf(token, cursor);
    if (at === -1) throw new Error(RICH_TEXT_FIGURE_MISSING);
    segments.push(...textAndFractions(text.slice(cursor, at)));
    segments.push(figure);
    cursor = at + token.length;
  }
  segments.push(...textAndFractions(text.slice(cursor)));
  return parseRichText(segments);
}

/** One run of typed text as text and fraction segments, unvalidated. */
function textAndFractions(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  let taken = 0;
  for (const match of text.matchAll(PLAIN_FRACTION)) {
    const numerator = wholeNumber(match[2]!);
    const denominator = wholeNumber(match[3]!);
    // A numerator or denominator too large to be an integer is not a fraction
    // this can carry, so the whole span stays the text it was written as.
    // `taken` is deliberately not advanced: the span is still owed to the text
    // segment that follows.
    if (numerator === null || denominator === null) continue;

    const whole = match[1] === undefined ? null : wholeNumber(match[1]);
    // An unsafe whole part does not take the fraction down with it. The digits
    // stay the text they were typed as and the bare `n/d` beside them is still
    // a fraction — skipping the span outright would lose the fraction for
    // good, because `matchAll` has already consumed it and it can never match
    // again.
    const start =
      match[1] !== undefined && whole === null
        ? // Past the whole part and the single space the pattern requires.
          match.index + match[1].length + 1
        : match.index;

    if (start > taken) segments.push({ kind: 'text', value: text.slice(taken, start) });
    segments.push({ kind: 'fraction', whole, numerator, denominator });
    taken = match.index + match[0].length;
  }
  if (taken < text.length) segments.push({ kind: 'text', value: text.slice(taken) });
  return segments;
}
