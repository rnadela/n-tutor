/**
 * Stage 2 of the AD-11 cascade: cosine similarity, in application code.
 *
 * **In TypeScript rather than in the database, deliberately.** A Subject's
 * canonical set is tens of rows, and a dot product over tens of short arrays is
 * arithmetic a CPU does between two other things. A database vector extension would buy an index
 * this does not need, at the price of an extension every database this deploys
 * to must then carry forever — and of a threshold that lives in SQL where no
 * unit spec can reach it.
 *
 * Pure, with no Prisma and no Nest. The vectors arrive as plain `number[]`
 * because that is what a `Json` column gives back.
 */

/** One candidate as stage 2 compares it: an id and the vector cached for it. */
export interface TopicCandidateVector {
  id: string;
  embedding: readonly number[];
}

/** The best candidate found, and how close it was. */
export interface TopicSimilarityMatch {
  id: string;
  score: number;
}

/**
 * The cosine of two vectors, or `0` when the question is meaningless.
 *
 * Zero rather than `null` or a throw for all three degenerate cases — a
 * dimension mismatch, a zero-magnitude vector, a non-finite component — because
 * every one of them means the same thing to the only caller: *this candidate is
 * not the answer*. A mismatch is a vector cached under a different embedding
 * snapshot that slipped past the model filter; a zero vector is text that
 * embedded to nothing; a `NaN` is a corrupted `Json` column. None of them is a
 * reason to fail a normalize that has a perfectly good stage 3 behind it, and
 * none of them is a match either.
 *
 * Both vectors are already unit-length in practice, but the magnitudes are
 * divided out anyway: a function called `cosine` that silently required unit
 * input would be a trap for whoever caches the next kind of vector.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    dot += left * right;
    aSquared += left * left;
    bSquared += right * right;
  }
  if (aSquared === 0 || bSquared === 0) return 0;

  const score = dot / Math.sqrt(aSquared * bSquared);
  return Number.isFinite(score) ? score : 0;
}

/**
 * The closest candidate at or above the threshold, or `null`.
 *
 * `null` is not a failure: it is stage 2 declining to answer, which is what
 * hands the question to stage 3. Only stage 3 may conclude that nothing fits.
 *
 * **Strictly greater wins a tie**, so the first candidate in the order given
 * keeps it. The caller reads its candidates in a stable order, which makes the
 * whole of stage 2 deterministic — two identical normalizes of the same label
 * against the same set cannot answer differently depending on how Postgres felt
 * about the row order.
 */
export function bestTopicMatch(
  target: readonly number[],
  candidates: readonly TopicCandidateVector[],
  threshold: number,
): TopicSimilarityMatch | null {
  let best: TopicSimilarityMatch | null = null;
  for (const candidate of candidates) {
    const score = cosine(target, candidate.embedding);
    if (score < threshold) continue;
    if (best === null || score > best.score) best = { id: candidate.id, score };
  }
  return best;
}
