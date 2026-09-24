import { z } from 'zod';

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

export const RichTextSegment = z.discriminatedUnion('kind', [TextSegment, FractionSegment]);

/** The shape. The constraints are `isRichText`'s; see the note above. */
export const RichText = z.array(RichTextSegment);

export type RichTextSegment = z.infer<typeof RichTextSegment>;
export type RichText = z.infer<typeof RichText>;

/** What a rich-text field may not be, beyond its shape. */
export const RICH_TEXT_EMPTY = 'A text field holds no segments.';
export const RICH_TEXT_ZERO_DENOMINATOR = 'A fraction denominator cannot be zero.';

/**
 * The parse every stored rich-text field goes through, wherever it came from:
 * the shape, then the two constraints the wire schema cannot carry.
 *
 * An empty array is not "no text" — it is a field the model declined to fill
 * while claiming to have filled it, and storing it would produce a question
 * with no prompt. A zero denominator is arithmetic nonsense that renders as a
 * division by zero wherever it is finally shown.
 */
export function parseRichText(value: unknown): RichText {
  const rich = RichText.parse(value);
  if (rich.length === 0) throw new Error(RICH_TEXT_EMPTY);
  let hasContent = false;
  for (const segment of rich) {
    if (segment.kind === 'fraction' && segment.denominator === 0) {
      throw new Error(RICH_TEXT_ZERO_DENOMINATOR);
    }
    if (segment.kind === 'fraction' || segment.value.trim() !== '') hasContent = true;
  }
  // Segments that are all present but all blank are the same "declined to
  // fill it" case an empty array is — just spelled with whitespace instead.
  if (!hasContent) throw new Error(RICH_TEXT_EMPTY);
  return rich;
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
 */
export function plainTextOf(rich: RichText): string {
  return rich
    .map((segment) => {
      if (segment.kind === 'text') return segment.value;
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
 * - Adjacent runs of text collapse into one text segment, and a number sitting
 *   immediately before a fraction is read as its whole part. Neither changes
 *   what is written; both are consequences of plain text being the thing a
 *   parent can actually type.
 *
 * The result goes through `parseRichText`, so an empty field and a zero
 * denominator are refused here exactly as they are refused on a generated one.
 */
export function richTextFromPlainText(text: string): RichText {
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
  return parseRichText(segments);
}
