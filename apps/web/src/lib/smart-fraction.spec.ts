import { describe, expect, it } from 'vitest';
import { fractionOf } from './smart-fraction';

describe('what the smart fraction field recognises', () => {
  it('reads a bare fraction', () => {
    expect(fractionOf('3/4')).toEqual({ whole: null, numerator: 3, denominator: 4 });
  });

  it('reads a mixed number, whole part and all', () => {
    expect(fractionOf('1 3/4')).toEqual({ whole: 1, numerator: 3, denominator: 4 });
  });

  it('tolerates surrounding whitespace, which is a typing artefact and not an answer', () => {
    expect(fractionOf('  3/4 ')).toEqual({ whole: null, numerator: 3, denominator: 4 });
    expect(fractionOf('\t1 3/4\n')).toEqual({ whole: 1, numerator: 3, denominator: 4 });
  });
});

describe('what it declines to read, without refusing it', () => {
  it('answers null for prose, which is a perfectly good answer to a question', () => {
    expect(fractionOf('one half')).toBeNull();
  });

  it('answers null for a decimal, which is not a fraction and needs no stacking', () => {
    expect(fractionOf('0.5')).toBeNull();
  });

  it('answers null mid-typing rather than guessing at what is coming', () => {
    // A child two keystrokes into `3/4` has typed `3/`, and a field that
    // completed it for them would be answering the question.
    expect(fractionOf('3/')).toBeNull();
    expect(fractionOf('/4')).toBeNull();
  });

  it('answers null for a zero denominator, which no rendering can draw', () => {
    expect(fractionOf('3/0')).toBeNull();
    expect(fractionOf('1 3/0')).toBeNull();
  });

  it('answers null for an empty field', () => {
    expect(fractionOf('')).toBeNull();
    expect(fractionOf('   ')).toBeNull();
  });

  it('answers null for a fraction buried in a sentence, rather than plucking it out', () => {
    // The field renders the *answer*, not a fragment of it: stacking `1/2` out of
    // "about 1/2 of it" would show a typographic form of something the child did
    // not type on its own.
    expect(fractionOf('about 3/4 of it')).toBeNull();
    expect(fractionOf('3/4 cups')).toBeNull();
    expect(fractionOf('1/2/3')).toBeNull();
  });

  it('answers null for a negative or decimal part, which is not read off a paper test', () => {
    expect(fractionOf('-3/4')).toBeNull();
    expect(fractionOf('3.5/4')).toBeNull();
  });
});

describe('what it never does', () => {
  it('never rewrites its input', () => {
    // The raw string is the answer. This function only says whether it *also*
    // has a typographic rendering — it masks nothing, completes nothing and
    // refuses nothing.
    for (const raw of ['3/4', '1 3/4', ' 3/4 ', 'one half', '0.5', '3/', '3/0', '']) {
      const before = raw;
      fractionOf(raw);
      expect(raw).toBe(before);
      expect(typeof fractionOf(raw)).not.toBe('string');
    }
  });
});
