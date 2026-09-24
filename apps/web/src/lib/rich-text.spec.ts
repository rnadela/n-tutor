import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSaveField, plainTextOf } from './rich-text';
import { plainTextOf as apiPlainTextOf } from '../../../api/src/extraction/rich-text';
import type { RichTextSegment } from './parent-api';

/**
 * Every shape a stored rich-text field can hold, and the one plain string both
 * renderings must produce for it.
 *
 * One table checked against both sides, so the two are pinned to each other by
 * behaviour rather than by either one's source text.
 */
const PLAIN_RENDERINGS: [RichTextSegment[], string][] = [
  [[{ kind: 'text', value: 'Half of four is two.' }], 'Half of four is two.'],
  [[{ kind: 'fraction', whole: null, numerator: 1, denominator: 2 }], '1/2'],
  [[{ kind: 'fraction', whole: 2, numerator: 1, denominator: 4 }], '2 1/4'],
  [[{ kind: 'fraction', whole: 0, numerator: 3, denominator: 8 }], '0 3/8'],
  [
    [
      { kind: 'text', value: 'What is ' },
      { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
      { kind: 'text', value: ' of 8?' },
    ],
    'What is 1/2 of 8?',
  ],
  [
    [
      { kind: 'text', value: 'Add ' },
      { kind: 'fraction', whole: 1, numerator: 1, denominator: 8 },
      { kind: 'text', value: ' to ' },
      { kind: 'fraction', whole: null, numerator: 3, denominator: 8 },
      { kind: 'text', value: '.' },
    ],
    'Add 1 1/8 to 3/8.',
  ],
  [[], ''],
];

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'rich-text.ts'), 'utf8');

describe('the plain rendering an editor is prefilled from', () => {
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

  it('renders an empty segment list as an empty field rather than throwing', () => {
    // A field with nothing in it is a state the editor shows; refusing it is
    // the server's job, and it does refuse it.
    expect(plainTextOf([])).toBe('');
  });

  it('agrees with the API rendering on every shape a stored field can hold', () => {
    // The agreement is on *outputs*, not on a line of the API's source: a
    // prettier reflow or an equivalent refactor over there must not break a web
    // test that has nothing to say about either.
    //
    // It matters because the API's `richTextFromPlainText` is the exact inverse
    // of *its* `plainTextOf`. If this one rendered a mixed number differently,
    // opening an editor and saving without typing would silently rewrite the
    // stored segments.
    for (const [segments, expected] of PLAIN_RENDERINGS) {
      expect(plainTextOf(segments)).toBe(expected);
      expect(apiPlainTextOf(segments)).toBe(expected);
    }
  });
});

describe('what the save control is allowed to offer', () => {
  it('refuses an empty or whitespace-only field', () => {
    expect(canSaveField('')).toBe(false);
    expect(canSaveField('   ')).toBe(false);
    expect(canSaveField('Four')).toBe(true);
  });
});

describe('the direction this module runs in', () => {
  it('never turns text back into segments — that inverse is the server one', () => {
    // A second answer to "what is a fraction" in the browser is how the two
    // come to disagree about a row neither of them wrote (AD-32).
    expect(SOURCE).not.toContain('numerator:');
    expect(SOURCE).not.toContain('richTextFromPlainText');
    expect(SOURCE).not.toContain('split(');
    expect(SOURCE).not.toContain('match(');
  });

  it('is DOM-free, so its rules are assertable without a render', () => {
    expect(SOURCE).not.toContain('document');
    expect(SOURCE).not.toContain('window');
    expect(SOURCE).not.toContain("'use client'");
  });
});
