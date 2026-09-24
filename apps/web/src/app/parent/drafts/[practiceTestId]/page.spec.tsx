import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';

const DIR = import.meta.dirname;

/**
 * The screen's own source.
 *
 * The web tier runs without a DOM, so the rules this screen states — that it
 * renders every Question, that its heading figures come from the server, that
 * it stores no review position, that it offers no control that changes a draft
 * — are asserted here, and what the screen actually renders is proved in the
 * browser by `e2e/tests/parent-practice-test.spec.ts`.
 */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');

describe('the draft review screen', () => {
  it('reads one draft, whole, by the id in its own URL', () => {
    expect(PAGE_SOURCE).toContain('useParams<{ practiceTestId: string }>()');
    expect(PAGE_SOURCE).toContain('parentApi.practiceTestDraft(token, practiceTestId)');
  });

  it('renders every Question in stored order, with nothing paginated or hidden', () => {
    // "Every Question in one reviewable list" is the acceptance criterion the
    // epic's human quality gate rests on.
    expect(PAGE_SOURCE).toContain('draft.questions.map((question)');
    expect(PAGE_SOURCE).not.toContain('.slice(');
    expect(PAGE_SOURCE).not.toContain('Accordion');
    expect(PAGE_SOURCE).not.toContain('showAll');
    expect(PAGE_SOURCE).not.toContain('page +');
  });

  it('counts the total from the questions it rendered, not the stored column', () => {
    // Two sources for one figure is one too many: a question row written
    // without bumping `questionCount` would head the screen with a total the
    // list below contradicts — on the one screen whose whole claim is that
    // every Question is there.
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.questionTotal(draft.questions.length)');
    expect(PAGE_SOURCE).not.toContain('questionTotal(draft.questionCount)');
  });

  it('puts list semantics back where the style strips them', () => {
    // `listStyle: 'none'` drops list semantics in Safari/VoiceOver, and with
    // them the item count — which here is the whole point. Both the question
    // list and each question's option list.
    expect(PAGE_SOURCE.match(/role="list"/g)).toHaveLength(2);
    expect(PAGE_SOURCE.match(/role="listitem"/g)).toHaveLength(2);
  });

  it('shows each Question answer, its options and its Topics', () => {
    expect(PAGE_SOURCE).toContain('question.choices.map((choice)');
    expect(PAGE_SOURCE).toContain('question.answer !== null');
    expect(PAGE_SOURCE).toContain('question.topics');
    // The correct option is marked in words, never by colour or position alone.
    expect(PAGE_SOURCE).toContain('choice.isCorrect && (');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.correctOption');
  });

  it('says so plainly when a Question carries no Topic, rather than showing nothing', () => {
    expect(PAGE_SOURCE).toContain('question.topics.length === 0');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.noTopics');
  });

  it('renders generated text through the segment renderer, never as a string', () => {
    // A fraction is structure (AD-32); no call site here builds "1/2".
    expect(PAGE_SOURCE).toContain('<RichText segments={question.prompt} />');
    expect(PAGE_SOURCE).toContain('<RichText segments={choice.body} />');
    expect(PAGE_SOURCE).toContain('<RichText segments={question.answer} />');
    expect(PAGE_SOURCE).not.toContain('numerator');
    expect(PAGE_SOURCE).not.toContain(".join('')");
  });

  it('sets Question bodies in the paper role, and leaves chrome sans', () => {
    // Generated content carries the serif family wherever it appears, the
    // parent side included (UX-DR6).
    expect(PAGE_SOURCE).toContain('variant="questionBody"');
  });

  it('states "draft N of M" from the server figures', () => {
    // The browser holds one draft and could not count its siblings.
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.position(draft.ordinal, draft.siblingCount)');
  });

  it('stores no review position at all — the URL is the position', () => {
    expect(PAGE_SOURCE).not.toContain('localStorage');
    expect(PAGE_SOURCE).not.toContain('sessionStorage');
    expect(PAGE_SOURCE).not.toContain('uncommittedState');
    // An expiry sends the parent to the PIN and they come back to this URL.
    expect(PAGE_SOURCE).toContain("router.replace('/parent/pin')");
  });

  it('treats a 404 as a state with a way back, not as a crash', () => {
    expect(PAGE_SOURCE).toContain('cause.status === 404');
    expect(PAGE_SOURCE).toContain('setMissing(true)');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.notFound');
    expect(PAGE_SOURCE).toContain('href="/parent/drafts"');
  });

  it('prefers the server own sentence on a 4xx it did author', () => {
    expect(PAGE_SOURCE).toContain('cause instanceof ParentApiError && cause.reason !== null');
  });

  it('fetches client-side with the in-memory bearer', () => {
    expect(PAGE_SOURCE).toContain("'use client'");
    expect(PAGE_SOURCE).toContain('useElevation()');
    expect(PAGE_SOURCE).toContain('elevation?.token ?? null');
  });

  it('offers no control that edits, deletes, releases, discards or times a draft', () => {
    // 4.4, 4.5 and 4.6 own those. This screen is read-only: it takes no input,
    // submits nothing, and makes no call that is not the one draft read.
    for (const forbidden of ['TextField', 'onSubmit', 'Checkbox', 'contentEditable']) {
      expect(PAGE_SOURCE).not.toContain(forbidden);
    }
    // The only call it makes at all.
    expect(PAGE_SOURCE.match(/parentApi\.\w+/g)).toEqual(['parentApi.practiceTestDraft']);
    // Its one button is Retry, which re-reads and changes nothing.
    expect(PAGE_SOURCE.match(/<Button/g)).toHaveLength(1);
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.retry');
  });

  it('names no allowance, cost, tier or model', () => {
    expect(PAGE_SOURCE).not.toContain('allowance');
    expect(PAGE_SOURCE).not.toContain('Allowance');
    expect(PAGE_SOURCE).not.toContain('gpt-');
  });
});

describe('its copy', () => {
  it('is parameterized, with no literal in the component', () => {
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.reviewTitle');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.questionHeading(question.ordinal)');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.topicsLabel');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.correctAnswerLabel');
  });

  it('reads a fraction aloud rather than spelling it as a glyph', () => {
    expect(parentCopy.drafts.fractionReading({ whole: null, numerator: 1, denominator: 2 })).toBe(
      '1 over 2',
    );
  });
});
