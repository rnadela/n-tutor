import { describe, expect, it } from 'vitest';
import { FAKE_EMBEDDING_DIMENSION, fakeEmbedding } from './fake-embedding.js';
import { TOPIC_SIMILARITY_THRESHOLD } from '../topics/topic-policy.js';
import { cosine } from '../topics/topic-similarity.js';

/**
 * The fake embedding's contract is not "returns numbers" — it is that stage 2 of
 * the AD-11 cascade is *reachable and falsifiable* without a provider. So the
 * assertions here are against the real threshold, imported rather than restated:
 * if the threshold moves, this spec is what says which pairs stopped working.
 */
describe('fakeEmbedding', () => {
  it('is deterministic, unit-length and of one fixed dimension', () => {
    const first = fakeEmbedding('Long Division');
    const second = fakeEmbedding('Long Division');

    expect(first).toEqual(second);
    expect(first).toHaveLength(FAKE_EMBEDDING_DIMENSION);
    const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 10);
    // A vector compared with itself is exactly a match, which is what makes the
    // threshold a floor rather than a ceiling.
    expect(cosine(first, second)).toBeGreaterThanOrEqual(TOPIC_SIMILARITY_THRESHOLD);
  });

  it('ignores case and collapses whitespace, as the match key does', () => {
    expect(fakeEmbedding('Long Division')).toEqual(fakeEmbedding('long   division'));
  });

  it('puts a plural above the similarity threshold', () => {
    // The pair stage 2 exists for: same concept, different key, no provider.
    const score = cosine(fakeEmbedding('Fraction Addition'), fakeEmbedding('Fractions Addition'));
    expect(score).toBeGreaterThanOrEqual(TOPIC_SIMILARITY_THRESHOLD);
  });

  it('keeps two different concepts well below the similarity threshold', () => {
    // Both branches of stage 2 have to be reachable, or the threshold is
    // decorative. `Photosynthesis` shares no trigram at all with `Long Division`;
    // `Fraction Addition` shares a few and still must not match.
    //
    // Asserted against the threshold rather than against exactly zero: two unrelated
    // labels scoring 0 depends on no FNV bucket happening to collide across 512
    // dimensions, which is a property of this hash and this pair rather than of the
    // design. What the cascade needs is that they do not match.
    expect(cosine(fakeEmbedding('Long Division'), fakeEmbedding('Photosynthesis'))).toBeLessThan(
      TOPIC_SIMILARITY_THRESHOLD,
    );
    expect(cosine(fakeEmbedding('Long Division'), fakeEmbedding('Fraction Addition'))).toBeLessThan(
      TOPIC_SIMILARITY_THRESHOLD,
    );
    // Related but not the same, which is a stage-3 question and not a stage-2 one.
    expect(
      cosine(fakeEmbedding('Fraction Word Problems'), fakeEmbedding('Fraction Estimation')),
    ).toBeLessThan(TOPIC_SIMILARITY_THRESHOLD);
  });

  it('answers the zero vector for text with nothing in it', () => {
    // Not a throw: the caller already refuses a blank label, and `cosine` reads a
    // zero vector as "matches nothing", which is the truthful answer here.
    expect(fakeEmbedding('   ')).toEqual(new Array(FAKE_EMBEDDING_DIMENSION).fill(0));
  });
});
