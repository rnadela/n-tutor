import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'ExplanationReview.tsx'), 'utf8');
/** The file with its prose stripped, so a comment cannot satisfy an assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * The inline region beneath a parent's answer-key row.
 *
 * `apps/web` runs its unit suite with `environment: 'node'`, so a stateful component's
 * rules are asserted on the source that states them, exactly as the drafts and
 * generate screens' specs do. The decision this component renders is a pure function
 * with its own spec (`lib/explanation-review.spec.ts`), and what a press actually does
 * in a browser is proved by `e2e/tests/parent-explanation-review.spec.ts`.
 */
describe('what a parent can do with one Explanation', () => {
  it('makes exactly five `parentApi.` calls, with a press behind every one', () => {
    // The prose arrives with the Attempt, in the screen's own read, so nothing here reads
    // on mount. The reconcile is one shared helper, reachable only from a write that was
    // refused as a conflict, and the removal only from the confirmation the parent pressed
    // through.
    const calls = CODE.match(/parentApi\.\w+/gu) ?? [];
    expect(calls).toEqual([
      'parentApi.flagExplanation',
      'parentApi.attemptExplanations',
      'parentApi.disposeExplanationFlag',
      'parentApi.suppressExplanation',
      'parentApi.regenerateExplanation',
    ]);
    // One spelling of the reconcile, called from all three writes' conflict arms.
    expect(CODE.match(/reconcileAfterConflict\(\);/gu)).toHaveLength(3);
    expect(CODE.indexOf('parentApi.attemptExplanations')).toBeGreaterThan(
      CODE.indexOf('function reconcileAfterConflict'),
    );
  });

  it('catches this region up when a decision is refused as already recorded', () => {
    // Without it, both controls stay on screen offering a decision the API will refuse for
    // ever, and the parent cannot learn which one was actually recorded short of reloading
    // the whole paper.
    expect(CODE).toContain('cause.status === CONFLICT_STATUS');
    expect(CODE).toContain('parentApi.attemptExplanations(token, attemptId)');
    expect(CODE).toContain('views.filter((view) => view.questionId === questionId)');
    expect(CODE).toContain('if (current.length > 0) onGenerations(current);');
  });

  it('reconciles only on the conflict, and announces nothing for it', () => {
    // Every other failure is transient and leaves the controls exactly where they were, to
    // be pressed again — and the refusal sentence is already in the live region, so a
    // second announcement for a read the parent never asked for would narrate the screen's
    // own housekeeping at them.
    const reconcile = CODE.slice(
      CODE.indexOf('function reconcileAfterConflict()'),
      CODE.indexOf('function decide('),
    );
    expect(reconcile).not.toContain('announce(');
    expect(reconcile).not.toContain('setDecisionFailed');
    // And a failed reconcile cannot replace the sentence that is already on screen.
    expect(reconcile).toContain('() => {},');
  });

  it('never generates an Explanation, on a press or otherwise', () => {
    // A parent reading an Attempt with ten unexplained Questions would otherwise bill
    // ten provider calls against their own Explanation Allowance for prose nobody
    // asked for — and the child would find it already there, never having asked.
    expect(CODE).not.toMatch(/explainQuestion/u);
    expect(CODE).not.toMatch(/ExplainPanel/u);
    // Nothing runs on mount that could reach the network. There *is* one effect — it
    // moves focus when the control a parent pressed stops existing — and the claim is
    // that it talks to nothing: the only request in the file is inside `flag()`, which
    // only a press calls.
    const effect = CODE.slice(CODE.indexOf('useEffect('), CODE.indexOf('}, [state]);'));
    expect(effect).toContain('focus()');
    expect(effect).not.toContain('parentApi');
    expect(CODE.indexOf('parentApi.flagExplanation')).toBeGreaterThan(
      CODE.indexOf('function flag()'),
    );
  });

  it('moves focus to the sentence that replaced the control, and only on a press', () => {
    // Reporting unmounts the control, and a browser drops focus to `document.body` when
    // the focused element disappears — which puts a keyboard user out of the paper
    // entirely, mid-list. Focus moves deliberately, to the outcome they need to read.
    expect(CODE).toContain('tabIndex={-1}');
    expect(CODE).toContain('ref={flaggedSentence}');
    expect(CODE).toContain('flaggedSentence.current?.focus()');
    // Guarded on this component's own press, so an Attempt opened with three
    // explanations already reported does not pull focus to one of them on load.
    expect(CODE).toContain('pressed.current = true');
    expect(CODE).toContain("if (state !== 'flagged' || !pressed.current) return;");
  });

  it('shows the reported state without a date rather than the words “Invalid Date”', () => {
    // `reviewStateFor` decides on the field being present — deliberately, and its own
    // spec pins that — so an unparsable instant is still a flag. It is only the date
    // that cannot be stated, and `new Date('').toLocaleString()` is the literal words
    // "Invalid Date", which read as a fault in the report rather than in a string.
    expect(CODE).toContain('readableInstant(');
    expect(CODE).toContain('parentCopy.attempts.flaggedUndated');
    expect(CODE).not.toMatch(/new Date\([^)]*\)\.toLocaleString/u);
  });

  it('heads only the branch that has prose to head', () => {
    // On a twenty-Question paper where the child asked about two, an unconditional
    // heading gives a screen reader eighteen identical headings over eighteen
    // statements that the child was told nothing.
    // The nothing-explained arm alone, which ends where the alternative begins.
    const absent = CODE.slice(CODE.indexOf('explanations.length === 0 ? ('), CODE.indexOf(') : ('));
    expect(absent).toContain('explanation-not-asked');
    expect(absent).not.toContain('explanation-heading');
    expect(CODE).toContain('data-testid="explanation-heading"');
    expect(CODE.indexOf('data-testid="explanation-heading"')).toBeGreaterThan(
      CODE.indexOf('explanations.length === 0'),
    );
  });

  it('labels a Question’s generations only where there are several to tell apart', () => {
    // A label on the one and only explanation of a Question names something there is nothing
    // to distinguish it from, and on a twenty-Question paper it would give a screen reader
    // twenty "Explanation 1" lines. The same rule the heading follows, for the same reason.
    expect(CODE).toContain('const labelled = explanations.length > 1;');
    expect(CODE).toContain('{labelled && (');
    expect(CODE).toContain('parentCopy.attempts.generationLabel(entry.generation)');
  });

  it('renders every generation, and puts every control on the latest only', () => {
    // An older generation is history: the child is not being served it, so there is no
    // concern to record about it, no decision to make and nothing to remove or replace.
    expect(CODE).toContain('explanations.map((entry)');
    expect(CODE).toContain('const isLatest = entry.generation === latest?.generation;');
    expect(CODE).toContain('{isLatest && (');
    // The prose is drawn for every entry; the parent's own flag, the removal and the
    // replacement are inside the latest-only branch.
    expect(CODE.indexOf('data-testid="explanation-body"')).toBeLessThan(
      CODE.indexOf('{isLatest && ('),
    );
    for (const control of [
      '"explanation-flag"',
      '"explanation-suppress"',
      '"explanation-regenerate"',
    ]) {
      expect(CODE.indexOf(control)).toBeGreaterThan(CODE.indexOf('{isLatest && ('));
    }
    // **The child's report is the exception, and deliberately outside that branch**: each
    // generation carries its own, and the API decides the oldest undecided one across all of
    // them — so a block that read only the latest would leave an older undecided report
    // undecidable from this screen, and a press beside the latest would silently decide the
    // older one.
    expect(CODE).toContain('const entryStudentState = studentFlagStateFor(entry);');
    expect(CODE.indexOf('"explanation-student-flag"')).toBeLessThan(CODE.indexOf('{isLatest && ('));
    expect(CODE.indexOf('"explanation-confirm"')).toBeLessThan(CODE.indexOf('{isLatest && ('));
  });

  it('puts the decision controls on the generation the API will actually decide', () => {
    // `disposeStudentFlag` decides the oldest **undecided** student report across every
    // generation. Controls beside the latest would have a parent press next to generation 2
    // and watch generation 1 get decided, with the region they pressed in not changing at all.
    expect(CODE).toContain('const decidable = decidableOf(explanations);');
    expect(CODE).toContain(
      "entryStudentState === 'awaiting' && entry.generation === decidable?.generation",
    );
    expect(CODE).toContain('{entryDecidable ? (');
    // The generation is passed to the write, so the row pressed and the row focused are the
    // same one — and the API's answer corrects it if the two ever drift.
    expect(CODE).toContain("decide('Confirmed', entry.generation)");
    expect(CODE).toContain("decide('Dismissed', entry.generation)");
    expect(CODE).toContain('decided.current = generation;');
    expect(CODE).toContain('decided.current = view.generation;');
    // An awaiting report that is **not** that row states nothing extra: the decided sentence is
    // gated on a decision actually existing, so the line saying the child reported it stands on
    // its own. An ungated arm would render `decisionSentence`'s empty string there, and a
    // control would invite a press the screen has deliberately put on another row.
    expect(CODE).toContain(
      "entryStudentState === 'confirmed' || entryStudentState === 'dismissed' ? (",
    );
    // And both decision controls live inside the decidable arm, not beside the decided one.
    expect(CODE.indexOf('"explanation-awaiting"')).toBeGreaterThan(
      CODE.indexOf('{entryDecidable ? ('),
    );
    expect(CODE.indexOf('"explanation-awaiting"')).toBeLessThan(
      CODE.indexOf("entryStudentState === 'confirmed' ||"),
    );
  });

  it('shows a removed generation read-only, with the instant it was removed', () => {
    // Retained, still readable, and with no control beside it: this cannot be undone. The
    // parent who decided stays able to read what they decided about.
    expect(CODE).toContain('{entry.suppressedAt !== null && (');
    expect(CODE).toContain('data-testid="explanation-removed"');
    expect(CODE).toContain('parentCopy.attempts.suppressed(removedAt)');
    expect(CODE).toContain('parentCopy.attempts.suppressedUndated');
  });

  it('renders nothing at all where the removal is not available', () => {
    // Not a disabled control: a greyed one invites a parent to wonder what they did wrong,
    // and there is nothing they did. A concern has to be recorded first, and until one is
    // this is simply not part of the screen.
    expect(CODE).toContain("{suppressionState === 'available' && (");
    expect(CODE).toContain('const suppressionState = suppressionStateFor(explanations);');
    // And the availability is the API's answer, never re-derived here.
    expect(CODE).not.toMatch(/canSuppress/u);
    expect(CODE).not.toMatch(/parentFlaggedAt !== null &&/u);
  });

  it('puts the removal behind a confirmation that names every consequence first', () => {
    // The one act on this surface that cannot be taken back, and the only one behind a
    // confirmation — `AppDialog` plus `DestructiveButton`, exactly as the drafts screen's
    // release and discard are.
    expect(CODE).toContain('<AppDialog');
    expect(CODE).toContain('<DestructiveButton');
    expect(CODE).toContain('parentCopy.attempts.suppressTitle');
    expect(CODE).toContain('parentCopy.attempts.suppressBody');
    expect(CODE).toContain('parentCopy.attempts.suppressConfirm');
    expect(CODE).toContain('parentCopy.drafts.cancel');
    // The body is wired to `aria-describedby`, or the one sentence that matters goes unread.
    expect(CODE).toContain('describedBy={confirmBodyId}');
    // **Nothing is sent until it is confirmed**: the control opens the dialog, and the only
    // caller of the write is the dialog's own confirm.
    expect(CODE).toContain('onClick={() => setConfirming(true)}');
    expect(CODE).toContain('onClick={confirmSuppression}');
    expect(CODE.indexOf('parentApi.suppressExplanation')).toBeGreaterThan(
      CODE.indexOf('function confirmSuppression()'),
    );
    // And never a blocking native dialog, in any of its three spellings.
    expect(CODE).not.toMatch(/window\.confirm|globalThis\.confirm|(?<![A-Za-z.])confirm\(/u);
  });

  it('states the cost before the replacement fires, and offers it only once one is removed', () => {
    // The child is still being served a live explanation, so there would be nothing to
    // replace — and the cost is nothing, at every plan, which a parent who has just taken
    // something away from their child should not have to weigh.
    expect(CODE).toContain("{suppressionState === 'suppressed' && (");
    expect(CODE).toContain('parentCopy.attempts.regenerateNote');
    expect(CODE).toContain('parentCopy.attempts.regenerating');
    expect(CODE.indexOf('parentCopy.attempts.regenerateNote')).toBeLessThan(
      CODE.indexOf('parentCopy.attempts.regenerateControl'),
    );
    // No confirmation on this one: it costs nothing, takes nothing away and can be done
    // again, and a dialog would teach a parent it is the same sort of act as the removal.
    const replacement = CODE.slice(
      CODE.indexOf("{suppressionState === 'suppressed' && ("),
      CODE.indexOf('data-testid="explanation-suppress-failed"'),
    );
    expect(replacement).not.toContain('AppDialog');
    expect(replacement).not.toContain('DestructiveButton');
  });

  it('offers no un-removal anywhere, in any spelling', () => {
    // There is no API call for it and no state that could hold one: suppression is not
    // reversible, and the confirmation says so before it fires.
    for (const forbidden of [/unsuppress/iu, /unSuppress/u, /restore/iu, /undo/iu, /\btoggle/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('says nothing was explained rather than offering to explain it', () => {
    expect(CODE).toContain('explanations.length === 0');
    expect(CODE).toContain('parentCopy.attempts.nothingExplained');
    // And that branch carries no control at all: every control is inside the branch that
    // has an Explanation to be about.
    // The truthy arm alone, which ends where the alternative begins — so the assertions below
    // are about the branch a Question nobody asked about actually renders.
    const absentBranch = CODE.slice(
      CODE.indexOf('explanations.length === 0'),
      CODE.indexOf(') : ('),
    );
    expect(absentBranch).not.toContain('explanation-flag');
    expect(absentBranch).not.toContain('explanation-confirm');
    // The confirmation dialog is inside the branch that has something to remove, not beside
    // it: on a twenty-Question paper where the child asked about two, one mounted per row
    // would be eighteen dialogs — each with its own `useId` — that can never open.
    expect(absentBranch).not.toContain('AppDialog');
    expect(CODE.indexOf('<AppDialog')).toBeGreaterThan(CODE.indexOf(') : ('));
    expect(CODE.indexOf('<AppDialog')).toBeLessThan(CODE.indexOf('explanations.map((entry)'));
  });

  it('drops the flag control once flagged, rather than leaving an inert one', () => {
    // There is no un-flagging: a record of a concern is not a toggle, so a control
    // left on screen would offer an action that does nothing.
    expect(CODE).toContain("state === 'flagged' ?");
    expect(CODE).toContain('data-testid="explanation-flagged"');
    expect(CODE).toContain('data-testid="explanation-flag"');
    // The flagged arm comes first and the control is the alternative to it.
    expect(CODE.indexOf('explanation-flagged')).toBeLessThan(CODE.indexOf('"explanation-flag"'));
  });

  it('states what flagging does, in words, beside the control', () => {
    // Suppression is the act that changes what a child is served, and it is not this
    // one. A confirmation dialog here would teach a parent otherwise.
    expect(CODE).toContain('parentCopy.attempts.flagNote');
    // **No confirmation on the flag**, which is the claim here: the dialog on this surface
    // belongs to the one act that cannot be taken back, and the flag is not it. The slice
    // ends where the removal's own controls begin.
    const flagging = CODE.slice(
      CODE.indexOf('parentCopy.attempts.flagNote'),
      CODE.indexOf('data-testid="explanation-student-flag"'),
    );
    expect(flagging).not.toMatch(/Dialog|Modal/u);
    // And never a blocking native dialog anywhere in the file, in any of its three
    // spellings. Narrowed away from a bare `/confirm/` because the copy legitimately
    // contains the word; the lookbehind excludes `.` so a member read as
    // `something.confirm(...)` could never be mistaken for one, which is why the qualified
    // spellings are named outright rather than left to it.
    expect(CODE).not.toMatch(/window\.confirm|globalThis\.confirm|(?<![A-Za-z.])confirm\(/u);
  });

  it('draws the child’s report as its own fact, never folded into the parent’s', () => {
    // Two people raising a concern, and two independent pure decisions. A region that
    // read either one for the other would tell a parent their child said something they
    // did not.
    expect(CODE).toContain('const state = reviewStateFor(latest);');
    expect(CODE).toContain('const studentState = studentFlagStateFor(latest);');
    expect(CODE).toContain('data-testid="explanation-student-flag"');
    // Both are applied to the **latest** generation, which is the one the child is being
    // served and the only one any decision can be about.
    expect(CODE).toContain('const latest = latestOf(explanations);');
    // And nothing here re-derives either from the raw fields.
    expect(CODE).not.toMatch(/latest\?\.studentFlagDisposition ===/u);
  });

  it('shows the child’s report only where there is one', () => {
    // On a twenty-Question paper where the child reported two, an unconditional block
    // would give a screen reader eighteen statements that nothing was reported.
    expect(CODE).toContain("{entryStudentState !== 'none' && (");
  });

  it('offers exactly two decisions, and only while none is recorded', () => {
    // A closed set of two, and the first decision stands — so a control after one is
    // recorded would be an offer to do something the API refuses with a 409.
    expect(CODE).toContain('{entryDecidable ? (');
    expect(CODE).toContain("decide('Confirmed', entry.generation)");
    expect(CODE).toContain("decide('Dismissed', entry.generation)");
    expect(CODE.match(/decide\('\w+', entry\.generation\)/gu)).toHaveLength(2);
    // The decided arm carries the outcome and no control at all.
    const decidedArm = CODE.slice(CODE.indexOf('data-testid="explanation-decided"'));
    expect(decidedArm.slice(0, 400)).not.toContain('<Button');
  });

  it('says in words that confirming sends the report on and does not remove anything', () => {
    // The assumption a parent would otherwise make is that agreeing takes the
    // explanation away from their child. It does not, and the note says so *before*
    // either control is pressed.
    expect(CODE).toContain('parentCopy.attempts.dispositionNote');
    expect(CODE.indexOf('parentCopy.attempts.dispositionNote')).toBeLessThan(
      CODE.indexOf("decide('Confirmed', entry.generation)"),
    );
    // And **deciding does not remove anything**: the only caller of the removal is the
    // confirmation's own confirm, which a parent reaches through a separate control and a
    // dialog. Nothing in `decide` touches it.
    const deciding = CODE.slice(
      CODE.indexOf('function decide(disposition'),
      CODE.indexOf('function confirmSuppression()'),
    );
    expect(deciding).not.toMatch(/suppressExplanation|regenerateExplanation|explainQuestion/u);
    // Nothing here generates unasked either — the one write that produces prose is the
    // parent's own deliberate press on a Question they have already removed one from.
    expect(CODE).not.toMatch(/explainQuestion/u);
  });

  it('moves focus to the sentence that replaced the removal control, and only on a press', () => {
    // The removal unmounts the control it was pressed from, and a browser drops focus to
    // `document.body` when the focused element disappears — out of the paper, mid-list.
    expect(CODE).toContain('ref={isLatest ? removedSentence : undefined}');
    expect(CODE).toContain('removedSentence.current?.focus()');
    expect(CODE).toContain('removed.current = true');
    expect(CODE).toContain('!removed.current');
    // And the replacement, which unmounts its own control and adds a generation: what
    // replaces it is the new explanation, so focus moves to the label naming it.
    expect(CODE).toContain('ref={isLatest ? latestLabel : undefined}');
    expect(CODE).toContain('latestLabel.current?.focus()');
    expect(CODE).toContain('regenerated.current = true');
    expect(CODE).toContain('!regenerated.current');
  });

  it('moves focus to the sentence that replaced the two controls', () => {
    // Deciding unmounts both, and a browser drops focus to `document.body` when the
    // focused element disappears — out of the paper, mid-list.
    // Pinned to the **generation** this component's own press decided, not to a fixed row:
    // once a decision lands, `decidableOf` moves on to the next undecided report, so a ref
    // pinned to "whatever is decidable now" would focus a row still awaiting one, or nothing.
    expect(CODE).toContain(
      'ref={entry.generation === decided.current ? decidedSentence : undefined}',
    );
    expect(CODE).toContain('decidedSentence.current?.focus()');
    // Guarded on this component's own press, so an Attempt opened with three decisions
    // already made does not pull focus to one of them on load — and released on a failure, or
    // it would fire on the next unrelated render for something that did not happen.
    expect(CODE).toContain('if (decided.current === null) return;');
    expect(CODE).toContain('decided.current = null;');
  });

  it('issues one decision per press, and renders the API’s own refusal', () => {
    // A double-tap would otherwise issue two calls whose responses land in either order.
    // A second, *different* decision is refused with a 409 whose sentence is written once,
    // in the API's policy file — rendered here rather than restated.
    expect(CODE).toContain('if (deciding || latest === undefined) return;');
    expect(CODE).toContain('disabled={deciding}');
    expect(CODE).toContain('parentCopy.attempts.disposeFailed');
    expect(CODE).toContain('data-testid="explanation-dispose-failed"');
  });

  it('announces the sentence it displays, once, through the screen’s region', () => {
    // One surface has one live region and the screen owns it, which is why `announce`
    // is a prop rather than a hook of this component's.
    expect(CODE).toContain('announce: (text: string) => void');
    expect(CODE).not.toMatch(/useAnnounce/u);
    const announced = CODE.match(/announce\((?!text)/gu) ?? [];
    // Nine call sites — each of the four writes' outcomes, each of their failures, and the
    // replacement's wait, announced at the press because a provider call takes seconds to tens
    // of seconds and a wait nobody is told about is a screen gone quiet. Every one announces a
    // sentence it also renders.
    expect(announced).toHaveLength(9);
    expect(CODE).toContain('announce(parentCopy.attempts.regenerating);');
    expect(CODE).toContain('data-testid="explanation-regenerating"');
    expect(CODE).toContain('aria-busy={regenerating}');
    expect(CODE.indexOf('announce(parentCopy.attempts.regenerating);')).toBeLessThan(
      CODE.indexOf('parentApi.regenerateExplanation'),
    );
    expect(CODE).toContain('announce(parentCopy.attempts.flagAnnouncement(ordinal))');
    expect(CODE).toContain('parentCopy.attempts.confirmAnnouncement(ordinal)');
    expect(CODE).toContain('parentCopy.attempts.dismissAnnouncement(ordinal)');
    expect(CODE).toContain('announce(parentCopy.attempts.suppressAnnouncement(ordinal))');
    expect(CODE).toContain('announce(parentCopy.attempts.regeneratedAnnouncement(ordinal))');
    expect(CODE).toContain('announce(sentence)');
    expect(CODE).toContain('setFailed(sentence)');
    expect(CODE).toContain('setDecisionFailed(sentence)');
    expect(CODE).toContain('setSuppressFailed(sentence)');
    expect(CODE).toContain('setRegenerateFailed(sentence)');
  });

  it('issues one request per press, however fast the pressing', () => {
    // A double-tap would otherwise issue two calls whose responses land in either
    // order — and announce twice, telling a parent something happened twice.
    expect(CODE).toContain('if (flagging || latest === undefined) return;');
    expect(CODE).toContain('disabled={flagging}');
    // And the same guard on the two writes Story 6.4 added.
    expect(CODE).toContain('if (suppressing || latest === undefined) return;');
    expect(CODE).toContain('if (regenerating || latest === undefined) return;');
    expect(CODE).toContain('disabled={suppressing}');
    expect(CODE).toContain('disabled={regenerating}');
  });

  it('ends Parent View only on the guard’s own refusal, on both writes', () => {
    // A transient failure is a sentence in this region with the control still there
    // to press. An expired elevation is not about this Explanation — and the decision
    // route is a write too, so a check it did not carry would be the one that mattered.
    // Four writes now, and a check any one of them did not carry would be the one that
    // mattered.
    expect(CODE.match(/cause\.notElevated \|\| cause\.status === 401/gu)).toHaveLength(4);
    expect(CODE.match(/onElevationLost\(\)/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(CODE).toContain('parentCopy.attempts.flagFailed');
  });

  it('draws the stored prose through the one renderer of segments', () => {
    // A fraction arrives as structure and keeps its spoken reading (AD-32).
    // For every generation, including the removed ones: they are retained, and the parent
    // who decided about one stays able to read what they decided about.
    expect(CODE).toContain('<RichText segments={entry.body} />');
    expect(CODE.match(/<RichText/gu)).toHaveLength(1);
  });

  it('shows a decision without a date rather than the words “Invalid Date”', () => {
    // A decided report whose instant will not parse still says which decision was made —
    // that is the fact — and only the date is unstateable.
    expect(CODE).toContain('parentCopy.attempts.confirmedUndated');
    expect(CODE).toContain('parentCopy.attempts.dismissedUndated');
    expect(CODE).toContain('parentCopy.attempts.studentFlaggedUndated');
    expect(CODE).not.toMatch(/new Date\([^)]*\)\.toLocaleString/u);
  });

  it('sits at h5, under the row’s own h4', () => {
    // An explanation belongs to its Question. A heading at `h4` would make it a
    // sibling of the row it sits inside, and an outline that lies is worse than none.
    expect(CODE).toContain('component="h5"');
    expect(CODE).not.toContain('component="h4"');
  });

  it('names no cost, tier, model or allowance anywhere', () => {
    // A parent reading an Explanation is spending nothing (AD-20, AD-26).
    for (const forbidden of [/allowance/iu, /\btier\b/iu, /costMicros/iu, /rationale/iu]) {
      expect(CODE).not.toMatch(forbidden);
    }
  });

  it('every sentence it shows is a member of `parentCopy.attempts`', () => {
    // Third person about the child, never addressed to them (AD-32).
    expect(CODE).not.toMatch(/studentCopy/u);
    const literals = CODE.match(/>\s*[A-Z][a-z]+ [a-z]/gu) ?? [];
    expect(literals).toEqual([]);
  });
});
