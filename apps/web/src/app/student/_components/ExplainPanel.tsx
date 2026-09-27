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
import { explainDecision, type ExplainState } from '@/lib/explain-panel';
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
      (value) => setState({ kind: 'loaded', body: value.body }),
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
    announced.current = state;
    const sentence = spokenOf(state, ordinal);
    if (sentence === null) return;
    announce(sentence);
  }, [open, state, ordinal, announce]);

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
