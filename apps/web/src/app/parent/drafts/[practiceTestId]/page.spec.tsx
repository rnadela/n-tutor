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
 * it stores no review position, that every mutation re-renders from the
 * returned view, and that a typed-but-unsaved edit goes to the `DraftEdit` slot
 * and to no browser storage — are asserted here, and what the screen actually
 * renders is proved in the browser by `e2e/tests/parent-practice-test.spec.ts`.
 */
const PAGE_SOURCE = readFileSync(path.resolve(DIR, 'page.tsx'), 'utf8');

/** Pending drafts, which is where the discard is stated. */
const LIST_SOURCE = readFileSync(path.resolve(DIR, '../page.tsx'), 'utf8');

/**
 * The same file with every comment removed.
 *
 * A ban on a *word* has to be a ban on the code, not on the prose: this screen
 * is required to explain in a comment why the delete-to-zero sentence names the
 * Generation Allowance, and a bare `not.toContain('Allowance')` over the raw
 * source would make writing that explanation a test failure.
 */
const PAGE_CODE = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

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

  it('offers no release, no discard of its own, and no timer', () => {
    // Stories 4.5 and 4.6 own those, and `Discarded` is reached here by
    // deleting the last Question and by no other path. No call, no copy key
    // and no state of any of them exists on this screen.
    for (const forbidden of [
      'releaseDraft',
      'discardDraft',
      'parentCopy.drafts.release',
      'parentCopy.drafts.discard',
      'durationMinutes',
      'timerMinutes',
      "status: 'Released'",
    ]) {
      expect(PAGE_SOURCE).not.toContain(forbidden);
    }
    // Exactly the calls this story adds, and nothing more. Matched on the
    // method name rather than on `parentApi.x`, because a wrapped call puts
    // the two on different lines.
    const called = [...PAGE_SOURCE.matchAll(/parentApi\s*\.\s*(\w+)\(\s*token[,)]/g)].map(
      (match) => match[1],
    );
    expect([...new Set(called)].sort()).toEqual([
      'deleteDraftQuestion',
      'discardUncommittedState',
      'editDraftQuestion',
      'practiceTestDraft',
      'saveUncommittedState',
      'uncommittedState',
    ]);
  });

  it('edits and deletes in place, re-rendering from the view the server answers with', () => {
    // Never from what this browser sent: the returned view is the only account
    // of what is stored, and it is what the list is drawn from.
    expect(PAGE_SOURCE).toContain('.editDraftQuestion(token, practiceTestId, question.id,');
    expect(PAGE_SOURCE).toContain('.deleteDraftQuestion(token, practiceTestId, question.id)');
    // The read, the edit and the delete: three writes of the same state, each
    // from a view the server authored.
    expect(PAGE_SOURCE.match(/setDraft\(view\)/g)).toHaveLength(3);
    // No navigation on an edit or an ordinary delete.
    expect(PAGE_SOURCE).not.toContain('router.push(');
  });

  it('sends plain text up and never builds a segment array of its own', () => {
    // A fraction is structure, and the one inverse of the plain rendering is
    // the server's (AD-32). The browser renders one direction only.
    expect(PAGE_SOURCE).toContain('plainTextOf(question.prompt)');
    expect(PAGE_SOURCE).not.toContain('numerator');
    expect(PAGE_SOURCE).not.toContain("kind: 'fraction'");
  });

  it('states which option is correct through a real radio group with a legend', () => {
    // A choice of exactly one, named in words — never a colour, a position or
    // a checkbox each, which would let two be marked correct.
    expect(PAGE_SOURCE).toContain('<RadioGroup');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.editCorrectLegend');
    expect(PAGE_SOURCE).not.toContain('Checkbox');
  });

  it('confirms every delete, and names the discard and the non-refund on the last one', () => {
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.deleteBody(');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.deleteLastBody');
    // The dialog is open before anything is deleted: the confirm control is
    // what calls the API, and the open control only records which Question.
    expect(PAGE_SOURCE).toContain('onClick={() => setPendingDelete(question)}');
    expect(PAGE_SOURCE).toContain('onClick={confirmDelete}');
    // Cancel leaves the draft untouched — it clears the pending id and nothing
    // else.
    expect(PAGE_SOURCE).toContain('onClick={() => setPendingDelete(null)}');
  });

  it('uses the ordinary dialog, not the password-gated destructive one', () => {
    // `DestructiveConfirmDialog` re-asks for the account password and is the
    // account- and profile-deletion ceremony. A question is not that.
    expect(PAGE_SOURCE).toContain('<AppDialog');
    expect(PAGE_SOURCE).not.toContain('DestructiveConfirm');
    expect(PAGE_SOURCE).not.toContain('password');
  });

  it('goes back to the pending drafts when the last Question took the draft with it', () => {
    expect(PAGE_SOURCE).toContain("view.status !== 'Draft'");
    // The discard is carried to the screen the parent lands on, because a live
    // region unmounted mid-announcement says nothing.
    expect(PAGE_SOURCE).toContain("'/parent/drafts?discarded=1'");
    expect(PAGE_SOURCE).toContain('router.replace(DISCARDED_DRAFTS_HREF)');
    // And that screen states it.
    expect(LIST_SOURCE).toContain('parentCopy.drafts.discarded');
    expect(LIST_SOURCE).toContain("useSearchParams().get('discarded') === '1'");
  });

  it('drops every slot the draft held when the draft itself is discarded', () => {
    // The other Questions' slots outlive the draft otherwise, and would come
    // back as restored edits against a practice test that no longer exists.
    expect(PAGE_SOURCE).toContain('discardEverySlot()');
    expect(PAGE_SOURCE).toContain('Object.values(liveSlots.current)');
  });

  it('restores the held edits once per draft id, not once per draft object', () => {
    // Every save and delete replaces `draft`, and restoring on each would race
    // the fire-and-forget discard: a slow DELETE would reopen an editor the
    // parent had already saved or cancelled.
    expect(PAGE_SOURCE).toContain('restoredFor.current === practiceTestId');
    expect(PAGE_SOURCE).toContain('restoredFor.current = practiceTestId');
  });

  it('checks every field of a restored slot, not only the top-level ones', () => {
    // A slot is opaque JSON: an option body that is not a string would land in
    // a controlled field, and an ordinal the Question no longer has would leave
    // the radio group with nothing selected.
    expect(PAGE_SOURCE).toContain("typeof typed.body !== 'string'");
    expect(PAGE_SOURCE).toContain(
      'base.choices.some((choice) => choice.ordinal === payload.correctOrdinal)',
    );
  });

  it('re-announces an identical sentence, and clears a stale one', () => {
    // A live region only announces what changes inside it, so saving the same
    // Question twice would otherwise be audible once.
    expect(PAGE_SOURCE).toContain('const announce = useCallback');
    expect(PAGE_SOURCE).toContain('setNotice(null);');
    expect(PAGE_SOURCE).toContain('announcement.current = setTimeout(() => setNotice(text), 0)');
    // Cleared when an editor opens and when either mutation fails.
    expect(PAGE_SOURCE.match(/setNotice\(null\)/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('mirrors the slot map in an effect rather than during render', () => {
    // A render React discards would otherwise leave the ref holding a map that
    // was never committed.
    expect(PAGE_SOURCE).not.toContain('liveSlots.current = slots;\n\n');
    expect(PAGE_SOURCE).toContain(
      'useEffect(() => {\n    liveSlots.current = slots;\n  }, [slots]);',
    );
  });

  it('moves focus on each of the three transitions it disturbs', () => {
    // Opening an editor replaces the row, saving removes the fields, and
    // deleting removes the card focus was on — which drops it to the document.
    expect(PAGE_SOURCE).toContain("setFocusTarget({ kind: 'prompt', questionId: question.id })");
    expect(PAGE_SOURCE).toContain("setFocusTarget({ kind: 'edit', questionId: question.id })");
    expect(PAGE_SOURCE).toContain("setFocusTarget({ kind: 'total' })");
    expect(PAGE_SOURCE).toContain('node?.focus();');
    // The line focus lands on after a delete is reachable programmatically and
    // not by tabbing.
    expect(PAGE_SOURCE).toContain('tabIndex={-1}');
  });

  it('holds a typed-but-unsaved edit in the DraftEdit slot, and nowhere else', () => {
    // Story 1.6 built the slot with no caller; this is it. Keyed to the
    // draft's own profile, scoped by Question id, and never in any browser
    // storage API — a device that has fallen back to Student Mode must hold no
    // trace of the work.
    expect(PAGE_SOURCE).toContain("kind: 'DraftEdit'");
    expect(PAGE_SOURCE).toContain('studentProfileId: draft.studentProfileId');
    expect(PAGE_SOURCE).toContain('scope: questionId');
    expect(PAGE_SOURCE).not.toContain('localStorage');
    expect(PAGE_SOURCE).not.toContain('sessionStorage');
    expect(PAGE_SOURCE).not.toContain('indexedDB');
  });

  it('discards the slot the moment the edit is committed or cancelled', () => {
    expect(PAGE_SOURCE.match(/discardSlot\(question\.id\)/g)).toHaveLength(3);
    expect(PAGE_SOURCE).toContain('.discardUncommittedState(token, slotId)');
  });

  it('lets a failed slot read leave the stored text, never blocking the screen', () => {
    // Losing a draft edit is a smaller harm than a review screen that will not
    // render, so the slot read swallows its own failure.
    expect(PAGE_SOURCE).toContain('.catch(() => {');
    expect(PAGE_SOURCE).toContain('.uncommittedState(token, draft.studentProfileId)');
  });

  it('debounces the slot write rather than saving every keystroke', () => {
    expect(PAGE_SOURCE).toContain('SLOT_DEBOUNCE_MS');
    expect(PAGE_SOURCE).toContain('clearTimeout(pause)');
  });

  it('announces what happened in the same words it shows', () => {
    expect(PAGE_SOURCE).toContain('aria-live="polite"');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.edited(question.ordinal)');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.deleted(view.questions.length)');
  });

  it('names no allowance, cost, tier or model', () => {
    // The word belongs to exactly one sentence — the delete-to-zero
    // confirmation, which is *required* to say the spent allowance is not given
    // back — and it lives in the copy module, not here. Nothing on this screen
    // names an allowance at all.
    expect(PAGE_CODE).not.toContain('allowance');
    expect(PAGE_CODE).not.toContain('Allowance');
    expect(PAGE_SOURCE).not.toContain('gpt-');
    expect(PAGE_SOURCE).not.toMatch(/allowanceFor|maxPerRequest/u);
  });

  it('takes its input through real form controls, never a contenteditable', () => {
    // Restored from the read-only version of this screen: an editor is fields
    // and buttons, each a real focusable control with its own label.
    expect(PAGE_SOURCE).not.toContain('onSubmit');
    expect(PAGE_SOURCE).not.toContain('contentEditable');
    expect(PAGE_SOURCE).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('its copy', () => {
  it('is parameterized, with no literal in the component', () => {
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.reviewTitle');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.questionHeading(question.ordinal)');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.topicsLabel');
    expect(PAGE_SOURCE).toContain('parentCopy.drafts.correctAnswerLabel');
  });

  it('says the discard and the non-refund in plain words, before the action', () => {
    const body = parentCopy.drafts.deleteLastBody;
    expect(body).toContain('discards the whole practice test');
    expect(body).toContain('not given back');
    // Plain fact: no exclamation, no cheerleading, no upsell.
    expect(body).not.toContain('!');
    expect(body).not.toMatch(/upgrade|buy|plan/iu);
  });

  it('names what an ordinary delete destroys, and what would be left', () => {
    expect(parentCopy.drafts.deleteBody(2, 4)).toBe(
      'Question 2 will be deleted. 4 questions will be left in this practice test. This cannot be undone.',
    );
    expect(parentCopy.drafts.deleteBody(2, 1)).toContain('1 question will be left');
  });

  it('reads a fraction aloud rather than spelling it as a glyph', () => {
    expect(parentCopy.drafts.fractionReading({ whole: null, numerator: 1, denominator: 2 })).toBe(
      '1 over 2',
    );
  });
});
