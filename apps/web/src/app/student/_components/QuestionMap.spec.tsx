import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import { progressOf, type QuestionProgress } from '@/lib/answers';
import { studentTheme } from '@/theme/theme';
import { comfortableDensity } from '@/theme/tokens';
import { QuestionMap } from './QuestionMap';

const ORDER = [
  { id: 'q-1', ordinal: 1 },
  { id: 'q-2', ordinal: 2 },
  { id: 'q-3', ordinal: 3 },
  { id: 'q-4', ordinal: 4 },
];

/** Two answered, two not — so neither state is vacuously satisfied. */
const PROGRESS: QuestionProgress[] = progressOf(ORDER, { 'q-1': '3/4', 'q-3': '2' });

function render(progress: readonly QuestionProgress[] = PROGRESS, currentIndex = 1): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(QuestionMap, { progress, currentIndex, onJump: () => {} }),
    ),
  );
}

/**
 * The markup with the emotion `<style>` blocks removed.
 *
 * A ban on a *word* has to be a ban on what the child is shown: generated CSS
 * carries `100%`, `right` and plenty else that has nothing to do with what this
 * map states, and asserting over it would fail about a percentage sign in a
 * width rule.
 */
function body(markup: string): string {
  return markup.replace(/<style[\s\S]*?<\/style>/gu, '');
}

describe('the map as a set of real controls', () => {
  it('draws one real button per Question, and no div carrying the action', () => {
    const markup = render();
    expect(markup.match(/<button/gu)).toHaveLength(ORDER.length);
    expect(markup.match(/data-testid="question-map-cell"/gu)).toHaveLength(ORDER.length);
  });

  it('sizes every cell at the comfortable tap-target floor, from the token', () => {
    const markup = render();
    expect(markup).toContain(`${comfortableDensity.tapTarget}px`);
  });

  it('marks exactly one cell as the one the child is on', () => {
    const markup = render();
    expect(markup.match(/aria-current="true"/gu)).toHaveLength(1);
  });
});

describe('what each cell announces', () => {
  it('says which Question it is and where that Question stands, in its own sentence', () => {
    const markup = render();
    // Not a bare digit: a cell read on its own has to say what it is.
    expect(markup).toContain(studentCopy.takeTest.cellState(1, true, false));
    expect(markup).toContain(studentCopy.takeTest.cellState(2, false, true));
    expect(markup).toContain(studentCopy.takeTest.cellState(3, true, false));
    expect(markup).toContain(studentCopy.takeTest.cellState(4, false, false));
  });

  it('gives every cell a distinct sentence', () => {
    const sentences = PROGRESS.map((question, index) =>
      studentCopy.takeTest.cellState(question.ordinal, question.state === 'answered', index === 1),
    );
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('says where the child is in words as well as through aria-current', () => {
    expect(studentCopy.takeTest.cellState(2, false, true)).toContain('you are here');
  });

  it('hides the digit and the glyph from assistive technology, so nothing is said twice', () => {
    const markup = render();
    // The accessible name of a cell is exactly its sentence. The number beside
    // the glyph is the same fact drawn, not a second one to announce.
    expect(markup.match(/aria-hidden="true"/gu)!.length).toBeGreaterThanOrEqual(ORDER.length * 2);
    const glyphCells = markup.match(/aria-hidden="true"[^>]*data-testid="question-map-glyph"/gu);
    expect(glyphCells).toHaveLength(ORDER.length);
  });
});

describe('what the map states, and what it never states', () => {
  it('reports each Question as Answered or Not answered, and nothing else', () => {
    const markup = render();
    expect(markup).toContain(studentCopy.takeTest.legendAnswered);
    expect(markup).toContain(studentCopy.takeTest.legendNotAnswered);
    // `Unanswered` is a grade state only submission could claim. It is not this
    // vocabulary, anywhere.
    expect(markup).not.toMatch(/unanswered/iu);
  });

  it('summarises with two counts and no third', () => {
    const markup = render();
    expect(markup).toContain(studentCopy.takeTest.mapSummary(2, 2));
  });

  it('states no score, no percentage and no correctness of any kind', () => {
    const markup = body(render());
    for (const forbidden of [
      /score/iu,
      /%/u,
      /\bcorrect/iu,
      /\bwrong\b/iu,
      /\bgrade/iu,
      /right/iu,
    ]) {
      expect(markup).not.toMatch(forbidden);
    }
  });

  it('keeps the states readable with colour stripped away', () => {
    // A word plus a glyph, never a colour or a fill alone (UX-DR20): with every
    // style attribute removed the two states are still different shapes and the
    // legend still names both in words.
    const bare = body(render()).replace(/\sclass="[^"]*"/gu, '');
    expect(bare).toContain('●');
    expect(bare).toContain('○');
    expect(bare).toContain(studentCopy.takeTest.legendAnswered);
    expect(bare).toContain(studentCopy.takeTest.legendNotAnswered);
    expect(bare).toContain(studentCopy.takeTest.cellState(1, true, false));
  });

  it('lists every Question, never a page of them', () => {
    const many = progressOf(
      Array.from({ length: 12 }, (_unused, index) => ({ id: `q-${index}`, ordinal: index + 1 })),
      {},
    );
    const markup = render(many, 0);
    expect(markup.match(/data-testid="question-map-cell"/gu)).toHaveLength(12);
  });

  it('holds one cell for a test of one Question, and still says where the child is', () => {
    // A one-Question test is the degenerate case the summary line and the
    // current marker are easiest to get wrong on: a map that renders nothing,
    // or an `aria-current` that lands on no cell, would leave the only
    // Question in the test unreachable from the escape hatch.
    const single = progressOf([{ id: 'q-1', ordinal: 1 }], {});
    const markup = render(single, 0);
    expect(markup.match(/data-testid="question-map-cell"/gu)).toHaveLength(1);
    expect(markup.match(/aria-current="true"/gu)).toHaveLength(1);
    expect(body(markup)).toContain(studentCopy.takeTest.mapSummary(0, 1));
  });

  it('draws the cells in the order it was given, never re-sorted here', () => {
    const markup = render();
    const ordinals = [...markup.matchAll(/data-ordinal="(\d+)"/gu)].map((match) => match[1]);
    expect(ordinals).toEqual(['1', '2', '3', '4']);
  });

  it('restores the list semantics `listStyle: none` strips in Safari', () => {
    const markup = render();
    expect(markup).toContain('role="list"');
    expect(markup.match(/role="listitem"/gu)).toHaveLength(ORDER.length);
  });
});
