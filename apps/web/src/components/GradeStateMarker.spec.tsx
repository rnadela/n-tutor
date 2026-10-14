import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { commonCopy } from '@/copy/common';
import type { GradeState } from '@/lib/parent-api';
import { studentTheme } from '@/theme/theme';
import { comfortableDensity, gradeStateMarker } from '@/theme/tokens';
import { GradeStateGlyph, GradeStateMarker } from './GradeStateMarker';

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

describe('the glyph on its own, which is what a results-map cell shows', () => {
  function glyph(props: { state: GradeState; size?: number | string; testId?: string }): string {
    return renderToStaticMarkup(
      createElement(ThemeProvider, { theme: studentTheme }, createElement(GradeStateGlyph, props)),
    );
  }

  it('carries all four non-colour carriers on the element itself', () => {
    // **The reason it was extracted.** On a row they ride on the labelled marker's
    // wrapper; a map cell has no wrapper of its own, so they have to be on the glyph or
    // they are nowhere — and `apps/web` asserts over markup with every colour, class and
    // inline style stripped.
    for (const state of STATES) {
      const marker = gradeStateMarker[state];
      const bare = colourless(glyph({ state }));
      expect(bare).toContain(`data-state="${state}"`);
      expect(bare).toContain(`data-frame="${marker.frame}"`);
      expect(bare).toContain(`data-border="${marker.border}"`);
      expect(bare).toContain(`data-glyph="${marker.glyph}"`);
      expect(bare).toContain(marker.glyph);
      // One element and nothing around it: there is no wrapper to carry anything.
      expect(bare.match(/<span/gu)).toHaveLength(1);
    }
  });

  it('is `aria-hidden` and carries no label of its own', () => {
    // Inside a cell the accessible name is the cell's whole sentence, which states the
    // grade label in words. A tick announced beside it would say the same thing twice.
    for (const state of STATES) {
      const markup = glyph({ state });
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toContain('aria-label');
      expect(markup).not.toContain('data-testid="grade-state-label"');
      // With every attribute taken away, the mark is the only thing left: the word is
      // not text here. (`data-state="Correct"` would otherwise match the literal.)
      const text = markup
        .replace(/<style[\s\S]*?<\/style>/gu, '')
        .replace(/<[a-z]+[^>]*>/gu, '')
        .replace(/<\/[a-z]+>/gu, '');
      expect(text).toBe(gradeStateMarker[state].glyph);
      expect(text).not.toContain(commonCopy.gradeState[state]);
    }
  });

  it('defaults to the figure a row has always used, and takes any CSS length', () => {
    // The default is what keeps the three existing row consumers byte-identical; a
    // relative length is what lets one cell geometry serve both surfaces' tap targets
    // without either density being written into a shared component.
    const rowSized = glyph({ state: 'Correct' });
    expect(rowSized).toContain(`${comfortableDensity.gap * 1.5}px`);
    expect(glyph({ state: 'Correct', size: '1.25em' })).toContain('1.25em');
    expect(glyph({ state: 'Correct', size: '1.25em' })).not.toContain(
      `width:${comfortableDensity.gap * 1.5}px`,
    );
    // And the labelled marker still renders at the row figure, through this default.
    expect(render('Correct')).toContain(`${comfortableDensity.gap * 1.5}px`);
  });

  it('defaults its test id, and lets a caller name the one it needs', () => {
    expect(glyph({ state: 'Correct' })).toContain('data-testid="grade-state-glyph"');
    expect(glyph({ state: 'Correct', testId: 'answer-key-map-glyph' })).toContain(
      'data-testid="answer-key-map-glyph"',
    );
    expect(glyph({ state: 'Correct', testId: 'answer-key-map-glyph' })).not.toContain(
      'data-testid="grade-state-glyph"',
    );
  });

  it('is the same element the labelled marker draws, not a second drawing of it', () => {
    // One mechanism: the marker is the glyph plus the word, so the two cannot come to
    // disagree about a frame, an outline or a mark.
    const source = readFileSync(path.resolve(import.meta.dirname, 'GradeStateMarker.tsx'), 'utf8');
    expect(source).toContain('<GradeStateGlyph state={state} />');
    expect(source.match(/borderRadius: marker\.frame === 'circle'/gu)).toHaveLength(1);
  });
});
