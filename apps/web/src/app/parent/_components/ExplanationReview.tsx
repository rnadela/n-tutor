'use client';

import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { RichText } from '@/components/RichText';
import { parentCopy } from '@/copy/parent';
import {
  reviewStateFor,
  studentFlagStateFor,
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
 * What the child was told about one Question, and the one thing a parent can do
 * about it.
 *
 * **Inline, beneath its own answer-key row** (UX-DR16), handed to the shared row
 * through its `explain` slot — the same adjacency the child's own panel keeps. Never
 * a modal, which would cover the Question and both answers this prose is about, and
 * never a route, which would take the paper away entirely.
 *
 * **It never generates.** There is no press that asks for an Explanation here, no
 * call to `explainQuestion`, and nothing that runs on mount: a parent reading an
 * Attempt with ten unexplained Questions would otherwise bill ten provider calls
 * against their own Explanation Allowance for prose nobody asked for — and the child
 * would then find it already there, having never asked. A Question the child did not
 * ask about says so, and that is the whole of that branch.
 *
 * **Three `parentApi.` calls, and a press is behind every one.** The prose arrives with
 * the Attempt, in the screen's own read, so this component fetches nothing on mount; the
 * only requests it ever makes are the parent's own flag, their decision about their
 * child's report, and the re-read that reconciles this region when that decision comes
 * back refused because one is already recorded.
 *
 * **It draws two independent flag facts side by side.** The parent's own concern and their
 * child's are two people raising one, and each is its own pure decision
 * (`reviewStateFor`, `studentFlagStateFor`) — a region that folded them into one state
 * would tell a parent their child said something they did not.
 *
 * **The flag control disappears once flagged.** There is no un-flagging — a record of
 * a concern is not a toggle — so leaving a pressed control on screen would be
 * offering an action that does nothing, and a parent pressing it again would learn
 * nothing from it. What replaces it is the state and the instant.
 *
 * **What flagging does is stated in words, before and after.** Suppression is the act
 * that changes what a child is served and it is not this one, so the note says the
 * student still sees the same explanation. A confirmation dialog here would teach a
 * parent that this does something it does not.
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
  explanation,
  token,
  announce,
  onFlagged,
  onElevationLost,
}: {
  attemptId: string;
  questionId: string;
  /** The number the child was shown while they worked. Announced, never derived. */
  ordinal: number;
  /** This Question's stored Explanation, or undefined for one nobody asked about. */
  explanation: ParentExplanationView | undefined;
  /** The elevation bearer. Held by the screen, never by this component. */
  token: string;
  /** The screen's live region. The sentence announced is the sentence shown. */
  announce: (text: string) => void;
  /**
   * Hands the screen the new state, so the Attempt's own copy of it stays true.
   *
   * Used by both writes: the API answers each with the **whole** view, so a decision
   * about the child's report and the parent's own flag replace the same entry and neither
   * can leave the screen holding half of the other's outcome.
   */
  onFlagged: (view: ParentExplanationView) => void;
  /** The one failure that is not about this Explanation: Parent View has closed. */
  onElevationLost: () => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Whether a decision this component sent is still out. A double-tap is one call. */
  const [deciding, setDeciding] = useState(false);
  /** The one sentence a failed decision shows, apart from the flag's own failure. */
  const [decisionFailed, setDecisionFailed] = useState<string | null>(null);
  const state = reviewStateFor(explanation);
  /**
   * What the **child's** report is: nothing, awaiting a decision, or decided.
   *
   * Its own pure decision beside `state`, never folded into it: the two flags are two
   * facts, and the region draws both.
   */
  const studentState = studentFlagStateFor(explanation);
  /**
   * The instant to state, or null for a stored one that will not parse.
   *
   * `reviewStateFor` decides `flagged` on the field being **present**, deliberately, and
   * that is not weakened here: a flag whose instant is unreadable is still a flag, and
   * only the date is unstateable. What would be unacceptable is rendering the words
   * "Invalid Date" beside "Reported".
   */
  const flaggedAt =
    explanation?.parentFlaggedAt === null || explanation?.parentFlaggedAt === undefined
      ? null
      : readableInstant(explanation.parentFlaggedAt);

  /**
   * That the child reported it, dated when the stored instant parses and undated when it
   * does not.
   *
   * `studentFlagStateFor` decides on the field being **present**, deliberately, and that
   * is not weakened here: a report whose instant is unreadable is still a report, and only
   * the date is unstateable. The words "Invalid Date" on a parent's screen read as a fault
   * in the report rather than in a string, and a screen reader says them.
   */
  const studentFlaggedAt =
    explanation?.studentFlaggedAt === null || explanation?.studentFlaggedAt === undefined
      ? null
      : readableInstant(explanation.studentFlaggedAt);
  const studentFlaggedSentence =
    studentFlaggedAt === null
      ? parentCopy.attempts.studentFlaggedUndated
      : parentCopy.attempts.studentFlagged(studentFlaggedAt);

  /** Which decision was recorded and when, in the same dated/undated pair. */
  const decidedSentenceText = decisionSentence(studentState, explanation?.studentFlagDispositionAt);

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
  const decided = useRef(false);
  useEffect(() => {
    if ((studentState !== 'confirmed' && studentState !== 'dismissed') || !decided.current) return;
    decided.current = false;
    decidedSentence.current?.focus();
  }, [studentState]);

  /**
   * One press, and the only request this component makes.
   *
   * Guarded on `flagging` so a double-tap issues one call rather than two whose
   * responses land in either order. A second *successful* press would be harmless —
   * the API is idempotent per (Explanation, origin) and answers the first instant —
   * but announcing twice would tell a parent something happened twice.
   */
  function flag() {
    if (flagging || explanation === undefined) return;
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
   * One press of Agree or Dismiss, and the second request this component makes.
   *
   * **The first decision is final, and this is the only place one is sent.** Guarded on
   * `deciding` so a double-tap issues one call rather than two whose responses land in
   * either order — and the API refuses a second, *different* decision with a 409 whose
   * sentence is rendered rather than restated here, because it is written once in the
   * API's policy file.
   *
   * **Confirming does not suppress**, and the note beside the controls says so before
   * either is pressed: the student is served exactly the same explanation afterwards, and
   * a screen that let a parent assume otherwise would have them take something away from
   * their child by accident.
   */
  function decide(disposition: FlagDisposition) {
    if (deciding || explanation === undefined) return;
    setDeciding(true);
    setDecisionFailed(null);
    parentApi.disposeExplanationFlag(token, attemptId, questionId, disposition).then(
      (view) => {
        setDeciding(false);
        // Set before the state that unmounts the controls, so the effect above can tell
        // this transition from a paper that arrived already decided.
        decided.current = true;
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
        // which one was actually recorded short of reloading the whole paper. So the
        // Attempt's Explanations are read again and this Question's entry handed back, and
        // the region redraws as decided beside the sentence that explains why.
        //
        // Only on the conflict: every other failure is transient and leaves the controls
        // exactly where they were, to be pressed again.
        if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS) {
          parentApi.attemptExplanations(token, attemptId).then(
            (views) => {
              const current = views.find((view) => view.questionId === questionId);
              // Nothing announced here and nothing said: the sentence above is already the
              // one on screen, and a second one for a read the parent did not ask for
              // would narrate the screen's own housekeeping at them. A Question whose
              // entry is somehow absent simply leaves the region as it was.
              if (current !== undefined) onFlagged(current);
            },
            // The reconcile is a courtesy on top of a refusal that has already been
            // stated. A failure here must not replace that sentence with a second one
            // about a request the parent never made.
            () => {},
          );
        }
      },
    );
  }

  return (
    <Box
      sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
      data-testid="explanation-review"
      data-state={state}
      data-student-state={studentState}
    >
      {state === 'absent' ? (
        /* A Question the child never asked about. A plain sentence, and no control:
           nothing here generates one, so there is nothing to offer.

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

          {/* The stored prose, drawn by the one renderer of stored segments (AD-32):
              a fraction arrives as structure and keeps its spoken reading. */}
          <Typography
            component="p"
            sx={{ ...typeRoles.explanationBody }}
            data-testid="explanation-body"
          >
            <RichText segments={explanation!.body} />
          </Typography>

          {/* What reporting does, said before it is pressed and kept beside the
              reported state afterwards. A control whose consequence a parent cannot
              see teaches them it did something it did not. */}
          <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="explanation-note">
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
            <Alert severity="error" variant="outlined" data-testid="explanation-flag-failed">
              {failed}
            </Alert>
          )}

          {/* The **child's** report, beside the parent's own and never folded into it.
              Rendered only where there is one: an Explanation nobody reported has nothing
              here to say, and a sentence stating so on every row of a twenty-Question
              paper would be nineteen statements that nothing happened. */}
          {studentState !== 'none' && (
            <Box
              sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
              data-testid="explanation-student-flag"
            >
              <Typography
                component="p"
                sx={{ ...typeRoles.caption }}
                data-testid="explanation-student-flagged"
              >
                {studentFlaggedSentence}
              </Typography>

              {studentState === 'awaiting' ? (
                <>
                  {/* What has to be decided, and what each decision does — both said
                      before either control is pressed. Confirming sends the report on and
                      **does not remove the explanation**, which is the assumption a
                      parent would otherwise make, and the one that would have them take
                      something away from their child by accident. */}
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
                      onClick={() => decide('Confirmed')}
                      disabled={deciding}
                      sx={{ minHeight: comfortableDensity.tapTarget }}
                      data-testid="explanation-confirm"
                    >
                      {parentCopy.attempts.confirm}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => decide('Dismissed')}
                      disabled={deciding}
                      sx={{ minHeight: comfortableDensity.tapTarget }}
                      data-testid="explanation-dismiss"
                    >
                      {parentCopy.attempts.dismiss}
                    </Button>
                  </Box>
                </>
              ) : (
                /* Which decision was recorded and when. **No control once decided**: the
                   first decision stands, so a control here would be an offer to do
                   something the API refuses.

                   Focusable only programmatically: this is where focus lands when the two
                   controls under the parent's finger unmount, and it is not a stop on the
                   way through the paper otherwise. */
                <Typography
                  component="p"
                  tabIndex={-1}
                  ref={decidedSentence}
                  sx={{ ...typeRoles.caption }}
                  data-testid="explanation-decided"
                >
                  {decidedSentenceText}
                </Typography>
              )}

              {decisionFailed !== null && (
                /* No `role="status"`: the sentence is already in the screen's live
                   region. The controls above are still there to press again — and the
                   API's own 409 sentence is what appears here when the decision was
                   refused because one is already recorded. */
                <Alert severity="error" variant="outlined" data-testid="explanation-dispose-failed">
                  {decisionFailed}
                </Alert>
              )}
            </Box>
          )}
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
