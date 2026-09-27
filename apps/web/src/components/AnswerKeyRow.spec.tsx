import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { commonCopy } from '@/copy/common';
import { parentCopy } from '@/copy/parent';
import { studentCopy } from '@/copy/student';
import type { AnswerKeyRowView, GradeState } from '@/lib/parent-api';
import { studentTheme } from '@/theme/theme';
import { gradeStateMarker } from '@/theme/tokens';
import { AnswerKeyRow, type AnswerKeyRowLabels } from './AnswerKeyRow';

/**
 * The child's words, as `AttemptResults` builds them.
 *
 * Restated here rather than imported from the screen: this spec is about what the
 * row does with the labels it is given, and reaching into a screen for them would
 * make a row's spec fail when that screen is refactored.
 */
const STUDENT_LABELS: AnswerKeyRowLabels = {
  question: studentCopy.results.question,
  format: studentCopy.takeTest.format,
  studentAnswer: studentCopy.results.yourAnswer,
  noAnswer: studentCopy.results.noAnswer,
  correctAnswer: studentCopy.results.correctAnswer,
  answerUnavailable: studentCopy.results.answerUnavailable,
  rowUngraded: studentCopy.results.rowUngraded,
  rowNewlyGraded: studentCopy.results.rowNewlyGraded,
};

/** The parent's words for the same row, in the third person about the child. */
const PARENT_LABELS: AnswerKeyRowLabels = {
  question: parentCopy.attempts.question,
  format: parentCopy.attempts.format,
  studentAnswer: parentCopy.attempts.studentAnswer,
  noAnswer: parentCopy.attempts.noAnswer,
  correctAnswer: parentCopy.attempts.correctAnswer,
  answerUnavailable: parentCopy.attempts.answerUnavailable,
  rowUngraded: parentCopy.attempts.rowUngraded,
  rowNewlyGraded: parentCopy.attempts.rowNewlyGraded,
};

const STATES: GradeState[] = ['Correct', 'Incorrect', 'Unanswered', 'Ungraded'];

function row(overrides: Partial<AnswerKeyRowView> = {}): AnswerKeyRowView {
  return {
    questionId: 'q1',
    ordinal: 3,
    format: 'MultipleChoice',
    prompt: [{ kind: 'text', value: 'What is two halves?' }],
    studentAnswer: [{ kind: 'text', value: 'Option A for 1.1' }],
    correctAnswer: [{ kind: 'text', value: 'Option A for 1.1' }],
    state: 'Correct',
    newlyGraded: false,
    ...overrides,
  };
}

function render(view: AnswerKeyRowView): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(AnswerKeyRow, { row: view, labels: STUDENT_LABELS }),
    ),
  );
}

describe('what one answer-key row shows a child', () => {
  it('renders a list item, not a bare block', () => {
    const markup = render(row());
    expect(markup).toContain('<li');
    expect(markup).toContain('role="listitem"');
  });

  it('says which Question it is by the stored ordinal, not by its place in the list', () => {
    expect(render(row({ ordinal: 7 }))).toContain(studentCopy.results.question(7));
  });

  it('sits at h4, under the section heading rather than beside it', () => {
    // `AttemptResults` is `h2` and its answer-key section heading is `h3`, so a row
    // at `h3` would be a *sibling* of the section it belongs to. An outline that
    // lies is worse than no outline.
    const markup = render(row());
    expect(markup).toContain('<h4');
    expect(markup).not.toContain('<h3');
    expect(markup).not.toContain('<h2');
  });

  it('says what kind of question it was, in the words the child already saw', () => {
    // The same three literals the take-test screen showed while they worked, reused
    // rather than restated — so the word for a format cannot come to differ between
    // the two screens.
    for (const format of ['MultipleChoice', 'FillInTheBlank', 'ShortAnswer'] as const) {
      const markup = render(row({ format, ordinal: 2 }));
      expect(markup).toContain(studentCopy.takeTest.format[format]);
      expect(markup).toContain(
        `${studentCopy.results.question(2)} · ${studentCopy.takeTest.format[format]}`,
      );
    }
  });

  it('shows the prompt, what the child answered and what the answer was', () => {
    const markup = render(
      row({
        prompt: [{ kind: 'text', value: 'Name one half.' }],
        studentAnswer: [{ kind: 'text', value: 'a third' }],
        correctAnswer: [{ kind: 'text', value: 'one half' }],
      }),
    );
    expect(markup).toContain('Name one half.');
    expect(markup).toContain(studentCopy.results.yourAnswer);
    expect(markup).toContain('a third');
    expect(markup).toContain(studentCopy.results.correctAnswer);
    expect(markup).toContain('one half');
  });

  it('draws all four states, each with its label and its non-colour carriers', () => {
    for (const state of STATES) {
      const markup = render(row({ state }));
      expect(markup).toContain(commonCopy.gradeState[state]);
      expect(markup).toContain(`data-state="${state}"`);
      // The row's own left rule, whose texture differs in every state.
      expect(markup).toContain(`data-rule="${gradeStateMarker[state].rule}"`);
    }
  });

  it('keeps a fraction as a fraction, with its spoken reading', () => {
    // Stored segments go through `components/RichText`, the one renderer of them
    // (AD-32): a fraction arrives as structure and keeps a reading a glyph could not
    // carry.
    const markup = render(
      row({ correctAnswer: [{ kind: 'fraction', whole: null, numerator: 3, denominator: 4 }] }),
    );
    expect(markup).toContain('data-testid="rich-text-fraction"');
    expect(markup).toContain('data-numerator="3"');
    expect(markup).toContain('data-denominator="4"');
  });

  it('says the child left it blank rather than showing an empty space', () => {
    const markup = render(row({ state: 'Unanswered', studentAnswer: null }));
    expect(markup).toContain(studentCopy.results.noAnswer);
    expect(markup).toContain(commonCopy.gradeState.Unanswered);
  });

  it('says the answer is unavailable when the stored key could not be read back', () => {
    // Degraded, never blank: the work was graded and only the words for the answer
    // are gone, so the row still states its state.
    const markup = render(row({ correctAnswer: null, state: 'Incorrect' }));
    expect(markup).toContain(studentCopy.results.answerUnavailable);
    expect(markup).toContain(commonCopy.gradeState.Incorrect);
  });

  it('says on the row itself that nothing has graded it yet', () => {
    const markup = render(row({ state: 'Ungraded' }));
    expect(markup).toContain(studentCopy.results.rowUngraded);
  });

  it('says a row was just graded in words, not by a highlight', () => {
    expect(render(row({ newlyGraded: true }))).toContain(studentCopy.results.rowNewlyGraded);
    expect(render(row({ newlyGraded: false }))).not.toContain(studentCopy.results.rowNewlyGraded);
  });

  it('never says both "not graded yet" and "just graded" on one row', () => {
    // The service cannot produce the pair — `writeGuarded` reports only the verdicts
    // it actually landed — but the type permits it, and a row claiming both is the
    // one thing a child could not make sense of. The state wins: it is the fact.
    const markup = render(row({ state: 'Ungraded', newlyGraded: true }));
    expect(markup).toContain(studentCopy.results.rowUngraded);
    expect(markup).not.toContain(studentCopy.results.rowNewlyGraded);
  });

  it('omits the prompt line entirely rather than rendering an empty one', () => {
    const markup = render(row({ prompt: null }));
    expect(markup).not.toContain('data-testid="answer-key-prompt"');
    // And the row is still a whole row: the state and both answer lines survive.
    expect(markup).toContain(commonCopy.gradeState.Correct);
    expect(markup).toContain(studentCopy.results.correctAnswer);
  });

  it('has no rationale-shaped field to render, and reads none off its prop', () => {
    // Not a claim about this component's markup so much as about its type: the prop
    // is `AnswerKeyRowView`, which has no `rationale`, no Topic and no cost, tier or
    // model field, and the read that composes it never selects the first. There is
    // nothing of that kind for a row to reach for.
    const source = readFileSync(path.resolve(import.meta.dirname, 'AnswerKeyRow.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    for (const forbidden of [/rationale/iu, /\btopic/iu, /allowance/iu, /tier/iu, /costMicros/iu]) {
      expect(code).not.toMatch(forbidden);
    }
    // A row a later edit widened would have to add the field to the API type first.
    const view: AnswerKeyRowView = row();
    expect(Object.keys(view).sort()).toEqual([
      'correctAnswer',
      'format',
      'newlyGraded',
      'ordinal',
      'prompt',
      'questionId',
      'state',
      'studentAnswer',
    ]);
  });

  it('renders whatever the screen put in the explain slot, last in its own column', () => {
    // Directly beneath the Question it is about (UX-DR16), and inside the row's
    // content column rather than after the row — an explanation that sat outside
    // would be prose attached to nothing in particular.
    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: studentTheme },
        createElement(AnswerKeyRow, {
          row: row(),
          labels: STUDENT_LABELS,
          explain: createElement('p', { 'data-testid': 'slot-probe' }, 'slotted'),
        }),
      ),
    );
    expect(markup).toContain('data-testid="slot-probe"');
    expect(markup.indexOf('slot-probe')).toBeGreaterThan(
      markup.indexOf('data-testid="answer-key-correct-label"'),
    );
    // And it is still inside the row: the `li` has not closed yet.
    expect(markup.slice(markup.indexOf('slot-probe'))).toContain('</li>');
  });

  it('renders nothing extra when no slot is given, and stays hookless either way', () => {
    // The slot is optional because a results screen that did not offer explaining —
    // or a row rendered by a test — is still a whole row.
    expect(render(row())).not.toContain('slot-probe');
    // Hookless is the property that keeps this component assertable as a markup
    // string at all, and the slot must not have cost it.
    const source = readFileSync(path.resolve(import.meta.dirname, 'AnswerKeyRow.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    expect(code).not.toMatch(/\buse[A-Z]\w*\(/u);
    // And it gained no notion of what the slot is for: the word appears only as the
    // prop's own name.
    expect(code).not.toMatch(/parentApi|explainQuestion|ExplainPanel/u);
  });

  it('says every word from the labels it was given, and imports no copy of its own', () => {
    // The row is rendered by two surfaces in two different persons. Reading a copy
    // group here would pin it to one of them, and the other would address a parent
    // as their own child — a mistake nothing else on that screen would catch.
    const source = readFileSync(path.resolve(import.meta.dirname, 'AnswerKeyRow.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    expect(code).not.toMatch(/studentCopy|parentCopy/u);
    // `commonCopy.gradeState` is still read — by `GradeStateMarker`, whose four
    // literals are shared between the surfaces by design and are not this row's.
    expect(code).not.toMatch(/commonCopy/u);
  });

  it('renders the same layout about a child in the third person', () => {
    // Same markup, same five carriers, different person: what makes one component
    // serve both surfaces rather than two components drifting apart.
    const markup = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: studentTheme },
        createElement(AnswerKeyRow, {
          row: row({ state: 'Unanswered', studentAnswer: null, correctAnswer: null, ordinal: 4 }),
          labels: PARENT_LABELS,
        }),
      ),
    );
    expect(markup).toContain(parentCopy.attempts.question(4));
    expect(markup).toContain(parentCopy.attempts.studentAnswer);
    expect(markup).toContain(parentCopy.attempts.noAnswer);
    expect(markup).toContain(parentCopy.attempts.answerUnavailable);
    // None of the child's second-person wording survives.
    expect(markup).not.toContain(studentCopy.results.yourAnswer);
    expect(markup).not.toContain(studentCopy.results.noAnswer);
    // And the state is still carried every way it was: the marker's four literals
    // are `commonCopy`'s, shared by both surfaces on purpose.
    expect(markup).toContain(commonCopy.gradeState.Unanswered);
    expect(markup).toContain('data-state="Unanswered"');
    expect(markup).toContain(`data-rule="${gradeStateMarker.Unanswered.rule}"`);
  });
});
