/**
 * Parent View's idle clock (AD-13).
 *
 * Framework-free on purpose. `apps/web` runs its unit tests in
 * `environment: 'node'` with no jsdom, so logic living inside a component can
 * only be pinned by matching its source text — which passes on code that is
 * structurally right and behaviourally wrong. Everything here takes `now`, the
 * timer functions, the refresh call and the event target as dependencies, so
 * the whole of the behaviour is drivable by a fake clock in a plain spec.
 *
 * Nothing in this module names a duration. The idle window is
 * `expiresAt - issuedAt` — instants the server stated — so an env override on
 * the API moves this clock too, and no second definition of "15 minutes" can
 * drift into the browser.
 */

/**
 * What counts as the parent still being there: real input, and only real input.
 *
 * An API call — a refresh included — is not interaction and must never extend
 * anything, or a screen that polls on its own would keep Parent View alive over
 * an empty room.
 */
export const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * How far into the window the first replacement is requested, as a fraction of
 * the window rather than a duration of its own.
 */
export const REFRESH_AT_FRACTION = 0.5;

/** How often a refused-by-the-network attempt is tried again, same units. */
export const RETRY_AT_FRACTION = 0.1;

/** The instants the server stated about the token held right now. */
export interface TokenInstants {
  /** When this browser received the token; the window is measured from here. */
  issuedAt: number;
  expiresAt: number;
  ceilingAt: number;
}

export interface IdleState extends TokenInstants {
  /** The last real interaction. The idle deadline hangs off this, not off the token. */
  lastInteractionAt: number;
  /** The last refresh *attempt*, or `null` while none has been made against this token. */
  lastAttemptAt: number | null;
}

export type IdleDecision =
  | { action: 'expire' }
  | { action: 'refresh' }
  | { action: 'wait'; delayMs: number };

/**
 * What the clock should do at `now`, given what it holds.
 *
 * Pure, and deciding against an instant rather than against elapsed timer time:
 * a browser that throttled a background tab fires the timer late, and a late
 * tick must expire rather than quietly grant the extra minutes it slept.
 *
 *   window = expiresAt - issuedAt
 *   expire  when now >= expiresAt | ceilingAt | lastInteractionAt + window
 *   refresh when expiresAt < lastInteractionAt + window
 *           and now >= lastAttemptAt + window * (first attempt ? REFRESH_AT : RETRY_AT)
 *   wait    until the earliest of those instants
 *
 * The deadline hangs off the last interaction rather than off the token because
 * the rule is "idle for one window". Refreshing on a timer alone would give a
 * parent who touched the device once at minute 1 a fresh window at minute 7.5
 * and expire at 22.5 — which is not the rule.
 */
export function decide(state: IdleState, now: number): IdleDecision {
  const windowMs = state.expiresAt - state.issuedAt;
  const idleDeadline = state.lastInteractionAt + windowMs;

  if (now >= state.expiresAt || now >= state.ceilingAt || now >= idleDeadline) {
    return { action: 'expire' };
  }

  const endsAt = endsParentViewAt(state);

  // A replacement is only worth asking for while the token would die *before*
  // the parent's own deadline. Otherwise the window lapses first and a refresh
  // would buy nothing.
  if (state.expiresAt < idleDeadline) {
    const { lastAttemptAt } = state;
    const base = lastAttemptAt ?? state.issuedAt;
    const fraction = lastAttemptAt === null ? REFRESH_AT_FRACTION : RETRY_AT_FRACTION;
    const attemptAt = base + windowMs * fraction;
    if (now >= attemptAt) return { action: 'refresh' };
    return { action: 'wait', delayMs: Math.min(endsAt, attemptAt) - now };
  }

  return { action: 'wait', delayMs: endsAt - now };
}

/**
 * The earliest instant at which Parent View ends no matter what happens next:
 * the token's own expiry, the ceiling, or the parent's idle deadline.
 *
 * A refresh can move the first of those and nothing can move the other two, so
 * this is the instant a timer must always be armed for — a request that hangs
 * must not buy the parent time the server never granted.
 */
export function endsParentViewAt(state: IdleState): number {
  const windowMs = state.expiresAt - state.issuedAt;
  return Math.min(state.expiresAt, state.ceilingAt, state.lastInteractionAt + windowMs);
}

/** What a refresh attempt turned out to be. */
export type RefreshOutcome =
  | { outcome: 'replaced'; instants: TokenInstants }
  /** The elevation guard itself refused: a stale epoch, or past the ceiling. */
  | { outcome: 'expired' }
  /** A dropped connection, a 429, a 500 — a bad moment, not an idle parent. */
  | { outcome: 'failed' };

export interface InteractionTarget {
  addEventListener(
    type: string,
    listener: () => void,
    options?: { passive?: boolean; capture?: boolean },
  ): void;
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
}

export interface IdleClockDeps<Handle> {
  /** The instants of the token held right now, or `null` when none is held. */
  token: TokenInstants | null;
  target: InteractionTarget;
  now(): number;
  setTimeout(handler: () => void, delayMs: number): Handle;
  clearTimeout(handle: Handle): void;
  /**
   * Requests a replacement.
   *
   * Failures are normally *returned* as outcomes rather than thrown, so the
   * clock can tell the guard's refusal from a bad moment. A rejection is
   * tolerated all the same and is treated as `failed`: a caller that throws
   * must not leave the clock stuck with a request it thinks is still in flight.
   */
  refresh(): Promise<RefreshOutcome>;
  /** The idle window has lapsed, the ceiling was reached, or the guard refused. */
  onExpire(): void;
}

/**
 * Whether a token describes a window this module can measure at all.
 *
 * `issuedAt` is the *browser's* clock and `expiresAt` is the server's, so a
 * device running far enough ahead of the server hands us a window of zero or
 * less. Deciding on that would expire Parent View the instant the parent
 * crossed the PIN, silently and for good — so an unmeasurable window is treated
 * as no clock at all, and the server's own refusal is left to be the authority.
 */
function isMeasurable(token: TokenInstants | null): token is TokenInstants {
  if (token === null) return false;
  if (
    !Number.isFinite(token.issuedAt) ||
    !Number.isFinite(token.expiresAt) ||
    !Number.isFinite(token.ceilingAt)
  ) {
    return false;
  }
  return token.expiresAt > token.issuedAt;
}

/**
 * Starts the clock and returns the function that stops it.
 *
 * With no elevation held — or with one whose window cannot be measured — it
 * attaches no listener and schedules no timer: there is nothing here to expire.
 */
export function createIdleClock<Handle>(deps: IdleClockDeps<Handle>): () => void {
  if (!isMeasurable(deps.token)) return () => {};

  let state: IdleState = {
    ...deps.token,
    lastInteractionAt: deps.now(),
    lastAttemptAt: null,
  };
  let handle: Handle | null = null;
  let stopped = false;
  /**
   * A replacement has been asked for and has not answered yet.
   *
   * Without this the retry threshold would dispatch a second request while the
   * first was still outstanding, and the older response — resolving last —
   * would install its stale instants over the newer token's.
   */
  let inFlight = false;

  function clearPending(): void {
    if (handle === null) return;
    deps.clearTimeout(handle);
    handle = null;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearPending();
    for (const type of INTERACTION_EVENTS) {
      deps.target.removeEventListener(type, onInteraction, { capture: true });
    }
  }

  function expire(): void {
    stop();
    deps.onExpire();
  }

  function tick(): void {
    if (stopped) return;
    clearPending();

    const decision = decide(state, deps.now());
    if (decision.action === 'expire') {
      expire();
      return;
    }

    if (decision.action === 'refresh') {
      if (!inFlight) {
        // Stamped before the request leaves, so the throttle holds even while
        // it is in flight: a keystroke storm gets one attempt per threshold,
        // not one per event.
        state = { ...state, lastAttemptAt: deps.now() };
        inFlight = true;
        void deps.refresh().then(onOutcome, () => onOutcome({ outcome: 'failed' }));
      }
      // Either way the window still ends on time: a request that never answers
      // does not extend anything.
      schedule();
      return;
    }

    handle = deps.setTimeout(tick, Math.max(0, decision.delayMs));
  }

  /**
   * Re-arms the timer from the current state without acting on it again.
   *
   * A `refresh` decision reaching here means one is already outstanding, so the
   * timer falls back to the instant Parent View ends regardless — the deadline
   * is armed even while a request hangs.
   */
  function schedule(): void {
    if (stopped) return;
    const now = deps.now();
    const decision = decide(state, now);
    if (decision.action === 'expire') return;
    const delayMs = decision.action === 'wait' ? decision.delayMs : endsParentViewAt(state) - now;
    handle = deps.setTimeout(tick, Math.max(0, delayMs));
  }

  function onOutcome(outcome: RefreshOutcome): void {
    inFlight = false;
    if (stopped) return;
    if (outcome.outcome === 'expired') {
      // The guard's refusal is the authority, not this module's arithmetic.
      expire();
      return;
    }
    if (outcome.outcome === 'replaced' && isMeasurable(outcome.instants)) {
      // The replacement's own instants become the window. `lastInteractionAt`
      // deliberately survives: a refresh is not interaction, so it must not
      // move the deadline.
      state = {
        ...outcome.instants,
        lastInteractionAt: state.lastInteractionAt,
        lastAttemptAt: null,
      };
    }
    // An unmeasurable replacement (finite but non-positive window) is a bad
    // response, not an idle parent: the prior state is kept and the retry
    // threshold tries again, same as any other transient failure.
    tick();
  }

  function onInteraction(): void {
    if (stopped) return;
    state = { ...state, lastInteractionAt: deps.now() };
    tick();
  }

  for (const type of INTERACTION_EVENTS) {
    // Capturing, because `scroll` does not bubble: a parent scrolling a list
    // inside the page is a parent who is still there.
    deps.target.addEventListener(type, onInteraction, { passive: true, capture: true });
  }
  tick();

  return stop;
}
