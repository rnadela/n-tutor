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
import { comfortableDensity } from '@/theme/tokens';
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
}: {
  question: StudentQuestionView;
  /** The raw answer: a chosen option's ordinal as a string, or typed text. */
  value: string;
  onChange(next: string): void;
  /** The prompt's own id — a choice group is named by the Question it answers. */
  labelledBy: string;
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
        >
          {question.choices.map((choice) => (
            <FormControlLabel
              key={choice.ordinal}
              value={String(choice.ordinal)}
              control={<Radio />}
              data-testid="answer-choice"
              label={<RichText segments={choice.body} />}
              sx={{ minHeight: `${comfortableDensity.tapTarget}px` }}
            />
          ))}
        </RadioGroup>
      </FormControl>
    );
  }

  if (question.format === 'FillInTheBlank') {
    return <SmartFractionField value={value} onChange={onChange} describedBy={labelledBy} />;
  }

  if (question.format === 'ShortAnswer') {
    return (
      <TextField
        multiline
        minRows={4}
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
