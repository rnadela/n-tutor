'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAnnounce } from '@/components/LiveRegion';
import { RichText } from '@/components/RichText';
import { studentCopy } from '@/copy/student';
import { explainDecision, flagDecision, flaggedAtOf, type ExplainState } from '@/lib/explain-panel';
import { CONFLICT_STATUS, ParentApiError, parentApi } from '@/lib/parent-api';
import { comfortableDensity, typeRoles } from '@/theme/tokens';
import { deviceIsUnbound } from '../page';

/**
 * One Question's explanation, as an inline disclosure beneath its own row.
 *
 * **Inline, never a modal and never a route** (UX-DR16). What a child wants when
 * they ask why is the question, their answer, the right answer and the reason, all
 * on screen together — a dialog would cover the first three, and a route would take
 * the paper away entirely. So it opens in place, under the row it is about, and
 * everything above it stays exactly where it was.
 *
 * **Nothing here happens without a press.** No prefetch, no queue, no poll, no
 * timer and no automatic retry: the first press asks, and every later ask is a
 * person pressing again. That is not only a UX rule — the first ask bills a
 * provider call against the account's Explanation Allowance, and a component that
 * asked on mount would bill one per Question per visit.
 *
 * **All the state is here.** `AnswerKeyRow` stays hookless and
 * `renderToStaticMarkup`-testable, and `AttemptResults` keeps its "exactly one
 * `parentApi.` call" invariant, because neither of them gains a notion of
 * explaining: the row takes a `ReactNode` in a slot and the results screen passes
 * this in, exactly as the retake control is passed to `footer`.
 *
 * **A failure here cannot take the results screen down with it.** Every outcome is
 * a sentence inside this panel; the answer key, the score, every other row and
 * every other panel are untouched. The one exception is the guard's own refusal,
 * `deviceIsUnbound`, which is the same exception every other read on this surface
 * makes — the binding is gone, and that is not about this Question.
 *
 * **Every sentence it shows is a member of `studentCopy`**, and the one it
 * announces is the one it displays. There is no running count of what is left, no
 * tier, no price and no upsell: an allowance is a billing fact and a child is never
 * shown one (AD-26).
 */
export function ExplainPanel({
  attemptId,
  questionId,
  ordinal,
}: {
  attemptId: string;
  questionId: string;
  /** The number the child was shown while they worked. Announced, never derived. */
  ordinal: number;
}) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ExplainState>({ kind: 'idle' });
  /** Whether a report this panel sent is still out. Guards a double-tap into one call. */
  const [sending, setSending] = useState(false);
  /**
   * The outcome of this panel's own report press, or null for a panel nobody has pressed.
   *
   * Held apart from `ExplainState` deliberately: a report that could not be sent has not
   * changed the explanation on screen, so folding it into that union would make the union
   * able to say "this failed" about prose that is still perfectly readable — and the
   * prose is exactly what must stay put.
   *
   * It is the **sentence** plus what kind of outcome it is, rather than a flag, so the
   * one string is what the live region carries and what the panel shows (UX-DR33). Null
   * on a re-open of an already-reported explanation, which is why nothing is announced
   * then: the report was not made now.
   */
  const [reported, setReported] = useState<ReportOutcome | null>(null);
  const panelId = `explain-panel-${questionId}`;

  /**
   * One press, and the only place this component talks to the API.
   *
   * The decision is a pure function in `lib/explain-panel.ts` so that the rules
   * that cost money — never ask twice for prose already held, never start a second
   * request while one is out, never send anything with no connection — are
   * assertable without a DOM.
   *
   * `navigator.onLine` is read **at the press**, not held in state behind a
   * listener: what matters is whether there is a connection at the moment
   * something would be sent, and a latched flag is just a second thing that can be
   * wrong.
   */
  const ask = useCallback(() => {
    const decision = explainDecision({ online: navigator.onLine, state });
    if (decision === 'stored' || decision === 'busy') return;
    if (decision === 'offline') {
      setState({ kind: 'offline' });
      return;
    }
    setState({ kind: 'loading' });
    parentApi.explainQuestion(attemptId, questionId).then(
      // The report's own state arrives on this response, which is what makes it survive
      // a reload and a re-open of the panel with no second request.
      (value) =>
        setState({ kind: 'loaded', body: value.body, studentFlaggedAt: value.studentFlaggedAt }),
      (cause: unknown) => {
        // The one refusal that is about the binding rather than about this
        // Question.
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        // The cap is the one refusal the API authors a sentence for, and it is
        // rendered rather than restated.
        if (cause instanceof ParentApiError && cause.status === CONFLICT_STATUS) {
          setState({ kind: 'atCap', limitSentence: cause.reason });
          return;
        }
        setState({ kind: 'failed' });
      },
    );
  }, [attemptId, questionId, router, state]);

  /**
   * One press of the report control, and the second and last place this component talks
   * to the API.
   *
   * The decision is a pure function in `lib/explain-panel.ts` so that the rules which
   * decide whether anything leaves the device — never send a second report for a concern
   * already recorded, never start a second request while one is out, never send anything
   * with no connection — are assertable without a DOM.
   *
   * **Nothing about the explanation is touched on any outcome.** The prose stays
   * rendered, the panel stays open, and `state` is only ever replaced with the *same*
   * `loaded` state carrying the report's instant. A failure is a sentence beneath it and
   * nothing more: the paragraph may well be fine, and taking it off screen would be this
   * panel deciding something only a grown-up can.
   *
   * `navigator.onLine` is read **at the press**, not held in state behind a listener:
   * what matters is whether there is a connection at the moment something would be sent.
   */
  const report = useCallback(() => {
    const decision = flagDecision({ online: navigator.onLine, state, sending });
    if (decision === 'noProse' || decision === 'already' || decision === 'busy') return;
    if (decision === 'offline') {
      setReported({ kind: 'offline', sentence: studentCopy.results.explain.flagOffline });
      return;
    }
    setSending(true);
    setReported(null);
    parentApi.flagExplanationAsStudent(attemptId, questionId).then(
      (value) => {
        setSending(false);
        // Set before the state that unmounts the control, so the effect below can tell
        // this transition from a panel that opened already reported.
        pressed.current = true;
        setReported({
          kind: 'recorded',
          sentence: studentCopy.results.explain.flagAnnouncement(ordinal),
        });
        // The same prose and the report's instant. Replaced rather than merged, so the
        // one thing this call is allowed to change is the only thing that changes.
        setState({
          kind: 'loaded',
          body: value.body,
          studentFlaggedAt: value.studentFlaggedAt,
        });
      },
      (cause: unknown) => {
        setSending(false);
        // The one refusal that is about the binding rather than about this Question.
        if (deviceIsUnbound(cause)) {
          router.replace('/auth/sign-in');
          return;
        }
        setReported({ kind: 'failed', sentence: studentCopy.results.explain.flagFailed });
      },
    );
  }, [attemptId, ordinal, questionId, router, sending, state]);

  /**
   * Announced once per state, with the very sentence on screen beside it.
   *
   * Latched on the state object rather than on its kind: two failures in a row are
   * two different facts, and a kind-keyed guard would swallow the second. A closed
   * panel announces nothing — there is nothing on screen to be the same sentence
   * as.
   */
  const announced = useRef<ExplainState | null>(null);
  useEffect(() => {
    if (!open || announced.current === state) return;
    const previous = announced.current;
    announced.current = state;
    // A recorded report replaces the `loaded` state with the *same* prose and a new
    // instant, which is a change this announcement has nothing to say about: the
    // explanation did not arrive a second time. The report's own sentence is announced
    // by the effect below, from the one string the panel also displays.
    if (
      previous?.kind === 'loaded' &&
      state.kind === 'loaded' &&
      flaggedAtOf(previous) !== flaggedAtOf(state)
    ) {
      return;
    }
    const sentence = spokenOf(state, ordinal);
    if (sentence === null) return;
    announce(sentence);
  }, [open, state, ordinal, announce]);

  /**
   * The report's own outcome, announced once, in the sentence the panel displays.
   *
   * Latched on the outcome object rather than on its kind or its sentence, exactly as the
   * effect above is and for the same reason: two failures in a row are two different
   * facts, and a guard keyed on either would swallow the second.
   *
   * Only ever this panel's own press. `reported` is null on a fresh mount, and a
   * collapsed panel is unmounted — so re-opening an already-reported explanation shows
   * the reported state and announces nothing, which is right: nothing just happened.
   */
  /**
   * Where focus goes when the control the child just pressed stops existing.
   *
   * Reporting unmounts the control, and a browser puts focus on `document.body` when the
   * focused element disappears — which drops a keyboard user out of the paper entirely,
   * mid-list, with no way back but retracing it. So focus moves deliberately, to the
   * sentence that replaced the control, which is also the outcome they need to read. The
   * same arrangement the parent's own region makes, for the same reason.
   */
  const flagged = useRef<HTMLParagraphElement | null>(null);
  /**
   * Whether *this panel's own press* is what recorded it — never a panel that opened
   * already reported.
   *
   * A ref rather than state, because it is not rendered and must not cause a render: a
   * child re-opening a panel they reported last week would otherwise have the page take
   * the keyboard from them the moment the prose arrived.
   */
  const pressed = useRef(false);
  useEffect(() => {
    if (flaggedAtOf(state) === null || !pressed.current) return;
    pressed.current = false;
    flagged.current?.focus();
  }, [state]);

  const reportAnnounced = useRef<ReportOutcome | null>(null);
  useEffect(() => {
    if (!open || reported === null || reportAnnounced.current === reported) return;
    reportAnnounced.current = reported;
    announce(reported.sentence);
  }, [open, reported, announce]);

  return (
    <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}>
      {/* The control both opens the panel and makes the first ask, which is what
          makes "one deliberate press" literal: there is no second step between
          wanting the explanation and asking for it.

          One label for both directions, because `aria-expanded` is what says which
          way the press goes — a label that changed under the finger would be a
          second, contradictory account of it.

          `aria-controls` is set only while the panel is in the tree: a collapsed
          panel here is unmounted rather than hidden, and an `aria-controls`
          pointing at an id that does not exist yet is handled inconsistently. */}
      <Button
        variant="outlined"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) ask();
        }}
        sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
        data-testid="explain-control"
      >
        {studentCopy.results.explain.control}
      </Button>

      {/* Rendered only while open, rather than hidden with CSS: a collapsed panel
          left in the tree is prose a screen reader can still reach and a child
          cannot see. */}
      {open && (
        <Box
          id={panelId}
          sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
          data-testid="explain-panel"
          data-state={state.kind}
        >
          {/* `h5`, under the row's own `h4`. An explanation belongs to its Question,
              and a heading at `h4` would make it a sibling of the row it sits inside
              — an outline that lies is worse than no outline. */}
          <Typography component="h5" sx={{ ...typeRoles.label }} data-testid="explain-heading">
            {studentCopy.results.explain.heading}
          </Typography>

          {state.kind === 'idle' && (
            <Alert severity="info" role="status" variant="outlined" data-testid="explain-idle">
              {studentCopy.results.explain.idle}
            </Alert>
          )}

          {state.kind === 'loading' && (
            <Alert severity="info" role="status" variant="outlined" data-testid="explain-loading">
              {studentCopy.results.explain.loading}
            </Alert>
          )}

          {state.kind === 'loaded' && (
            <>
              {/* Displayed as well as announced, from the one string both come from,
                  so what is spoken and what is shown cannot come apart. */}
              <Typography component="p" sx={{ ...typeRoles.caption }} data-testid="explain-ready">
                {studentCopy.results.explain.announcement(ordinal)}
              </Typography>
              {/* The prose, drawn by the one renderer of stored segments (AD-32): a
                  fraction arrives as structure and keeps its spoken reading. */}
              <Typography
                component="p"
                sx={{ ...typeRoles.explanationBody }}
                data-testid="explain-body"
              >
                <RichText segments={state.body} />
              </Typography>

              {/* Beneath the prose, inside the `loaded` branch and nowhere else: there is
                  nothing to report about a panel with nothing in it, and the rule is
                  stated in `flagDecision` as well so it does not rest on this placement.

                  Nothing in this block can move, replace or hide the paragraph above it.
                  Every outcome is a sentence here; the explanation, the panel's open
                  state, the answer key, the score and every other row are untouched. */}
              <Typography
                component="p"
                sx={{ ...typeRoles.caption }}
                data-testid="explain-flag-note"
              >
                {studentCopy.results.explain.flagNote}
              </Typography>

              {state.studentFlaggedAt === null ? (
                <Button
                  variant="outlined"
                  onClick={report}
                  disabled={sending}
                  sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
                  data-testid="explain-flag"
                >
                  {studentCopy.results.explain.flagControl}
                </Button>
              ) : (
                /* The state, not the act. The control is gone rather than disabled:
                   there is no un-reporting, so an inert control would be an offer of
                   something that does nothing.

                   Focusable only programmatically: this is where focus lands when the
                   control that was under the child's finger unmounts, and it is not a
                   stop on the way through the paper otherwise. */
                <Typography
                  component="p"
                  tabIndex={-1}
                  ref={flagged}
                  sx={{ ...typeRoles.caption }}
                  data-testid="explain-flagged"
                >
                  {flaggedSentence(state.studentFlaggedAt)}
                </Typography>
              )}

              {reported !== null && reported.kind !== 'recorded' && (
                /* No `role="status"` on this one: the sentence is already in the
                   surface's live region, and a second implicit region would speak it
                   twice. The control above is still there to press again. */
                <Alert
                  severity={reported.kind === 'offline' ? 'info' : 'error'}
                  variant="outlined"
                  data-testid="explain-flag-failed"
                >
                  {reported.sentence}
                </Alert>
              )}
            </>
          )}

          {(state.kind === 'failed' || state.kind === 'offline' || state.kind === 'atCap') && (
            <>
              {/* No `role="status"` on this one, unlike the idle and loading
                  alerts: this sentence is the one the live region already carries,
                  and a second implicit region would speak it twice. One sentence,
                  one announcement. */}
              <Alert
                severity={state.kind === 'atCap' ? 'info' : 'error'}
                variant="outlined"
                data-testid="explain-note"
              >
                {noteOf(state)}
              </Alert>
              {/* A person asking again, and the only thing that ever asks again.
                  Offered at the cap too: the period may have turned over since, and
                  the server is the only thing that can say so. */}
              <Button
                variant="outlined"
                onClick={ask}
                sx={{ minHeight: comfortableDensity.tapTarget, justifySelf: 'start' }}
                data-testid="explain-retry"
              >
                {studentCopy.retry}
              </Button>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * One press of the report control's outcome: what happened, and the sentence for it.
 *
 * The sentence is on the value rather than derived from the kind at each site, so the
 * one string is both what the live region carries and what the panel shows — the two
 * cannot come apart (UX-DR33).
 */
interface ReportOutcome {
  kind: 'recorded' | 'failed' | 'offline';
  sentence: string;
}

/**
 * The reported state, dated when the instant parses and undated when it does not.
 *
 * Both sentences are `studentCopy`'s and the only decision here is which applies. A
 * report whose instant will not parse is still a report — only the date is unstateable —
 * and `new Date('').toLocaleString()` is the literal words "Invalid Date", which a screen
 * reader says out loud and which read as a fault in the report itself.
 */
function flaggedSentence(instant: string): string {
  const when = new Date(instant);
  if (Number.isNaN(when.getTime())) return studentCopy.results.explain.flaggedUndated;
  return studentCopy.results.explain.flagged(when.toLocaleString());
}

/** The sentence a refusing or failing state shows. */
function noteOf(state: Extract<ExplainState, { kind: 'failed' | 'offline' | 'atCap' }>): string {
  if (state.kind === 'offline') return studentCopy.results.explain.offline;
  if (state.kind === 'atCap') return studentCopy.results.explain.atCap(state.limitSentence);
  return studentCopy.results.explain.failed;
}

/**
 * What the live region carries, which is always a sentence that is also on screen.
 *
 * `null` for the two states nothing is announced from: `idle` is the panel simply
 * being open with nothing asked for yet, and `loading` is a press the child just
 * made — narrating either would be announcing their own action back at them.
 */
function spokenOf(state: ExplainState, ordinal: number): string | null {
  if (state.kind === 'loaded') return studentCopy.results.explain.announcement(ordinal);
  if (state.kind === 'failed' || state.kind === 'offline' || state.kind === 'atCap') {
    return noteOf(state);
  }
  return null;
}
