import type { RichTextSegment } from './parent-api';

/**
 * What one explain panel is showing, as a closed set.
 *
 * Seven states and no eighth, and no pair of booleans that could be true at once:
 * "loading and failed" and "at the cap with prose on screen" are both states a
 * `pending`/`error`/`body` triple admits and neither is a thing a child could make
 * sense of. A union makes the panel's render a `switch` the compiler checks.
 *
 * `atCap` carries the API's own refusal sentence rather than a flag, because that
 * sentence is written once — in the API's policy file — and a second spelling in
 * the browser would be two answers to one refusal. `null` is a 409 that arrived
 * without one.
 *
 * `suppressed` is the seventh, added in Story 6.4: a grown-up removed this explanation.
 * It carries **nothing** — no body, no instant, no reason and no sentence of the API's —
 * because the whole of what the child is told is `studentCopy`'s own two lines, and a
 * field for anything else would be somewhere for a parent's words to arrive. It is not an
 * error state and it is not a refusal: nothing failed.
 */
export type ExplainState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'loaded';
      body: RichTextSegment[];
      studentFlaggedAt: string | null;
      /**
       * Whether this is a replacement for one a grown-up removed.
       *
       * On the `loaded` state because it is a fact about prose that is on screen. A boolean
       * and not an ordinal: "which of four" is a fact about a history the child has no
       * business reading.
       */
      replacement: boolean;
    }
  | { kind: 'failed' }
  | { kind: 'offline' }
  | { kind: 'suppressed' }
  | { kind: 'atCap'; limitSentence: string | null };

/**
 * Whether this child has reported the explanation they are reading.
 *
 * On the `loaded` state and nowhere else, because reporting is only possible when there
 * is prose to report: a panel with nothing in it has nothing to be wrong. An instant
 * rather than a boolean, and the *first* one -- the API keeps it, so a second press
 * cannot move it -- and `null` for one nobody has reported.
 *
 * **It is the child's own report and never anybody else's.** The API's response has
 * nowhere for a parent's flag or a decision about this one to travel, so there is
 * nothing here to hold one either (AD-20, AD-26). Whether a grown-up later agreed or
 * disagreed is not a thing this panel can learn.
 *
 * It is carried on the state rather than fetched, because it arrives on the same
 * response the prose does: the panel unmounts on collapse, so reopening it re-issues
 * the explanation request, which answers 200 from the stored row with this beside it.
 */
export function flaggedAtOf(state: ExplainState): string | null {
  return state.kind === 'loaded' ? state.studentFlaggedAt : null;
}

/**
 * What a press should do, given the connection and what the panel already holds.
 *
 * - `stored` — there is prose already; show it and ask for nothing. This is the
 *   guarantee that expanding a panel a second time is free, held in the browser as
 *   well as on the server: the API would answer 200 from its row, but the request
 *   that got there would still be a round trip nobody needs.
 * - `busy` — a request is already out. A second press must not start a second one:
 *   two concurrent generations for one Question race the unique index, and the
 *   loser is a refusal a child did nothing to earn.
 * - `offline` — no connection, so nothing is sent at all. Distinct from a failure,
 *   because "you are not connected" is a thing a child can act on.
 * - `removed` — a grown-up settled this Question, so nothing is sent. Distinct from
 *   every other arm because it is not a state a press could improve: there is no retry
 *   that would help and no connection that would change it, and a request that left the
 *   device would be the child asking again for something already decided about.
 * - `request` — ask. Which is the case for a first press, and for a person pressing
 *   again after a failure or a refusal.
 */
export type ExplainDecision = 'stored' | 'removed' | 'busy' | 'offline' | 'request';

/**
 * The whole of what a press decides, as a pure function.
 *
 * It lives here rather than inside the component because `apps/web` runs its unit
 * tests with `environment: 'node'` and no DOM: a rule that only exists inside an
 * event handler is a rule nothing can assert. The component's job is to hold the
 * state and draw it; **what a press means** is this.
 *
 * The order of the arms is the rule. Stored prose wins over everything, including
 * being offline — an Explanation already on the page does not stop being readable
 * when the connection drops. **`removed` comes immediately after it and ahead of every
 * other rule**: a press must never leave the device for a Question a grown-up has
 * settled, whatever the connection is doing and whatever else is in flight. `busy` comes
 * next, so a double press is swallowed before the connection is even consulted. Only then
 * does a press become a request that could leave the device.
 */
export function explainDecision(input: { online: boolean; state: ExplainState }): ExplainDecision {
  if (input.state.kind === 'loaded') return 'stored';
  if (input.state.kind === 'suppressed') return 'removed';
  if (input.state.kind === 'loading') return 'busy';
  if (!input.online) return 'offline';
  return 'request';
}

/**
 * What a press of the **report** control should do, given the panel and the connection.
 *
 * - `noProse` -- there is nothing on screen to report. A press cannot happen here,
 *   because the control is only rendered inside the `loaded` branch; it is a value
 *   rather than an impossibility so the rule is stated once instead of resting on where
 *   a control happens to be drawn today.
 * - `already` -- this child has already reported it. There is **no un-reporting**, so a
 *   second press must send nothing: a record of a concern is not a toggle, and the API
 *   would answer the first instant anyway, which makes the round trip one nobody needs.
 * - `busy` -- a report is already out. A second press must not start a second one, or
 *   two responses land in either order and the child is told twice that something
 *   happened once.
 * - `offline` -- no connection, so nothing is sent at all. Distinct from a failure,
 *   because "you are not connected" is a thing a child can act on.
 * - `request` -- send it. A first press, or a person pressing again after a failure.
 *
 * The order of the arms is the rule. No prose wins over everything; an existing report
 * wins over being busy, because it means nothing needs sending whatever else is in
 * flight; `busy` is swallowed before the connection is consulted; and only then does a
 * press become something that leaves the device.
 *
 * It is a pure function here rather than a branch inside an event handler for the reason
 * `explainDecision` is: `apps/web` runs its unit tests with `environment: 'node'` and no
 * DOM, and a rule that only exists inside a handler is a rule nothing can assert.
 */
export function flagDecision(input: {
  online: boolean;
  state: ExplainState;
  /** Whether a report this panel sent is still out. */
  sending: boolean;
}): FlagPressDecision {
  if (input.state.kind !== 'loaded') return 'noProse';
  if (input.state.studentFlaggedAt !== null) return 'already';
  if (input.sending) return 'busy';
  if (!input.online) return 'offline';
  return 'request';
}

/** What a press of the report control means. Five outcomes and no sixth. */
export type FlagPressDecision = 'noProse' | 'already' | 'busy' | 'offline' | 'request';
