'use client';

import type { Route } from 'next';
import NextLink from 'next/link';
import type { LinkProps } from 'next/link';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@/components/LiveRegion';
import { WeakAreaMarker } from '@/components/WeakAreaMarker';
import { parentCopy } from '@/copy/parent';
import { masteryPercent } from '@/lib/analytics-view';
import type { MasteryTopicView } from '@/lib/parent-api';
import { density, typeRoles } from '@/theme/tokens';

/**
 * One student's topics, ranked, with what they are out of beside every figure.
 *
 * **A bare percentage is explicitly rejected.** Every row states the fraction, the
 * questions it is over and how many were left blank — a percentage on its own is a
 * percentage over a denominator nobody stated, and a parent acting on "40%" needs
 * to know whether that is four questions or forty.
 *
 * **The API's order, and nothing here sorts.** Weakest-first is the server's
 * answer, and re-deciding it in the browser would be a second opinion about which
 * topic matters most. The Weak Area verdict is the server's too: this table
 * compares no figure against anything and knows no threshold.
 *
 * **It states its own scope on itself**, beside the heading and again on every
 * row. A topic's figure is over the last few practice tests that *asked about that
 * topic*, which is a different set of runs from the chart's — so the table says so
 * rather than letting the two figures on one page be read as one window. Both the
 * window and the per-row count are the server's figures; this file knows neither.
 *
 * **Two shapes at two widths, one density, and one accessibility tree.** On a phone
 * the answered and blank counts stack under the figure as a sub-line, because five
 * columns at 360px is five columns of two characters each. From the tablet
 * breakpoint they are real columns — the same rows, the same row height, no second
 * table.
 *
 * The narrow layout hides those columns **visually only**: `display: none` would
 * take the header cells out of the accessibility tree along with the pixels, and a
 * table whose headers are gone is a table whose cells have nothing to be associated
 * with. So the columns are visually hidden instead and stay in the tree at every
 * width, and the phone-only sub-line — which restates exactly those figures for a
 * sighted reader — is `aria-hidden`, so nothing is announced twice.
 *
 * The breakpoints are `sx` keys and never `useMediaQuery`: a hook that reads the
 * viewport renders the phone layout first on every device and then swaps, which is
 * a visible reflow on the slowest device the product runs on.
 *
 * **Every row opens.** The topic name is a link filling its cell, and `hrefFor` is a
 * required prop rather than an optional one: a row that cannot be opened is a
 * dashboard that still dead-ends, and an optional href is an href somebody forgets.
 * Where it goes is the caller's to compose — the drill-down is about one child and the
 * table does not know which one is selected.
 *
 * The link's accessible name is the topic, and nothing else: it is a real anchor rather
 * than a row click handler, so it is keyboard reachable and announced as a link without
 * a word of `aria-` over the top of it.
 *
 * No cost, plan name, price or model name reaches this table (AD-20, AD-26).
 */

/**
 * `NextLink`, pinned to the drill-down route.
 *
 * MUI's `component` prop takes a concrete component, and handing it the generic
 * `NextLink` collapses its route parameter to `unknown` — under which every *dynamic*
 * route stops being a legal href, this one included.
 */
function TopicLink(props: LinkProps<`/parent/analytics/topics/${string}`>) {
  return <NextLink {...props} />;
}
/**
 * Visually hidden up to the tablet breakpoint, an ordinary cell from there up.
 *
 * Every property is written at both widths rather than only at `xs`: MUI merges
 * breakpoint objects, so a value set only for the narrow case would still be in
 * force at `sm` and the cell would stay collapsed.
 */
const phoneVisuallyHidden = {
  position: { xs: visuallyHidden.position, sm: 'static' },
  width: { xs: visuallyHidden.width, sm: 'auto' },
  height: { xs: visuallyHidden.height, sm: 'auto' },
  overflow: { xs: visuallyHidden.overflow, sm: 'visible' },
  clip: { xs: visuallyHidden.clip, sm: 'auto' },
  clipPath: { xs: visuallyHidden.clipPath, sm: 'none' },
  whiteSpace: { xs: visuallyHidden.whiteSpace, sm: 'normal' },
  border: { xs: visuallyHidden.border, sm: undefined },
  padding: { xs: visuallyHidden.padding, sm: undefined },
  margin: { xs: visuallyHidden.margin, sm: 0 },
} as const;

export function MasteryTable({
  topics,
  heading,
  windowSize,
  name,
  hrefFor,
}: {
  topics: readonly MasteryTopicView[];
  /** The table's accessible name — the Subject's when the parent narrowed it. */
  heading: string;
  /** The API's own window figure. Never a number written into this file. */
  windowSize: number;
  /** The student, named — Parent View is third person (UX-DR31). */
  name: string;
  /**
   * Where this topic's drill-down is, for the student the caller has selected.
   *
   * Required, so no render of this table can leave a row unopenable — and the caller's,
   * because which child is selected is the dashboard's fact and not this table's.
   */
  hrefFor: (topicId: string) => Route<`/parent/analytics/topics/${string}`>;
}) {
  return (
    <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
      {/* The table's own scope, stated on the table and deliberately not the same
          scope the chart states. Neither is reconciled with the other. */}
      <Typography component="p" sx={{ ...typeRoles.dashboardBody }} data-testid="mastery-scope">
        {parentCopy.analytics.masteryScope(name, windowSize)}
      </Typography>
      <Table size="small" aria-label={heading} data-testid="mastery-table">
        <TableHead>
          <TableRow>
            <TableCell component="th" scope="col">
              {parentCopy.analytics.topicColumn}
            </TableCell>
            <TableCell component="th" scope="col">
              {parentCopy.analytics.masteryColumn}
            </TableCell>
            {/* Present in the accessibility tree at every width, and hidden only
              from the eye on a phone — `display: none` would take the header out
              of the tree too, leaving the cells below with nothing to be
              associated with. */}
            <TableCell component="th" scope="col" sx={phoneVisuallyHidden}>
              {parentCopy.analytics.answeredColumn}
            </TableCell>
            <TableCell component="th" scope="col" sx={phoneVisuallyHidden}>
              {parentCopy.analytics.unansweredColumn}
            </TableCell>
            <TableCell component="th" scope="col" sx={phoneVisuallyHidden}>
              {parentCopy.analytics.runsColumn}
            </TableCell>
            <TableCell component="th" scope="col" sx={phoneVisuallyHidden}>
              {parentCopy.analytics.statusColumn}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {topics.map((topic) => {
            const percent = masteryPercent(topic.value);
            return (
              <TableRow
                key={topic.topicId}
                data-testid="mastery-row"
                data-topic-id={topic.topicId}
                // Mirrored so a DOM-less spec can read the verdict off the markup
                // rather than off a colour.
                data-weak-area={topic.isWeakArea ? 'true' : 'false'}
              >
                <TableCell>
                  {/* The stored name, or a neutral stand-in for a topic that no
                    longer resolves: the row keeps its place and loses its label — and
                    it still opens, because the figure is still true whatever became of
                    the row that named it.

                    A real anchor filling the cell, so it is keyboard reachable and its
                    accessible name is the topic. Client-side, so the provider holding
                    the elevation bearer stays mounted across the navigation. */}
                  <Link
                    component={TopicLink}
                    href={hrefFor(topic.topicId)}
                    sx={{ display: 'block', minHeight: density.tapTarget }}
                    data-testid="mastery-topic-link"
                  >
                    {topic.topicName ?? parentCopy.analytics.unknownTopic}
                  </Link>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
                    <Typography
                      component="span"
                      sx={{ ...typeRoles.tableCell, fontVariantNumeric: 'tabular-nums' }}
                      data-testid="mastery-figure"
                    >
                      {/* A topic with no fraction says so in words. Rendering it as
                        0% would tell a parent their child got everything wrong on
                        a topic they never answered. */}
                      {percent === null
                        ? parentCopy.analytics.masteryNone
                        : parentCopy.analytics.masteryFigure(percent, topic.answered)}
                    </Typography>
                    {/* The bar, which carries the same figure a second way. It is
                      decoration over text that already states the number, so it is
                      hidden from the accessibility tree rather than duplicating
                      the sentence above it. */}
                    <Box
                      aria-hidden="true"
                      data-testid="mastery-bar"
                      sx={(theme) => ({
                        height: density.gap / 2,
                        width: '100%',
                        maxWidth: 120,
                        backgroundColor: theme.vars.palette.action.hover,
                        overflow: 'hidden',
                      })}
                    >
                      <Box
                        sx={(theme) => ({
                          height: '100%',
                          width: `${percent ?? 0}%`,
                          backgroundColor: topic.isWeakArea
                            ? theme.vars.palette.warning.main
                            : theme.vars.palette.primary.main,
                        })}
                      />
                    </Box>
                    {/* The phone's sub-line: the counts the columns carry at wider
                      widths, so a sighted reader never meets the figure without
                      them. `aria-hidden`, because those columns are still in the
                      accessibility tree at this width — announcing both would read
                      every row's blanks and run count twice. */}
                    <Typography
                      component="span"
                      aria-hidden="true"
                      sx={{ ...typeRoles.label, display: { xs: 'inline', sm: 'none' } }}
                      data-testid="mastery-subline"
                    >
                      {`${
                        topic.unanswered === 0
                          ? parentCopy.analytics.unansweredNone
                          : parentCopy.analytics.unansweredNote(topic.unanswered)
                      } — ${parentCopy.analytics.masteryRowScope(topic.attemptsCounted)}`}
                    </Typography>
                    {/* The verdict, for the same reason and with the same rule: the
                      status column below is still announced at this width. */}
                    <Box aria-hidden="true" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                      {topic.isWeakArea && <WeakAreaMarker />}
                    </Box>
                  </Box>
                </TableCell>
                <TableCell
                  sx={{ ...phoneVisuallyHidden, fontVariantNumeric: 'tabular-nums' }}
                  data-testid="mastery-answered"
                >
                  {topic.answered}
                </TableCell>
                <TableCell
                  sx={{ ...phoneVisuallyHidden, fontVariantNumeric: 'tabular-nums' }}
                  data-testid="mastery-unanswered"
                >
                  {topic.unanswered}
                </TableCell>
                {/* How many runs this row's own figure is over — the row's own scope,
                  and the server's count, never one derived here. */}
                <TableCell sx={phoneVisuallyHidden} data-testid="mastery-runs">
                  {parentCopy.analytics.masteryRowScope(topic.attemptsCounted)}
                </TableCell>
                <TableCell sx={phoneVisuallyHidden}>
                  {topic.isWeakArea && <WeakAreaMarker />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
