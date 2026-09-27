import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import type {
  AttemptRunView,
  PracticeTestRunsView,
  StudentPracticeTestSummary,
} from '@/lib/parent-api';
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
function render(summary: StudentPracticeTestSummary, runs?: PracticeTestRunsView): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(PracticeTestRow, {
        test: summary,
        runs,
      }),
    ),
  );
}

/** One finished run, with whatever figure the case is about. */
function run(overrides: Partial<AttemptRunView> = {}): AttemptRunView {
  return {
    attemptId: 'a1',
    ordinal: 1,
    submittedAt: '2026-09-01T10:00:00.000Z',
    score: { correct: 5, denominator: 8, excludedUngraded: 0 },
    countsTowardMastery: true,
    ...overrides,
  };
}

/** A run history, defaulting to the single-run shape the API states for one run. */
function runs(overrides: Partial<PracticeTestRunsView> = {}): PracticeTestRunsView {
  const only = run();
  return {
    practiceTestId: 'test-1',
    attemptCount: 1,
    first: only,
    latest: only,
    ...overrides,
  };
}

/** Two finished runs, with the first and the latest carrying different figures. */
function history(): PracticeTestRunsView {
  return runs({
    attemptCount: 2,
    first: run({
      attemptId: 'a1',
      ordinal: 1,
      score: { correct: 3, denominator: 8, excludedUngraded: 0 },
      countsTowardMastery: true,
    }),
    latest: run({
      attemptId: 'a2',
      ordinal: 2,
      score: { correct: 7, denominator: 8, excludedUngraded: 0 },
      countsTowardMastery: false,
    }),
  });
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

describe('what a row says about the runs a child has finished', () => {
  it('shows one figure and no framing for a single finished run', () => {
    const markup = render(test({ state: 'Completed' }), runs());
    expect(markup).toContain('student-practice-test-runs');
    expect(markup).toContain('5 out of 8');
    // No first/latest framing and no run count: one run is one figure.
    expect(markup).not.toContain('First');
    expect(markup).not.toContain('Latest');
    expect(markup).not.toContain('attempt');
    expect(markup).not.toContain('student-practice-test-runs-note');
  });

  it('shows both figures, the count and which run counts for a history', () => {
    const markup = render(test({ state: 'Completed' }), history());
    expect(markup).toContain('First 3 out of 8');
    expect(markup).toContain('Latest 7 out of 8');
    expect(markup).toContain('2 attempts');
    expect(markup).toContain(studentCopy.runs.countsTowardProgress);
  });

  it('renders nothing extra at all without an entry', () => {
    // Both "the run read failed" and "nothing is finished here yet". A row with no
    // figure is the row that shipped in Story 5.1 and is still complete.
    const markup = render(test({ state: 'Completed' }));
    expect(markup).not.toContain('student-practice-test-runs');
    expect(markup).not.toContain('out of');
    // And everything the row has always said is still there.
    expect(markup).toContain('Mathematics');
    expect(markup).toContain('A practice test with 8 questions');
    expect(markup).toContain('Completed');
  });

  it('says so in words rather than dividing when a run could not be graded', () => {
    const markup = render(
      test({ state: 'Completed' }),
      runs({ first: run({ score: { correct: 0, denominator: 0, excludedUngraded: 8 } }) }),
    );
    expect(markup).toContain(studentCopy.runs.notGradedYet);
    expect(markup).not.toContain('0 out of 0');
  });

  it('states no percentage and no figure of its own', () => {
    // Both numbers are the server's. A percentage rendered here would be a second
    // answer to FR-37.
    // Scoped to the line itself: the theme's own emitted CSS carries `rem` figures,
    // and a ban over the whole markup would be a ban on MUI rather than on this row.
    const line = /data-testid="student-practice-test-runs">([^<]*)</u.exec(
      render(test({ state: 'Completed' }), history()),
    )?.[1];
    expect(line).toBeDefined();
    expect(line).not.toContain('%');
    expect(line).not.toMatch(/\d\.\d/u);
  });

  it('keeps every figure and the first/latest distinction with all styling stripped', () => {
    // The distinction has to survive being read aloud, printed in one ink, or seen by
    // someone who cannot separate two hues. So it lives in the words.
    const bare = colourless(render(test({ state: 'Completed' }), history()));
    expect(bare).not.toMatch(/\sclass=|\sstyle=|\scolor=/u);
    expect(bare).toContain('First 3 out of 8');
    expect(bare).toContain('Latest 7 out of 8');
    expect(bare).toContain('2 attempts');
    expect(bare).toContain(studentCopy.runs.countsTowardProgress);
    // And the single figure survives the same stripping.
    expect(colourless(render(test({ state: 'Completed' }), runs()))).toContain('5 out of 8');
  });
});

describe('the run line’s copy', () => {
  it('addresses the child, with no exclamation mark and no error code', () => {
    for (const line of [
      studentCopy.runs.notGradedYet,
      studentCopy.runs.first('5 out of 8'),
      studentCopy.runs.latest('5 out of 8'),
      studentCopy.runs.count(2),
      studentCopy.runs.countsTowardProgress,
    ]) {
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\b[45]\d\d\b/u);
    }
    expect(studentCopy.runs.countsTowardProgress).toMatch(/\byour\b/iu);
  });

  it('uses the child’s plain word for progress, never the parent’s term', () => {
    expect(studentCopy.runs.countsTowardProgress).toContain('progress');
    expect(studentCopy.runs.countsTowardProgress).not.toMatch(/mastery|average|best|streak/iu);
  });

  it('writes no denominator of its own into any sentence', () => {
    // Every figure is handed in. The only digits this module states are the run count
    // and the numbers it was given.
    expect(studentCopy.runs.figure(5, 8)).toBe('5 out of 8');
    expect(studentCopy.runs.notGradedYet).not.toMatch(/\d/u);
    expect(studentCopy.runs.countsTowardProgress).not.toMatch(/\d/u);
  });
});
