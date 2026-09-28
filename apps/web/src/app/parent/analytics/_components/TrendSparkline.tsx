'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { sparklineGeometry, type SparklinePoint } from '@/lib/sparkline';
import type { TrendPointView } from '@/lib/parent-api';
import { readableInstant } from '@/lib/parent-view';
import { density, typeRoles } from '@/theme/tokens';

/**
 * One point of the text equivalent, as a whole sentence.
 *
 * The date is the run's own, checked through `readableInstant` so a stored instant
 * that will not parse becomes an undated sentence rather than the literal words
 * "Invalid Date" — which read as a fault in the work rather than in a string. The
 * excluded count is stated only where there is one: a note saying nothing was
 * excluded on every row is noise on the rows where it matters.
 */
function pointSentence(point: TrendPointView): string {
  const when = readableInstant(point.submittedAt) ?? parentCopy.analytics.trendPointUndated;
  return point.excludedUngraded === 0
    ? parentCopy.analytics.trendPoint(when, point.correct, point.denominator)
    : parentCopy.analytics.trendPointExcluded(
        when,
        point.correct,
        point.denominator,
        point.excludedUngraded,
      );
}

/** The drawing box, in the SVG's own user units. */
const BOX = { width: 240, height: 56, padding: 6 } as const;

/**
 * The one trend on the dashboard: the student's recent scores, oldest first.
 *
 * **Hand-built inline `<svg>`, because no chart library is installed** and this
 * story adds none: a charting dependency for one polyline is a bundle, a theming
 * surface and a version treadmill bought for five points. The coordinates come
 * from `sparklineGeometry`, which is pinned in its own spec — a chart's arithmetic
 * asserted through a render is arithmetic nothing can read back.
 *
 * **No fill, no gradient and no draw-in animation.** A filled area implies an
 * integral nobody computed, a gradient implies a scale nobody stated, and an
 * animated line makes a parent wait to read a number. The line and its markers are
 * the whole drawing.
 *
 * **A visible marker per plotted run**, so the chart says how many runs it is over
 * without anybody counting inflection points — and so a flat series is still
 * legibly five runs rather than one straight line.
 *
 * **It states its own scope on itself**, beside the drawing: how many runs, whose,
 * and that retakes are not on it. That sentence is what keeps this from being read
 * as a record of everything the student did — and it is why the Mastery table's own
 * window and this one are never reconciled: they are different questions, each
 * labelled.
 *
 * **The chart is `aria-hidden` and the text equivalent is real text.** A dated
 * list of what each run came to is what a screen reader gets, not a description of
 * a picture, and it is the same figures the drawing is of.
 *
 * **Each entry is labelled by the day it was handed in**, not by its place in the
 * list: a position renames itself the moment a run drops out of the window, and it
 * collides with the run ordinal a parent already knows a practice test by.
 *
 * **A run with questions nothing could mark says so.** `excludedUngraded` is the
 * difference between "3 of 4" and "3 of 4, and two more nobody could judge", and a
 * score stated without it reads as a worse result than it was.
 *
 * There is exactly one of these on the page and there is no per-topic line: a chart
 * per topic would be twelve charts nobody reads and a dozen scales to reconcile.
 */
export function TrendSparkline({
  points,
  windowSize,
  name,
}: {
  /** Oldest first, as the API answered. Nothing here re-sorts. */
  points: readonly TrendPointView[];
  /** The API's own window figure. Never a number written into this file. */
  windowSize: number;
  /** The student, named — Parent View is third person (UX-DR31). */
  name: string;
}) {
  const geometry = sparklineGeometry(
    points.map(
      (point): SparklinePoint => ({
        correct: point.correct,
        denominator: point.denominator,
      }),
    ),
    BOX,
  );
  // The geometry's own endpoint decides *which* point is the endpoint, so the
  // printed figure and the last marker cannot come apart; the view row beside it
  // is the one at the same index.
  const endpointIndex = geometry.markers.length - 1;
  const endpoint = endpointIndex < 0 ? null : (points[endpointIndex] ?? null);

  return (
    <Box
      component="section"
      aria-labelledby="analytics-trend-heading"
      sx={{ display: 'grid', gap: `${density.gap}px` }}
      data-testid="trend-sparkline"
    >
      <Typography id="analytics-trend-heading" component="h2" variant="cardTitle">
        {parentCopy.analytics.trendTitle}
      </Typography>
      {/* The scope, stated with the chart rather than in a legend elsewhere: a
          window a reader has to go and find is a window they will assume. */}
      <Typography component="p" sx={{ ...typeRoles.dashboardBody }} data-testid="trend-scope">
        {parentCopy.analytics.trendScope(name, windowSize)}
      </Typography>

      {points.length === 0 ? (
        <Typography component="p" data-testid="trend-empty">
          {parentCopy.analytics.trendEmpty(name)}
        </Typography>
      ) : (
        <>
          <Box
            component="svg"
            // `aria-hidden` alone: `role="presentation"` beside it says the same
            // thing again, and a hidden node has no role worth naming.
            aria-hidden="true"
            viewBox={`0 0 ${BOX.width} ${BOX.height}`}
            width={BOX.width}
            height={BOX.height}
            // `height: auto` with the width cap, so the box scales instead of
            // squashing: a fixed height under a shrinking width distorts the line
            // on every phone narrower than the drawing.
            sx={{ maxWidth: '100%', height: 'auto', overflow: 'visible' }}
          >
            {geometry.polyline !== '' && (
              <Box
                component="polyline"
                data-testid="trend-line"
                points={geometry.polyline}
                // `none`, explicitly: an unset `fill` on a polyline is black, which
                // would be the filled area this chart must not have.
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                sx={(theme) => ({ stroke: theme.vars.palette.primary.main })}
              />
            )}
            {geometry.markers.map((marker, index) => (
              <Box
                component="circle"
                key={points[index]!.attemptId}
                data-testid="trend-marker"
                cx={marker.x}
                cy={marker.y}
                r={3}
                sx={(theme) => ({ fill: theme.vars.palette.primary.main })}
              />
            ))}
          </Box>

          {/* The most recent figure, printed rather than left to be read off the
              line — in tabular figures, so it does not jump as it changes. */}
          {endpoint !== null && (
            <>
              <Typography
                component="p"
                sx={{ ...typeRoles.tableCell, fontVariantNumeric: 'tabular-nums' }}
                data-testid="trend-latest"
              >
                {parentCopy.analytics.trendLatest(endpoint.correct, endpoint.denominator)}
              </Typography>
              {endpoint.excludedUngraded > 0 && (
                <Typography
                  component="p"
                  sx={{ ...typeRoles.label }}
                  data-testid="trend-latest-excluded"
                >
                  {parentCopy.analytics.trendLatestExcluded(endpoint.excludedUngraded)}
                </Typography>
              )}
            </>
          )}

          {/* The accessible equivalent: the same figures as a list, because a
              picture of a chart is not a description of one. */}
          <Box
            component="ol"
            // `listStyle: 'none'` strips list semantics in Safari/VoiceOver along
            // with the item count, which here is the number of runs plotted.
            role="list"
            data-testid="trend-equivalent"
            sx={{ display: 'grid', gap: `${density.gap / 2}px`, p: 0, m: 0, listStyle: 'none' }}
          >
            {points.map((point) => (
              <Typography
                key={point.attemptId}
                component="li"
                role="listitem"
                sx={{ ...typeRoles.label }}
                data-testid="trend-equivalent-point"
              >
                {pointSentence(point)}
              </Typography>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
