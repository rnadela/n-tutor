import type { RichTextSegment } from './parent-api';

/**
 * The plain rendering of stored rich text, for prefilling an editor.
 *
 * **One direction only, and that is the point.** The browser renders segments
 * as text so a parent can type over them; it never turns text back into
 * segments. That inverse is the server's single answer (AD-32) — if this app
 * held one too, the two would eventually disagree about a fraction in a row
 * neither of them wrote, and the schema's whole reason for keeping
 * `numerator` and `denominator` apart would be lost the first time they drifted.
 *
 * So: prefill with this, send back what was typed, and render what comes back.
 * The view the API answers with is the only account of what is stored.
 *
 * Pure and DOM-free, like `page-order.ts`, because `apps/web` runs its unit
 * tests without a DOM: a rule reachable only through a rendered control is a
 * rule no test can state.
 *
 * A mixed number renders with a space between the whole part and the fraction,
 * which is how it is written on paper; a bare fraction renders as
 * `numerator/denominator`. A figure renders as `[Figure: <alt>]`. All three
 * match the API's `plainTextOf` exactly, which is what makes an untouched save
 * a no-op on the stored segments — and the figure one matters most, because the
 * server's inverse finds each stored figure by that exact token and refuses the
 * edit when one is not there (`figureTokensPreserved` below is the mirror of
 * that refusal).
 */
export function plainTextOf(segments: readonly RichTextSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === 'text') return segment.value;
      if (segment.kind === 'figure') return `[Figure: ${segment.alt}]`;
      const fraction = `${segment.numerator}/${segment.denominator}`;
      return segment.whole === null ? fraction : `${segment.whole} ${fraction}`;
    })
    .join('');
}

/**
 * Whether a field a parent has typed is worth sending at all.
 *
 * A mirror of the server's refusal and deliberately only a mirror: the API
 * refuses an empty field whatever the browser did. It is here so a save control
 * can be disabled rather than firing a request whose only possible answer is a
 * 400 the parent has to read.
 */
export function canSaveField(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Whether the typed text still carries every figure the stored field holds.
 *
 * **A mirror of the server's rule, and only a mirror.** The API refuses an edit
 * that drops a `[Figure: …]` token whatever the browser did; this exists so the
 * save control can be disabled rather than firing a request whose only possible
 * answer is a 400. It is not the enforcement, and nothing here may become the
 * only place the rule is stated.
 *
 * The algorithm is the server's inverse, step for step: each stored figure's
 * exact `[Figure: <alt>]` projection is searched from the end of the previous
 * one, so order is checked as well as presence, and a token whose alternative
 * was altered reads as a token that is gone. Searched as a literal string
 * rather than a pattern, because an alternative may itself contain brackets.
 *
 * A field holding no figure always passes, which is every field in a draft
 * generated from a source test with nothing drawn in it.
 */
export function figureTokensPreserved(segments: readonly RichTextSegment[], text: string): boolean {
  let cursor = 0;
  for (const segment of segments) {
    if (segment.kind !== 'figure') continue;
    const token = `[Figure: ${segment.alt}]`;
    const at = text.indexOf(token, cursor);
    if (at === -1) return false;
    cursor = at + token.length;
  }
  return true;
}
