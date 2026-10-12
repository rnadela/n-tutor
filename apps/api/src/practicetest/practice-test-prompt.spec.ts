import { describe, expect, it } from 'vitest';
import type { QuestionFormat } from '../generated/prisma/enums.js';
import type { RichText } from '../extraction/rich-text.js';
import { buildGenerationPrompt, type GenerationSourceQuestion } from './practice-test-prompt.js';

/**
 * The generation prompt, read as the contract it is.
 *
 * Two halves of one rule run through this file: every figure instruction
 * asserted here has a deterministic refusal behind it in
 * `practice-test-payload.ts`, and the point of the first test is the *absence*
 * of all of it — a Source Test with no figures must be asked Story 4.1's
 * question, word for word, because wording is the only thing that changes what
 * a model writes.
 */

const CIRCLE = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="currentColor"/></svg>';
const SQUARE = '<svg viewBox="0 0 8 8"><rect x="1" y="1" width="6" height="6"/></svg>';

const text = (value: string): RichText => [{ kind: 'text', value }];
const drawn = (svg: string, alt: string): RichText => [{ kind: 'figure', svg, alt }];

function question(overrides: Partial<GenerationSourceQuestion> = {}): GenerationSourceQuestion {
  return {
    ordinal: 1,
    format: 'ShortAnswer' as QuestionFormat,
    prompt: text('What is two plus two?'),
    choices: [],
    topics: ['Addition'],
    ...overrides,
  };
}

function promptFor(
  sourceQuestions: GenerationSourceQuestion[],
  weighting: { topic: string; floor: number } | null = null,
): string {
  return buildGenerationPrompt({
    sourceQuestions,
    targets: new Map<QuestionFormat, number>([['ShortAnswer', 2]]),
    topics: ['Addition', 'Shapes'],
    weighting,
    alreadyGenerated: [],
  });
}

describe('a source test with no figures', () => {
  it('is asked Story 4.1 question, with no figure wording and no drawing', () => {
    const prompt = promptFor([question()]);
    expect(prompt).not.toMatch(/figure/iu);
    expect(prompt).not.toContain('<svg');
    expect(prompt).not.toContain('viewBox');
    expect(prompt).not.toContain('currentColor');
  });

  it('stops its rule list at the never-copy rule', () => {
    const prompt = promptFor([question()]);
    expect(prompt).toContain('5. Never reproduce a question from the source test');
    expect(prompt).not.toContain('6.');
  });

  it('lists each source question as exactly one line', () => {
    const prompt = promptFor([
      question(),
      question({
        ordinal: 2,
        format: 'MultipleChoice' as QuestionFormat,
        prompt: text('Which is larger?'),
        choices: [text('Four'), text('Five')],
      }),
    ]);
    const listing = prompt.slice(prompt.indexOf('The source test, which you must not copy from:'));
    expect(listing.trim().split('\n')).toEqual([
      'The source test, which you must not copy from:',
      '1. [ShortAnswer] What is two plus two?',
      '2. [MultipleChoice] Which is larger? Options: Four | Five',
    ]);
  });
});

describe('a source test that carries a figure', () => {
  const pictured = question({
    prompt: [{ kind: 'text', value: 'What shape? ' }, ...drawn(CIRCLE, 'A circle')],
  });

  it('carries the figure rules after the never-copy rule', () => {
    const prompt = promptFor([pictured]);
    expect(prompt).toContain('5. Never reproduce a question from the source test');
    expect(prompt).toContain('6. Where a question needs a printed shape');
    // The copy rule, whose other half is `FIGURE_NOT_NEW`.
    expect(prompt).toContain('7. Every figure you draw must be new work.');
    // The grammar and the ceilings the sanitizer and the payload module hold.
    expect(prompt).toContain('`currentColor`');
    expect(prompt).toContain('16 KB');
    expect(prompt).toContain('at most 4 figures in any one field');
    expect(prompt).toContain("all of one field's figures together under 32 KB");
    // The alt rule the distinctness check leans on, and the two judgement calls.
    expect(prompt).toContain('must read differently from every other option');
    expect(prompt).toContain('10. Never invent a figure for source content you could not read.');
    expect(prompt).toContain('11. Where the source asked the student to draw a shape');
    // The one field a figure may not reach, because grading reads text.
    expect(prompt).toContain('Never put a figure in the `answer` field');
  });

  it('lists the drawing beneath the question it belongs to', () => {
    const prompt = promptFor([pictured]);
    expect(prompt).toContain('1. [ShortAnswer] What shape? [Figure: A circle]');
    expect(prompt).toContain(`   Figure in the question, alternative "A circle": ${CIRCLE}`);
  });

  it('tells a prompt figure and an option figure apart', () => {
    const prompt = promptFor([
      question({
        format: 'MultipleChoice' as QuestionFormat,
        prompt: [{ kind: 'text', value: 'Which matches? ' }, ...drawn(CIRCLE, 'A circle')],
        choices: [drawn(SQUARE, 'A square'), text('Neither')],
      }),
    ]);
    expect(prompt).toContain(`   Figure in the question, alternative "A circle": ${CIRCLE}`);
    expect(prompt).toContain(`   Figure in option 1, alternative "A square": ${SQUARE}`);
    // The option that is words only adds no line of its own.
    expect(prompt).not.toContain('Figure in option 2');
  });

  it('leaves the rest of the prompt as it reads without a figure', () => {
    // The listing and the rules are additive: everything Story 4.1 and 4.2
    // wrote is still there, unweighted and weighted alike.
    for (const weighting of [null, { topic: 'Shapes', floor: 2 }]) {
      const plain = promptFor([question()], weighting);
      const withFigure = promptFor([pictured], weighting);
      for (const line of plain.split('\n')) {
        if (line.includes('What is two plus two?')) continue;
        expect(withFigure).toContain(line);
      }
    }
  });

  it('weights a figure-bearing source exactly as it weights a plain one', () => {
    const prompt = promptFor([pictured], { topic: 'Shapes', floor: 2 });
    expect(prompt).toContain('At least 2 of the 2 questions must carry this topic');
    expect(prompt).toContain('6. Where a question needs a printed shape');
  });
});
