'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { GradeStateGlyph } from '@/components/GradeStateMarker';
import { QuestionGrid, type QuestionGridCell } from '@/components/QuestionGrid';
import { commonCopy } from '@/copy/common';
import type { GradeState } from '@/lib/parent-api';
import { typeRoles } from '@/theme/tokens';

/**
 * The four states in the order a legend lists them, which is the order the token table
 * states them in: the two verdicts, then the blank, then the one state that is not a
 * judgement. A fixed order so the legend does not reshuffle itself as a run is graded.
 */
const LEGEND_ORDER: readonly GradeState[] = ['Correct', 'Incorrect', 'Unanswered', 'Ungraded'];

/**
 * Every word the results map says, as a parameter.
 *
 * **Required and never defaulted**, exactly as `AnswerKeyRowLabels` is: a default
 * would be one surface's person, and the other would ship it. The child reads "you are
 * here"; the parent reads about their child and is never addressed as them.
 *
 * The four grade labels are deliberately **absent** from this interface. They are
 * `commonCopy.gradeState`'s — cross-surface literals with one home — and they arrive
 * here as the `gradeLabel` argument, so a map cell cannot come to say a different word
 * for a state than the row it jumps to.
 */
export interface AnswerKeyMapLabels {
  /** The map's own heading, in both the rail and the overlay. */
  heading: string;
  /** One cell's whole spoken sentence. The grade label is handed in. */
  cellState: (
    ordinal: number,
    gradeLabel: string,
    current: boolean,
    newlyGraded: boolean,
  ) => string;
  /** The `aria-hidden` mark drawn in a cell this read judged. */
  cellNewlyGraded: string;
  /** One legend entry, for the fixed literal of a state that is present. */
  legendEntry: (gradeLabel: string) => string;
}

/** The one fact per row the map needs. A projection, so the map holds no view type. */
export interface AnswerKeyMapRow {
  questionId: string;
  ordinal: number;
  state: GradeState;
  newlyGraded: boolean;
}

/**
 * The results map: every Question of a marked paper, where each one stands, and a way
 * to reach it.
 *
 * **A separate component from `QuestionMap`, and not a mode of it.** The progress map's
 * spec asserts that its rendered markup matches none of `/score/`, `/%/`, `/correct/`,
 * `/wrong/`, `/grade/` or `/right/`, and that is not incidental: it is the proof that
 * no correctness leaks onto a screen read while the child is still working. This map
 * says nothing *but* correctness. One component could never satisfy both bans, so "two
 * vocabularies for two moments" is a deliberate rule rather than duplication nobody got
 * round to removing. What the two genuinely share — the grid rule, the button's box, the
 * `aria-hidden` digit, the single visually-hidden sentence, `aria-current` — is
 * extracted into `QuestionGrid` and lives in exactly one place.
 *
 * **Grade vocabulary only, and no arithmetic at all.** No percentage, no tally, no
 * "8 of 12": the score is the header's one figure, stated once by the surface from the
 * two numbers the server computed (FR-37). A map that counted its own cells would be a
 * second answer to a question already answered.
 *
 * **Every state is carried four ways in the cell** — the glyph's shape, its frame, its
 * outline texture, and the fixed literal inside the cell's accessible sentence — with
 * colour as a fifth that is never alone. The glyph is `aria-hidden`, so the sentence is
 * the whole accessible name and the state is never read out twice.
 *
 * **The heading is an `h3`** wherever this draws one: a sibling of the surface's own
 * answer-key section heading,
 * under its `h2` (the child's results) or `h1` (the parent's detail). That keeps the
 * row's `h4` correctly nested beneath a heading rather than beside one — the same
 * reasoning `AnswerKeyRow` states for its own level. An outline that lies is worse than
 * no outline.
 *
 * **The legend lists only the states that are present.** A legend naming `Not graded
 * yet` on a fully-marked paper describes a state the reader cannot see, which is an
 * invitation to look for it.
 */
export function AnswerKeyMap({
  rows,
  currentIndex,
  onJump,
  labels,
  headingProvided = false,
}: {
  /** Every row, in the order the server gave them. Never re-sorted here. */
  rows: readonly AnswerKeyMapRow[];
  /**
   * Which Question the screen is on, as **one index** into `rows`.
   *
   * An index and not an ordinal, although the ordinal is what the URL carries and what
   * the pager resolves from: `AnswerKeyRowView` promises neither that the ordinals are
   * dense nor that they are distinct, and two rows sharing a number would otherwise both
   * be marked `aria-current` — two "you are here" cells in one map. The pager does the
   * resolving, once, and hands the answer down.
   *
   * `-1` for an ordinal that matches no row, which marks no cell at all.
   */
  currentIndex: number;
  /** The pressed cell's index. The pager turns it into the ordinal the URL carries. */
  onJump(index: number): void;
  labels: AnswerKeyMapLabels;
  /**
   * Whether the container already states the heading, in which case this draws none.
   *
   * The overlay form is an `AppDialog`, whose own title is the same string: an `h3`
   * repeating it underneath would make a reader hear the identical line twice before the
   * first cell. The rail has no title of its own, so it keeps the `h3` — which is also
   * what keeps the row's `h4` nested beneath a heading rather than beside one.
   */
  headingProvided?: boolean;
}) {
  const cells: QuestionGridCell[] = rows.map((row, index) => {
    const current = index === currentIndex;
    // Gated on the state as well as the flag, as the row itself is: a cell saying both
    // "not graded yet" and "just graded" is the one thing nobody could make sense of.
    const newlyGraded = row.newlyGraded && row.state !== 'Ungraded';
    return {
      key: row.questionId,
      ordinal: row.ordinal,
      current,
      // Every cell, because after a hand-in every Question has been dealt with. The
      // ground is not a carrier here — the glyph and the sentence are.
      tone: 'done',
      data: {
        'data-state': row.state,
        ...(newlyGraded ? { 'data-newly-graded': 'true' } : {}),
      },
      glyph: (
        <>
          {/* A relative length, so one cell geometry serves the Student Mode tap
              target and the Parent View one with neither written in here. */}
          <GradeStateGlyph state={row.state} size="1.25em" testId="answer-key-map-glyph" />
          {newlyGraded && (
            <Box
              component="span"
              aria-hidden="true"
              data-testid="answer-key-map-newly-graded"
              sx={{ lineHeight: 1 }}
            >
              {labels.cellNewlyGraded}
            </Box>
          )}
        </>
      ),
      sentence: labels.cellState(
        row.ordinal,
        commonCopy.gradeState[row.state],
        current,
        newlyGraded,
      ),
    };
  });

  /** The states actually on this paper, in the fixed order, so the legend is stable. */
  const present = LEGEND_ORDER.filter((state) => rows.some((row) => row.state === state));

  return (
    <Box sx={(theme) => ({ display: 'grid', gap: `${theme.density.gap}px` })}>
      {headingProvided ? null : (
        <Typography
          component="h3"
          sx={{ ...typeRoles.cardTitle }}
          data-testid="answer-key-map-heading"
        >
          {labels.heading}
        </Typography>
      )}
      {/* The grid hands back an index and so does this: the translation to the ordinal
          the URL carries happens in the pager, once, where the row list it is an index
          into is the same list the pager pages. */}
      <QuestionGrid
        cells={cells}
        onJump={onJump}
        testId="answer-key-map"
        cellTestId="answer-key-map-cell"
      />
      {/* On screen, because without it the glyphs would be the only account of a state
          for anyone reading the map visually — and only the states that are here. */}
      <Box
        data-testid="answer-key-map-legend"
        // A group, not labelled with the map's own heading text: the overlay form
        // states that heading once, as its dialog title, and a second copy of the
        // same words here would read it out again (see the test right above this
        // component's `headingProvided` branch).
        role="group"
        sx={(theme) => ({
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${theme.density.gap}px`,
        })}
      >
        {present.map((state) => (
          <Typography
            key={state}
            sx={{ ...typeRoles.caption, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            data-testid="answer-key-map-legend-entry"
            data-state={state}
          >
            <GradeStateGlyph state={state} size="1.25em" testId="answer-key-map-legend-glyph" />
            {labels.legendEntry(commonCopy.gradeState[state])}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
