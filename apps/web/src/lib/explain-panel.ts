import type { RichTextSegment } from './parent-api';

/**
 * What one explain panel is showing, as a closed set.
 *
 * Six states and no seventh, and no pair of booleans that could be true at once:
 * "loading and failed" and "at the cap with prose on screen" are both states a
 * `pending`/`error`/`body` triple admits and neither is a thing a child could make
 * sense of. A union makes the panel's render a `switch` the compiler checks.
 *
 * `atCap` carries the API's own refusal sentence rather than a flag, because that
 * sentence is written once — in the API's policy file — and a second spelling in
 * the browser would be two answers to one refusal. `null` is a 409 that arrived
 * without one.
 */
export type ExplainState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; body: RichTextSegment[] }
  | { kind: 'failed' }
  | { kind: 'offline' }
  | { kind: 'atCap'; limitSentence: string | null };

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
 * - `request` — ask. Which is the case for a first press, and for a person pressing
 *   again after a failure or a refusal.
 */
export type ExplainDecision = 'stored' | 'busy' | 'offline' | 'request';

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
 * when the connection drops. `busy` comes next, so a double press is swallowed
 * before the connection is even consulted. Only then does a press become a request
 * that could leave the device.
 */
export function explainDecision(input: { online: boolean; state: ExplainState }): ExplainDecision {
  if (input.state.kind === 'loaded') return 'stored';
  if (input.state.kind === 'loading') return 'busy';
  if (!input.online) return 'offline';
  return 'request';
}
