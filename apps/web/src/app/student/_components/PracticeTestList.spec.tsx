import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type { StudentPracticeTestSummary } from '@/lib/parent-api';
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
