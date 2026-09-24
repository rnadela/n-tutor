import { describe, expect, it } from 'vitest';
import { isRichText, parseRichText, plainTextOf } from './rich-text.js';

describe('parsing', () => {
  it('takes a run of plain text', () => {
    expect(parseRichText([{ kind: 'text', value: 'What is the answer?' }])).toEqual([
      { kind: 'text', value: 'What is the answer?' },
    ]);
  });

  it('takes a fraction as structure', () => {
    const rich = parseRichText([{ kind: 'fraction', whole: null, numerator: 3, denominator: 4 }]);
    expect(rich[0]).toMatchObject({ kind: 'fraction', numerator: 3, denominator: 4 });
  });

  it('refuses a fraction with no whole part stated at all', () => {
    // `whole` is nullable and required, never optional: strict Structured
    // Outputs has no other way to express "may be absent", and two spellings of
    // an absent whole part is how a renderer ends up with a special case.
    expect(() => parseRichText([{ kind: 'fraction', numerator: 3, denominator: 4 }])).toThrow();
  });

  it('takes a mixed number', () => {
    expect(() =>
      parseRichText([{ kind: 'fraction', whole: 2, numerator: 1, denominator: 3 }]),
    ).not.toThrow();
  });

  it('refuses a denominator of zero', () => {
    expect(() =>
      parseRichText([{ kind: 'fraction', whole: null, numerator: 1, denominator: 0 }]),
    ).toThrow();
  });

  it('refuses a fraction whose parts are not whole numbers', () => {
    expect(() =>
      parseRichText([{ kind: 'fraction', whole: null, numerator: 1.5, denominator: 2 }]),
    ).toThrow();
  });

  it('refuses an empty array, which is a field claimed and not filled', () => {
    expect(() => parseRichText([])).toThrow();
  });

  it('refuses a plain string, which is the shape AD-32 exists to prevent', () => {
    expect(isRichText('1/2')).toBe(false);
    expect(isRichText([{ kind: 'latex', value: '\\frac{1}{2}' }])).toBe(false);
  });
});

describe('plain rendering', () => {
  it('joins segments without inventing separators', () => {
    expect(
      plainTextOf([
        { kind: 'text', value: 'What is ' },
        { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
        { kind: 'text', value: ' of 8?' },
      ]),
    ).toBe('What is 1/2 of 8?');
  });

  it('writes a mixed number the way it is written on paper', () => {
    expect(plainTextOf([{ kind: 'fraction', whole: 2, numerator: 1, denominator: 4 }])).toBe(
      '2 1/4',
    );
  });

  it('treats a null whole part as no whole part', () => {
    expect(plainTextOf([{ kind: 'fraction', whole: null, numerator: 1, denominator: 4 }])).toBe(
      '1/4',
    );
  });
});
