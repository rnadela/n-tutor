import { describe, expect, it } from 'vitest';
import { topicMatchKey, topicTokens } from './topic-match-key.js';

describe('topicMatchKey', () => {
  it('absorbs case, punctuation and spacing', () => {
    // The row the matrix names: `Long Division` is stored under `division long`,
    // and `long  DIVISION!` has to find it with no provider call at all.
    expect(topicMatchKey('Long Division')).toBe('division long');
    expect(topicMatchKey('long  DIVISION!')).toBe('division long');
    expect(topicMatchKey('  Long-Division  ')).toBe('division long');
  });

  it('sorts tokens, so word order is not a distinction', () => {
    // A model that writes the same concept two ways round must not split the
    // Mastery history on which way it chose.
    expect(topicMatchKey('Addition of Fractions')).toBe(topicMatchKey('Fractions Addition'));
    expect(topicMatchKey('Addition of Fractions')).toBe('addition fractions');
  });

  it('dedupes repeated tokens', () => {
    expect(topicMatchKey('Fractions and fractions')).toBe('fractions');
  });

  it('drops stopwords but keeps every word that carries meaning', () => {
    expect(topicMatchKey('The Area of a Circle')).toBe('area circle');
    // A plural is deliberately *not* absorbed: that is stage 2's job, and a key
    // clever enough to stem would be a second matching path nobody can inspect.
    expect(topicMatchKey('Fraction Addition')).not.toBe(topicMatchKey('Fractions Addition'));
  });

  it('falls back rather than ever answering an empty key', () => {
    // An empty key is a perfectly valid value for a unique index, so every
    // all-stopword label would collide into one Topic. `the of` keys as the
    // tokens it actually has — a bad Topic, but an honest one.
    expect(topicMatchKey('the of')).toBe('of the');
    // Nothing alphanumeric at all: the normalized text itself.
    expect(topicMatchKey('???')).toBe('???');
    expect(topicMatchKey('the of')).not.toBe('');
    expect(topicMatchKey('a to')).not.toBe(topicMatchKey('the of'));
  });

  it('keeps digits and non-Latin letters as tokens', () => {
    expect(topicMatchKey('Times Tables (2-5)')).toBe('2 5 tables times');
    expect(topicMatchKey('Área')).toBe('área');
  });
});

describe('topicTokens', () => {
  it('reads the meaningful tokens in written order', () => {
    expect(topicTokens('The Area of a Circle')).toEqual(['area', 'circle']);
  });

  it('falls back to every token when all of them are stopwords', () => {
    expect(topicTokens('the of')).toEqual(['the', 'of']);
  });

  it('is what the fake stage-3 answer tells a plausible candidate by', () => {
    // The pair the integration spec drives stage 3's match branch with: they share
    // `fraction` and nothing else, and they score well below the stage-2 threshold.
    const label = new Set(topicTokens('Fraction Estimation'));
    expect(topicTokens('Fraction Word Problems').some((token) => label.has(token))).toBe(true);
    // And the pair it drives the mint branch with: no overlap at all.
    expect(topicTokens('Long Division').some((token) => label.has(token))).toBe(false);
  });
});

describe('topicMatchKey and Unicode', () => {
  it('keys the precomposed and decomposed spellings of one word identically', () => {
    // `Área` with a precomposed `Á`, and `Área` with an `A` and a combining acute.
    // One word to every reader, two byte strings to Postgres — so without NFC they
    // key differently, mint two rows, and split one concept's Mastery history on
    // which form the model's training data happened to use.
    const composed = 'Área';
    const decomposed = 'Área';
    expect(composed).not.toBe(decomposed);
    expect(topicMatchKey(composed)).toBe(topicMatchKey(decomposed));
    expect(topicTokens(composed)).toEqual(topicTokens(decomposed));
  });

  it('normalizes a decomposed label inside a longer phrase', () => {
    expect(topicMatchKey('The Área of a Circle')).toBe(topicMatchKey('Área Circle'));
  });
});
