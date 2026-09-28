import { describe, expect, it } from 'vitest';
import { sparklineGeometry, type SparklineBox } from './sparkline';

/**
 * The trend line's arithmetic.
 *
 * The two cases that break a hand-rolled sparkline are one point and a flat
 * series: the first renders as nothing at all if it is drawn as a polyline, and
 * the second divides by zero if the vertical scale is fitted to the data. Both are
 * failures a rendered chart hides, so both are decided here and pinned.
 */

const BOX: SparklineBox = { width: 100, height: 40, padding: 5 };
/** The two extremes of the fixed 0..1 scale, inside the padding. */
const TOP = BOX.padding;
const BOTTOM = BOX.height - BOX.padding;

describe('where the points go', () => {
  it('spreads the points across the box, oldest at the left', () => {
    const geometry = sparklineGeometry(
      [
        { correct: 0, denominator: 4 },
        { correct: 2, denominator: 4 },
        { correct: 4, denominator: 4 },
      ],
      BOX,
    );
    expect(geometry.markers.map((marker) => marker.x)).toEqual([5, 50, 95]);
    // y grows downward in SVG, so the perfect score is the smallest y.
    expect(geometry.markers.map((marker) => marker.y)).toEqual([BOTTOM, 20, TOP]);
  });

  it('holds the vertical scale at 0..1 and never fits it to the data', () => {
    // Fitted, this pair would be drawn as a collapse from the top of the chart to
    // the bottom. A parent reads this as "how is my child doing", so the axis has
    // to mean the same thing every time it is drawn.
    const geometry = sparklineGeometry(
      [
        { correct: 19, denominator: 20 },
        { correct: 18, denominator: 20 },
      ],
      BOX,
    );
    expect(geometry.markers[0]!.y).toBeCloseTo(BOTTOM - (BOTTOM - TOP) * 0.95);
    expect(geometry.markers[1]!.y).toBeCloseTo(BOTTOM - (BOTTOM - TOP) * 0.9);
    // Neither reaches an edge, which is the whole point.
    expect(geometry.markers.every((marker) => marker.y > TOP)).toBe(true);
  });

  it('draws a flat series as a straight line at its own height, not a collapsed one', () => {
    const geometry = sparklineGeometry(
      [
        { correct: 3, denominator: 4 },
        { correct: 3, denominator: 4 },
        { correct: 3, denominator: 4 },
      ],
      BOX,
    );
    const heights = new Set(geometry.markers.map((marker) => marker.y));
    expect(heights.size).toBe(1);
    expect([...heights][0]).toBeCloseTo(BOTTOM - (BOTTOM - TOP) * 0.75);
    expect(Number.isFinite(geometry.markers[0]!.y)).toBe(true);
  });

  it('plots a run nothing could mark on the midline, and says its fraction is absent', () => {
    // Plotting it at the bottom would tell a parent their child got none of it
    // right, when in fact nothing was judged.
    const geometry = sparklineGeometry([{ correct: 0, denominator: 0 }], BOX);
    expect(geometry.markers[0]!.fraction).toBeNull();
    expect(geometry.markers[0]!.y).toBeCloseTo((TOP + BOTTOM) / 2);
  });
});

describe('the degenerate series', () => {
  it('draws one point as one marker and no line', () => {
    // A polyline of a single point renders as nothing at all in every browser.
    const geometry = sparklineGeometry([{ correct: 1, denominator: 2 }], BOX);
    expect(geometry.markers).toHaveLength(1);
    expect(geometry.polyline).toBe('');
    // Centred rather than pinned to the left edge, which reads as a clipped chart.
    expect(geometry.markers[0]!.x).toBe(BOX.width / 2);
    expect(geometry.endpoint).toEqual(geometry.markers[0]);
  });

  it('answers empty geometry for no points at all', () => {
    expect(sparklineGeometry([], BOX)).toEqual({ polyline: '', markers: [], endpoint: null });
  });

  it('draws nothing at all rather than inverting a box the padding does not fit in', () => {
    // With `padding * 2 >= height` the span goes negative and every marker lands
    // outside the viewBox on the wrong side of the axis — a chart that silently
    // draws the inverse of the data, which is worse than no chart.
    const points = [
      { correct: 1, denominator: 4 },
      { correct: 4, denominator: 4 },
    ];
    const empty = { polyline: '', markers: [], endpoint: null };
    expect(sparklineGeometry(points, { width: 100, height: 10, padding: 5 })).toEqual(empty);
    expect(sparklineGeometry(points, { width: 100, height: 8, padding: 5 })).toEqual(empty);
    // And the same on the other axis.
    expect(sparklineGeometry(points, { width: 10, height: 100, padding: 5 })).toEqual(empty);
  });

  it('still draws the smallest box the padding does fit in', () => {
    // One unit of span either way. The guard refuses a degenerate box, not a
    // small one.
    const geometry = sparklineGeometry(
      [
        { correct: 0, denominator: 1 },
        { correct: 1, denominator: 1 },
      ],
      { width: 12, height: 11, padding: 5 },
    );
    expect(geometry.markers).toHaveLength(2);
    expect(geometry.markers[0]!.y).toBeGreaterThan(geometry.markers[1]!.y);
  });
});

describe('what the line and the endpoint are', () => {
  it('writes the polyline as the markers, in order', () => {
    const geometry = sparklineGeometry(
      [
        { correct: 1, denominator: 2 },
        { correct: 2, denominator: 2 },
      ],
      BOX,
    );
    expect(geometry.polyline).toBe(
      geometry.markers.map((marker) => `${marker.x},${marker.y}`).join(' '),
    );
  });

  it('makes the endpoint the most recent run, which is the last one given', () => {
    const geometry = sparklineGeometry(
      [
        { correct: 1, denominator: 4 },
        { correct: 4, denominator: 4 },
      ],
      BOX,
    );
    expect(geometry.endpoint).toEqual(geometry.markers[1]);
    expect(geometry.endpoint!.fraction).toBe(1);
  });

  it('keeps every marker inside the padded box, so none is clipped in half', () => {
    const geometry = sparklineGeometry(
      [
        { correct: 0, denominator: 3 },
        { correct: 3, denominator: 3 },
      ],
      BOX,
    );
    for (const marker of geometry.markers) {
      expect(marker.x).toBeGreaterThanOrEqual(BOX.padding);
      expect(marker.x).toBeLessThanOrEqual(BOX.width - BOX.padding);
      expect(marker.y).toBeGreaterThanOrEqual(TOP);
      expect(marker.y).toBeLessThanOrEqual(BOTTOM);
    }
  });
});
