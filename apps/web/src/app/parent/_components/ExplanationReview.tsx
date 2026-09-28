'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { DestructiveButton } from '@/components/Button';
import { AppDialog } from '@/components/Dialog';
import { RichText } from '@/components/RichText';
import { parentCopy } from '@/copy/parent';
import {
  decidableOf,
  latestOf,
  reviewStateFor,
  studentFlagStateFor,
  suppressionStateFor,
  type StudentFlagState,
} from '@/lib/explanation-review';
import {
  CONFLICT_STATUS,
  ParentApiError,
  parentApi,
  type FlagDisposition,
  type ParentExplanationView,
} from '@/lib/parent-api';
import { readableInstant } from '@/lib/parent-view';
import { comfortableDensity, typeRoles } from '@/theme/tokens';

/**
 * What the child was told about one Question, and what a parent can do about it.
 *
 * **Inline, beneath its own answer-key row** (UX-DR16), handed to the shared row
 * through its `explain` slot — the same adjacency the child's own panel keeps. Never
 * a modal, which would cover the Question and both answers this prose is about, and
 * never a route, which would take the paper away entirely.
 *
 * **It never generates on its own account.** There is no call to `explainQuestion` here
 * and nothing that runs on mount: a parent reading an Attempt with ten unexplained
 * Questions would otherwise bill ten provider calls against their own Explanation
 * Allowance for prose nobody asked for — and the child would then find it already there,
 * having never asked. A Question the child did not ask about says so, and that is the whole
 * of that branch. The one write that *does* produce prose is the parent's own deliberate
 * press on a Question they have already removed an explanation from, and it costs nothing.
 *
 * **Five `parentApi.` calls, and a press is behind every one.** The prose arrives with the
 * Attempt, in the screen's own read; the requests are the parent's own flag, their decision
 * about their child's report, the removal, the replacement, and the re-read that reconciles
 * this region when a decision comes back refused because one is already recorded.
 *
 * **Since Story 6.4 it takes a Question's whole history.** A Question can hold several
 * explanations — the ones a parent removed, and the replacement that followed each — and
 * every one is rendered, oldest first. The removed ones are read-only, with the instant they
 * were removed; the controls are on the **latest** only, because that is the one the child is
 * being served and the only one any decision can be about.
 *
 * **It draws two independent flag facts side by side.** The parent's own concern and their
 * child's are two people raising one, and each is its own pure decision
 * (`reviewStateFor`, `studentFlagStateFor`) — a region that folded them into one state
 * would tell a parent their child said something they did not.
 *
 * **Every control disappears once it has nothing left to do.** There is no un-flagging, no
 * reversing a decision and no un-removing: leaving a pressed control on screen would be
 * offering an action that does nothing, and what replaces it is the state and the instant.
 * And where suppression is not available at all, **nothing is rendered** rather than
 * something disabled: a greyed control invites a parent to wonder what they did wrong, and
 * there is nothing they did.
 *
 * **What each act does is stated in words, before it fires.** The flag note says the child
 * still sees the same explanation; the disposition note says agreeing does not remove it;
 * the removal's confirmation names every consequence including that it cannot be undone; and
 * the replacement's note says it costs nothing, at every plan. The removal is the one act
 * behind a confirmation, because it is the one that cannot be taken back — and it is
 * `AppDialog` plus `DestructiveButton`, never a blocking native `confirm`.
 *
 * Every sentence is a member of `parentCopy.attempts`, in the third person about the
 * child. The announcement is the sentence displayed beside it, reported through the
 * screen's own live region: `announce` is a prop rather than a hook of this
 * component's, because one surface has one region and the screen owns it.
 */
export function ExplanationReview({
  attemptId,
  questionId,
  ordinal,
  explanations,
  token,
  announce,
  onFlagged,
  onGenerations,
  onElevationLost,
}: {
  attemptId: string;
  questionId: string;
  /** The number the child was shown while they worked. Announced, never derived. */
  ordinal: number;
  /**
   * Every explanation stored for this Question, oldest generation first, or empty for one
   * nobody asked about.
   *
   * A list rather than one view, because a Question legitimately holds several since Story
   * 6.4. Empty rather than `undefined` for the absent case: one shape for "nothing here",
   * so the branch is a length and not a null check.
   */
  explanations: readonly ParentExplanationView[];
  /** The elevation bearer. Held by the screen, never by this component. */
  token: string;
  /** The screen's live region. The sentence announced is the sentence shown. */
  announce: (text: string) => void;
  /**
   * Hands the screen one replaced entry, so the Attempt's own copy of it stays true.
   *
   * Used by the two writes that change one generation and answer with it: a decision about
   * the child's report and the parent's own flag. The API answers each with the **whole**
   * view, so neither can leave the screen holding half of the other's outcome — and the
   * screen replaces by `(questionId, generation)`, because a question id alone now matches
   * several rows.
   */
  onFlagged: (view: ParentExplanationView) => void;
  /**
   * Hands the screen **every** entry for this Question, replacing all of them.
   *
   * Used by the two writes that change the history rather than one row: a removal, which
   * changes one generation but must redraw the lot, and a replacement, which *adds* one. A
   * handler that replaced by generation would drop a new generation on the floor, because
   * there is nothing on screen yet for it to replace.
   */
  onGenerations: (views: readonly ParentExplanationView[]) => void;
  /** The one failure that is not about this Explanation: Parent View has closed. */
  onElevationLost: () => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Whether a decision this component sent is still out. A double-tap is one call. */
  const [deciding, setDeciding] = useState(false);
  /** The one sentence a failed decision shows, apart from the flag's own failure. */
  const [decisionFailed, setDecisionFailed] = useState<string | null>(null);
  /** Whether the confirmation for the removal is open. Nothing is sent until it is confirmed. */
  const [confirming, setConfirming] = useState(false);
  /** Whether a removal this component sent is still out. */
  const [suppressing, setSuppressing] = useState(false);
  const [suppressFailed, setSuppressFailed] = useState<string | null>(null);
  /** Whether a replacement this component asked for is still out. */
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateFailed, setRegenerateFailed] = useState<string | null>(null);
  const confirmBodyId = useId();

  /**
   * The generation every control is about: the one the child is being served, or the one
   * that was last removed from them.
   *
   * The highest ordinal and never the last element of the list, because the ordinal is the
   * fact the API maintains. Older generations are read-only history.
   */
  const latest = latestOf(explanations);
  const state = reviewStateFor(latest);
  /**
   * What the **child's** report on the latest generation is: nothing, awaiting, or decided.
   *
   * Its own pure decision beside `state`, never folded into it: the two flags are two
   * facts, and the region draws both.
   *
   * It is the *latest* generation's, and it is used for this region's `data-student-state`
   * and nothing else. Each generation draws its own report from its own entry, because each
   * generation carries its own — see the map below.
   */
  const studentState = studentFlagStateFor(latest);
  /**
   * The generation a decision would land on, which is the one that draws Agree and Dismiss.
   *
   * **Not the latest.** The API decides the oldest *undecided* student report across every
   * generation, so controls beside the latest would have a parent press next to generation 2
   * and watch generation 1 get decided — with the region they pressed in not changing at all,
   * and an undecided report on an older generation undecidable from this screen at any point.
   * `decidableOf` mirrors the API's pick so the control a parent presses and the flag the API
   * writes are the same row.
   */
  const decidable = decidableOf(explanations);
  /**
   * What a parent may do about this Question right now: nothing, remove it, or replace it.
   *
   * Its own pure decision too, and read off the API's `canSuppress` rather than re-derived
   * here — so the control offered and the answer a press would get cannot disagree.
   */
  const suppressionState = suppressionStateFor(explanations);
  /**
   * The instant to state, or null for a stored one that will not parse.
   *
   * `reviewStateFor` decides `flagged` on the field being **present**, deliberately, and
   * that is not weakened here: a flag whose instant is unreadable is still a flag, and
   * only the date is unstateable. What would be unacceptable is rendering the words
   * "Invalid Date" beside "Reported".
   */
  const flaggedAt =
    latest?.parentFlaggedAt === null || latest?.parentFlaggedAt === undefined
      ? null
      : readableInstant(latest.parentFlaggedAt);

  /**
   * Where focus goes when the control the parent just pressed stops existing.
   *
   * Reporting unmounts the control, and a browser puts focus on `document.body` when
   * the focused element disappears — which drops a keyboard user out of the paper
   * entirely, mid-list, with no way back but retracing it. So focus moves deliberately,
   * to the sentence that replaced the control, which is also the outcome they need to
   * read.
   */
  const flaggedSentence = useRef<HTMLParagraphElement | null>(null);
  /**
   * Whether *this component's own press* is what flagged it — never a page that arrived
   * already flagged.
   *
   * A ref rather than state, because it is not rendered and must not cause one: an
   * Attempt opened with three explanations already reported would otherwise pull focus
   * to the third of them on load, which is a screen taking the keyboard from somebody
   * who has not touched anything.
   */
  const pressed = useRef(false);
  useEffect(() => {
    if (state !== 'flagged' || !pressed.current) return;
    pressed.current = false;
    flaggedSentence.current?.focus();
  }, [state]);

  /**
   * The same arrangement for the decision, which unmounts two controls rather than one.
   *
   * Deciding replaces Agree and Dismiss with the sentence saying which was recorded, so a
   * keyboard user's focus would otherwise land on `document.body` — out of the paper,
   * mid-list. It moves to the sentence that replaced them, which is also the outcome they
   * need to read. Guarded on this component's own press for the same reason: an Attempt
   * opened with three decisions already made must not pull focus to one of them on load.
   */
  const decidedSentence = useRef<HTMLParagraphElement | null>(null);
  /**
   * Which generation this component's own press decided, or null.
   *
   * A generation rather than a boolean, because the controls are no longer on a fixed row:
   * once a decision lands, `decidableOf` moves on to the *next* undecided report, so a ref
   * pinned to "whatever is decidable now" would put focus on a row that is still awaiting one
   * — or on nothing at all. Latched at the press, read by the render that the write triggers,
   * and cleared by the effect below.
   *
   * A ref rather than state for the reason `pressed` is one: it is not rendered on its own
   * account and must not cause a render, and an Attempt opened with three decisions already
   * made must not pull focus to one of them on load.
   */
  const decided = useRef<number | null>(null);
  useEffect(() => {
    if (decided.current === null) return;
    const target = explanations.find((entry) => entry.generation === decided.current);
    // Only once the decision is actually on the row: until the write answers, the sentence
    // the focus moves to does not exist yet.
    if (target === undefined || target.studentFlagDisposition === null) return;
    decided.current = null;
    decidedSentence.current?.focus();
  }, [explanations]);

  /**
   * And the same arrangement again for the removal, which unmounts the control it was
   * pressed from and replaces it with the sentence saying it happened.
   *
   * Guarded on this component's own press exactly as the two above are, so an Attempt opened
   * with three explanations already removed does not pull focus to one of them on load.
   */
  const removedSentence = useRef<HTMLParagraphElement | null>(null);
  const removed = useRef(false);
  useEffect(() => {
    if (suppressionState !== 'suppressed' || !removed.current) return;
    removed.current = false;
    removedSentence.current?.focus();
  }, [suppressionState]);

  /**
   * And for the replacement, which unmounts its own control and adds a generation.
   *
   * There is no sentence replacing that control — what replaces it is the new explanation —
   * so focus moves to the label naming it, which is the first thing a parent needs in order
   * to make sense of two explanations where there was one.
   */
  const latestLabel = useRef<HTMLParagraphElement | null>(null);
  const regenerated = useRef(false);
  useEffect(() => {
    if (!regenerated.current) return;
    regenerated.current = false;
    latestLabel.current?.focus();
  }, [explanations]);

  /**
   * One press of the report control.
   *
   * Guarded on `flagging` so a double-tap issues one call rather than two whose
   * responses land in either order. A second *successful* press would be harmless —
   * the API is idempotent per (Explanation, origin) and answers the first instant —
   * but announcing twice would tell a parent something happened twice.
   */
  function flag() {
    if (flagging || latest === undefined) return;
    setFlagging(true);
    setFailed(null);
    parentApi.flagExplanation(token, attemptId, questionId).then(
      (view) => {
        setFlagging(false);
        // Set before the state that unmounts the control, so the effect above can tell
        // this transition from a paper that arrived already reported.
        pressed.current = true;
        onFlagged(view);
        // The sentence on screen and the sentence announced are one string, so the
        // two cannot come apart (UX-DR33).
        announce(parentCopy.attempts.flagAnnouncement(ordinal));
      },
      (cause: unknown) => {
        setFlagging(false);
        if (cause instanceof ParentApiError && (cause.notElevated || cause.status === 401)) {
          onElevationLost();
          return;
        }
        const sentence =
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.attempts.flagFailed;
        setFailed(sentence);
        announce(sentence);
      },
    );
  }

  /**
   * Catches this region up after any of the three writes below is refused as a conflict.
   *
   * **One spelling of the reconcile**, called from `decide`, `confirmSuppression` and
   * `regenerate` alike: a 409 from any of them means this region is already out of date —
   * decided, suppressed or regenerated elsewhere — and without a re-read the control that
   * was pressed would stay on screen offering an act the API will keep refusing, with no
   * way to learn what actually happened short of reloading the whole paper. Nothing is
   * announced here and nothing said: the caller has already stated its own refusal, and a
   * second sentence for a read the parent did not ask for would narrate the screen's own
   * housekeeping at them. A failure to reconcile must not replace that sentence with a
   * second one about a request the parent never made, and a Question whose entries are
   * somehow absent simply leaves the region as it was.
   */
  function reconcileAfterConflict() {
    parentApi.attemptExplanations(token, attemptId).then(
      (views) => {
        const current = views.filter((view) => view.questionId === questionId);
        if (current.length > 0) onGenerations(current);
      },
      () => {},
    );
  }

  /**
   * One press of Agree or Dismiss.
   *
   * **The first decision is final, and this is the only place one is sent.** Guarded on
   * `deciding` so a double-tap issues one call rather than two whose responses land in
   * either order — and the API refuses a second, *different* decision with a 409 whose
   * sentence is rendered rather than restated here, because it is written once in the
   * API's policy file.
   *
   * **Confirming does not remove anything**, and the note beside the controls says so before
   * either is pressed: the student is served exactly the same explanation afterwards. What
   * it does do is *unlock* the removal as something the parent may then choose — and
   * unlocking an act is not performing it, which is why the removal has a confirmation of its
   * own and this does not.
   *
   * **The generation is a parameter, and it is the one whose controls were pressed.** The API
   * picks the oldest undecided report across every generation, so the caller is `decidableOf`'s
   * row and never simply the latest — otherwise a press beside generation 2 would decide
   * generation 1 and the region pressed in would not change. It is not sent on the wire (the
   * route takes no body): it is what the focus move below is aimed at.
   */
  function decide(disposition: FlagDisposition, generation: number) {
    if (deciding || latest === undefined) return;
    setDeciding(true);
    setDecisionFailed(null);
    // Latched at the press, so the row the parent is standing on already carries the focus ref
    // by the time the write answers — and corrected below to whatever generation the API says
    // it actually decided, which is authoritative over the one this screen aimed at.
    decided.current = generation;
    parentApi.disposeExplanationFlag(token, attemptId, questionId, disposition).then(
      (view) => {
        setDeciding(false);
        // The generation the API says it decided, which is authoritative over the one this
        // press aimed at: if `decidableOf` and the API ever drift, focus and the sentence land
        // on the row that actually changed rather than on the row the screen guessed.
        decided.current = view.generation;
        onFlagged(view);
        // The sentence on screen and the sentence announced are one string, so the two
        // cannot come apart (UX-DR33).
        announce(
          disposition === 'Confirmed'
            ? parentCopy.attempts.confirmAnnouncement(ordinal)
            : parentCopy.attempts.dismissAnnouncement(ordinal),
        );
      },
      (cause: unknown) => {
        setDeciding(false);
        // Nothing was decided, so the focus latch is released: left set, it would fire on the
        // next unrelated render of this Question and take the keyboard for something that did
        // not happen.
        decided.current = null;
        if (cause instanceof ParentApiError && (cause.notElevated || cause.status === 401)) {
          onElevationLost();
          return;
        }
        // The API's own 409 sentence when it sent one — the first decision stands, and
        // that rule is stated in one place.
        const sentence =
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.attempts.disposeFailed;
        setDecisionFailed(sentence);
        announce(sentence);
        // **A 409 means this region is out of date, so it catches up.** The refusal says a
        // decision is already recorded — made in another tab, on another device, or by the
        // other half of a double press — and without a re-read both controls would stay on
        // screen offering a decision the API will refuse for ever, with no way to learn
        // which one was actually recorded short of reloading the whole paper.
        //
        // Only on the conflict: every other failure is transient and leaves the controls
        // exactly where they were, to be pressed again.
        if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS) {
          reconcileAfterConflict();
        }
      },
    );
  }

  /**
   * One confirmed removal, and **the only thing that sends one**.
   *
   * Nothing leaves the device until the parent confirms: the control opens the dialog, the
   * dialog states every consequence, and this runs from the dialog's own confirm. Cancel
   * sends nothing and changes nothing.
   *
   * Guarded on `suppressing` so a double-tap issues one call. A second successful press
   * would be harmless — the API keeps the first instant and answers 200 — but announcing
   * twice would tell a parent something happened twice.
   */
  function confirmSuppression() {
    if (suppressing || latest === undefined) return;
    setSuppressing(true);
    setSuppressFailed(null);
    parentApi.suppressExplanation(token, attemptId, questionId).then(
      (views) => {
        setSuppressing(false);
        setConfirming(false);
        // Set before the state that unmounts the control, so the effect above can tell this
        // transition from a paper that arrived with it already removed.
        removed.current = true;
        onGenerations(views);
        // The sentence on screen and the sentence announced are one string (UX-DR33), and it
        // restates the irreversibility the dialog stated before the press.
        announce(parentCopy.attempts.suppressAnnouncement(ordinal));
      },
      (cause: unknown) => {
        setSuppressing(false);
        setConfirming(false);
        if (cause instanceof ParentApiError && (cause.notElevated || cause.status === 401)) {
          onElevationLost();
          return;
        }
        // The API's own sentence when it sent one — the 409 that says a concern has to be
        // recorded first is written once, in the API's policy file, and rendered here.
        const sentence =
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.attempts.suppressFailed;
        setSuppressFailed(sentence);
        announce(sentence);
        // A 409 here means this region is already out of date — suppressed, or already
        // regenerated, from another tab or the other half of a double press — and the
        // control would otherwise stay on screen offering an action the API will refuse
        // forever. Reconciled exactly as `decide`'s own conflict does, and for the same
        // reason.
        if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS) {
          reconcileAfterConflict();
        }
      },
    );
  }

  /**
   * One press of the replacement control.
   *
   * **No confirmation**, deliberately: it costs nothing, it takes nothing away and it can be
   * done again. The note beside the control states the cost before it fires, which is the
   * whole of what a parent needs to decide — a dialog here would teach them this is the same
   * sort of act as the removal, and it is the opposite of one.
   *
   * Guarded on `regenerating` so a double-tap issues one call rather than two, which the API
   * would settle into one row anyway and which would announce twice.
   */
  function regenerate() {
    if (regenerating || latest === undefined) return;
    setRegenerating(true);
    setRegenerateFailed(null);
    // Announced **at the press**, in the sentence the screen displays beside it: a provider
    // call takes seconds to tens of seconds, and a wait nobody is told about is a screen that
    // has simply gone quiet for somebody reading it by ear. The one string is both what the
    // live region carries and what is rendered, exactly as every outcome on this surface is
    // (UX-DR33).
    announce(parentCopy.attempts.regenerating);
    parentApi.regenerateExplanation(token, attemptId, questionId).then(
      (views) => {
        setRegenerating(false);
        // Set before the state that unmounts the control, so the effect above can tell this
        // transition from a paper that arrived with a replacement already on it.
        regenerated.current = true;
        // **Every** entry, because this one *adds* a generation: a handler that replaced by
        // generation would have nothing on screen to match the new one against and would drop
        // it on the floor.
        onGenerations(views);
        announce(parentCopy.attempts.regeneratedAnnouncement(ordinal));
      },
      (cause: unknown) => {
        setRegenerating(false);
        if (cause instanceof ParentApiError && (cause.notElevated || cause.status === 401)) {
          onElevationLost();
          return;
        }
        const sentence =
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.attempts.regenerateFailed;
        setRegenerateFailed(sentence);
        announce(sentence);
        // Reconciled on a conflict for the same reason `confirmSuppression` and `decide` are:
        // the row it was pressed on is no longer live, from another tab or a concurrent
        // regeneration elsewhere, and without a re-read the control would stay offering a
        // replacement the API will keep refusing.
        if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS) {
          reconcileAfterConflict();
        }
      },
    );
  }

  /**
   * Whether a Question's generations need labelling.
   *
   * Only where there are several: a label on the one and only explanation of a Question
   * names something there is nothing to tell it apart from, and on a twenty-Question paper
   * it would give a screen reader twenty "Explanation 1" lines. The same rule the heading
   * below follows, for the same reason.
   */
  const labelled = explanations.length > 1;

  return (
    <Box
      sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
      data-testid="explanation-review"
      data-state={state}
      data-student-state={studentState}
      data-suppression-state={suppressionState}
    >
      {explanations.length === 0 ? (
        /* A Question the child never asked about. A plain sentence, and no control:
           nothing here generates one unasked, so there is nothing to offer.

           **And no heading.** A heading introduces something, and there is nothing here
           for it to introduce: on a twenty-Question paper where the child asked about
           two, an unconditional heading would give a screen reader eighteen identical
           "What the student was told" headings over eighteen statements that they were
           told nothing. The sentence stands on its own. */
        <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="explanation-not-asked">
          {parentCopy.attempts.nothingExplained}
        </Typography>
      ) : (
        <>
          {/* `h5`, under the row's own `h4`. An explanation belongs to its Question, and
              a heading at `h4` would make it a sibling of the row it sits inside — an
              outline that lies is worse than no outline. Rendered only here, where there
              is prose for it to head. */}
          <Typography component="h5" sx={{ ...typeRoles.label }} data-testid="explanation-heading">
            {parentCopy.attempts.explanationHeading}
          </Typography>

          {/*
        The one act on this surface that cannot be taken back, and the only one behind a
        confirmation.

        **Inside the branch that has something to remove**, not beside it: on a twenty-Question
        paper where the child asked about two, a dialog mounted per row would be eighteen
        dialogs — each with its own `useId` — that can never open, because there is nothing for
        them to be about.

        The ordinary `AppDialog` plus a `DestructiveButton`, exactly as the drafts screen's
        release and discard are — and never a blocking native `confirm`, which cannot carry
        six sentences, cannot be read by a screen reader as a described dialog and cannot be
        styled to say which press is the destructive one.

        It names every consequence **before** the press, because there is no afterwards to
        read them in: that it stops being served to this student only, that it is not a
        deletion, that it stays readable here and to the people reviewing reports, that the
        question, the attempt, its score and progress are unchanged, and that it cannot be
        undone. Cancel sends nothing and leaves the explanation exactly as it was.
      */}
          <AppDialog
            open={confirming}
            title={parentCopy.attempts.suppressTitle}
            describedBy={confirmBodyId}
            onClose={() => setConfirming(false)}
            actions={
              <>
                <Button
                  type="button"
                  disabled={suppressing}
                  data-testid="explanation-suppress-cancel"
                  onClick={() => setConfirming(false)}
                >
                  {parentCopy.drafts.cancel}
                </Button>
                <DestructiveButton
                  disabled={suppressing}
                  data-testid="explanation-suppress-confirm"
                  onClick={confirmSuppression}
                >
                  {parentCopy.attempts.suppressConfirm}
                </DestructiveButton>
              </>
            }
          >
            <Typography component="p" id={confirmBodyId} data-testid="explanation-suppress-body">
              {parentCopy.attempts.suppressBody}
            </Typography>
          </AppDialog>

          {explanations.map((entry) => {
            const isLatest = entry.generation === latest?.generation;
            const removedAt =
              entry.suppressedAt === null ? null : readableInstant(entry.suppressedAt);
            /**
             * This generation's own student report. Each generation carries its own — a child
             * can report an explanation and then report its replacement — so it is derived per
             * entry and never from the latest.
             */
            const entryStudentState = studentFlagStateFor(entry);
            /**
             * Whether the decision controls belong on this generation.
             *
             * `decidableOf`'s row and not the latest, so the control a parent presses and the
             * flag the API writes are the same row.
             */
            const entryDecidable =
              entryStudentState === 'awaiting' && entry.generation === decidable?.generation;
            const entryFlaggedAt =
              entry.studentFlaggedAt === null ? null : readableInstant(entry.studentFlaggedAt);
            return (
              <Box
                key={entry.generation}
                sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
                data-testid="explanation-generation"
                data-generation={entry.generation}
                data-removed={entry.suppressedAt === null ? 'no' : 'yes'}
                data-student-state={entryStudentState}
              >
                {labelled && (
                  /* Which explanation of this Question this is. Focusable only
                     programmatically: it is where focus lands when the replacement control
                     the parent pressed unmounts, and not a stop on the way through the paper
                     otherwise. */
                  <Typography
                    component="p"
                    tabIndex={-1}
                    ref={isLatest ? latestLabel : undefined}
                    sx={{ ...typeRoles.label }}
                    data-testid="explanation-generation-label"
                  >
                    {parentCopy.attempts.generationLabel(entry.generation)}
                  </Typography>
                )}

                {/* The stored prose, drawn by the one renderer of stored segments (AD-32):
                    a fraction arrives as structure and keeps its spoken reading. A removed
                    explanation keeps its prose — it is retained, and the parent who decided
                    about it stays able to read what they decided about. */}
                <Typography
                  component="p"
                  sx={{ ...typeRoles.explanationBody }}
                  data-testid="explanation-body"
                >
                  <RichText segments={entry.body} />
                </Typography>

                {entry.suppressedAt !== null && (
                  /* That it was removed, and when. The state, not the act — and there is no
                     control beside it, because this cannot be undone.

                     Product voice in the dashboard face, with no error colour and no glyph:
                     the parent decided this, and a screen that framed their own decision as a
                     fault would be arguing with them.

                     Focusable only programmatically: this is where focus lands when the
                     control that was under the parent's finger unmounts. */
                  <Typography
                    component="p"
                    tabIndex={-1}
                    ref={isLatest ? removedSentence : undefined}
                    sx={{ ...typeRoles.caption }}
                    data-testid="explanation-removed"
                  >
                    {removedAt === null
                      ? parentCopy.attempts.suppressedUndated
                      : parentCopy.attempts.suppressed(removedAt)}
                  </Typography>
                )}

                {/* The **child's** report on *this* generation, beside the parent's own and never
                    folded into it. Rendered only where there is one: an Explanation nobody
                    reported has nothing here to say, and a sentence stating so on every row of a
                    twenty-Question paper would be nineteen statements that nothing happened.

                    **Per generation, and outside the latest-only branch.** A child can report an
                    explanation and then report its replacement, so a Question can hold two
                    reports — and the API decides the *oldest undecided* one. A block that read
                    only the latest would leave an older undecided report undecidable from this
                    screen at all, and a press beside the latest would silently decide the older
                    one. */}
                {entryStudentState !== 'none' && (
                  <Box
                    sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
                    data-testid="explanation-student-flag"
                  >
                    <Typography
                      component="p"
                      sx={{ ...typeRoles.caption }}
                      data-testid="explanation-student-flagged"
                    >
                      {entryFlaggedAt === null
                        ? parentCopy.attempts.studentFlaggedUndated
                        : parentCopy.attempts.studentFlagged(entryFlaggedAt)}
                    </Typography>

                    {entryDecidable ? (
                      <>
                        {/* What has to be decided, and what each decision does — both said
                            before either control is pressed. Agreeing sends the report on and
                            **does not remove the explanation**, which is the assumption a parent
                            would otherwise make, and the one that would have them take something
                            away from their child by accident.

                            Rendered on `decidableOf`'s generation only, which is the row the API
                            will actually decide. */}
                        <Typography
                          component="p"
                          sx={{ ...typeRoles.caption }}
                          data-testid="explanation-awaiting"
                        >
                          {parentCopy.attempts.studentFlagAwaiting}
                        </Typography>
                        <Typography
                          component="p"
                          sx={{ ...typeRoles.caption }}
                          data-testid="explanation-disposition-note"
                        >
                          {parentCopy.attempts.dispositionNote}
                        </Typography>
                        <Box
                          sx={{
                            display: 'flex',
                            gap: `${comfortableDensity.gap / 2}px`,
                            flexWrap: 'wrap',
                          }}
                        >
                          <Button
                            variant="outlined"
                            onClick={() => decide('Confirmed', entry.generation)}
                            disabled={deciding}
                            sx={{ minHeight: comfortableDensity.tapTarget }}
                            data-testid="explanation-confirm"
                          >
                            {parentCopy.attempts.confirm}
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => decide('Dismissed', entry.generation)}
                            disabled={deciding}
                            sx={{ minHeight: comfortableDensity.tapTarget }}
                            data-testid="explanation-dismiss"
                          >
                            {parentCopy.attempts.dismiss}
                          </Button>
                        </Box>
                      </>
                    ) : entryStudentState === 'confirmed' || entryStudentState === 'dismissed' ? (
                      /* Which decision was recorded and when. **No control once decided**: the
                         first decision stands, so a control here would be an offer to do
                         something the API refuses.

                         Focusable only programmatically, and only on the generation this
                         component's own press decided: this is where focus lands when the two
                         controls under the parent's finger unmount, and it is not a stop on the
                         way through the paper otherwise. */
                      <Typography
                        component="p"
                        tabIndex={-1}
                        ref={entry.generation === decided.current ? decidedSentence : undefined}
                        sx={{ ...typeRoles.caption }}
                        data-testid="explanation-decided"
                      >
                        {decisionSentence(entryStudentState, entry.studentFlagDispositionAt)}
                      </Typography>
                    ) : /* A report that is awaiting a decision but is **not** the one the API would
                         decide, which means an *earlier* generation's report is still undecided.
                         The line above already says the child reported this one, and that is the
                         whole of what is true: there is no decision to state and no control to
                         offer, because the controls are on the row the API will act on. A sentence
                         here would either be empty or would invite a press the screen has
                         deliberately put somewhere else. */
                    null}

                    {decisionFailed !== null && (
                      /* No `role="status"`: the sentence is already in the screen's live
                         region. The controls above are still there to press again — and the
                         API's own 409 sentence is what appears here when the decision was
                         refused because one is already recorded. */
                      <Alert
                        severity="error"
                        variant="outlined"
                        data-testid="explanation-dispose-failed"
                      >
                        {decisionFailed}
                      </Alert>
                    )}
                  </Box>
                )}

                {/* **The parent's own flag, the removal and the replacement are on the latest
                    generation only.** An older one is history: the child is not being served it,
                    so there is no concern to record about it and nothing to remove or replace.
                    The child's report above is the exception, because each generation carries
                    its own. */}
                {isLatest && (
                  <>
                    {/* What reporting does, said before it is pressed and kept beside the
                        reported state afterwards. A control whose consequence a parent
                        cannot see teaches them it did something it did not. */}
                    <Typography
                      component="p"
                      sx={{ ...typeRoles.caption }}
                      data-testid="explanation-note"
                    >
                      {parentCopy.attempts.flagNote}
                    </Typography>

                    {state === 'flagged' ? (
                      /* The state, not the act. The control is gone rather than disabled:
                         there is no un-flagging, so an inert control would be an offer of
                         something that does nothing.

                         Focusable only programmatically: this is where focus lands when the
                         control that was under the parent's finger unmounts, and it is not a
                         stop on the way through the paper otherwise. */
                      <Typography
                        component="p"
                        tabIndex={-1}
                        ref={flaggedSentence}
                        sx={{ ...typeRoles.caption }}
                        data-testid="explanation-flagged"
                      >
                        {flaggedAt === null
                          ? parentCopy.attempts.flaggedUndated
                          : parentCopy.attempts.flagged(flaggedAt)}
                      </Typography>
                    ) : (
                      <Button
                        variant="outlined"
                        onClick={flag}
                        disabled={flagging}
                        sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
                        data-testid="explanation-flag"
                      >
                        {parentCopy.attempts.flagControl}
                      </Button>
                    )}

                    {failed !== null && (
                      /* No `role="status"` on this one: the sentence is already in the
                         screen's live region, and a second implicit region would speak it
                         twice. The control above is still there to press again. */
                      <Alert
                        severity="error"
                        variant="outlined"
                        data-testid="explanation-flag-failed"
                      >
                        {failed}
                      </Alert>
                    )}

                    {/* **Nothing at all where the removal is not available**, rather than a
                        disabled control: a greyed one invites a parent to wonder what they
                        did wrong, and there is nothing they did. A concern has to be recorded
                        first — theirs, or their child's that they agreed with — and until one
                        is, this is simply not part of the screen. */}
                    {suppressionState === 'available' && (
                      <Button
                        variant="outlined"
                        onClick={() => setConfirming(true)}
                        disabled={suppressing}
                        sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
                        data-testid="explanation-suppress"
                      >
                        {parentCopy.attempts.suppressControl}
                      </Button>
                    )}

                    {/* The replacement, offered **only** once one has been removed: the child
                        is still being served a live explanation, so there would be nothing to
                        replace, and the API refuses it with its own sentence.

                        The note states the cost *before* the press, and the cost is
                        nothing — at every plan. A parent who has just taken something away
                        from their child should not have to weigh whether replacing it will
                        cost them. */}
                    {suppressionState === 'suppressed' && (
                      <>
                        <Typography
                          component="p"
                          sx={{ ...typeRoles.caption }}
                          data-testid="explanation-regenerate-note"
                        >
                          {parentCopy.attempts.regenerateNote}
                        </Typography>
                        <Button
                          variant="outlined"
                          onClick={regenerate}
                          disabled={regenerating}
                          // Disabled *and* busy: `disabled` stops a second press, and
                          // `aria-busy` is what says the control is working rather than simply
                          // unavailable — a wait of tens of seconds is otherwise a control that
                          // went inert for no stated reason.
                          aria-busy={regenerating}
                          sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
                          data-testid="explanation-regenerate"
                        >
                          {parentCopy.attempts.regenerateControl}
                        </Button>
                        {regenerating && (
                          /* The sentence the press announced, displayed beside the control it
                             was pressed on. No `role="status"` on it: it is already in the
                             screen's live region, and a second implicit region would speak it
                             twice. */
                          <Typography
                            component="p"
                            sx={{ ...typeRoles.caption }}
                            data-testid="explanation-regenerating"
                          >
                            {parentCopy.attempts.regenerating}
                          </Typography>
                        )}
                      </>
                    )}

                    {suppressFailed !== null && (
                      <Alert
                        severity="error"
                        variant="outlined"
                        data-testid="explanation-suppress-failed"
                      >
                        {suppressFailed}
                      </Alert>
                    )}

                    {regenerateFailed !== null && (
                      <Alert
                        severity="error"
                        variant="outlined"
                        data-testid="explanation-regenerate-failed"
                      >
                        {regenerateFailed}
                      </Alert>
                    )}
                  </>
                )}
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}

/**
 * Which decision was recorded and when, or the empty string where none was.
 *
 * The dated and undated sentences are both `parentCopy`'s and the only decision here is
 * which of the four applies; the parse goes through `readableInstant` so no parent screen
 * renders the words "Invalid Date" at a parent. A decided flag whose instant will not
 * parse still says which decision was made — that is the fact, and only the date is
 * unstateable.
 *
 * The empty string is unreachable from the one place this is rendered, which is inside the
 * decided branch. It is returned rather than thrown or asserted away so a future change to
 * that branch cannot make a non-null assertion quietly wrong.
 */
function decisionSentence(state: StudentFlagState, instant: string | null | undefined): string {
  if (state !== 'confirmed' && state !== 'dismissed') return '';
  const when = instant === null || instant === undefined ? null : readableInstant(instant);
  if (state === 'confirmed') {
    return when === null
      ? parentCopy.attempts.confirmedUndated
      : parentCopy.attempts.confirmed(when);
  }
  return when === null ? parentCopy.attempts.dismissedUndated : parentCopy.attempts.dismissed(when);
}
