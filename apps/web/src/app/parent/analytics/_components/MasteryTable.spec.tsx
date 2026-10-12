import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Route } from 'next';
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

  it('states the blank count on every row, in both layouts', () => {
    // As a column in the table, and as a labeled field on the card — so there is
    // no width at which the figure is read without it.
    expect(CODE).toContain('data-testid="mastery-unanswered"');
    expect(CODE).toContain('testId="mastery-unanswered-card"');
    expect(CODE).toContain('parentCopy.analytics.unansweredColumn');
    // And "none" is said in words rather than drawn as a bare `0`, so nothing is
    // implied by silence. This is the rule the deleted phone sub-line carried.
    expect(CODE).toContain('topic.unanswered === 0');
    expect(CODE).toContain('parentCopy.analytics.unansweredNone');
  });

  it('states the run count as the count, not as the sentence about it', () => {
    // `masteryRowScope` reads "over 3 practice tests", which under a field
    // labeled "Practice tests" stutters the label into the value. The table's own
    // cell is where the sentence belongs.
    expect(CODE).toContain('value={topic.attemptsCounted}');
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
    // The swap itself is the shared pattern's, stated once in `TableCards.tsx`
    // and asserted there; this file's job is to go through it.
    expect(CODE).toContain('<TableOnDesktop>');
    expect(CODE).toContain('<CardList ranked');
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia/u);
    // And no breakpoint of its own: the cutoff is not a figure this file knows.
    expect(CODE).not.toMatch(/@media|breakpoints/u);
  });

  it('drops no column on a phone, and states every one as a labeled field', () => {
    // What this layout replaced hid four of the six columns from the eye with a
    // clip rectangle, which left a sighted reader a figure with no counts beside
    // it. Every column is now a field on the card, labeled by the column's own
    // header so the two layouts cannot drift into two names for one fact.
    expect(CODE).not.toContain('phoneVisuallyHidden');
    expect(CODE).not.toContain('visuallyHidden');
    for (const label of [
      'parentCopy.analytics.masteryColumn',
      'parentCopy.analytics.answeredColumn',
      'parentCopy.analytics.unansweredColumn',
      'parentCopy.analytics.runsColumn',
      'parentCopy.analytics.statusColumn',
    ]) {
      // Twice: once as the table's header, once as the card field's label.
      expect(CODE.split(label).length - 1, label).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the hidden layout out of the accessibility tree rather than clipping it', () => {
    // Both layouts are the same rows, so the one that is not drawn has to leave
    // the tree entirely — a duplicate that is merely invisible is every row
    // announced twice. That is why the phone-only sub-line and the phone-only
    // marker, which existed to restate columns that stayed in the tree, are gone.
    expect(CODE).not.toContain('mastery-subline');
    expect(CODE).not.toMatch(/display:\s*\{\s*xs:\s*'inline'/u);
    expect(CODE).not.toMatch(/display:\s*\{\s*xs:\s*'inline-flex'/u);
  });

  it('hides the bar from the accessibility tree, because the text already says it', () => {
    expect(CODE).toContain('data-testid={`mastery-bar${suffix}`}');
    expect(CODE).toContain('aria-hidden="true"');
  });

  it('offers its one way on as a link, and no click handler standing in for one', () => {
    // A row opens through an anchor, which is keyboard reachable and announced as a
    // link. A row-level `onClick` would be neither, and a router push from a table cell
    // would be navigation nothing can see the destination of.
    //
    // Asserted as "the topic cell is an anchor whose href is the caller's" rather than
    // by counting `href=` occurrences: an unrelated anchor added elsewhere in this table
    // is not a regression in this rule, and a count would call it one.
    expect(CODE).not.toMatch(/onClick|router/u);
    expect(CODE).toContain('component={TopicLink}');
    expect(CODE).toContain('href={hrefFor(topic.topicId)}');
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

/**
 * The caller's own href composition, stood in for here.
 *
 * The table takes it as a required prop precisely because *where* a row goes is the
 * dashboard's fact and not the table's, so the spec supplies one rather than the table
 * having a default a caller could forget to replace.
 */
const TEST_HREF_FOR = (topicId: string): Route<`/parent/analytics/topics/${string}`> =>
  `/parent/analytics/topics/${topicId}`;

function render(topics: readonly MasteryTopicView[]): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: parentTheme },
      createElement(MasteryTable, {
        topics,
        heading: 'Topics',
        windowSize: 5,
        name: 'Ada',
        hrefFor: TEST_HREF_FOR,
      }),
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
  it('renders one row per topic, in the order it was given, in both layouts', () => {
    const markup = render(ROWS);
    expect(count(markup, 'mastery-row')).toBe(3);
    expect(count(markup, 'mastery-card')).toBe(3);
    expect(markup.indexOf('fractions')).toBeLessThan(markup.indexOf('decimals'));
  });

  it('draws the card list as a ranked, one-column list of real li cards', () => {
    // Weakest-first is the answer this table gives; two columns would turn that
    // into a reading order a parent has to reconstruct.
    const markup = render(ROWS);
    expect(markup).toContain('data-testid="mastery-cards"');
    expect(markup).toContain('<ul');
    expect(markup).toContain('<li');
    expect(markup).not.toContain('repeat(2');
  });

  it('states every figure with the count it is over', () => {
    const markup = render(ROWS);
    expect(markup).toContain(parentCopy.analytics.masteryFigure(40, 5));
    expect(markup).toContain(parentCopy.analytics.masteryFigure(90, 10));
    // Three figures, three answered counts — none of them a bare percentage.
    // Once per row in each layout, counted apart: the card's copies carry the
    // `-card` suffix, so a count of one layout is never handed the sum.
    expect(count(markup, 'mastery-figure')).toBe(3);
    expect(count(markup, 'mastery-figure-card')).toBe(3);
    expect(count(markup, 'mastery-answered')).toBe(3);
    expect(count(markup, 'mastery-answered-card')).toBe(3);
  });

  it('states the blank count on every row, as a cell and as a card field', () => {
    const markup = render(ROWS);
    expect(count(markup, 'mastery-unanswered')).toBe(3);
    expect(count(markup, 'mastery-unanswered-card')).toBe(3);
    // The card names the column it is stating, so the figure is never a bare
    // number with nothing saying what it counts.
    expect(markup).toContain(parentCopy.analytics.unansweredColumn);
  });

  it('says in words that a row has no blanks, rather than drawing a zero', () => {
    // `decimals` left none blank. A bare `0` under "Left blank" implies nothing by
    // silence, which is what the deleted phone sub-line said in words instead.
    const none = render([ROWS[1]!]);
    expect(none).toContain(parentCopy.analytics.unansweredNone);
    // A row that does have blanks states the figure itself.
    const some = render([ROWS[0]!]);
    expect(some).not.toContain(parentCopy.analytics.unansweredNone);
  });

  it('states a row’s run count as the number, never as the sentence', () => {
    const markup = render(ROWS);
    // The table's cell carries the sentence; the card's field carries the count
    // under the column's own label, so neither stutters.
    expect(markup).toContain(parentCopy.analytics.masteryRowScope(3));
    expect(count(markup, 'mastery-runs-card')).toBe(3);
    expect(markup.split(parentCopy.analytics.masteryRowScope(3)).length - 1).toBe(1);
  });

  it('says in words that a topic with no fraction has no figure', () => {
    const markup = render([row({ topicId: 'skipped', unanswered: 4 })]);
    expect(markup).toContain(parentCopy.analytics.masteryNone);
    expect(markup).not.toContain(parentCopy.analytics.masteryFigure(0, 0));
  });

  it('marks exactly the weak row, and no other', () => {
    const markup = render(ROWS);
    expect(markup).toContain('data-weak-area="true"');
    // Two layouts, so the verdict is mirrored on four unmarked rows and two marked.
    expect(markup.split('data-weak-area="false"').length - 1).toBe(4);
    expect(markup.split('data-weak-area="true"').length - 1).toBe(2);
    // One marker per weak row per layout — never on a row the server did not mark.
    expect(count(markup, 'weak-area-marker')).toBe(2);
    expect(count(render([ROWS[1]!]), 'weak-area-marker')).toBe(0);
  });

  it('renders a row whose topic name is null, with its stand-in label', () => {
    const markup = render(ROWS);
    expect(markup).toContain(parentCopy.analytics.unknownTopic);
    // And it is still a row, not a dropped one — in both layouts.
    expect(count(markup, 'mastery-row')).toBe(3);
    expect(count(markup, 'mastery-card')).toBe(3);
  });

  it('states the table’s own scope and every row’s own run count', () => {
    const markup = render(ROWS);
    expect(markup).toContain(parentCopy.analytics.masteryScope('Ada', 5));
    expect(markup).toContain(parentCopy.analytics.masteryRowScope(3));
    expect(markup).toContain(parentCopy.analytics.masteryRowScope(2));
  });

  it('keeps every one of the six columns, and states each one on the card too', () => {
    // The table keeps all six from the desktop breakpoint up; below it every one
    // of them is a labeled field, so no width drops a fact.
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
    expect(markup.split('scope="col"').length - 1).toBe(6);
    // And the card's own copies of the five non-identifying columns.
    for (const testid of [
      'mastery-figure-card',
      'mastery-answered-card',
      'mastery-unanswered-card',
      'mastery-runs-card',
      'mastery-status-card',
    ]) {
      expect(count(markup, testid), testid).toBe(3);
    }
  });

  it('renders nothing but the scope line, an empty body and an empty ul for no topics', () => {
    const markup = render([]);
    expect(count(markup, 'mastery-row')).toBe(0);
    expect(count(markup, 'mastery-card')).toBe(0);
    expect(markup).toContain('data-testid="mastery-cards"');
    expect(markup).not.toContain('<li');
    expect(markup).toContain(parentCopy.analytics.masteryScope('Ada', 5));
  });
});

describe('opening a row', () => {
  it('renders the topic name as a real link carrying the topic id', () => {
    // A row that cannot be opened is a dashboard that still dead-ends. An anchor rather
    // than a row click handler, so it is keyboard reachable and announced as a link.
    const markup = render(ROWS);
    expect(count(markup, 'mastery-topic-link')).toBe(ROWS.length);
    // And the card's title is the same anchor, so a row opens at every width.
    expect(count(markup, 'mastery-topic-link-card')).toBe(ROWS.length);
    for (const topic of ROWS) {
      expect(markup).toContain(`href="/parent/analytics/topics/${topic.topicId}"`);
    }
  });

  it('makes the link’s accessible name the topic, and never a bare glyph', () => {
    const markup = render([ROWS[0]!]);
    expect(markup).toMatch(
      new RegExp(`data-testid="mastery-topic-link"[^>]*>${ROWS[0]!.topicName}<`, 'u'),
    );
  });

  it('opens a row whose topic no longer resolves, with the stand-in as its name', () => {
    // The figure is still true whatever became of the row that named it.
    const markup = render([row({ topicId: 'gone', topicName: null })]);
    expect(markup).toContain('href="/parent/analytics/topics/gone"');
    expect(markup).toContain(parentCopy.analytics.unknownTopic);
  });

  it('composes no URL of its own', () => {
    // Which child is selected is the dashboard's fact; a route composed here would be a
    // second place the drill-down's address lives. The route only appears as the type
    // the prop is checked against, never as a value.
    expect(CODE).toContain('hrefFor(topic.topicId)');
    expect(CODE).not.toMatch(/href=\{`/u);
    expect(CODE).not.toMatch(/student=/u);
  });
});
