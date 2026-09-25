/**
 * What a child typed, read as a fraction — or not read as one at all.
 *
 * The smart fraction field's whole rule, and deliberately pure and DOM-free:
 * `apps/web` runs its unit tests without a DOM, so a rule reachable only through
 * a rendered control is a rule no test can state.
 *
 * **It never rewrites its input.** The raw string is the answer — it is what the
 * `<input>` holds, what assistive technology announces and what a later story
 * submits. This function only says whether that string *also* has a typographic
 * rendering worth drawing beside it. Nothing here masks, reformats, completes or
 * refuses anything a child typed.
 */
export interface ParsedFraction {
  /** The whole part of a mixed number, or `null` for a bare fraction. */
  whole: number | null;
  numerator: number;
  denominator: number;
}

/**
 * `3/4` and `1 3/4`, and nothing else.
 *
 * Surrounding whitespace is tolerated because it is a typing artefact rather
 * than a different answer; everything else answers `null`, which is the
 * specified degradation to plain text: `one half`, `0.5`, `3/`, `3/0`, an empty
 * string and any sentence with a fraction buried in it all render no sibling and
 * leave the input untouched.
 *
 * A zero denominator is `null` too. It is arithmetic nonsense that no rendering
 * can draw, and the child is told nothing about it — they simply see no stacked
 * form, exactly as they would for prose.
 */
const BARE_OR_MIXED = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/u;

export function fractionOf(raw: string): ParsedFraction | null {
  const match = BARE_OR_MIXED.exec(raw.trim());
  if (match === null) return null;
  const [, whole, numerator, denominator] = match;
  const wholeValue = whole === undefined ? null : Number(whole);
  const numeratorValue = Number(numerator);
  const denominatorValue = Number(denominator);
  if (denominatorValue === 0) return null;
  // A digit string long enough to overflow `Number()` to `Infinity` is still a
  // regex match, but it has no stacked form worth drawing — the same
  // degradation to plain text as any other unparseable answer.
  if (
    (wholeValue !== null && !Number.isSafeInteger(wholeValue)) ||
    !Number.isSafeInteger(numeratorValue) ||
    !Number.isSafeInteger(denominatorValue)
  ) {
    return null;
  }
  return { whole: wholeValue, numerator: numeratorValue, denominator: denominatorValue };
}
