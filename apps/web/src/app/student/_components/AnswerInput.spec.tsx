import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import type { StudentQuestionView } from '@/lib/parent-api';
import { studentTheme } from '@/theme/theme';
import { AnswerInput } from './AnswerInput';

const PROMPT_ID = 'question-prompt-q-1';

function question(over: Partial<StudentQuestionView>): StudentQuestionView {
  return {
    id: 'q-1',
    ordinal: 1,
    format: 'ShortAnswer',
    prompt: [{ kind: 'text', value: 'What is half of six?' }],
    choices: [],
    ...over,
  };
}

function render(view: StudentQuestionView, value = ''): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(AnswerInput, {
        question: view,
        value,
        onChange: () => {},
        labelledBy: PROMPT_ID,
      }),
    ),
  );
}

const MULTIPLE_CHOICE = question({
  format: 'MultipleChoice',
  choices: [
    { ordinal: 1, body: [{ kind: 'text', value: 'Two' }] },
    { ordinal: 2, body: [{ kind: 'text', value: 'Three' }] },
    { ordinal: 3, body: [{ kind: 'text', value: 'Four' }] },
  ],
});

describe('Multiple Choice', () => {
  it('renders one real radio per stored choice, sharing one group name', () => {
    const markup = render(MULTIPLE_CHOICE);
    const radios = markup.match(/type="radio"/gu);
    expect(radios).toHaveLength(MULTIPLE_CHOICE.choices.length);
    expect(markup.match(/name="question-q-1"/gu)).toHaveLength(MULTIPLE_CHOICE.choices.length);
  });

  it('names the group by the Question it answers, rather than restating it', () => {
    expect(render(MULTIPLE_CHOICE)).toContain(`aria-labelledby="${PROMPT_ID}"`);
  });

  it('draws each option body through the one rich-text renderer', () => {
    const markup = render(MULTIPLE_CHOICE);
    for (const body of ['Two', 'Three', 'Four']) expect(markup).toContain(body);
    expect(markup).toContain('data-testid="rich-text-segment"');
  });

  it('keeps the options in the stored order', () => {
    const values = [...render(MULTIPLE_CHOICE).matchAll(/value="(\d)"/gu)].map((m) => m[1]);
    expect(values).toEqual(['1', '2', '3']);
  });

  it('holds the chosen option and no more than one', () => {
    const markup = render(MULTIPLE_CHOICE, '2');
    expect(markup.match(/checked=""/gu)).toHaveLength(1);
  });
});

describe('Fill in the Blank', () => {
  const FILL = question({ format: 'FillInTheBlank' });

  it('renders one real labelled input holding the raw string', () => {
    const markup = render(FILL, '3/4');
    expect(markup.match(/<input/gu)).toHaveLength(1);
    expect(markup).toContain('value="3/4"');
    expect(markup).toContain(studentCopy.takeTest.answerLabel);
    expect(markup).toMatch(/<label[^>]*for="[^"]+"/u);
  });

  it('puts the stacked form in an adjacent sibling, hidden from assistive technology', () => {
    const markup = render(FILL, '3/4');
    const preview = /aria-hidden="true"[^>]*data-testid="answer-fraction-preview"/u;
    expect(markup).toMatch(preview);
    // Adjacent, never overlaid and never a second accessible value: the input is
    // the only thing announced and the only thing submitted.
    expect(markup.indexOf('answer-fraction-input')).toBeLessThan(
      markup.indexOf('answer-fraction-preview'),
    );
    expect(markup.match(/<input/gu)).toHaveLength(1);
    expect(markup).not.toContain('aria-label=');
  });

  it('renders no sibling at all when what was typed is not a fraction', () => {
    for (const raw of ['one half', '0.5', '3/', '3/0', '']) {
      const markup = render(FILL, raw);
      expect(markup).not.toContain('answer-fraction-preview');
      // And the input is untouched: the raw string, exactly as typed.
      if (raw !== '') expect(markup).toContain(`value="${raw}"`);
    }
  });

  it('turns off every browser behaviour that would rewrite an answer', () => {
    // Asserted case-insensitively: this runner's static renderer emits the JSX
    // spelling, where a browser normalises it. The attribute is what matters.
    const markup = render(FILL, 'one half');
    expect(markup).toMatch(/autocomplete="off"/iu);
    expect(markup).toMatch(/spellcheck="false"/iu);
    expect(markup).toContain('type="text"');
  });
});

describe('Short Answer', () => {
  it('renders a multi-line control holding the raw string', () => {
    const markup = render(question({ format: 'ShortAnswer' }), 'Because six halved is three.');
    expect(markup).toContain('<textarea');
    expect(markup).toContain('Because six halved is three.');
    expect(markup).toContain(studentCopy.takeTest.answerLabel);
  });
});

describe('what no Format renders', () => {
  it('carries no correct-answer marker of any kind', () => {
    for (const view of [
      MULTIPLE_CHOICE,
      question({ format: 'FillInTheBlank' }),
      question({ format: 'ShortAnswer' }),
    ]) {
      const markup = render(view, '3/4').replace(/<style[\s\S]*?<\/style>/gu, '');
      for (const forbidden of [
        /isCorrect/iu,
        /\bcorrect/iu,
        /\banswer-key\b/iu,
        /\bwrong\b/iu,
        /\bscore\b/iu,
      ]) {
        expect(markup).not.toMatch(forbidden);
      }
    }
  });
});
