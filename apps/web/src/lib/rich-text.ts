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
 * `numerator/denominator`. Both match the API's `plainTextOf` exactly, which is
 * what makes an untouched save a no-op on the stored segments.
 */
export function plainTextOf(segments: readonly RichTextSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === 'text') return segment.value;
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
