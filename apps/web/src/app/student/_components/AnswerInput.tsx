'use client';

import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { RichText } from '@/components/RichText';
import { TextField } from '@/components/TextField';
import { studentCopy } from '@/copy/student';
import { MAX_ANSWER_LENGTH } from '@/lib/answers';
import type { StudentQuestionView } from '@/lib/parent-api';
import { comfortableDensity, rounded } from '@/theme/tokens';
import { SmartFractionField } from './SmartFractionField';

/**
 * The control one Question's Format calls for, and nothing else.
 *
 * One file for all three because they are one decision — *which control does
 * this Format get* — and splitting them would hide the exhaustive switch that is
 * the whole point: a Format with no branch here is a Format a child cannot
 * answer, and TypeScript says so at the bottom of this function rather than a
 * child finding out.
 *
 * Purely presentational: it holds the value it is given and reports the next
 * one. No fetch, no router, no knowledge of the rest of the test — and no
 * correctness of any kind, because the view it renders carries none. There is
 * nothing here that could mark an option right even if a later edit wanted to.
 */
export function AnswerInput({
  question,
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  question: StudentQuestionView;
  /** The raw answer: a chosen option's ordinal as a string, or typed text. */
  value: string;
  onChange(next: string): void;
  /** The prompt's own id — a choice group is named by the Question it answers. */
  labelledBy: string;
  /**
   * The answer can no longer change. Set once a timed Attempt's deadline has
   * passed: what was entered before it is what is graded, so nothing after it
   * may be (FR-15) — including while the hand-in waits for a connection.
   */
  disabled?: boolean;
}) {
  if (question.format === 'MultipleChoice') {
    return (
      <FormControl component="fieldset" sx={{ width: '100%' }}>
        {/* Named by the prompt rather than by a label of its own: "what am I
            choosing between" is the Question, and restating it as a legend
            would say it to a screen reader twice. */}
        <RadioGroup
          aria-labelledby={labelledBy}
          name={`question-${question.id}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          sx={{ gap: `${comfortableDensity.gap / 2}px` }}
        >
          {question.choices.map((choice) => (
            <FormControlLabel
              key={choice.ordinal}
              value={String(choice.ordinal)}
              control={<Radio />}
              disabled={disabled}
              data-testid="answer-choice"
              label={<RichText segments={choice.body} />}
              // Each option is a whole tile, not a dot and a word: the full row
              // is the target a child's finger lands on, and the chosen one is
              // marked by its border and tint as well as by the filled radio.
              sx={(theme) => {
                const chosen = value === String(choice.ordinal);
                return {
                  m: 0,
                  minHeight: `${comfortableDensity.tapTarget}px`,
                  pr: `${comfortableDensity.cardPadding}px`,
                  border: '1px solid',
                  borderColor: chosen ? 'primary.main' : 'divider',
                  borderRadius: `${rounded.control}px`,
                  bgcolor: chosen ? 'action.selected' : 'transparent',
                  transition: theme.transitions.create(['border-color', 'background-color']),
                  '&:hover': { bgcolor: chosen ? 'action.selected' : 'action.hover' },
                };
              }}
            />
          ))}
        </RadioGroup>
      </FormControl>
    );
  }

  if (question.format === 'FillInTheBlank') {
    return (
      <SmartFractionField
        value={value}
        onChange={onChange}
        describedBy={labelledBy}
        disabled={disabled}
      />
    );
  }

  if (question.format === 'ShortAnswer') {
    return (
      <TextField
        multiline
        minRows={4}
        disabled={disabled}
        label={studentCopy.takeTest.answerLabel}
        // The raw string, held as it was typed. Nothing here reformats it.
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Capped where the typing happens, at the same figure the API refuses a body
        // by. The alternative is a child writing past the ceiling and finding out only
        // when handing in fails — a refusal arriving after the work is finished, which
        // is the one point on this screen where there is nothing useful to do about it.
        slotProps={{
          htmlInput: { 'data-testid': 'answer-short-input', maxLength: MAX_ANSWER_LENGTH },
        }}
      />
    );
  }

  // A Format the union does not hold. `satisfies never` is the compile error the
  // moment a later story adds one without adding the control it needs; `null` is
  // what a build that somehow met one at runtime renders — returning the value
  // would print the raw enum name into the page for a child to read.
  question.format satisfies never;
  return null;
}
