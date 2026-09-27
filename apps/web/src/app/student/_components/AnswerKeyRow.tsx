'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { RichText } from '@/components/RichText';
import { studentCopy } from '@/copy/student';
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
export function AnswerKeyRow({ row, explain }: { row: AnswerKeyRowView; explain?: ReactNode }) {
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
            {/* What kind of question this was, beside its number: the same three
                literals the child was shown while they worked, reused rather than
                restated, so the word for a format cannot come to differ between the
                two screens. */}
            {`${studentCopy.results.question(row.ordinal)} · ${studentCopy.takeTest.format[row.format]}`}
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
          {studentCopy.results.yourAnswer}
        </Typography>
        {/* A sentence rather than an empty space: an empty space beside a label
            reads as something that failed to load. */}
        {row.studentAnswer === null ? (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-no-answer"
          >
            {studentCopy.results.noAnswer}
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
          {studentCopy.results.correctAnswer}
        </Typography>
        {/* The stored key could not be read back. The row still states its state:
            the work was graded, and only the words for the answer are gone. */}
        {row.correctAnswer === null ? (
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="answer-key-unavailable"
          >
            {studentCopy.results.answerUnavailable}
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
            {studentCopy.results.rowUngraded}
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
            {studentCopy.results.rowNewlyGraded}
          </Typography>
        )}
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
