'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { flipOf, overrideScope, retainedOverrideOf } from '@/lib/grade-dispute';
import {
  CONFLICT_STATUS,
  ParentApiError,
  parentApi,
  type GradeState,
  type ParentAnswerKeyRowView,
  type ParentAttemptResultsView,
  type UncommittedStateView,
} from '@/lib/parent-api';
import { readableInstant } from '@/lib/parent-view';
import { comfortableDensity, typeRoles } from '@/theme/tokens';

/**
 * One Question's mark, as the parent decides about it: what the marking recorded, why, what
 * their child said about it, and the one remedy there is.
 *
 * **The decision sits beside the evidence it is made on.** The requirement's whole
 * mitigation is a parent reading *why* a question was marked as it was and disagreeing with
 * it, so the reason and the control are one region under one Question — not a screen of
 * their own, and not a dialog that would cover the answer key the decision depends on.
 *
 * **The reason is collapsed by default.** It is a paragraph per question, and twenty open at
 * once is a screen a parent cannot scan; one label serves both directions because
 * `aria-expanded` is what says which way the press goes.
 *
 * **The recorded mark is never described as gone.** It is on the response after an
 * adjustment and it is on screen after one: a parent who thought adjusting destroyed the
 * reason would stop being able to check their own decision.
 *
 * **There is exactly one remedy and no dismiss.** Nothing here settles a dispute the other
 * way, because nothing authorizes a second outcome — a parent who reads one and agrees with
 * the marking leaves it awaiting, which is what a record of an unanswered concern should look
 * like. So there is no second control and no sentence implying one exists.
 *
 * **A picked mark is not a saved one.** The control picks and an explicit save commits,
 * with the pick held in the `GradeOverride` slot scoped to this Attempt — so a parent who
 * read the reason, decided, and was sent back through the PIN finds their decision still
 * picked. The reason itself is **re-read from the run** and never retained: it is the
 * server's prose, and a copy in a slot would be a second one to keep in step.
 *
 * All the state is here. `AnswerKeyRow` stays hookless and the screen keeps owning its two
 * reads, because neither of them gains a notion of adjusting: the row takes a `ReactNode` in
 * its `grade` slot.
 */
export function GradeReview({
  attemptId,
  row,
  studentProfileId,
  retainedSlots,
  token,
  announce,
  onAdjusted,
  onElevationLost,
}: {
  attemptId: string;
  /** The parent's own row: the effective mark, the recorded one, the reason and the dispute. */
  row: ParentAnswerKeyRowView;
  /**
   * Whose run this is, for the retained slot's key.
   *
   * The slot is keyed to a Student Profile server-side, so a pick saved under one child
   * cannot be restored into another. It comes from the screen rather than from this row,
   * because a row is not where a child's id belongs.
   */
  studentProfileId: string;
  /**
   * Every slot of retained parent work this account holds, read **once by the screen**.
   *
   * A prop and not a read of this component's own, because this region is mounted per
   * Question: a fifteen-Question run would otherwise fire fifteen identical account-scoped
   * reads on mount, all answering the same list, to pick one row out of it. The screen
   * makes that read once per Attempt and every row filters the same array — the *scope*
   * stays per-Question, which is what keeps one Question's pick off the other fourteen.
   *
   * Empty while the screen's read is in flight and empty if it failed, deliberately: an
   * empty list means "nothing picked", which is the ordinary case and the safe one. Losing
   * a pick is a smaller harm than a review screen that will not render.
   */
  retainedSlots: readonly UncommittedStateView[];
  /** The elevation bearer. Held by the screen, never by this component. */
  token: string;
  /** The screen's live region. The sentence announced is the sentence shown. */
  announce: (text: string) => void;
  /**
   * The whole run, recalculated.
   *
   * The API answers the view rather than a row, because the mark and the score commit
   * together: a row-shaped answer would leave this browser to work out the new fraction,
   * which is a second denominator (FR-37).
   */
  onAdjusted: (view: ParentAttemptResultsView) => void;
  /** The one failure that is not about this mark: Parent View has closed. */
  onElevationLost: () => void;
}) {
  /** Whether the reason is showing. Collapsed on mount, every time. */
  const [reasonOpen, setReasonOpen] = useState(false);
  /** The mark this parent has picked and not yet saved, or null for nothing picked. */
  const [picked, setPicked] = useState<GradeState | null>(null);
  /** Whether the pick was restored from the retained slot rather than pressed just now. */
  const [restored, setRestored] = useState(false);
  /** Whether a save this component sent is still out. A double press is one call. */
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** The retained slot's id, once one exists, so the pick can be discarded on commit. */
  const slotId = useRef<string | null>(null);
  /**
   * Invalidates a `pick`'s in-flight save once a later pick, unpick or save has run.
   *
   * `saveUncommittedState` is not awaited by the caller, so a press quickly followed by
   * another press or an unpick can have its response land after the state it was for is
   * gone. Without a guard the late response would still set `slotId.current`, leaving a
   * slot on the server that names a mark this parent already put back or replaced — and
   * that abandoned slot is exactly what a later restore (FR-35) would offer back as if it
   * were still picked.
   */
  const pickSeq = useRef(0);
  const reasonId = useId();

  /**
   * The mark a parent would be offered instead of the one that counts.
   *
   * `null` on a question that was never judged — unanswered, or not graded yet — which is
   * exactly the set the API refuses with its own 409. **One predicate**, read by the control
   * a parent is offered and by the refusal they would get, so a control is never drawn for a
   * press that cannot succeed.
   */
  const flip = flipOf(row.state);

  /**
   * Restores a pick this parent made before Parent View closed.
   *
   * **No request of its own**: the screen read every slot once for the whole run, and this
   * walks that array for the one filed under this Question's scope. Run once per (Attempt,
   * Question) and never again for it, so a pick a parent has since put back is not
   * re-restored under them by a re-render.
   *
   * The reason is deliberately not restored from anywhere: it arrived on the run's own read,
   * because it is the server's prose and a copy in a slot would be a second one to keep in
   * step.
   */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    // Nothing to walk yet. The screen's read may still be in flight, and an empty list is
    // also what a failed one leaves behind — neither is "this parent picked nothing", so
    // neither is latched as an answer.
    if (retainedSlots.length === 0) return;
    const key = `${attemptId}:${row.questionId}`;
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    // Scoped to this Attempt *and* this Question, by the one function that spells that
    // scope: one run holds many rows, so a scope of the Attempt alone would restore one
    // Question's pick onto every row of the paper.
    const scope = overrideScope(attemptId, row.questionId);
    for (const slot of retainedSlots) {
      // The whole of what a retained slot may become, decided by a pure function so the
      // four `null` cases — wrong kind, wrong scope, an unusable payload, and a pick for
      // the mark that already counts — are assertable without a DOM.
      const state = retainedOverrideOf(slot, scope, row.state);
      // The id is kept even for a slot that yields no pick, so a stale one is still the
      // slot a later save discards rather than a row left behind in the store.
      if (slot.kind === 'GradeOverride' && slot.scope === scope) slotId.current = slot.id;
      if (state === null) continue;
      setPicked(state);
      setRestored(true);
      return;
    }
  }, [attemptId, retainedSlots, row.questionId, row.state]);

  /**
   * Focus follows the sentence that replaces the control.
   *
   * The control unmounts once the mark is set, and focus left on a removed button falls to
   * the document — which would throw a parent working by keyboard to the top of a long paper
   * by their own press.
   */
  const adjustedSentence = useRef<HTMLParagraphElement | null>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (!row.parentAdjusted || !pressed.current) return;
    pressed.current = false;
    adjustedSentence.current?.focus();
  }, [row.parentAdjusted, row.state]);

  /** Holds the pick server-side, so an idle expiry does not eat the decision. */
  function pick(state: GradeState) {
    setPicked(state);
    setRestored(false);
    setFailed(null);
    const seq = ++pickSeq.current;
    parentApi
      .saveUncommittedState(token, {
        studentProfileId,
        kind: 'GradeOverride',
        scope: overrideScope(attemptId, row.questionId),
        payload: { state },
      })
      .then(
        (slot) => {
          // A later pick, unpick or save has already run: this pick is no longer the
          // one on screen, so the slot it just created is discarded rather than kept.
          if (pickSeq.current !== seq) {
            parentApi.discardUncommittedState(token, slot.id).catch(() => {});
            return;
          }
          slotId.current = slot.id;
        },
        () => {
          /* Nothing to tell the parent: the pick is still on screen and still savable. */
        },
      );
  }

  /**
   * Puts the pick back, and drops the slot holding it.
   *
   * **A pick has to be reversible, because it is a step and not a decision.** Without this
   * a mis-press is escapable only by saving the wrong mark: the control it replaced is
   * gone, and nothing else on the row clears `picked`. It also matters for the *retained*
   * pick — a parent who comes back through the PIN, reads the reason again and changes
   * their mind needs a way to leave the mark alone that is not "save the other one".
   *
   * The slot goes with it, fire-and-forget: a discard that failed leaves a slot naming a
   * mark this parent has abandoned, which the next restore would offer back. Nothing is
   * told to the parent either way, because the screen already shows the pick undone.
   */
  function unpick() {
    setPicked(null);
    setRestored(false);
    setFailed(null);
    pickSeq.current++; // any pick still in flight is now stale
    const id = slotId.current;
    if (id === null) return;
    slotId.current = null;
    parentApi.discardUncommittedState(token, id).catch(() => {});
  }

  function save() {
    if (saving || picked === null) return;
    pickSeq.current++; // any pick still in flight is now stale
    setSaving(true);
    setFailed(null);
    parentApi.overrideGrade(token, attemptId, row.questionId, picked).then(
      (view) => {
        setSaving(false);
        setPicked(null);
        setRestored(false);
        pressed.current = true;
        onAdjusted(view);
        announce(
          parentCopy.attempts.override.announcement(
            row.ordinal,
            parentCopy.attempts.override.grade[picked],
          ),
        );
        // The pick is committed, so the slot is the one thing left holding a decision that
        // has already been made. Fire-and-forget: a failed discard is a stale slot the next
        // restore refuses anyway, because the mark it names is by then the one that counts.
        const id = slotId.current;
        if (id !== null) {
          slotId.current = null;
          parentApi.discardUncommittedState(token, id).catch(() => {});
        }
      },
      (cause: unknown) => {
        setSaving(false);
        if (cause instanceof ParentApiError && (cause.notElevated || cause.status === 401)) {
          onElevationLost();
          return;
        }
        // The API's own sentence when it authored one — the two 409s are written once,
        // server-side, and rendered rather than restated — and this screen's own otherwise.
        const sentence =
          cause instanceof ParentApiError && cause.reason !== null
            ? cause.reason
            : parentCopy.attempts.override.failed;
        setFailed(sentence);
        announce(sentence);
        // **A 409 is a refusal this pick can never recover from, so the pick goes.** Both
        // of them are rules about the row rather than about the moment: the mark asked for
        // is already the one that counts, or the question was never judged. Leaving the
        // pick set would leave a Save control that fails identically however many times it
        // is pressed — which is exactly what a stale tab does after somebody else set the
        // same mark. Dropping it puts the ordinary control back, and the row beneath it now
        // states what the mark actually is.
        if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS) unpick();
      },
    );
  }

  const adjustedAt = row.overriddenAt === null ? null : readableInstant(row.overriddenAt);
  const disputedAt = row.disputedAt === null ? null : readableInstant(row.disputedAt);

  return (
    <Box
      sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
      data-testid="grade-review"
      data-adjusted={row.parentAdjusted ? 'true' : 'false'}
      data-disputed={row.disputed ? 'true' : 'false'}
    >
      <Typography component="h5" sx={{ ...typeRoles.label }} data-testid="grade-review-heading">
        {parentCopy.attempts.override.heading}
      </Typography>

      {/* What the marking recorded — still stated after an adjustment, because it is still
          stored and it is the evidence the adjustment was made against. */}
      <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="grade-review-recorded">
        {parentCopy.attempts.override.recorded(parentCopy.attempts.override.grade[row.aiState])}
      </Typography>

      {/* The reason, behind a disclosure. `aria-expanded` says which way the press goes, so
          one label serves both directions. */}
      <Button
        type="button"
        variant="text"
        onClick={() => setReasonOpen((open) => !open)}
        aria-expanded={reasonOpen}
        aria-controls={reasonId}
        data-testid="grade-review-reason-control"
      >
        {parentCopy.attempts.override.reasonControl}
      </Button>
      {reasonOpen && (
        <Box id={reasonId} sx={{ display: 'grid', gap: `${comfortableDensity.gap / 4}px` }}>
          <Typography component="p" sx={{ ...typeRoles.caption }}>
            {parentCopy.attempts.override.reasonHeading}
          </Typography>
          {/* A question marked by comparison, or one that is not a judgement at all, never
              had a reason — stated as that fact rather than as a failure, so a parent does
              not go looking for prose that was never written. */}
          <Typography
            component="p"
            sx={{ ...typeRoles.questionBody }}
            data-testid="grade-review-reason"
          >
            {row.rationale ?? parentCopy.attempts.override.noReason}
          </Typography>
        </Box>
      )}

      {/* What the student said, and what there is to do about it. `disputeAwaiting` says the
          one thing a parent would otherwise assume: leaving the mark alone is a legitimate
          answer. */}
      {row.disputed && (
        <>
          <Typography
            component="p"
            sx={{ ...typeRoles.caption }}
            data-testid="grade-review-disputed"
          >
            {disputedAt === null
              ? parentCopy.attempts.override.disputedUndated
              : parentCopy.attempts.override.disputed(disputedAt)}
          </Typography>
          {/* **Gated on the control actually being offered, not on the adjustment alone.**
              A child may object to any mark, including one nothing judged — there is no
              student-side rule about which, deliberately. On such a row `flipOf` answers
              null and no control is drawn, so telling the parent they can change it would
              be an instruction with nothing to press. They are told the reason instead,
              below. */}
          {!row.parentAdjusted && flip !== null && (
            <Typography
              component="p"
              sx={{ ...typeRoles.caption }}
              data-testid="grade-review-dispute-awaiting"
            >
              {parentCopy.attempts.override.disputeAwaiting}
            </Typography>
          )}
        </>
      )}

      {row.parentAdjusted && (
        // The state, named rather than the act. `tabIndex={-1}` so the press's own focus
        // move lands somewhere without adding a stop for anyone tabbing past.
        <Typography
          component="p"
          ref={adjustedSentence}
          tabIndex={-1}
          sx={{ ...typeRoles.caption }}
          data-testid="grade-review-adjusted"
        >
          {adjustedAt === null
            ? parentCopy.attempts.override.adjustedUndated
            : parentCopy.attempts.override.adjusted(adjustedAt)}
        </Typography>
      )}

      {/* Offered only where a mark could actually be set: `flipOf` answers null for a
          question that was never judged, which is the same set the API refuses. A parent who
          has already set a mark may still set it back, which is why this is not gated on
          `parentAdjusted`. */}
      {flip !== null && (
        <>
          {picked === null ? (
            <Button
              type="button"
              variant="outlined"
              onClick={() => pick(flip)}
              data-testid="grade-review-control"
            >
              {parentCopy.attempts.override.control(parentCopy.attempts.override.grade[flip])}
            </Button>
          ) : (
            <>
              {/* A picked-but-unsaved mark that came back through the PIN, named as what it
                  is — so a parent is not left wondering why a control is already chosen. */}
              {restored && (
                <Alert severity="info" variant="outlined" data-testid="grade-review-restored">
                  {parentCopy.attempts.override.restored}
                </Alert>
              )}
              <Button
                type="button"
                variant="contained"
                onClick={save}
                disabled={saving}
                data-testid="grade-review-save"
              >
                {saving ? parentCopy.attempts.override.saving : parentCopy.attempts.override.save}
              </Button>
              {/* The way back out, beside the way forward. A pick is a step and not a
                  decision, so a mis-press must not be escapable only by saving the wrong
                  mark. Disabled while a save is out, so it cannot race the request it would
                  be undoing. */}
              <Button
                type="button"
                variant="text"
                onClick={unpick}
                disabled={saving}
                data-testid="grade-review-cancel"
              >
                {parentCopy.attempts.override.cancel}
              </Button>
            </>
          )}
          {/* Every consequence, before it fires: the recorded mark and its reason are kept,
              the score is recalculated, and the student sees the new mark and one line — never
              the reason. */}
          <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="grade-review-note">
            {parentCopy.attempts.override.note}
          </Typography>
        </>
      )}

      {/* A question the marking never judged: there is no mark to disagree with, so there
          is no control — and the reason is stated rather than left as an absence. A region
          that simply showed nothing would leave a parent looking for a control, most of all
          on a row their child objected to. */}
      {flip === null && (
        <Typography
          component="p"
          sx={{ ...typeRoles.caption }}
          data-testid="grade-review-not-judged"
        >
          {parentCopy.attempts.override.notJudged}
        </Typography>
      )}

      {/* **Rendered, not announced again.** The same sentence already went to the screen's
          one live region through `announce`, so a `role="alert"` here would reach assistive
          technology twice for one failure — once as the region's change and once as this
          node's. The region is the announcer on this surface; this is the copy of it a
          sighted reader keeps. */}
      {failed !== null && (
        <Alert severity="error" variant="outlined" data-testid="grade-review-failed">
          {failed}
        </Alert>
      )}
    </Box>
  );
}
