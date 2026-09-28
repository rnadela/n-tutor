'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAnnounce } from '@/components/LiveRegion';
import { studentCopy } from '@/copy/student';
import { disputeDecision } from '@/lib/grade-dispute';
import { ParentApiError, parentApi, type AttemptResultsView } from '@/lib/parent-api';
import { comfortableDensity, typeRoles } from '@/theme/tokens';
import { deviceIsUnbound } from '../page';

/**
 * One Question's "I think this is marked wrong", inline beneath its own row.
 *
 * **A sibling of `ExplainPanel`, not a part of it.** The two are different things a child
 * may do about one Question — ask why, and say the mark looks wrong — and folding them into
 * one component would mean a failed explanation and a failed objection sharing a state
 * machine. Each owns its own press, its own request and its own outcomes, which is what
 * keeps a failure in either from taking the answer key down.
 *
 * **Nothing here happens without a press**, and a press changes no mark: the API records the
 * objection and nothing else, because only a grown-up can set a mark. So the control is not
 * a toggle, there is nothing to undo, and the row's grade stays exactly where it was — which
 * the note beside the control says *before* it is pressed, so a child who watches the mark
 * stay put does not read the press as having failed.
 *
 * **All the state is here.** `AnswerKeyRow` stays hookless and
 * `renderToStaticMarkup`-testable, and `AttemptResults` keeps its "two reads and no third"
 * invariant, because neither of them gains a notion of disputing: the row takes a
 * `ReactNode` in its `grade` slot and the results screen passes this in.
 *
 * **The reported state comes off the results read, not a request of its own.** `disputed`
 * is a field on the row, so the state survives a reload with no second call — and a press
 * that succeeds hands the whole refreshed view back up to the screen rather than patching
 * anything here. There is no instant beside it, and deliberately: `AnswerKeyRowView` carries
 * no `disputedAt`, because a date is a fact about a record the child has no use for.
 *
 * **Nothing here is about a mechanism.** No rationale, no "override", no mention of how the
 * marking works and no comparison between what anything decided (AD-20, AD-26) — the
 * `AttemptResultsView` this reads has no field any of that could travel in, and
 * `studentCopy.results.dispute` has no sentence for it.
 */
export function DisputePanel({
  attemptId,
  questionId,
  ordinal,
  disputed,
  onDisputed,
}: {
  attemptId: string;
  questionId: string;
  /** The number the child was shown while they worked. Announced, never derived. */
  ordinal: number;
  /**
   * Whether this row already carries the child's objection, off the one results read.
   *
   * A boolean and not an instant, because the instant is not on the student view: the child
   * is told that they said it, and a date a screen could not source would be one it invented.
   */
  disputed: boolean;
  /**
   * The refreshed results, handed straight up.
   *
   * The API answers the whole view, so the screen re-renders from one response: this
   * component holds no copy of the row and cannot disagree with the screen about what the
   * mark now is.
   */
  onDisputed: (view: AttemptResultsView) => void;
}) {
  const router = useRouter();
  const { announce } = useAnnounce();
  /** Whether an objection this panel sent is still out. A double press is one call. */
  const [sending, setSending] = useState(false);
  /**
   * The one sentence a press that did not land shows.
   *
   * Two failures, told apart: a request that never left the device because there is no
   * connection, and one that left and did not land. "You are not connected" is a thing a
   * child can act on, and collapsing it into "it did not work" would send them pressing at
   * a wall.
   */
  const [failure, setFailure] = useState<'failed' | 'offline' | null>(null);

  /**
   * Focus follows the sentence that replaces the control.
   *
   * The control unmounts when the objection is recorded, and focus left on a removed button
   * falls to the document — so a child working by keyboard would be thrown to the top of a
   * long paper by their own press. The sentence takes it instead, which is also what a
   * screen reader then reads.
   */
  const reportedSentence = useRef<HTMLParagraphElement | null>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (!disputed || !pressed.current) return;
    pressed.current = false;
    reportedSentence.current?.focus();
  }, [disputed]);

  function send() {
    // The whole of what a press means, decided by a pure function so the rule is
    // assertable without a DOM. `already` in particular: there is no un-saying, so a
    // second press must not leave the device.
    const decision = disputeDecision({ online: navigator.onLine, disputed, sending });
    if (decision === 'already' || decision === 'busy') return;
    if (decision === 'offline') {
      setFailure('offline');
      announce(studentCopy.results.dispute.offline);
      return;
    }

    setSending(true);
    setFailure(null);
    parentApi.disputeGrade(attemptId, questionId).then(
      (view) => {
        setSending(false);
        pressed.current = true;
        onDisputed(view);
        // Announced with the very sentence the screen displays, so the words heard and the
        // words shown cannot come apart.
        announce(studentCopy.results.dispute.announcement(ordinal));
      },
      (cause: unknown) => {
        setSending(false);
        // The guard's own refusal is the one failure that is not about this Question: the
        // device is no longer bound to a child, and every read on this surface answers it
        // the same way.
        if (cause instanceof ParentApiError && deviceIsUnbound(cause)) {
          router.replace('/student');
          return;
        }
        setFailure('failed');
        announce(studentCopy.results.dispute.failed);
      },
    );
  }

  return (
    <Box
      sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
      data-testid="dispute-panel"
      data-disputed={disputed ? 'true' : 'false'}
    >
      {disputed ? (
        // The state, named rather than the act that produced it — and no control beside
        // it, because there is nothing left to press. `tabIndex={-1}` so the press's own
        // focus move lands somewhere, without adding a stop for anyone tabbing past.
        <Typography
          component="p"
          ref={reportedSentence}
          tabIndex={-1}
          sx={{ ...typeRoles.caption }}
          data-testid="dispute-reported"
        >
          {studentCopy.results.dispute.reported}
        </Typography>
      ) : (
        <>
          <Button
            type="button"
            variant="text"
            onClick={send}
            disabled={sending}
            data-testid="dispute-control"
          >
            {studentCopy.results.dispute.control}
          </Button>
          {/* What the press does, said *before* it is pressed: a grown-up will look, and
              nothing here changes until they do. A child who pressed and watched the mark
              stay put would otherwise think it had not worked. */}
          <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="dispute-note">
            {studentCopy.results.dispute.note}
          </Typography>
        </>
      )}
      {failure !== null && (
        // One sentence, no error code, and it says what did not happen rather than what
        // went wrong. The control is still there to press, and nothing presses it on its own.
        //
        // **Rendered, not announced again.** The same sentence already went to the
        // surface's one live region through `announce`, so a `role="status"` here would
        // reach assistive technology twice for one failure — once as the region's change
        // and once as this node's. The region is the announcer on this surface; this is the
        // copy of it a sighted reader keeps.
        <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="dispute-failure">
          {failure === 'offline'
            ? studentCopy.results.dispute.offline
            : studentCopy.results.dispute.failed}
        </Typography>
      )}
    </Box>
  );
}
