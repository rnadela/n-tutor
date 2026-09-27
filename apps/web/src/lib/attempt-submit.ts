/**
 * When handing in is dispatched, and when it is refused — as a rule, not as a
 * `catch`.
 *
 * Handing in is the one act on Take Test that needs the network. Everything about
 * *when* it leaves is decided here, and nothing about *how it is judged* is: the
 * server compares its own clock to its own column at submit, so this module's
 * worst possible mistake is a dispatch at the wrong moment, never an Attempt
 * graded wrongly.
 *
 * "Never silently retried" is the claim these two pieces exist to make structural.
 * A decision function says what to do, and a **latch that empties when it is read**
 * says it at most once — so two `online` events, a reload between them, or a
 * re-render all produce one dispatch. A flag somebody remembers to unset in a
 * `catch` would be the same promise with nothing enforcing it.
 */

import { readAttemptState, writeAttemptState, type AttemptStorage } from './attempt-store';

/** What a press of Hand in, or an `online` transition, should actually do. */
export type SubmitAction =
  /** Dispatch now. */
  | 'send'
  /**
   * Say plainly that it needs a connection, and wait for the child to press again.
   * The Attempt stays open and every answer stays in the store.
   */
  | 'refuse-offline'
  /**
   * The deadline has passed with no connection. Say so, and dispatch **once** when
   * the connection returns — not on a timer, not in a loop.
   */
  | 'wait-for-online'
  /** Already handed in. Say so, and send nothing whatever the network says. */
  | 'already-submitted';

export interface SubmitConditions {
  /** Whether this browser believes it has a connection. */
  online: boolean;
  /**
   * The instant the deadline passed, or `null` while it has not.
   *
   * An instant rather than a boolean so the latch has something to record. It is
   * the browser's reading of the server's deadline, and it decides only *when* to
   * dispatch — the server re-decides expiry from its own column on arrival.
   */
  expiredAt: number | null;
  /** Whether this Attempt has already been handed in successfully. */
  submitted: boolean;
}

/**
 * What to do, given the network, the deadline and whether the work is already in.
 *
 * Order matters and is the whole of the rule. `submitted` first, because an
 * Attempt that is in is in and nothing about the network changes that — a second
 * dispatch would answer 409 and tell a child their handed-in work failed. Then the
 * network, because being online means there is nothing to wait for. Offline splits
 * on the deadline: a child who still has time keeps it, and one whose time has run
 * out has nothing left to do but reconnect.
 */
export function submitDecision({ online, expiredAt, submitted }: SubmitConditions): SubmitAction {
  if (submitted) return 'already-submitted';
  if (online) return 'send';
  return expiredAt === null ? 'refuse-offline' : 'wait-for-online';
}

/**
 * Records that the deadline passed with no connection.
 *
 * Persisted in the Attempt's own record, so it survives the reload that a child
 * closing a lid and opening it somewhere else produces. Arming twice is arming
 * once: the instant is overwritten, not queued.
 */
export function armPending(
  storage: AttemptStorage | null,
  profileId: string,
  attemptId: string,
  at: number,
): void {
  const existing = readAttemptState(storage, profileId, attemptId);
  writeAttemptState(storage, profileId, attemptId, {
    answers: existing?.answers ?? {},
    index: existing?.index ?? 0,
    pendingSubmitAt: at,
  });
}

/**
 * Takes the latch: answers the armed instant **and empties it in the same act**.
 *
 * A take, not a read. This is what makes "exactly one auto-submit on reconnect" a
 * property of the code: the second caller — a duplicate `online` event, a
 * re-render, a reload that raced the first — gets `null` and dispatches nothing.
 *
 * A dispatch that then fails leaves the Attempt open and says so. It does **not**
 * re-arm: the next attempt is a person's press or the next `online` transition,
 * never this module's own doing.
 */
export function takePending(
  storage: AttemptStorage | null,
  profileId: string,
  attemptId: string,
): number | null {
  const existing = readAttemptState(storage, profileId, attemptId);
  if (existing === null || existing.pendingSubmitAt === null) return null;
  writeAttemptState(storage, profileId, attemptId, {
    answers: existing.answers,
    index: existing.index,
    pendingSubmitAt: null,
  });
  return existing.pendingSubmitAt;
}
