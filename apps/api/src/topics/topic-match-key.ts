/**
 * Stage 1 of the AD-11 cascade: the one derivation of a Topic's match key.
 *
 * **One function, used for both the lookup and the insert.** The key is a stored
 * column with a unique index on `(subjectId, matchKey)`, so a second spelling of
 * this reduction — one at query time and one at write time — is how two rows
 * that should have collided quietly stop colliding. Every caller goes through
 * here.
 *
 * It is deliberately crude, and that is the design rather than a shortcut: this
 * stage exists to absorb the cheap differences — case, punctuation, spacing,
 * word order, a leading "the" — for free, before anything is embedded and long
 * before a provider is asked. The differences it cannot see (a plural, a
 * synonym, a rephrasing) are precisely what stages 2 and 3 are for. A key
 * clever enough to catch those would be a second matching path with no way to
 * inspect what it decided.
 *
 * Pure, with no Prisma and no Nest, so it is unit-testable by calling it.
 */

/**
 * The stopwords dropped from a key.
 *
 * A short, closed list of English function words, and short on purpose: every
 * word here is one that two labels may differ by without meaning anything
 * different — `Law of Cosines` and `Laws Cosines` should land on one key. Words
 * that carry meaning in a school Topic are never on it, which is why `and` is
 * here but `with` is too and nothing domain-shaped (`of` aside) is: a list long
 * enough to include, say, `area` would be a list that merges two real concepts.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Anything that is not a letter or a digit is a token boundary. */
const NON_TOKEN = /[^\p{L}\p{N}]+/gu;

/**
 * Lowercased, Unicode-normalized, whitespace collapsed and trimmed.
 *
 * **NFC first, and it is not cosmetic.** `Área` written as a precomposed `Á` and
 * `Área` written as `A` followed by a combining acute are the same word to every
 * reader and two different strings to Postgres — so without this they key
 * differently, mint two rows, and split one concept's Mastery history on which
 * keyboard the model's training data happened to use. Labels arrive from a model
 * reading a photograph, so both forms genuinely occur.
 *
 * NFC rather than NFD because it is the composed form, which is what a name column
 * a human eventually reads should hold, and what the rest of the system's text
 * already is.
 */
function normalizeText(label: string): string {
  return label.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Tokens, lowercased, deduped and sorted, joined by single spaces. */
function keyFrom(tokens: readonly string[]): string {
  return [...new Set(tokens)].sort().join(' ');
}

/**
 * The match key for one emitted label.
 *
 * Lowercase, punctuation to spaces, whitespace collapsed, stopwords dropped,
 * tokens deduped and sorted. Sorted because `Addition of Fractions` and
 * `Fraction Addition` differ only in the order a model happened to write two
 * words in, and a key that preserved that order would make word order a
 * distinction the Mastery history splits on.
 *
 * **The fallback chain is what keeps this from ever returning an empty key**, and
 * an empty key is the one thing it must never return: `''` is a perfectly valid
 * value for a unique index, so every label made only of stopwords would collide
 * into one Topic and `the of` would be the same concept as `a to`. So:
 *
 * 1. the stopword-dropped tokens, which is the normal answer;
 * 2. failing that, the tokens *before* stopwords were dropped — `the of` keys as
 *    `of the`, which is a bad Topic but an honest one;
 * 3. failing that — a label with no letters or digits at all, such as `???` —
 *    the normalized text itself, lowercased with its whitespace collapsed.
 *
 * A blank label never reaches here: `TopicService.normalize` refuses it before
 * any of this, because a Topic with no name is not a key problem.
 */
export function topicMatchKey(label: string): string {
  const normalized = normalizeText(label);
  const tokens = normalized.split(NON_TOKEN).filter((token) => token !== '');
  const meaningful = tokens.filter((token) => !STOPWORDS.has(token));

  if (meaningful.length > 0) return keyFrom(meaningful);
  if (tokens.length > 0) return keyFrom(tokens);
  return normalized;
}

/**
 * The meaningful tokens of a label, in the order they were written.
 *
 * Exported for the `fake` transport's stage-3 answer, which decides whether a
 * candidate is plausible by whether it shares a token with the label. It is the
 * same reduction the key is built from rather than a second one, so the fake
 * cannot drift into thinking two labels are related on a definition of "token"
 * nothing else uses. Nothing in the cascade itself reads it.
 */
export function topicTokens(label: string): string[] {
  const tokens = normalizeText(label)
    .split(NON_TOKEN)
    .filter((token) => token !== '');
  const meaningful = tokens.filter((token) => !STOPWORDS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}
