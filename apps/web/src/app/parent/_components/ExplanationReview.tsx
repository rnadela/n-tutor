'use client';

import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { RichText } from '@/components/RichText';
import { parentCopy } from '@/copy/parent';
import { reviewStateFor } from '@/lib/explanation-review';
import { ParentApiError, parentApi, type ParentExplanationView } from '@/lib/parent-api';
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
 * **One `parentApi.` call, and it is the flag.** The prose arrives with the Attempt,
 * in the screen's own read, so this component fetches nothing; the only request it
 * ever makes is the one a parent's press authorises.
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
  /** Hands the screen the new state, so the Attempt's own copy of it stays true. */
  onFlagged: (view: ParentExplanationView) => void;
  /** The one failure that is not about this Explanation: Parent View has closed. */
  onElevationLost: () => void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const state = reviewStateFor(explanation);
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

  return (
    <Box
      sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
      data-testid="explanation-review"
      data-state={state}
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
        </>
      )}
    </Box>
  );
}
