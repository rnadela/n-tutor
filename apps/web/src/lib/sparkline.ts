/**
 * The trend line's geometry, as arithmetic.
 *
 * **No chart library.** `apps/web` has none installed and this story adds none: a
 * charting dependency for one polyline is a bundle, a theming surface and a
 * version treadmill bought for five points. The page draws an inline `<svg>` from
 * what this returns.
 *
 * **Geometry belongs in a spec, not in a render.** `apps/web` runs its unit suite
 * with `environment: 'node'`, so coordinates computed inside a component are
 * coordinates nothing can assert. The two cases that actually break a hand-rolled
 * sparkline — one point, and a perfectly flat series — are cases a rendered chart
 * would fail silently by drawing nothing or dividing by zero, so they are decided
 * here and pinned.
 *
 * **No fill, no gradient and no animation** is a rule about the drawing rather
 * than about this module, but it is why nothing here returns an area path: there
 * is no shape to fill because there is no fill.
 */

/** One plotted run, as the geometry needs it. Nothing about which test it was. */
export interface SparklinePoint {
  /** How many were right. */
  correct: number;
  /** What they were out of. Zero is legitimate: a run nothing could mark. */
  denominator: number;
}

/** The box the line is drawn in, in the SVG's own user units. */
export interface SparklineBox {
  width: number;
  height: number;
  /**
   * The inset the markers are drawn inside.
   *
   * Without it a marker at the top or bottom of the range is clipped in half by
   * the viewBox, which reads as a rendering fault rather than as a high score.
   */
  padding: number;
}

/** A plotted marker: where it is, and what it was. */
export interface SparklineMarker {
  x: number;
  y: number;
  /** The fraction this marker is, in `0..1`, or `null` for an unscorable run. */
  fraction: number | null;
}

export interface SparklineGeometry {
  /** The `points` attribute of a `<polyline>`, or `''` for a single marker. */
  polyline: string;
  /** One marker per plotted run, in the order they were given: oldest first. */
  markers: SparklineMarker[];
  /** The last marker, which is the one whose figure is printed. */
  endpoint: SparklineMarker | null;
}

/**
 * The fraction of one run, or `null` when it has no denominator to be out of.
 *
 * A run nothing could mark is not a zero: plotting it at the bottom of the chart
 * would tell a parent their child got none of it right, when in fact nothing was
 * judged. It is plotted on the midline instead, and its own text equivalent says
 * what it is.
 */
function fractionOf(point: SparklinePoint): number | null {
  if (point.denominator <= 0) return null;
  return point.correct / point.denominator;
}

/**
 * Where each point sits, and the polyline through them.
 *
 * **The vertical scale is fixed at 0..1 and is never fitted to the data.** A chart
 * that stretched to its own minimum and maximum would draw a dramatic collapse for
 * a student who went from 95% to 90%, and a flat line for one who went from 20% to
 * 90% on a day nothing else changed. A parent reads this as "how is my child
 * doing", so the axis has to mean the same thing every time it is drawn.
 *
 * **One point is drawn as one marker and no line.** A polyline of a single point
 * renders as nothing at all in every browser, so the marker is the chart — and the
 * page states the figure beside it either way.
 *
 * **A flat series is a straight line at its own height**, not a collapsed one: the
 * horizontal step is the box, never the data's range, so nothing here can divide
 * by zero.
 *
 * An empty series answers empty geometry rather than a degenerate line; the page
 * renders its own sentence and no chart at all.
 *
 * **A box the padding does not fit inside answers empty geometry too.** With
 * `padding * 2 >= height` the span inverts, and every marker is computed *outside*
 * the viewBox on the wrong side of the axis — a chart that silently draws the
 * inverse of the data. That is worse than no chart, so there is no chart: the
 * caller renders the figures, which it prints beside the drawing anyway.
 */
export function sparklineGeometry(
  points: readonly SparklinePoint[],
  box: SparklineBox,
): SparklineGeometry {
  if (points.length === 0) return { polyline: '', markers: [], endpoint: null };
  // Both axes, and `>=` rather than `>`: a zero span is a line with no height,
  // which is not a degenerate drawing so much as no drawing at all.
  if (box.padding * 2 >= box.height || box.padding * 2 >= box.width) {
    return { polyline: '', markers: [], endpoint: null };
  }

  const left = box.padding;
  const right = box.width - box.padding;
  const top = box.padding;
  const bottom = box.height - box.padding;
  const span = bottom - top;
  // One point sits in the middle horizontally rather than at the left edge: a lone
  // marker pinned to the corner reads as a clipped chart.
  const step = points.length === 1 ? 0 : (right - left) / (points.length - 1);

  const markers = points.map((point, index) => {
    const fraction = fractionOf(point);
    // An unscorable run is drawn on the midline — neither a success nor a failure,
    // because nothing judged it.
    const height = fraction ?? 0.5;
    return {
      x: points.length === 1 ? (left + right) / 2 : left + step * index,
      // SVG's y grows downward, so a higher fraction is a smaller y.
      y: bottom - span * height,
      fraction,
    };
  });

  return {
    polyline:
      markers.length === 1 ? '' : markers.map((marker) => `${marker.x},${marker.y}`).join(' '),
    markers,
    endpoint: markers[markers.length - 1] ?? null,
  };
}
