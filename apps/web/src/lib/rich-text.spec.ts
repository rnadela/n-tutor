import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSaveField, figureTokensPreserved, plainTextOf } from './rich-text';
import {
  plainTextOf as apiPlainTextOf,
  richTextFromPlainText as apiRichTextFromPlainText,
} from '../../../api/src/extraction/rich-text';
import type { RichTextSegment } from './parent-api';

/**
 * Every shape a stored rich-text field can hold, and the one plain string both
 * renderings must produce for it.
 *
 * One table checked against both sides, so the two are pinned to each other by
 * behaviour rather than by either one's source text.
 */
/** A figure exactly as the API stores it, sanitized. */
const FIGURE_SVG =
  '<svg viewBox="0 0 10 10"><path d="M0 5A5 5 0 0 1 10 5" fill="none" stroke="currentColor"/></svg>';

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
  [[{ kind: 'figure', svg: FIGURE_SVG, alt: 'A half-circle' }], '[Figure: A half-circle]'],
  [
    [
      { kind: 'text', value: 'What shape? ' },
      { kind: 'figure', svg: FIGURE_SVG, alt: 'A half-circle' },
      { kind: 'text', value: ' Name it.' },
    ],
    'What shape? [Figure: A half-circle] Name it.',
  ],
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

describe('the figure projection', () => {
  it('renders a figure as its text alternative, in place', () => {
    // Grading, dedupe, the explanation prompt and the topic prompts all work
    // on this string alone, so a figure projecting to nothing would turn
    // "what shape is this?" into "what shape is?".
    expect(plainTextOf([{ kind: 'figure', svg: FIGURE_SVG, alt: 'A circle' }])).toBe(
      '[Figure: A circle]',
    );
  });

  it('is worded byte-identically to the API projection, in mixed fields too', () => {
    // Byte-identical and not merely similar: Story 4.8 has to recover the
    // segments from this string, and it can only do that against one wording.
    const mixed: RichTextSegment[] = [
      { kind: 'text', value: 'Shade ' },
      { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
      { kind: 'text', value: ' of ' },
      { kind: 'figure', svg: FIGURE_SVG, alt: 'A rectangle in four parts' },
      { kind: 'text', value: '.' },
    ];
    expect(plainTextOf(mixed)).toBe('Shade 1/2 of [Figure: A rectangle in four parts].');
    expect(plainTextOf(mixed)).toBe(apiPlainTextOf(mixed));
  });
});

describe('the figure-token mirror', () => {
  const circle: RichTextSegment = { kind: 'figure', svg: FIGURE_SVG, alt: 'A circle' };
  const square: RichTextSegment = { kind: 'figure', svg: FIGURE_SVG, alt: 'A square' };

  /** Whether the server would take this edit — the rule this one mirrors. */
  function serverAccepts(segments: RichTextSegment[], text: string): boolean {
    const figures = segments.filter((segment) => segment.kind === 'figure');
    try {
      apiRichTextFromPlainText(text, figures);
      return true;
    } catch {
      return false;
    }
  }

  /** Agreement on outputs, so neither side's wording pins the other's. */
  function agree(segments: RichTextSegment[], text: string, expected: boolean) {
    expect(figureTokensPreserved(segments, text)).toBe(expected);
    expect(serverAccepts(segments, text)).toBe(expected);
  }

  it('passes an untouched prefill', () => {
    const segments: RichTextSegment[] = [{ kind: 'text', value: 'What shape? ' }, circle];
    agree(segments, plainTextOf(segments), true);
  });

  it('passes text edited around the token', () => {
    agree(
      [{ kind: 'text', value: 'What shape? ' }, circle],
      'Which shape? [Figure: A circle]',
      true,
    );
  });

  it('fails a dropped, reordered or altered token', () => {
    const two: RichTextSegment[] = [circle, { kind: 'text', value: ' then ' }, square];
    agree(two, 'Only [Figure: A circle] now', false);
    agree(two, '[Figure: A square] then [Figure: A circle]', false);
    agree(two, '[Figure: a circle] then [Figure: A square]', false);
  });

  it('passes a field that holds no figure at all', () => {
    agree([{ kind: 'text', value: 'What is 1/2 of 8?' }], 'What is 1/4 of 8?', true);
    agree(
      [{ kind: 'text', value: 'Anything' }],
      'Someone typed [Figure: A circle] themselves',
      true,
    );
  });
});
