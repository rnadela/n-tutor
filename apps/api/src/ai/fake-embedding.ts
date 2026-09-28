/**
 * The `fake` transport's embedding (AD-22).
 *
 * **It has to make similar labels genuinely similar**, which is the whole
 * reason it is not a hash of the string. Stage 2 of the AD-11 cascade is a
 * cosine against a threshold, and a fake that returned an arbitrary vector
 * would make that stage either always miss or always hit — in both cases
 * untestable without a provider, which is exactly what the `fake` transport
 * exists to avoid.
 *
 * **Character trigrams rather than a bag of words.** A word-level fake scores
 * `fraction addition` against `fractions addition` at about a half, because the
 * plural is simply a different word: stage 2 would then be unreachable for the
 * near-duplicate spellings it exists to catch. Trigrams share almost every
 * window across a plural, so that pair lands around 0.89 — above the threshold —
 * while `long division` against `fraction addition` lands around 0.24, well
 * below it. Both branches are therefore reachable with no provider and no
 * fixture full of hand-written numbers.
 *
 * It is deterministic, unit-length and of one fixed dimension, because those are
 * the three properties the real thing has that the cascade actually relies on:
 * the same label embeds to the same vector (so an idempotent repeat is
 * idempotent), the cosine is a plain dot product, and a cached vector from a
 * previous call is comparable with a fresh one.
 *
 * This lives in `ai` rather than in `topics` because it is a property of the
 * transport, not of what is being embedded: `topics` asks for an embedding and
 * must not know which transport answered.
 */

/**
 * The fake's dimension. Smaller than any real embedding on purpose — these
 * vectors are written into a `Json` column in integration tests, and 512 floats
 * is already far more room than a few dozen trigrams need to avoid collisions
 * that would perturb a cosine.
 */
export const FAKE_EMBEDDING_DIMENSION = 512;

/** The character the text is padded with, so a first and last trigram exist. */
const PAD = ' ';

/** The trigram window. Three, which is what makes a plural a near-duplicate. */
const GRAM = 3;

/**
 * FNV-1a, 32-bit, as the bucket function.
 *
 * A named arithmetic rather than a crypto hash: the only properties needed are
 * that it spreads short strings evenly and that it is the same on every machine
 * and every Node version. `Math.imul` keeps the multiply in 32 bits, and the
 * `>>> 0` makes the result unsigned before it is taken modulo the dimension.
 */
function bucketOf(gram: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < gram.length; index += 1) {
    hash ^= gram.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % FAKE_EMBEDDING_DIMENSION;
}

/**
 * A deterministic unit-length vector for one piece of text.
 *
 * The text is lowercased and its whitespace collapsed first, so that
 * `long  DIVISION!` and `long division!` embed identically — the same
 * insensitivity `topicMatchKey` has, for the same reason. Punctuation is
 * **kept**, unlike in the match key: it is a real difference between two
 * spellings, and a fake that erased it would hide a difference the real
 * embedding would see.
 *
 * Text with no trigrams at all — empty after collapsing — returns the zero
 * vector rather than throwing. `cosine` already answers zero for a zero vector,
 * so the cascade treats it as "matches nothing", which is the truthful answer;
 * refusing here would put a second gate on blank input beside the one the
 * caller already has.
 */
export function fakeEmbedding(text: string): number[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const vector = new Array<number>(FAKE_EMBEDDING_DIMENSION).fill(0);
  if (normalized === '') return vector;

  const padded = `${PAD}${normalized}${PAD}`;
  for (let index = 0; index + GRAM <= padded.length; index += 1) {
    vector[bucketOf(padded.slice(index, index + GRAM))]! += 1;
  }

  // Unit length, so every cosine downstream is a plain dot product and a long
  // label is not "bigger" than a short one — length is not similarity.
  let sumOfSquares = 0;
  for (const component of vector) sumOfSquares += component * component;
  const magnitude = Math.sqrt(sumOfSquares);
  if (magnitude === 0) return vector;
  return vector.map((component) => component / magnitude);
}
