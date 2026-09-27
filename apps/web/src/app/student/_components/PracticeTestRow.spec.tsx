import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import type { StudentPracticeTestSummary } from '@/lib/parent-api';
import { studentTheme } from '@/theme/theme';
import { PracticeTestRow } from './PracticeTestRow';

function test(overrides: Partial<StudentPracticeTestSummary> = {}): StudentPracticeTestSummary {
  return {
    id: 'test-1',
    subjectName: 'Mathematics',
    questionCount: 8,
    state: 'NotStarted',
    ...overrides,
  };
}

/**
 * The row as a child actually receives it: rendered, under the student theme,
 * and read back off the markup.
 *
 * Rendered rather than matched against the component's source, because every
 * claim here is a claim about what reaches the screen. A behaviour-preserving
 * refactor must not fail these, and a row that stopped reaching the DOM must
 * not pass them.
 */
function render(summary: StudentPracticeTestSummary): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(PracticeTestRow, {
        test: summary,
      }),
    ),
  );
}

/** The markup with every colour, class and inline style taken away. */
function colourless(markup: string): string {
  return markup
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\sstyle="[^"]*"/gu, '')
    .replace(/\scolor="[^"]*"/gu, '');
}

describe('what one practice-test row shows a child', () => {
  it('renders a list item, not a bare paragraph', () => {
    const markup = render(test());
    expect(markup).toContain('<li');
    expect(markup).toContain('role="listitem"');
  });

  it('shows the Subject it was given', () => {
    expect(render(test({ subjectName: 'Science' }))).toContain('Science');
  });

  it('shows the question count from the figure it was handed', () => {
    expect(render(test({ questionCount: 8 }))).toContain('A practice test with 8 questions');
    expect(render(test({ questionCount: 1 }))).toContain('A practice test with 1 question');
  });

  it('says each of the three conditions in its own words', () => {
    expect(render(test({ state: 'NotStarted' }))).toContain('Not started');
    expect(render(test({ state: 'InProgress' }))).toContain('In progress');
    expect(render(test({ state: 'Completed' }))).toContain('Completed');
  });

  it('tells the three conditions apart with every bit of colour stripped', () => {
    // The distinction has to survive being read aloud, printed in one ink or
    // seen by someone who cannot separate two hues. So it lives in the words.
    const words: string[] = [];
    for (const state of ['NotStarted', 'InProgress', 'Completed'] as const) {
      const word = studentCopy.practiceTestState(state)!;
      expect(colourless(render(test({ state })))).toContain(word);
      words.push(word);
    }
    // Three conditions, three different words — not one word styled three ways.
    expect(new Set(words).size).toBe(3);
  });
});

describe('what a row does with a Subject it does not have', () => {
  it('renders no Subject element at all for null', () => {
    const markup = render(test({ subjectName: null }));
    expect(markup).not.toContain('student-practice-test-subject');
  });

  it('renders no Subject element at all for undefined', () => {
    // The field can be absent on a payload this browser did not write.
    const markup = render(test({ subjectName: undefined as unknown as null }));
    expect(markup).not.toContain('student-practice-test-subject');
  });

  it('renders no Subject element at all for an empty string', () => {
    // An empty styled line is worse than no line: it reads as a Subject the
    // child cannot see.
    const markup = render(test({ subjectName: '' }));
    expect(markup).not.toContain('student-practice-test-subject');
  });

  it('still shows the count and the state without a Subject', () => {
    const markup = render(test({ subjectName: null, state: 'InProgress' }));
    expect(markup).toContain('A practice test with 8 questions');
    expect(markup).toContain('In progress');
  });
});

describe('what a row does with a state it does not recognise', () => {
  it('renders no state label rather than guessing one', () => {
    for (const state of ['', 'Graded', 'completed', undefined, null]) {
      const markup = render(test({ state: state as StudentPracticeTestSummary['state'] }));
      expect(markup).not.toContain('student-practice-test-state');
      // And above all not "Completed": telling a child a test they never
      // touched is finished is the worst answer available.
      expect(markup).not.toContain('Completed');
    }
  });
});
