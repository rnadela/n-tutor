import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { commonCopy } from '@/copy/common';
import type { GradeState } from '@/lib/parent-api';
import { studentTheme } from '@/theme/theme';
import { gradeStateMarker } from '@/theme/tokens';
import { GradeStateMarker } from './GradeStateMarker';

const STATES: GradeState[] = ['Correct', 'Incorrect', 'Unanswered', 'Ungraded'];

/** The marker as a child actually receives it: rendered, under the student theme. */
function render(state: GradeState): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(GradeStateMarker, { state }),
    ),
  );
}

/** The markup with every colour, class and inline style taken away. */
function colourless(markup: string): string {
  return markup
    .replace(/\sclass="[^"]*"/gu, '')
    .replace(/\sstyle="[^"]*"/gu, '')
    .replace(/\scolor="[^"]*"/gu, '');
}

describe('what one grade-state marker shows a child', () => {
  it('shows the literal label for each of the four states, as real text', () => {
    for (const state of STATES) {
      expect(render(state)).toContain(commonCopy.gradeState[state]);
    }
    // The normative literals, pinned here as well as in the copy module: these exact
    // words are what every surface shows, so a reword is a decision and not a typo.
    expect(STATES.map((state) => commonCopy.gradeState[state])).toEqual([
      'Correct',
      'Not correct',
      'Unanswered',
      'Not graded yet',
    ]);
  });

  it('hides the glyph from assistive technology, because the label already says it', () => {
    for (const state of STATES) {
      expect(render(state)).toContain('aria-hidden="true"');
    }
  });

  it('puts no aria-label over the visible words', () => {
    // The visible label **is** the accessible name. A label over the top of it would
    // replace the words for anyone speaking them (WCAG 2.5.3) and would be a second
    // string for the same fact.
    for (const state of STATES) {
      expect(render(state)).not.toContain('aria-label');
    }
  });

  it('tells all four states apart with every colour, class and style stripped', () => {
    const labels = new Set<string>();
    for (const state of STATES) {
      const markup = colourless(render(state));
      // The word survives.
      expect(markup).toContain(commonCopy.gradeState[state]);
      labels.add(commonCopy.gradeState[state]);
      // And so does every non-colour carrier.
      const marker = gradeStateMarker[state];
      expect(markup).toContain(`data-state="${state}"`);
      expect(markup).toContain(`data-frame="${marker.frame}"`);
      expect(markup).toContain(`data-border="${marker.border}"`);
      expect(markup).toContain(`data-glyph="${marker.glyph}"`);
    }
    // Four states, four different words — not one word styled four ways.
    expect(labels.size).toBe(4);
  });

  it('separates the two verdicts on every axis but the frame shape', () => {
    // `Correct` and `Incorrect` share a shape on purpose: they are the same *kind*
    // of fact about the work, and giving them different outlines would group
    // `Incorrect` with the two non-verdicts instead. So the separation has to live
    // everywhere else.
    const right = gradeStateMarker.Correct;
    const wrong = gradeStateMarker.Incorrect;
    expect(wrong.frame).toBe(right.frame);
    expect(wrong.glyph).not.toBe(right.glyph);
    expect(wrong.rule).not.toBe(right.rule);
    expect(wrong.color).not.toBe(right.color);
    expect(commonCopy.gradeState.Incorrect).not.toBe(commonCopy.gradeState.Correct);
  });

  it('gives the two non-verdicts carriers of their own', () => {
    // "Nothing has judged this" has to be legible as a different kind of row before
    // a word is read, which is why `Ungraded` is the one square.
    expect(gradeStateMarker.Ungraded.frame).toBe('square');
    expect(gradeStateMarker.Unanswered.frame).toBe('circle');
    expect(gradeStateMarker.Unanswered.border).not.toBe(gradeStateMarker.Correct.border);
    expect(new Set(STATES.map((state) => gradeStateMarker[state].rule)).size).toBe(4);
    expect(new Set(STATES.map((state) => gradeStateMarker[state].glyph)).size).toBe(4);
  });
});
