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
