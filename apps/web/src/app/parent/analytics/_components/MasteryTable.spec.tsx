import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import type { MasteryTopicView } from '@/lib/parent-api';
import { parentTheme } from '@/theme/theme';
import { MasteryTable } from './MasteryTable';

/**
 * The ranked topic table, asserted over its own source.
 *
 * `apps/web` runs vitest with `environment: 'node'`, so the acceptance criterion
 * that matters here — that no Mastery figure is ever rendered without the counts
 * it is over — is read off the markup. What a percentage *is* is a pure function
 * with its own spec in `lib/analytics-view.spec.ts`.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'MasteryTable.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('what the mastery table states', () => {
  it('never states a figure without what it is over', () => {
    // A bare percentage is a percentage over a denominator nobody stated. The one
    // copy function that renders the figure takes the answered count with it.
    expect(CODE).toContain('parentCopy.analytics.masteryFigure(percent, topic.answered)');
    expect(CODE).not.toMatch(/\{\s*percent\s*\}%/u);
  });

  it('states the blank count on every row, at every width', () => {
    // As a column from the tablet breakpoint up, and as the row's sub-line on a
    // phone — so there is no width at which the figure is read without it.
    expect(CODE).toContain('data-testid="mastery-unanswered"');
    expect(CODE).toContain('data-testid="mastery-subline"');
    expect(CODE).toContain('parentCopy.analytics.unansweredNote(topic.unanswered)');
    // And "none" is said rather than left out, so nothing is implied by silence.
    expect(CODE).toContain('parentCopy.analytics.unansweredNone');
  });

  it('says in words that a topic has no figure, rather than drawing a zero', () => {
    // 0% would tell a parent their child got everything wrong on a topic they
    // never answered.
    expect(CODE).toContain('percent === null');
    expect(CODE).toContain('parentCopy.analytics.masteryNone');
  });

  it('renders the API order and sorts nothing', () => {
    expect(CODE).toContain('topics.map((topic)');
    expect(CODE).not.toMatch(/\.sort\(|localeCompare/u);
  });

  it('never re-decides a Weak Area, and never states a threshold', () => {
    // The verdict is the server's boolean. A comparison here would be a second
    // classifier that disagreed the day either figure was retuned.
    expect(CODE).toContain('topic.isWeakArea');
    // Anchored to whole identifiers and whole numbers: a bare `60` alternative
    // matched any two digits in the file — a `maxWidth: 160` would have tripped
    // it, and a real `60` inside one would not have been told apart.
    expect(CODE).not.toMatch(/\b(ceilingPercent|answeredFloor)\b/u);
    expect(CODE).not.toMatch(/\bweakArea\./u);
    expect(CODE).not.toMatch(/\b(60|0\.6)\b/u);
    // And no comparison of a figure against anything: the verdict is the boolean.
    expect(CODE).not.toMatch(/topic\.value\s*[<>]/u);
  });

  it('mirrors the verdict as a data attribute, so colour is never the only carrier', () => {
    expect(CODE).toContain("data-weak-area={topic.isWeakArea ? 'true' : 'false'}");
    expect(CODE).toContain('<WeakAreaMarker />');
  });

  it('keeps a row whose topic no longer resolves, with a stand-in label', () => {
    expect(CODE).toContain('topic.topicName ?? parentCopy.analytics.unknownTopic');
    expect(CODE).not.toMatch(/\.filter\(/u);
  });

  it('changes shape by breakpoint keys and never by a viewport hook', () => {
    // `useMediaQuery` renders the phone layout first on every device and then
    // swaps, which is a visible reflow on the slowest device the product runs on.
    expect(CODE).toContain('const phoneVisuallyHidden');
    expect(CODE).toContain("sm: 'static'");
    expect(CODE).not.toMatch(/useMediaQuery/u);
  });

  it('hides the narrow-width columns from the eye and never from assistive tech', () => {
    // `display: none` removes a header from the accessibility tree along with the
    // pixels, and a table whose headers are gone is a table whose cells have
    // nothing to be associated with.
    expect(CODE).toContain('visuallyHidden');
    expect(CODE).not.toMatch(/display:\s*\{\s*xs:\s*'none'/u);
    // And the phone-only restatements are hidden instead, so nothing is
    // announced twice.
    expect(CODE).toMatch(/aria-hidden="true"[\s\S]*data-testid="mastery-subline"/u);
  });

  it('hides the bar from the accessibility tree, because the text already says it', () => {
    expect(CODE).toContain('data-testid="mastery-bar"');
    expect(CODE).toContain('aria-hidden="true"');
  });

  it('offers no way on, because the drill-down is not this story', () => {
    expect(CODE).not.toMatch(/NextLink|href=|onClick|router/u);
  });

  it('carries no cost, plan or model figure', () => {
    expect(CODE).not.toMatch(/tier|upgrade|cost|price|model/iu);
  });
});

/**
 * And the table rendered, under the parent theme it is shown in.
 *
 * `renderToStaticMarkup` with no DOM, exactly as `GradeStateMarker.spec.tsx` does
 * it. The source assertions above say what the file contains; these say what a
 * parent's browser is actually sent — which is the only way the acceptance
 * criterion "no rendered Mastery figure appears without its counts" is a claim
 * about the render rather than about a regex.
 */
function row(over: Partial<MasteryTopicView> & { topicId: string }): MasteryTopicView {
  return {
    topicName: over.topicId,
    subjectId: 's-1',
    subjectName: 'Maths',
    correct: 0,
    incorrect: 0,
    unanswered: 0,
    answered: 0,
    attemptsCounted: 1,
    value: null,
    isWeakArea: false,
    ...over,
  };
}

function render(topics: readonly MasteryTopicView[]): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: parentTheme },
      createElement(MasteryTable, { topics, heading: 'Topics', windowSize: 5, name: 'Ada' }),
    ),
  );
}

/** How many times a testid appears in the markup. */
function count(markup: string, testid: string): number {
  return markup.split(`data-testid="${testid}"`).length - 1;
}

const ROWS: MasteryTopicView[] = [
  row({
    topicId: 'fractions',
    correct: 2,
    incorrect: 3,
    unanswered: 7,
    answered: 5,
    attemptsCounted: 3,
    value: 0.4,
    isWeakArea: true,
  }),
  row({
    topicId: 'decimals',
    correct: 9,
    incorrect: 1,
    unanswered: 0,
    answered: 10,
    attemptsCounted: 2,
    value: 0.9,
  }),
  row({
    topicId: 'orphan',
    topicName: null,
    subjectId: null,
    subjectName: null,
    correct: 1,
    incorrect: 1,
    unanswered: 2,
    answered: 2,
    value: 0.5,
  }),
];

describe('what the rendered mastery table shows a parent', () => {
  it('renders one row per topic, in the order it was given', () => {
    const markup = render(ROWS);
    expect(count(markup, 'mastery-row')).toBe(3);
    expect(markup.indexOf('fractions')).toBeLessThan(markup.indexOf('decimals'));
  });

  it('states every figure with the count it is over', () => {
    const markup = render(ROWS);
    expect(markup).toContain(parentCopy.analytics.masteryFigure(40, 5));
    expect(markup).toContain(parentCopy.analytics.masteryFigure(90, 10));
    // Three figures, three answered counts — none of them a bare percentage.
    expect(count(markup, 'mastery-figure')).toBe(3);
    expect(count(markup, 'mastery-answered')).toBe(3);
  });

  it('states the blank count on every row, as a cell and in the sub-line', () => {
    const markup = render(ROWS);
    expect(count(markup, 'mastery-unanswered')).toBe(3);
    expect(count(markup, 'mastery-subline')).toBe(3);
    expect(markup).toContain(parentCopy.analytics.unansweredNote(7));
    // And says so where there are none, rather than leaving it to be inferred.
    expect(markup).toContain(parentCopy.analytics.unansweredNone);
  });

  it('says in words that a topic with no fraction has no figure', () => {
    const markup = render([row({ topicId: 'skipped', unanswered: 4 })]);
    expect(markup).toContain(parentCopy.analytics.masteryNone);
    expect(markup).not.toContain(parentCopy.analytics.masteryFigure(0, 0));
  });

  it('marks exactly the weak row, and no other', () => {
    const markup = render(ROWS);
    expect(markup).toContain('data-weak-area="true"');
    expect(markup.split('data-weak-area="false"').length - 1).toBe(2);
    // One marker per weak row and per width it is drawn at — never on a row the
    // server did not mark. One weak row, two placements (sub-line and column).
    expect(count(markup, 'weak-area-marker')).toBe(2);
    expect(count(render([ROWS[1]!]), 'weak-area-marker')).toBe(0);
  });

  it('renders a row whose topic name is null, with its stand-in label', () => {
    const markup = render(ROWS);
    expect(markup).toContain(parentCopy.analytics.unknownTopic);
    // And it is still a row, not a dropped one.
    expect(count(markup, 'mastery-row')).toBe(3);
  });

  it('states the table’s own scope and every row’s own run count', () => {
    const markup = render(ROWS);
    expect(markup).toContain(parentCopy.analytics.masteryScope('Ada', 5));
    expect(markup).toContain(parentCopy.analytics.masteryRowScope(3));
    expect(markup).toContain(parentCopy.analytics.masteryRowScope(2));
  });

  it('keeps every header in the markup at every width, never display:none', () => {
    // `display: none` would take the headers out of the accessibility tree along
    // with the pixels, leaving the cells below nothing to be associated with.
    const markup = render(ROWS);
    for (const header of [
      parentCopy.analytics.topicColumn,
      parentCopy.analytics.masteryColumn,
      parentCopy.analytics.answeredColumn,
      parentCopy.analytics.unansweredColumn,
      parentCopy.analytics.runsColumn,
      parentCopy.analytics.statusColumn,
    ]) {
      expect(markup).toContain(header);
    }
    // Counted by the attribute rather than by `<th`, which `<thead` also contains.
    // That the hiding is visual and not `display: none` is asserted at the source
    // level above; MUI's own emitted stylesheet contains the declaration for
    // unrelated components, so it cannot be asserted over the markup here.
    expect(markup.split('scope="col"').length - 1).toBe(6);
  });

  it('renders nothing but the scope line and an empty body for no topics', () => {
    const markup = render([]);
    expect(count(markup, 'mastery-row')).toBe(0);
    expect(markup).toContain(parentCopy.analytics.masteryScope('Ada', 5));
  });
});
