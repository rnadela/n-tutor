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
import { CardField, CardList, TableCard, TableOnDesktop } from '@/components/TableCards';
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
 * **Two layouts, one state, and one accessibility tree (UX-DR44).** From the
 * desktop breakpoint this is the six-column table. Below it, every row is a card
 * carrying the same six facts as labeled fields — because six columns at 360px is
 * six columns of two characters each, and the hidden-column trick this layout
 * replaced answered that by dropping four of them from the eye and leaving a
 * sighted reader a figure with no counts beside it.
 *
 * The card list is `ranked`: one column at every width, in the server's order.
 * Weakest-first is the answer this table gives, and two columns would turn that
 * into a reading order a parent has to reconstruct.
 *
 * Only one layout is ever in the accessibility tree: the other is `display: none`,
 * so no row is announced twice. The breakpoints are `sx` keys and never
 * `useMediaQuery`: a hook that reads the viewport renders the phone layout first on
 * every device and then swaps, which is a visible reflow on the slowest device the
 * product runs on.
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

/** The stored name, or a neutral stand-in for a topic that no longer resolves. */
function labelOf(topic: MasteryTopicView): string {
  return topic.topicName ?? parentCopy.analytics.unknownTopic;
}

/**
 * The row's one way on, in whichever layout is asking for it.
 *
 * A real anchor filling its cell, so it is keyboard reachable and its accessible
 * name is the topic. Client-side, so the provider holding the elevation bearer
 * stays mounted across the navigation.
 *
 * The card's copy carries the `-card` testid: the two layouts are both in the
 * markup, and a spec counting one of them must not be handed the sum.
 */
function TopicOpener({
  topic,
  href,
  testId,
}: {
  topic: MasteryTopicView;
  href: Route<`/parent/analytics/topics/${string}`>;
  testId: string;
}) {
  return (
    <Link
      component={TopicLink}
      href={href}
      sx={{ display: 'block', minHeight: density.tapTarget }}
      data-testid={testId}
    >
      {labelOf(topic)}
    </Link>
  );
}

/**
 * The figure and the bar that restates it, shared by both layouts.
 *
 * A topic with no fraction says so in words: rendering it as 0% would tell a
 * parent their child got everything wrong on a topic they never answered.
 */
function MasteryReading({
  topic,
  percent,
  suffix,
}: {
  topic: MasteryTopicView;
  percent: number | null;
  /** `-card` on the card layout, empty on the table's. */
  suffix: string;
}) {
  return (
    <Box sx={{ display: 'grid', gap: `${density.gap / 2}px` }}>
      <Typography
        component="span"
        sx={{ ...typeRoles.tableCell, fontVariantNumeric: 'tabular-nums' }}
        data-testid={`mastery-figure${suffix}`}
      >
        {percent === null
          ? parentCopy.analytics.masteryNone
          : parentCopy.analytics.masteryFigure(percent, topic.answered)}
      </Typography>
      {/* The bar, which carries the same figure a second way. It is decoration
        over text that already states the number, so it is hidden from the
        accessibility tree rather than duplicating the sentence above it. */}
      <Box
        aria-hidden="true"
        data-testid={`mastery-bar${suffix}`}
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
    </Box>
  );
}

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

      <TableOnDesktop>
        <Table size="small" aria-label={heading} data-testid="mastery-table">
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">
                {parentCopy.analytics.topicColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {parentCopy.analytics.masteryColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {parentCopy.analytics.answeredColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {parentCopy.analytics.unansweredColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {parentCopy.analytics.runsColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {parentCopy.analytics.statusColumn}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {topics.map((topic) => (
              <TableRow
                key={topic.topicId}
                data-testid="mastery-row"
                data-topic-id={topic.topicId}
                // Mirrored so a DOM-less spec can read the verdict off the markup
                // rather than off a colour.
                data-weak-area={topic.isWeakArea ? 'true' : 'false'}
              >
                <TableCell>
                  <TopicOpener
                    topic={topic}
                    href={hrefFor(topic.topicId)}
                    testId="mastery-topic-link"
                  />
                </TableCell>
                <TableCell>
                  <MasteryReading topic={topic} percent={masteryPercent(topic.value)} suffix="" />
                </TableCell>
                <TableCell
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                  data-testid="mastery-answered"
                >
                  {topic.answered}
                </TableCell>
                <TableCell
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                  data-testid="mastery-unanswered"
                >
                  {topic.unanswered}
                </TableCell>
                {/* How many runs this row's own figure is over — the row's own scope,
                  and the server's count, never one derived here. */}
                <TableCell data-testid="mastery-runs">
                  {parentCopy.analytics.masteryRowScope(topic.attemptsCounted)}
                </TableCell>
                <TableCell>{topic.isWeakArea && <WeakAreaMarker />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableOnDesktop>

      {/* The same rows, below the desktop breakpoint, with every column that was
          a column now a labeled field. Ranked, so the server's weakest-first
          order is still the reading order. */}
      <CardList ranked label={heading} testId="mastery-cards">
        {topics.map((topic) => (
          <TableCard
            key={topic.topicId}
            title={labelOf(topic)}
            titleContent={
              <TopicOpener
                topic={topic}
                href={hrefFor(topic.topicId)}
                testId="mastery-topic-link-card"
              />
            }
            testId="mastery-card"
            dataAttributes={{
              'data-topic-id': topic.topicId,
              'data-weak-area': topic.isWeakArea ? 'true' : 'false',
            }}
          >
            <CardField
              label={parentCopy.analytics.masteryColumn}
              value={
                <MasteryReading
                  topic={topic}
                  percent={masteryPercent(topic.value)}
                  suffix="-card"
                />
              }
            />
            <CardField
              label={parentCopy.analytics.answeredColumn}
              value={topic.answered}
              tabular
              testId="mastery-answered-card"
            />
            {/* A bare `0` implies nothing by silence, which is exactly what the
              deleted phone sub-line said in words instead — so the card says it
              too. A real count keeps the tabular figures the column has; the
              sentence does not need them. */}
            <CardField
              label={parentCopy.analytics.unansweredColumn}
              value={
                topic.unanswered === 0 ? parentCopy.analytics.unansweredNone : topic.unanswered
              }
              tabular={topic.unanswered !== 0}
              testId="mastery-unanswered-card"
            />
            {/* The count itself, as the column states it. `masteryRowScope` reads
              "over 3 practice tests", which stutters the label into the value. */}
            <CardField
              label={parentCopy.analytics.runsColumn}
              value={topic.attemptsCounted}
              tabular
              testId="mastery-runs-card"
            />
            {/* The verdict, where the server gave one. A row it did not mark shows
              nothing here, exactly as its status cell does — the field itself
              still renders, matching the column it stands in for. */}
            <CardField
              label={parentCopy.analytics.statusColumn}
              value={topic.isWeakArea ? <WeakAreaMarker /> : null}
              testId="mastery-status-card"
            />
          </TableCard>
        ))}
      </CardList>
    </Box>
  );
}
