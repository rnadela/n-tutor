import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { commonCopy } from '@/copy/common';
import { parentCopy } from '@/copy/parent';
import { studentCopy } from '@/copy/student';
import type { GradeState } from '@/lib/parent-api';
import { parentTheme, studentTheme } from '@/theme/theme';
import { gradeStateMarker } from '@/theme/tokens';
import { AnswerKeyMap, type AnswerKeyMapLabels, type AnswerKeyMapRow } from './AnswerKeyMap';

const STATES: GradeState[] = ['Correct', 'Incorrect', 'Unanswered', 'Ungraded'];

/** The child's words, as `AttemptResults` builds them. */
const STUDENT_LABELS: AnswerKeyMapLabels = {
  heading: studentCopy.results.pager.mapHeading,
  cellState: studentCopy.results.pager.cellState,
  cellNewlyGraded: studentCopy.results.pager.cellNewlyGraded,
  legendEntry: studentCopy.results.pager.legendEntry,
};

/** The parent's words for the same map, in the third person about the child. */
const PARENT_LABELS: AnswerKeyMapLabels = {
  heading: parentCopy.attempts.pager.mapHeading,
  cellState: parentCopy.attempts.pager.cellState,
  cellNewlyGraded: parentCopy.attempts.pager.cellNewlyGraded,
  legendEntry: parentCopy.attempts.pager.legendEntry,
};

/** One row per state, so no state is vacuously satisfied. */
const ROWS: AnswerKeyMapRow[] = STATES.map((state, index) => ({
  questionId: `q-${index + 1}`,
  ordinal: index + 1,
  state,
  newlyGraded: false,
}));

function render(
  rows: readonly AnswerKeyMapRow[] = ROWS,
  currentIndex = 1,
  labels: AnswerKeyMapLabels = STUDENT_LABELS,
  theme = studentTheme,
  headingProvided = false,
): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme },
      createElement(AnswerKeyMap, {
        rows,
        currentIndex,
        onJump: () => {},
        labels,
        headingProvided,
      }),
    ),
  );
}

/** The markup with the emotion `<style>` blocks removed. */
function body(markup: string): string {
  return markup.replace(/<style[\s\S]*?<\/style>/gu, '');
}

/** The markup with every colour, class and inline style taken away. */
function colourless(markup: string): string {
  return body(markup)
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\sstyle="[^"]*"/gu, '')
    .replace(/\scolor="[^"]*"/gu, '');
}

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'AnswerKeyMap.tsx'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('the results map as a set of real controls', () => {
  it('draws one real button per Question, in the order it was given', () => {
    const markup = render();
    expect(markup.match(/<button/gu)).toHaveLength(ROWS.length);
    expect(markup.match(/data-testid="answer-key-map-cell"/gu)).toHaveLength(ROWS.length);
    const ordinals = [...markup.matchAll(/data-ordinal="(\d+)"/gu)].map((match) => match[1]);
    expect(ordinals).toEqual(['1', '2', '3', '4']);
  });

  it('lists every Question of a long paper, never a page of them', () => {
    const many: AnswerKeyMapRow[] = Array.from({ length: 12 }, (_unused, index) => ({
      questionId: `q-${index}`,
      ordinal: index + 1,
      state: 'Correct',
      newlyGraded: false,
    }));
    expect(render(many, 0).match(/data-testid="answer-key-map-cell"/gu)).toHaveLength(12);
  });

  it('takes its tap target from the mounted surface’s density', () => {
    expect(render(ROWS, 1, STUDENT_LABELS, studentTheme)).toContain('48px');
    expect(render(ROWS, 1, PARENT_LABELS, parentTheme)).toContain('44px');
  });

  it('marks exactly one cell, from the one index the pager resolved', () => {
    // An index and not an ordinal: `AnswerKeyRowView` promises neither that the ordinals
    // are dense nor that they are distinct, and two rows sharing a number would
    // otherwise both be marked — two "you are here" cells in one map.
    const gappy: AnswerKeyMapRow[] = [
      { questionId: 'a', ordinal: 0, state: 'Ungraded', newlyGraded: false },
      { questionId: 'b', ordinal: 5, state: 'Correct', newlyGraded: false },
    ];
    const markup = render(gappy, 1);
    expect(markup.match(/aria-current="true"/gu)).toHaveLength(1);
    const before = markup.slice(0, markup.indexOf('aria-current="true"'));
    expect(before.lastIndexOf('data-ordinal="5"')).toBeGreaterThan(
      before.lastIndexOf('data-ordinal="0"'),
    );
  });

  it('marks one cell and no other when two rows share an ordinal', () => {
    const twins: AnswerKeyMapRow[] = [
      { questionId: 'a', ordinal: 0, state: 'Ungraded', newlyGraded: false },
      { questionId: 'b', ordinal: 0, state: 'Ungraded', newlyGraded: false },
    ];
    expect(render(twins, 0).match(/aria-current="true"/gu)).toHaveLength(1);
    expect(render(twins, 1).match(/aria-current="true"/gu)).toHaveLength(1);
  });

  it('marks nothing at all for an index that names no row', () => {
    // The honest rendering of a clamp the caller has not written back yet.
    expect(render(ROWS, -1)).not.toContain('aria-current="true"');
  });
});

describe('what each cell says', () => {
  it('says which Question it is and the fixed grade label for its state', () => {
    const markup = render();
    for (const row of ROWS) {
      expect(markup).toContain(
        STUDENT_LABELS.cellState(
          row.ordinal,
          commonCopy.gradeState[row.state],
          row.ordinal === 2,
          false,
        ),
      );
    }
  });

  it('says where the reader is in words as well as through aria-current', () => {
    expect(STUDENT_LABELS.cellState(2, commonCopy.gradeState.Correct, true, false)).toContain(
      'you are here',
    );
    expect(PARENT_LABELS.cellState(2, commonCopy.gradeState.Correct, true, false)).toContain(
      'shown now',
    );
  });

  it('hides the digit and the glyph, so the name is the sentence and nothing else', () => {
    const markup = render();
    expect(markup).not.toContain('aria-label');
    const glyphs = markup.match(/aria-hidden="true"[^>]*data-testid="answer-key-map-glyph"/gu);
    expect(glyphs).toHaveLength(ROWS.length);
    expect(markup.match(/aria-hidden="true"/gu)!.length).toBeGreaterThanOrEqual(ROWS.length * 2);
  });

  it('marks a Question this read judged, and says so in the sentence too', () => {
    const rows = ROWS.map((row) => (row.ordinal === 1 ? { ...row, newlyGraded: true } : row));
    const markup = render(rows, 1);
    expect(markup).toContain('data-newly-graded="true"');
    expect(markup).toContain('data-testid="answer-key-map-newly-graded"');
    // The drawn mark is `aria-hidden`, so the sentence is the only account of it.
    expect(markup).toContain(
      STUDENT_LABELS.cellState(1, commonCopy.gradeState.Correct, false, true),
    );
    expect(STUDENT_LABELS.cellState(1, commonCopy.gradeState.Correct, false, true)).toContain(
      'just graded',
    );
    expect(render()).not.toContain('data-newly-graded');
  });

  it('never says both "not graded yet" and "just graded" on one cell', () => {
    // The service cannot produce the pair, but the type permits it. The state wins.
    const rows: AnswerKeyMapRow[] = [
      { questionId: 'a', ordinal: 1, state: 'Ungraded', newlyGraded: true },
    ];
    const markup = render(rows, 0);
    expect(markup).not.toContain('data-newly-graded');
    expect(markup).toContain(
      STUDENT_LABELS.cellState(1, commonCopy.gradeState.Ungraded, true, false),
    );
  });
});

describe('what the map states, and what it never states', () => {
  it('keeps all four states apart with colour, class and inline style stripped', () => {
    const bare = colourless(render());
    for (const state of STATES) {
      const marker = gradeStateMarker[state];
      expect(bare).toContain(`data-frame="${marker.frame}"`);
      expect(bare).toContain(`data-border="${marker.border}"`);
      expect(bare).toContain(`data-glyph="${marker.glyph}"`);
      // And the word, in the cell's own sentence and in the legend.
      expect(bare).toContain(commonCopy.gradeState[state]);
    }
    // Four glyphs, four shapes — not one glyph styled four ways.
    expect(new Set(STATES.map((state) => gradeStateMarker[state].glyph)).size).toBe(4);
  });

  it('lists exactly the states present in the legend, and no others', () => {
    const everyState = render();
    for (const state of STATES) {
      expect(everyState).toContain(
        `data-testid="answer-key-map-legend-entry" data-state="${state}"`,
      );
    }

    // A fully-marked paper: a legend naming `Not graded yet` would describe a state
    // the reader cannot see, which is an invitation to look for it.
    const marked: AnswerKeyMapRow[] = [
      { questionId: 'a', ordinal: 1, state: 'Correct', newlyGraded: false },
      { questionId: 'b', ordinal: 2, state: 'Incorrect', newlyGraded: false },
    ];
    const markup = render(marked, 0);
    expect(markup).toContain('data-state="Correct"');
    expect(markup).toContain('data-state="Incorrect"');
    expect(markup).not.toContain('data-testid="answer-key-map-legend-entry" data-state="Ungraded"');
    expect(markup).not.toContain(
      'data-testid="answer-key-map-legend-entry" data-state="Unanswered"',
    );
    expect(markup).not.toContain(commonCopy.gradeState.Ungraded);
  });

  it('states no percentage and no tally of its own', () => {
    // The score is the surface header's one figure, from the two the server computed
    // (FR-37). A map that counted its own cells would be a second answer.
    const markup = body(render());
    expect(markup).not.toMatch(/%/u);
    expect(markup).not.toMatch(/\b\d+ (of|out of) \d+\b/u);
    expect(CODE).not.toMatch(/\.length\b[\s\S]{0,40}of/u);
    expect(CODE).not.toMatch(/Math\.round|toFixed|percent/iu);
  });

  it('borrows none of the progress map’s vocabulary', () => {
    // `Answered` and `Not answered` are the words of a test still being worked. This
    // map is read once the marks are in, and says nothing but grades.
    const markup = body(render());
    expect(markup).not.toMatch(/\bAnswered\b/u);
    expect(markup).not.toContain('Not answered');
    expect(CODE).not.toMatch(/QuestionMap|takeTest/u);
  });

  it('sits at h3, so the row’s h4 is nested beneath a heading and not beside one', () => {
    const markup = render();
    expect(markup).toContain('<h3');
    expect(markup).toContain('data-testid="answer-key-map-heading"');
    expect(markup).toContain(STUDENT_LABELS.heading);
    expect(markup).not.toContain('<h2');
    expect(markup).not.toContain('<h4');
  });

  it('draws no heading at all where the container already states it', () => {
    // The overlay form is a dialog whose own title is this very string. A second
    // heading saying the identical words underneath would make a reader hear the same
    // line twice before the first cell.
    const markup = render(ROWS, 1, STUDENT_LABELS, studentTheme, true);
    expect(markup).not.toContain('<h3');
    expect(markup).not.toContain('data-testid="answer-key-map-heading"');
    expect(markup).not.toContain(STUDENT_LABELS.heading);
    // Everything else is unchanged: the same cells, the same legend.
    expect(markup.match(/data-testid="answer-key-map-cell"/gu)).toHaveLength(ROWS.length);
    expect(markup).toContain('data-testid="answer-key-map-legend"');
  });

  it('restores the list semantics `listStyle: none` strips in Safari', () => {
    const markup = render();
    expect(markup).toContain('role="list"');
    expect(markup.match(/role="listitem"/gu)).toHaveLength(ROWS.length);
  });

  it('nothing animates and nothing celebrates', () => {
    expect(CODE).not.toMatch(/Confetti|celebrat|animate|Fade|Grow|Collapse|Zoom|transition/iu);
  });
});

describe('two vocabularies for two moments', () => {
  it('is a separate component from the progress map rather than a mode of it', () => {
    // `QuestionMap.spec.tsx` asserts its markup matches none of `/score/`, `/%/`,
    // `/correct/`, `/wrong/`, `/grade/` or `/right/` — the proof that no correctness
    // leaks before a hand-in. This map says nothing else. One component could satisfy
    // neither ban, and the shared part is the geometry, which `QuestionGrid` owns.
    expect(CODE).toContain("from '@/components/QuestionGrid'");
    const progress = readFileSync(
      path.resolve(import.meta.dirname, '..', 'app', 'student', '_components', 'QuestionMap.tsx'),
      'utf8',
    );
    expect(progress).toContain("from '@/components/QuestionGrid'");
    expect(progress).not.toContain('AnswerKeyMap');
  });

  it('reads the four grade literals from the one place they live, never its labels', () => {
    expect(CODE).toContain('commonCopy.gradeState[row.state]');
    expect(CODE).not.toMatch(/studentCopy|parentCopy/u);
  });

  it('renders the same map about a child in the third person', () => {
    const markup = render(ROWS, 1, PARENT_LABELS, parentTheme);
    expect(markup).toContain(parentCopy.attempts.pager.mapHeading);
    expect(markup).toContain(
      PARENT_LABELS.cellState(2, commonCopy.gradeState.Incorrect, true, false),
    );
    // None of the child's second-person wording survives.
    expect(markup).not.toContain('you are here');
    expect(STUDENT_LABELS.heading).not.toBe(PARENT_LABELS.heading);
  });
});
