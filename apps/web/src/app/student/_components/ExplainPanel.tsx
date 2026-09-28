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
  suppressed,
}: {
  attemptId: string;
  questionId: string;
  /** The number the child was shown while they worked. Announced, never derived. */
  ordinal: number;
  /**
   * Whether a grown-up has removed this Question's explanation.
   *
   * Handed down from the screen's one attempt-scoped read rather than learned here, because
   * this component is mounted per row: a read of its own would be one request per Question
   * on load, and learning it at press time would leave the control on screen for a child to
   * press — one tap from undoing a parent's decision, and on a Free account one allowance
   * unit spent doing it.
   *
   * `false` while that read is still in flight or after it failed, which is deliberate: the
   * control is drawn, a press answers 200 suppressed, and nothing is generated and nothing
   * is charged. That is exactly why the API's check is at serve time and not a cache key.
   */
  suppressed: boolean;
}) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [open, setOpen] = useState(false);
  /**
   * What the panel is showing.
   *
   * It starts at the removed state where the screen already knows one applies, so a child
   * never sees an `Explain this` control for a Question a grown-up has settled — and the
   * press that would have asked cannot happen, because there is nothing to press.
   */
  const [state, setState] = useState<ExplainState>(
    suppressed ? { kind: 'suppressed' } : { kind: 'idle' },
  );
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
   * Adopts the prop **whenever it turns true**, and not only at mount.
   *
   * The initializer above is not enough, and the gap it leaves is the whole guarantee. The
   * results screen makes two independent reads: rows mount as soon as the answer key lands,
   * so a panel routinely mounts *before* the suppression read resolves — and with the prop
   * read only once, that panel would keep `idle` and draw `Explain this` for a Question the
   * parent removed. Which control a child sees would be decided by which request won.
   *
   * **It only ever moves one way.** There is no arm here that un-suppresses: suppression is
   * not reversible, and a prop that went false — which it does on the retry path, where the
   * screen resets the set to empty before re-reading — must never put the control back. The
   * functional updater keeps the held object where it is already suppressed, so nothing
   * re-renders and the announcement below is not fired twice for one fact.
   *
   * It replaces whatever is on screen, prose included: a parent deciding while the child had
   * the paper open is exactly the case suppression exists for, and the API would answer the
   * suppressed arm to any press from here anyway.
   */
  useEffect(() => {
    if (!suppressed) return;
    setState((held) => (held.kind === 'suppressed' ? held : { kind: 'suppressed' }));
  }, [suppressed]);

  /**
   * The prop's current value, read by the two requests below at the moment their response
   * arrives rather than at the moment they were sent.
   *
   * `ask` and `report` close over `suppressed` from whichever render fired them, which can
   * be stale by the time a response lands: a parent can suppress the explanation *after* the
   * request went out and *before* it comes back, and the effect above only fires on a change
   * a still-in-flight closure never sees. A response that read `suppressed: false` before the
   * fact was true would otherwise overwrite the state the effect above just set, and nothing
   * afterwards would put it back — the prop is not read again until it next changes. This ref
   * lets both `.then` handlers check the live fact instead of the one their own request saw.
   */
  const suppressedRef = useRef(suppressed);
  useEffect(() => {
    suppressedRef.current = suppressed;
  }, [suppressed]);

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
    // `removed` is here beside `stored` and `busy`, and the rule that produces it is in
    // `explainDecision` ahead of every other arm: a press must never leave the device for a
    // Question a grown-up has settled.
    if (decision === 'stored' || decision === 'removed' || decision === 'busy') return;
    if (decision === 'offline') {
      setState({ kind: 'offline' });
      return;
    }
    setState({ kind: 'loading' });
    parentApi.explainQuestion(attemptId, questionId).then(
      // The report's own state arrives on this response, which is what makes it survive
      // a reload and a re-open of the panel with no second request.
      (value) => {
        // A grown-up removed it between the screen's read and this press — a stale tab, or a
        // parent deciding while the child had the paper open. The prose and the report
        // control are replaced by the same two lines the withheld-control case draws, and
        // nothing was generated and nothing charged to find that out.
        //
        // The flag is set before the state that unmounts the control this press came from, so
        // the focus effect can tell this transition from a panel that mounted already removed.
        //
        // The live ref is read ahead of `value.suppressed`: a parent can settle it *after* this
        // request went out but before it came back, and a response that asked its question
        // before that must still lose to the fact that is true now.
        if (value.suppressed || suppressedRef.current) settled.current = true;
        setState(
          value.suppressed || suppressedRef.current
            ? { kind: 'suppressed' }
            : {
                kind: 'loaded',
                body: value.body,
                studentFlaggedAt: value.studentFlaggedAt,
                replacement: value.replacement,
              },
        );
      },
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
        // A grown-up removed it between the prose arriving and this press. Nothing was
        // recorded, so nothing is announced as recorded: the panel simply becomes the removed
        // state, which is the true thing to show.
        //
        // The live ref is read ahead of `value.suppressed` for the same reason `ask`'s handler
        // reads it: suppression can land after this request went out and before it came back.
        if (value.suppressed || suppressedRef.current) {
          setReported(null);
          // Set before the state that unmounts the report control this press came from.
          settled.current = true;
          setState({ kind: 'suppressed' });
          return;
        }
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
          replacement: value.replacement,
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
   *
   * **The removed state is announced when a press produced it, and not on arrival**, which
   * is the same `open` gate every other state passes and the same behaviour `announcement`
   * has: a press opens the panel, so a child who just asked is told. A paper opening with
   * five removed explanations would otherwise fire five announcements at somebody who has
   * touched nothing — and the sentence is displayed on every one of those rows regardless,
   * which is what it is for.
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

  /**
   * The same arrangement for a press that turns out to have been settled already.
   *
   * A press on `Explain this`, or on the report control, can come back saying a grown-up
   * removed this explanation — and both of those controls unmount when it does. A browser
   * puts focus on `document.body` when the focused element disappears, which drops a
   * keyboard user out of the paper entirely, mid-list. So focus moves deliberately to the
   * sentence that replaced the control, which is also the outcome they need to read.
   *
   * Guarded on *this panel's own press*, exactly as the report's focus move is and for the
   * same reason: a panel that mounted already removed, or one the late-arriving read above
   * adopted, must not take the keyboard from a child who has touched nothing.
   */
  const removedLine = useRef<HTMLParagraphElement | null>(null);
  const settled = useRef(false);
  useEffect(() => {
    if (state.kind !== 'suppressed' || !settled.current) return;
    settled.current = false;
    removedLine.current?.focus();
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
      {state.kind === 'suppressed' ? (
        /* **In place of the control, not beside it and not disabled.** There is no expand,
           no retry and no report control either: a child cannot undo this, and an inert
           control or a retry that could never help would be an offer of something that does
           nothing. The two lines are the whole of what is shown.

           `severity="info"` at most, and never `error` or `warning`: nothing failed, and a
           glyph that said otherwise would make a grown-up's decision read as a fault. The
           statement itself is product voice in the dashboard face — `typeRoles.caption`,
           never `typeRoles.explanationBody`, because it is the product speaking and not
           generated prose.

           Nothing else on the row or the screen changes: the question, both answers, the
           grade state, the score, Retake and every other explanation are where they were. */
        <Box
          sx={{ display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
          data-testid="explain-suppressed"
          data-state={state.kind}
        >
          {/* Displayed as well as announced, from the one string both come from, exactly as
              `announcement` is — so what is spoken and what is shown cannot come apart. */}
          {/* Focusable only programmatically: this is where focus lands when the control
              that was under the child's finger unmounts, and it is not a stop on the way
              through the paper otherwise. */}
          <Typography
            component="p"
            tabIndex={-1}
            ref={removedLine}
            sx={{ ...typeRoles.caption }}
            data-testid="explain-suppressed-announcement"
          >
            {studentCopy.results.explain.suppressedAnnouncement(ordinal)}
          </Typography>
          <Typography
            component="p"
            sx={{ ...typeRoles.caption }}
            data-testid="explain-suppressed-note"
          >
            {studentCopy.results.explain.suppressed}
          </Typography>
        </Box>
      ) : (
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
      )}

      {/* Rendered only while open, rather than hidden with CSS: a collapsed panel
          left in the tree is prose a screen reader can still reach and a child
          cannot see. */}
      {open && state.kind !== 'suppressed' && (
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
              {/* Only above a replacement, so a child re-reading a question they asked about
                  twice is not left wondering why the words changed. It says nothing about who
                  asked for it, why, or what it replaced: that history is a grown-up's. */}
              {state.replacement && (
                <Typography
                  component="p"
                  sx={{ ...typeRoles.caption }}
                  data-testid="explain-replacement"
                >
                  {studentCopy.results.explain.replacementNote}
                </Typography>
              )}
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
  // Announced once, in the sentence the panel also displays. It is a fact and not a
  // failure, which is why it is here beside `loaded` rather than with the three below.
  if (state.kind === 'suppressed') {
    return studentCopy.results.explain.suppressedAnnouncement(ordinal);
  }
  if (state.kind === 'failed' || state.kind === 'offline' || state.kind === 'atCap') {
    return noteOf(state);
  }
  return null;
}
