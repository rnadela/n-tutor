'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { RichText } from '@/components/RichText';
import type { AnswerKeyRowView } from '@/lib/parent-api';
import { GRADE_PALETTE } from '@/theme/grade-state-palette';
import {
  GRADE_RULE_WIDTH,
  comfortableDensity,
  gradeStateMarker,
  type GradeStateMarker as GradeStateMarkerToken,
  typeRoles,
} from '@/theme/tokens';
import { GradeStateMarker } from './GradeStateMarker';

/**
 * Every user-facing string one answer-key row says, as a parameter.
 *
 * **Because two surfaces now render this row in two different persons.** The child
 * reads "You answered"; the parent reads about their child in the third person, and
 * never addressed to them. Duplicating the ~150 lines of grade-marker layout below
 * into a parent copy would let the two drift on exactly the redundant carriers
 * accessibility depends on — five carriers per state, on a component whose specs
 * assert over markup with every colour stripped. So the layout is one component and
 * the words are an argument.
 *
 * **Required, not defaulted.** A default would be the student's wording, which is
 * the one thing a parent surface must not accidentally ship: an optional label is a
 * label somebody forgets, and a parent being addressed as their own child is a bug
 * nothing else here would catch.
 *
 * Every member is a plain string but `question` and `format`, which take the figure
 * and the stored format they are about: a copy group states the sentence and the
 * caller supplies the number, exactly as every other group in this app does.
 */
export interface AnswerKeyRowLabels {
  /** This row's heading, from the ordinal the child was shown while they worked. */
  question: (ordinal: number) => string;
  /** What kind of question it was, in the same words the child saw. */
  format: Record<AnswerKeyRowView['format'], string>;
  /** Above what was put down. */
  studentAnswer: string;
  /** Instead of an empty space, for a Question left blank. */
  noAnswer: string;
  /** Above what the answer was. */
  correctAnswer: string;
  /** When the stored answer key could not be read back. */
  answerUnavailable: string;
  /** On a row nothing has judged yet. */
  rowUngraded: string;
  /** On a row this read is what judged. */
  rowNewlyGraded: string;
  /**
   * On a row a parent set the mark of.
   *
   * **A sentence, never a sixth colour.** `GradeStateMarker` and
   * `theme/grade-state-palette.ts` already carry state five ways, and a parent's adjustment
   * is not a sixth state: the row's state *is* the adjusted mark, and what this adds is who
   * settled it. A new marker token would make "adjusted" look like a state of its own, and
   * a colour alone would be unreadable to anyone the row is read aloud to.
   *
   * Two persons, as every other label here: the child reads that a grown-up looked at it,
   * the parent reads that they set it.
   */
  rowParentAdjusted: string;
}

/**
 * The left rule's texture, as a background rather than as a border.
 *
 * `solid`, `dashed` and `dotted` are what a border can express; `hatch` is not, so
 * all four are drawn the same way — a repeating gradient on a strip
 * `GRADE_RULE_WIDTH` wide. One mechanism, so the four textures differ in pattern
 * and never in weight, and `Incorrect` is separated from `Correct` by something
 * other than a hue.
 *
 * **Exhaustive, with no `default`.** A fifth texture added to the token table has to
 * be drawn deliberately: a `default` arm would render it as `dotted` and silently
 * collapse two states onto one carrier, which is exactly the colour-only distinction
 * the table exists to prevent. The `never` assignment below is what turns that into
 * a compile error.
 */
function ruleBackground(rule: GradeStateMarkerToken['rule'], color: string): string {
  switch (rule) {
    case 'solid':
      return color;
    case 'hatch':
      // Diagonal, so it reads as a texture at 4px and not as a paler solid.
      return `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 6px)`;
    case 'dashed':
      return `repeating-linear-gradient(to bottom, ${color} 0 10px, transparent 10px 18px)`;
    case 'dotted':
      return `repeating-linear-gradient(to bottom, ${color} 0 3px, transparent 3px 7px)`;
    default: {
      const unhandled: never = rule;
      throw new Error(`No rule texture is drawn for ${String(unhandled)}.`);
    }
  }
}

/**
 * One row of the answer key: the Question, what the child put down, what the answer
 * was, and the state it is in. No hooks.
 *
 * **One layout, two persons.** The child's results screen and the parent's Attempt
 * detail render this same component and differ only in `labels`: the words are an
 * argument (`AnswerKeyRowLabels`) precisely so that the state's five redundant
 * carriers cannot come to disagree between the two surfaces. It lives in
 * `components/` rather than under `app/student/` for that reason — a shared row
 * inside one surface's folder is a row the other surface reaches across a boundary
 * to import.
 *
 * **The prop type is the guard.** `AnswerKeyRowView` has no `rationale` field, no
 * Topic label and no cost, tier or model figure, and the read that composes it never
 * selects the first — so there is no prose of that kind this component could render
 * even by mistake (AD-20, AD-26).
 *
 * Prompts and both answers are stored `RichText` segments and are drawn by
 * `components/RichText`, the one renderer of them (AD-32): a fraction arrives as
 * structure and keeps its spoken reading, so `3/4` is never flattened to a glyph on
 * the way to a child.
 *
 * The state is carried five ways at once — the left rule's texture here, and the
 * frame, outline, glyph and literal label in `GradeStateMarker` — with colour as a
 * fifth that is never alone.
 *
 * **Nothing here celebrates and nothing counts up.** A row appears drawn, in the
 * place the Question was, whatever state it is in.
 */
export function AnswerKeyRow({
  row,
  labels,
  grade,
  explain,
}: {
  row: AnswerKeyRowView;
  /** Every word this row says. Required, so neither surface can inherit the other's. */
  labels: AnswerKeyRowLabels;
  /**
   * Whatever the screen puts about the *mark* — a dispute control on the child's screen,
   * the reason and the adjustment on the parent's.
   *
   * A slot and not a prop with a meaning, exactly as `explain` is: this component keeps
   * knowing nothing about disputing or adjusting, keeps having no hooks, and stays
   * assertable as a markup string. It does not know what is in here and cannot act on it.
   *
   * Rendered **before** `explain`, because a mark is what the row is about and an
   * explanation is a thing asked for afterwards — and because the two surfaces put
   * different things in each, so a fixed order here is the one thing that keeps them from
   * interleaving differently.
   */
  grade?: ReactNode;
  explain?: ReactNode;
}) {
  const marker = gradeStateMarker[row.state];
  return (
    <Box
      component="li"
      // `listStyle: 'none'` strips list semantics in Safari/VoiceOver along with the
      // item count, which is what tells a child how much paper there is. Put back by
      // hand, as `PracticeTestRow` does.
      role="listitem"
      sx={{
        listStyle: 'none',
        display: 'grid',
        gridTemplateColumns: `${GRADE_RULE_WIDTH}px 1fr`,
        columnGap: `${comfortableDensity.gap}px`,
        paddingBlock: `${comfortableDensity.gap}px`,
      }}
      data-testid="answer-key-row"
      data-state={row.state}
      data-rule={marker.rule}
      data-ordinal={row.ordinal}
    >
      <Box
        aria-hidden="true"
        sx={(theme) => ({
          background: ruleBackground(marker.rule, GRADE_PALETTE[marker.color](theme)),
          borderRadius: `${GRADE_RULE_WIDTH / 2}px`,
        })}
      />
      <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: `${comfortableDensity.gap / 2}px`,
          }}
        >
          {/* The stored ordinal, which is the number the child was shown while they
              worked — never this row's position in the array.

              `h4`, because the section heading above it is the `h3` under the
              results' own `h2`: a row heading at `h3` would be a *sibling* of the
              section it belongs to, and an outline that lies is worse than no
              outline. The visual type role is unchanged — level is structure and
              `typeRoles.label` is size. */}
          <Typography component="h4" sx={{ ...typeRoles.label }} data-testid="answer-key-ordinal">
            {/* What kind of question this was, beside its number. The words are the
                caller's: the student surface passes the same three literals the
                child was shown while they worked, so the word for a format cannot
                come to differ between the two screens they see. */}
            {`${labels.question(row.ordinal)} · ${labels.format[row.format]}`}
          </Typography>
          <GradeStateMarker state={row.state} />
        </Box>

        {row.prompt === null ? null : (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-prompt"
          >
            <RichText segments={row.prompt} />
          </Typography>
        )}

        <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="answer-key-your-label">
          {labels.studentAnswer}
        </Typography>
        {/* A sentence rather than an empty space: an empty space beside a label
            reads as something that failed to load. */}
        {row.studentAnswer === null ? (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-no-answer"
          >
            {labels.noAnswer}
          </Typography>
        ) : (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-your-answer"
          >
            <RichText segments={row.studentAnswer} />
          </Typography>
        )}

        <Typography
          component="p"
          sx={{ ...typeRoles.caption }}
          data-testid="answer-key-correct-label"
        >
          {labels.correctAnswer}
        </Typography>
        {/* The stored key could not be read back. The row still states its state:
            the work was graded, and only the words for the answer are gone. */}
        {row.correctAnswer === null ? (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-unavailable"
          >
            {labels.answerUnavailable}
          </Typography>
        ) : (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-correct-answer"
          >
            <RichText segments={row.correctAnswer} />
          </Typography>
        )}

        {/* The gap, on the row it is about, so a row read on its own still says it. */}
        {row.state === 'Ungraded' && (
          <Typography
            component="p"
            sx={{ ...typeRoles.caption }}
            data-testid="answer-key-row-ungraded"
          >
            {labels.rowUngraded}
          </Typography>
        )}
        {/* In words, never as a highlight: the one fact that changed since last time
            must not be carried by a colour.

            Gated on the state as well as on the flag. The service never writes
            `newlyGraded` onto a row it left `Ungraded` — `writeGuarded` reports only
            the verdicts it actually landed — but the *type* permits the pair, and a
            row saying both "not graded yet" and "just graded" is the one thing a
            child could not make sense of. The state wins: it is the fact. */}
        {row.newlyGraded && row.state !== 'Ungraded' && (
          <Typography
            component="p"
            sx={{ ...typeRoles.caption }}
            data-testid="answer-key-row-newly-graded"
          >
            {labels.rowNewlyGraded}
          </Typography>
        )}
        {/* A parent set this mark. In words on the row it is about, so a row read on its
            own still says it — and never as a colour, because the state's five carriers
            are about the mark itself and this is about who settled it. */}
        {row.parentAdjusted && (
          <Typography
            component="p"
            sx={{ ...typeRoles.caption }}
            data-testid="answer-key-row-parent-adjusted"
          >
            {labels.rowParentAdjusted}
          </Typography>
        )}
        {/* Whatever the screen put about the mark: the dispute control on the child's
            screen, the reason and the adjustment on the parent's. Before `explain`,
            because a mark is what the row is about. */}
        {grade}
        {/* Whatever the screen put here, last inside this row's own content column
            and never outside it — an explanation belongs directly beneath the
            Question it is about (UX-DR16).

            A slot rather than a prop with a meaning, exactly as `AttemptResults`'
            `footer` is: this component keeps knowing nothing about explaining, keeps
            having no hooks, and stays assertable as a markup string. It does not
            know what is in here and cannot act on it. */}
        {explain}
      </Box>
    </Box>
  );
}
