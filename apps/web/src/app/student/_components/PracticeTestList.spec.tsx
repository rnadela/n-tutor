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
import { runsById } from '@/lib/practice-test-runs';
import { studentTheme } from '@/theme/theme';
import { PracticeTestList } from './PracticeTestList';

function summary(
  id: string,
  overrides: Partial<StudentPracticeTestSummary> = {},
): StudentPracticeTestSummary {
  return { id, subjectName: 'Mathematics', questionCount: 4, state: 'NotStarted', ...overrides };
}

function render(tests: StudentPracticeTestSummary[]): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(PracticeTestList, { tests }),
    ),
  );
}

/** Where each needle first appears in the markup, in the order given. */
function positions(markup: string, needles: string[]): number[] {
  return needles.map((needle) => {
    const at = markup.indexOf(needle);
    // A needle that is not there would make every ordering assertion below
    // vacuously true, so its absence is the failure rather than the premise.
    expect(at).toBeGreaterThanOrEqual(0);
    return at;
  });
}

/**
 * The order claim, rendered.
 *
 * This is the test that makes "the page renders what it is given" observable:
 * a list that reversed, sorted or grouped its input would fail here, where a
 * ban on `.sort(` in a page's source text is walked straight past by
 * `.reverse()`, `.toSorted()` or a named grouping helper.
 */
describe('the order the child’s list renders in', () => {
  it('renders three rows in exactly the order it was handed them', () => {
    const tests = [
      summary('a', { subjectName: 'Alpha' }),
      summary('b', { subjectName: 'Beta' }),
      summary('c', { subjectName: 'Gamma' }),
    ];
    const [alpha, beta, gamma] = positions(render(tests), ['Alpha', 'Beta', 'Gamma']);
    expect(alpha!).toBeLessThan(beta!);
    expect(beta!).toBeLessThan(gamma!);
  });

  it('renders the reverse input in the reverse order, so nothing is re-sorting it', () => {
    // The same three rows the other way round. A list that sorted by Subject,
    // by id or by state would answer identically to the case above.
    const tests = [
      summary('c', { subjectName: 'Gamma' }),
      summary('b', { subjectName: 'Beta' }),
      summary('a', { subjectName: 'Alpha' }),
    ];
    const [gamma, beta, alpha] = positions(render(tests), ['Gamma', 'Beta', 'Alpha']);
    expect(gamma!).toBeLessThan(beta!);
    expect(beta!).toBeLessThan(alpha!);
  });

  it('keeps a completed row ahead of a not-started one when that is the order given', () => {
    // The server owns the bands. If it says a completed test comes first, that
    // is what the child sees — the browser does not second-guess it.
    const tests = [
      summary('done', { subjectName: 'Alpha', state: 'Completed' }),
      summary('todo', { subjectName: 'Beta', state: 'NotStarted' }),
    ];
    const [alpha, beta] = positions(render(tests), ['Alpha', 'Beta']);
    expect(alpha!).toBeLessThan(beta!);
  });
});

describe('what the list is, structurally', () => {
  it('is one flat list with its semantics restored, never a set of groups', () => {
    const markup = render([summary('a'), summary('b')]);
    expect(markup).toContain('role="list"');
    // One `<ul>`, so there is no per-Subject section: the Subject is a label
    // on a row, not a heading over one list of several.
    expect(markup.match(/<ul/gu)).toHaveLength(1);
  });

  it('renders one list item per element and no more', () => {
    for (const count of [1, 2, 5]) {
      const tests = Array.from({ length: count }, (_, index) =>
        summary(`id-${index}`, { subjectName: `Subject ${index}` }),
      );
      expect(render(tests).match(/<li/gu)).toHaveLength(count);
    }
  });

  it('pairs each row’s Subject with its own state', () => {
    // A row assembled from the wrong element's fields would pass every
    // single-row assertion; only two rows side by side can catch it.
    const markup = render([
      summary('a', { subjectName: 'Alpha', state: 'Completed', questionCount: 3 }),
      summary('b', { subjectName: 'Beta', state: 'InProgress', questionCount: 7 }),
    ]);
    const items = markup.split('<li').slice(1);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Alpha');
    expect(items[0]).toContain('Completed');
    expect(items[0]).toContain('A practice test with 3 questions');
    expect(items[0]).not.toContain('Beta');
    expect(items[1]).toContain('Beta');
    expect(items[1]).toContain('In progress');
    expect(items[1]).toContain('A practice test with 7 questions');
    expect(items[1]).not.toContain('Alpha');
  });

  it('renders no list item at all for an empty array', () => {
    // "There is nothing to practise yet" is the page's sentence to say, not
    // this component's — and an empty list must not invent a row.
    expect(render([])).not.toContain('<li');
  });
});

/**
 * The run figures, row by row.
 *
 * The lookup is what makes "each row's own figures" a claim rather than a hope, and
 * it is only observable with two rows side by side: a list that handed every row the
 * same entry, or the first entry it found, would pass every single-row assertion.
 */
describe('which row gets which figures', () => {
  function runsFor(
    practiceTestId: string,
    overrides: Partial<PracticeTestRunsView> = {},
  ): PracticeTestRunsView {
    const only: AttemptRunView = {
      attemptId: `${practiceTestId}-a1`,
      ordinal: 1,
      submittedAt: '2026-09-01T10:00:00.000Z',
      score: { correct: 2, denominator: 4, excludedUngraded: 0 },
      countsTowardMastery: true,
    };
    return { practiceTestId, attemptCount: 1, first: only, latest: only, ...overrides };
  }

  function renderWithRuns(
    tests: StudentPracticeTestSummary[],
    runs: PracticeTestRunsView[],
  ): string {
    return renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: studentTheme },
        createElement(PracticeTestList, { tests, runs: runsById(runs) }),
      ),
    );
  }

  it('puts each entry on its own row and on no other', () => {
    const markup = renderWithRuns(
      [summary('a', { subjectName: 'Alpha' }), summary('b', { subjectName: 'Beta' })],
      [
        runsFor('a', {
          first: {
            attemptId: 'a-a1',
            ordinal: 1,
            submittedAt: '2026-09-01T10:00:00.000Z',
            score: { correct: 1, denominator: 4, excludedUngraded: 0 },
            countsTowardMastery: true,
          },
          latest: {
            attemptId: 'a-a1',
            ordinal: 1,
            submittedAt: '2026-09-01T10:00:00.000Z',
            score: { correct: 1, denominator: 4, excludedUngraded: 0 },
            countsTowardMastery: true,
          },
        }),
        runsFor('b', {
          attemptCount: 2,
          first: {
            attemptId: 'b-a1',
            ordinal: 1,
            submittedAt: '2026-09-01T10:00:00.000Z',
            score: { correct: 2, denominator: 4, excludedUngraded: 0 },
            countsTowardMastery: true,
          },
          latest: {
            attemptId: 'b-a2',
            ordinal: 2,
            submittedAt: '2026-09-02T10:00:00.000Z',
            score: { correct: 3, denominator: 4, excludedUngraded: 0 },
            countsTowardMastery: false,
          },
        }),
      ],
    );
    const items = markup.split('<li').slice(1);
    expect(items).toHaveLength(2);
    // One finished run: one figure, with no framing and no count.
    expect(items[0]).toContain('1 out of 4');
    expect(items[0]).not.toContain('First');
    expect(items[0]).not.toContain('attempt');
    // Two finished runs: both figures, the count, and which one counts.
    expect(items[1]).toContain('First 2 out of 4');
    expect(items[1]).toContain('Latest 3 out of 4');
    expect(items[1]).toContain('2 attempts');
    expect(items[1]).toContain(studentCopy.runs.countsTowardProgress);
    // And neither row wearing the other's figures.
    expect(items[0]).not.toContain('3 out of 4');
    expect(items[1]).not.toContain('1 out of 4');
  });

  it('ignores an entry for a test that is not in the list', () => {
    // The map is a lookup, never a source of rows: an entry nothing looks up cannot
    // add a row, reorder one or annotate the wrong one.
    const markup = renderWithRuns([summary('a', { subjectName: 'Alpha' })], [runsFor('ghost')]);
    expect(markup.match(/<li/gu)).toHaveLength(1);
    expect(markup).not.toContain('student-practice-test-runs');
    expect(markup).not.toContain('2 out of 4');
  });

  it('renders every row exactly as before when it was handed no map at all', () => {
    // What a failed run read comes to. A row with no figure is the row that shipped
    // in Story 5.1, and it is still complete.
    const tests = [summary('a', { subjectName: 'Alpha', state: 'Completed' })];
    const without = render(tests);
    expect(without).not.toContain('student-practice-test-runs');
    expect(without).toContain('Completed');
    expect(without).toContain('A practice test with 4 questions');
    // Byte-for-byte the same as an empty map: absent and absent-for-this-row are one
    // rendering.
    expect(renderWithRuns(tests, [])).toBe(without);
  });
});
