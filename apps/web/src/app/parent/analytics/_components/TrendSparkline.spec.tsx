import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import webPackage from '../../../../../package.json' with { type: 'json' };
import { parentCopy } from '@/copy/parent';
import type { TrendPointView } from '@/lib/parent-api';
import { readableInstant } from '@/lib/parent-view';
import { parentTheme } from '@/theme/theme';
import { TrendSparkline } from './TrendSparkline';

/**
 * The dashboard's one trend, asserted over its own source.
 *
 * The geometry is a pure function with its own spec; what is asserted here is
 * everything a render decides — that there is no fill, no gradient and no
 * animation, that the chart states its own scope, that it has a text equivalent,
 * and that no chart library was added to build it.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'TrendSparkline.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('how the trend is drawn', () => {
  it('is a hand-built inline svg, with no chart library anywhere in the app', () => {
    expect(CODE).toContain('component="svg"');
    expect(CODE).toContain('sparklineGeometry');
    const dependencies = {
      ...webPackage.dependencies,
      ...webPackage.devDependencies,
    } as Record<string, string>;
    for (const name of Object.keys(dependencies)) {
      expect(name).not.toMatch(/recharts|chart\.js|victory|nivo|visx|d3|apexcharts|plotly/u);
    }
  });

  it('has no fill, no gradient and no animation', () => {
    // A filled area implies an integral nobody computed, a gradient implies a
    // scale nobody stated, and an animated line makes a parent wait for a number.
    expect(CODE).toContain('fill="none"');
    expect(CODE).not.toMatch(/linearGradient|radialGradient|<Box component="path"/u);
    expect(CODE).not.toMatch(/animate|transition:|keyframes|@keyframes/u);
  });

  it('draws a visible marker per plotted run', () => {
    expect(CODE).toContain('geometry.markers.map');
    expect(CODE).toContain('data-testid="trend-marker"');
  });

  it('computes no coordinate of its own', () => {
    // The arithmetic is in `lib/sparkline.ts`, where it has a spec. A formula
    // here would be a second scale nothing can read back.
    expect(CODE).not.toMatch(/Math\.(min|max)\(|\/\s*\(points\.length/u);
  });
});

describe('what the trend says about itself', () => {
  it('states its own window and scope on the chart, from the API figure', () => {
    // A window a reader has to go and find is a window they will assume — and the
    // figure is the server's, never a number written into this file.
    expect(CODE).toContain('parentCopy.analytics.trendScope(name, windowSize)');
    expect(CODE).toContain('data-testid="trend-scope"');
    expect(CODE).not.toMatch(/windowSize\s*=\s*\d|const\s+WINDOW/u);
  });

  it('never claims to be a record of everything the student did', () => {
    // The sentence lives in the copy module, not in this component — asserting
    // against a file that holds no prose could not fail for this reason.
    const scope = parentCopy.analytics.trendScope('Ada', 5);
    expect(scope).toContain('Retakes are not plotted');
    expect(scope).toContain('last 5');
    expect(scope).not.toMatch(/\ball\b|\bevery\b|\bcomplete\b|whole history/iu);
    expect(parentCopy.analytics.trendTitle).not.toMatch(/\ball\b|\bevery\b/iu);
  });

  it('gives a screen reader the figures, not a description of a picture', () => {
    expect(CODE).toContain('aria-hidden="true"');
    expect(CODE).toContain('data-testid="trend-equivalent"');
    expect(CODE).toContain('data-testid="trend-equivalent-point"');
    expect(CODE).toContain('parentCopy.analytics.trendPoint(when, point.correct');
    // The list semantics restored by hand, as every other list in this app does.
    expect(CODE).toContain('role="list"');
  });

  it('prints the most recent figure in tabular figures', () => {
    expect(CODE).toContain('parentCopy.analytics.trendLatest');
    expect(CODE).toContain("fontVariantNumeric: 'tabular-nums'");
  });

  it('names the student through the address rather than a literal', () => {
    // Parent View is third person by name (UX-DR31); the name is a prop.
    expect(CODE).toContain('name: string');
    expect(CODE).toContain('parentCopy.analytics.trendEmpty(name)');
  });

  it('re-sorts nothing: the order is the API answer', () => {
    expect(CODE).not.toMatch(/\.sort\(|\.reverse\(/u);
  });
});

/**
 * And the chart rendered, under the parent theme it is shown in.
 *
 * `renderToStaticMarkup` with no DOM, the precedent `GradeStateMarker.spec.tsx`
 * set. The geometry has its own spec; what these assert is that the drawing and
 * its text equivalent actually carry one entry per run — which a source regex
 * cannot say.
 */
function point(over: Partial<TrendPointView> & { attemptId: string }): TrendPointView {
  return {
    submittedAt: '2026-01-02T09:00:00.000Z',
    correct: 3,
    denominator: 4,
    excludedUngraded: 0,
    ...over,
  };
}

function render(points: readonly TrendPointView[]): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: parentTheme },
      createElement(TrendSparkline, { points, windowSize: 5, name: 'Ada' }),
    ),
  );
}

function count(markup: string, testid: string): number {
  return markup.split(`data-testid="${testid}"`).length - 1;
}

const POINTS = ['a-1', 'a-2', 'a-3'].map((attemptId, index) =>
  point({ attemptId, submittedAt: `2026-01-0${index + 1}T09:00:00.000Z`, correct: index + 1 }),
);

describe('what the rendered trend shows a parent', () => {
  it('draws one marker per plotted run, and one line through them', () => {
    const markup = render(POINTS);
    expect(count(markup, 'trend-marker')).toBe(3);
    expect(count(markup, 'trend-line')).toBe(1);
  });

  it('gives one text-equivalent entry per run, and no more', () => {
    const markup = render(POINTS);
    expect(count(markup, 'trend-equivalent-point')).toBe(3);
  });

  it('labels each entry by its own date, never by its place in the list', () => {
    const markup = render(POINTS);
    for (const entry of POINTS) {
      const when = readableInstant(entry.submittedAt)!;
      expect(markup).toContain(
        parentCopy.analytics.trendPoint(when, entry.correct, entry.denominator),
      );
    }
    // The position labels the old copy produced appear nowhere.
    expect(markup).not.toMatch(/Test \d:/u);
  });

  it('states the excluded count where there is one, and not where there is not', () => {
    const markup = render([
      point({ attemptId: 'a-1', correct: 3, denominator: 4, excludedUngraded: 2 }),
    ]);
    expect(markup).toContain('could not be marked');
    expect(count(markup, 'trend-latest-excluded')).toBe(1);
    expect(count(render(POINTS), 'trend-latest-excluded')).toBe(0);
  });

  it('draws a marker and no line for a single run', () => {
    const markup = render([point({ attemptId: 'only' })]);
    expect(count(markup, 'trend-marker')).toBe(1);
    expect(count(markup, 'trend-line')).toBe(0);
  });

  it('prints the most recent figure, which is the last point given', () => {
    const markup = render(POINTS);
    expect(markup).toContain(parentCopy.analytics.trendLatest(3, 4));
  });

  it('draws no chart at all and says so when there is nothing to plot', () => {
    const markup = render([]);
    expect(count(markup, 'trend-marker')).toBe(0);
    expect(markup).toContain(parentCopy.analytics.trendEmpty('Ada'));
    expect(markup).toContain(parentCopy.analytics.trendScope('Ada', 5));
  });

  it('scales instead of squashing, and names no redundant role', () => {
    const markup = render(POINTS);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="presentation"');
    expect(markup).toMatch(/height:\s*auto/u);
  });
});
