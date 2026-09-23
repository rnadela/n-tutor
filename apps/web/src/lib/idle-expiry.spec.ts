import { describe, expect, it, vi } from 'vitest';
import {
  INTERACTION_EVENTS,
  REFRESH_AT_FRACTION,
  RETRY_AT_FRACTION,
  createIdleClock,
  decide,
  type IdleState,
  type RefreshOutcome,
  type TokenInstants,
} from './idle-expiry';

/**
 * The window the server happens to state in these tests. Nothing in the module
 * knows it: every figure below is derived from the two instants, exactly as the
 * clock derives them.
 */
const WINDOW = 900_000;
const CEILING = 8 * 60 * 60 * 1000;

function instants(overrides: Partial<TokenInstants> = {}): TokenInstants {
  return { issuedAt: 0, expiresAt: WINDOW, ceilingAt: CEILING, ...overrides };
}

/**
 * A clock whose "now" is wall-clock time under the test's control, and whose
 * timers fire only when that time reaches them — the two being separable is the
 * whole point, because a throttled background tab separates them too.
 */
function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; handler: () => void }>();

  /** Lets any promise the handler started settle before the next step. */
  const settle = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

  function due(upTo: number): [number, { at: number; handler: () => void }] | undefined {
    let earliest: [number, { at: number; handler: () => void }] | undefined;
    for (const entry of timers) {
      if (entry[1].at > upTo) continue;
      if (earliest === undefined || entry[1].at < earliest[1].at) earliest = entry;
    }
    return earliest;
  }

  return {
    now: () => now,
    setTimeout(handler: () => void, delayMs: number): number {
      nextId += 1;
      timers.set(nextId, { at: now + delayMs, handler });
      return nextId;
    },
    clearTimeout(handle: number): void {
      timers.delete(handle);
    },
    pending: (): number => timers.size,
    /** Moves time forward, running each timer at the instant it comes due. */
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      for (;;) {
        const next = due(target);
        if (next === undefined) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].handler();
        await settle();
      }
      now = target;
    },
    /**
     * A browser that slept: time passes first, and only then does the timer it
     * was throttling get to run.
     */
    async throttledAdvance(ms: number): Promise<void> {
      now += ms;
      for (;;) {
        const next = due(now);
        if (next === undefined) break;
        timers.delete(next[0]);
        next[1].handler();
        await settle();
      }
    },
  };
}

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void): void {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
    attached: (): number => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    fire(type: string): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
}

interface Rig {
  clock: ReturnType<typeof fakeClock>;
  target: ReturnType<typeof fakeTarget>;
  refresh: ReturnType<typeof vi.fn>;
  onExpire: ReturnType<typeof vi.fn>;
  stop: () => void;
}

function start(
  options: {
    token?: TokenInstants | null;
    outcome?: (now: number) => RefreshOutcome;
  } = {},
): Rig {
  const clock = fakeClock();
  const target = fakeTarget();
  const outcome =
    options.outcome ??
    ((now: number): RefreshOutcome => ({
      outcome: 'replaced',
      instants: { issuedAt: now, expiresAt: now + WINDOW, ceilingAt: CEILING },
    }));
  const refresh = vi.fn(() => Promise.resolve(outcome(clock.now())));
  const onExpire = vi.fn();
  const stop = createIdleClock<number>({
    token: options.token === undefined ? instants() : options.token,
    target,
    now: () => clock.now(),
    setTimeout: (handler, delayMs) => clock.setTimeout(handler, delayMs),
    clearTimeout: (handle) => clock.clearTimeout(handle),
    refresh,
    onExpire,
  });
  return { clock, target, refresh, onExpire, stop };
}

describe('what the idle clock decides', () => {
  const base: IdleState = { ...instants(), lastInteractionAt: 0, lastAttemptAt: null };

  it('expires at the idle deadline, which hangs off the last interaction', () => {
    // The shape after a refresh: a token issued at minute 7.5 and good until
    // minute 22.5, held by a parent who last touched the device at minute 1.
    // The deadline is theirs, not the token's.
    const state = { ...base, issuedAt: 450_000, expiresAt: 1_350_000, lastInteractionAt: 60_000 };
    expect(decide(state, 60_000 + WINDOW - 1).action).toBe('wait');
    expect(decide(state, 60_000 + WINDOW)).toEqual({ action: 'expire' });
    expect(60_000 + WINDOW).toBeLessThan(state.expiresAt);
  });

  it('expires at the token’s own expiry and at the ceiling alike', () => {
    expect(decide(base, WINDOW)).toEqual({ action: 'expire' });
    expect(decide({ ...base, ceilingAt: 1000, lastInteractionAt: 500_000 }, 1000)).toEqual({
      action: 'expire',
    });
  });

  it('asks for a replacement only once the token would die before the deadline', () => {
    // No interaction since the token arrived: the window lapses first, so a
    // replacement would buy nothing and none is asked for.
    expect(decide({ ...base }, WINDOW - 1).action).toBe('wait');
    const active = { ...base, lastInteractionAt: 100_000 };
    expect(decide(active, WINDOW * REFRESH_AT_FRACTION)).toEqual({ action: 'refresh' });
    expect(decide(active, WINDOW * REFRESH_AT_FRACTION - 1).action).toBe('wait');
  });

  it('throttles a second attempt to the retry fraction of the window', () => {
    const attempted = { ...base, lastInteractionAt: 100_000, lastAttemptAt: 500_000 };
    expect(decide(attempted, 500_000 + WINDOW * RETRY_AT_FRACTION - 1).action).toBe('wait');
    expect(decide(attempted, 500_000 + WINDOW * RETRY_AT_FRACTION)).toEqual({ action: 'refresh' });
  });

  it('states its thresholds as fractions of the window, never as durations', () => {
    expect(REFRESH_AT_FRACTION).toBeGreaterThan(0);
    expect(REFRESH_AT_FRACTION).toBeLessThan(1);
    expect(RETRY_AT_FRACTION).toBeGreaterThan(0);
    expect(RETRY_AT_FRACTION).toBeLessThan(REFRESH_AT_FRACTION);
  });
});

describe('a parent who walks away', () => {
  it('expires exactly one window after the token arrived, silently', async () => {
    const rig = start();
    await rig.clock.advance(WINDOW - 1);
    expect(rig.onExpire).not.toHaveBeenCalled();

    await rig.clock.advance(1);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
    // Nothing was asked of the server on the way: an idle parent is not
    // refreshed into staying.
    expect(rig.refresh).not.toHaveBeenCalled();
  });

  it('expires one window after the last interaction, not one after the refresh', async () => {
    const rig = start();
    await rig.clock.advance(60_000);
    rig.target.fire('keydown');

    // The refresh lands at the refresh threshold and replaces the token, but a
    // refresh is not interaction and must not move the deadline.
    await rig.clock.advance(60_000 + WINDOW - 60_000 - 1);
    expect(rig.refresh).toHaveBeenCalledTimes(1);
    expect(rig.onExpire).not.toHaveBeenCalled();

    await rig.clock.advance(1);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
  });

  it('expires on a late tick rather than granting the time the tab slept', async () => {
    const rig = start();
    // The timer was armed for the deadline; the browser froze the tab and only
    // ran it long afterwards. The decision is made against the current instant.
    await rig.clock.throttledAdvance(WINDOW * 4);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
  });

  it('stops watching once it has expired', async () => {
    const rig = start();
    await rig.clock.advance(WINDOW);
    expect(rig.target.attached()).toBe(0);
    expect(rig.clock.pending()).toBe(0);

    // A stray event after the fact cannot resurrect Parent View.
    rig.target.fire('pointerdown');
    await rig.clock.advance(WINDOW);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('a parent who keeps working', () => {
  it('keeps Parent View alive across many windows of interaction', async () => {
    const rig = start();
    for (let step = 0; step < 60; step += 1) {
      await rig.clock.advance(WINDOW / 2);
      rig.target.fire('pointerdown');
    }
    expect(rig.onExpire).not.toHaveBeenCalled();
  });

  it('asks for at most one replacement per threshold under a keystroke storm', async () => {
    const rig = start();
    // A thousand interactions across rather more than two windows. Per-event
    // refreshing would be a thousand requests.
    for (let step = 0; step < 1000; step += 1) {
      await rig.clock.advance(1000);
      rig.target.fire('keydown');
    }
    expect(rig.refresh.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(1_000_000 / (WINDOW * REFRESH_AT_FRACTION)),
    );
    expect(rig.refresh.mock.calls.length).toBeGreaterThan(0);
    expect(rig.onExpire).not.toHaveBeenCalled();
  });

  it('treats every stated interaction event as interaction, and nothing else', async () => {
    for (const type of INTERACTION_EVENTS) {
      const rig = start();
      await rig.clock.advance(WINDOW / 2);
      rig.target.fire(type);
      await rig.clock.advance(WINDOW / 2);
      expect(rig.onExpire, type).not.toHaveBeenCalled();
    }

    const ignored = start();
    await ignored.clock.advance(WINDOW - 1);
    ignored.target.fire('mousemove');
    await ignored.clock.advance(1);
    expect(ignored.onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('what a refresh turns out to be', () => {
  it('expires on the guard’s own refusal rather than waiting out the window', async () => {
    const rig = start({ outcome: () => ({ outcome: 'expired' }) });
    await rig.clock.advance(60_000);
    rig.target.fire('keydown');

    await rig.clock.advance(WINDOW * REFRESH_AT_FRACTION);
    expect(rig.refresh).toHaveBeenCalledTimes(1);
    // Well before the deadline the window would otherwise have run to.
    expect(rig.clock.now()).toBeLessThan(60_000 + WINDOW);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure instead of treating it as an idle parent', async () => {
    const rig = start({ outcome: () => ({ outcome: 'failed' }) });
    await rig.clock.advance(1);
    rig.target.fire('keydown');

    await rig.clock.advance(WINDOW * REFRESH_AT_FRACTION);
    expect(rig.refresh).toHaveBeenCalledTimes(1);
    expect(rig.onExpire).not.toHaveBeenCalled();

    // The retries keep coming on the retry threshold, and none of them ends
    // Parent View early.
    await rig.clock.advance(WINDOW * RETRY_AT_FRACTION * 3);
    expect(rig.refresh.mock.calls.length).toBeGreaterThan(1);
    expect(rig.onExpire).not.toHaveBeenCalled();

    // The window still lapses on schedule: a bad connection buys no extra time.
    await rig.clock.advance(WINDOW);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
  });

  it('survives a refresh that rejects outright rather than answering', async () => {
    const clock = fakeClock();
    const target = fakeTarget();
    const onExpire = vi.fn();
    const refresh = vi.fn((): Promise<RefreshOutcome> => Promise.reject(new Error('boom')));
    createIdleClock<number>({
      token: instants(),
      target,
      now: () => clock.now(),
      setTimeout: (handler, delayMs) => clock.setTimeout(handler, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(handle),
      refresh,
      onExpire,
    });
    await clock.advance(1);
    target.fire('keydown');
    await clock.advance(WINDOW * REFRESH_AT_FRACTION);
    expect(refresh).toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('treats a replacement with a non-positive window as a bad moment, not an idle parent', async () => {
    // A finite but degenerate `expiresAt` (clock-skewed or otherwise malformed)
    // is not the guard's refusal and not the ceiling — it must not end Parent
    // View on its own, the same as any other bad response.
    const rig = start({
      outcome: (now) => ({
        outcome: 'replaced',
        instants: { issuedAt: now, expiresAt: now, ceilingAt: CEILING },
      }),
    });
    await rig.clock.advance(60_000);
    rig.target.fire('keydown');

    await rig.clock.advance(WINDOW * REFRESH_AT_FRACTION);
    expect(rig.refresh).toHaveBeenCalledTimes(1);
    expect(rig.onExpire).not.toHaveBeenCalled();

    // The prior, measurable window is kept, so the deadline it already had
    // still lapses on schedule.
    await rig.clock.advance(60_000 + WINDOW - rig.clock.now());
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('the ceiling', () => {
  it('ends Parent View however active the parent is, and is not refreshed past', async () => {
    const ceilingAt = 300_000;
    const rig = start({ token: instants({ ceilingAt }) });
    await rig.clock.advance(100_000);
    rig.target.fire('keydown');

    await rig.clock.advance(ceilingAt - 100_000 - 1);
    expect(rig.onExpire).not.toHaveBeenCalled();

    await rig.clock.advance(1);
    expect(rig.onExpire).toHaveBeenCalledTimes(1);
    // The refresh threshold sits past the ceiling, so nothing was ever asked.
    expect(rig.refresh).not.toHaveBeenCalled();
  });
});

describe('with no elevation held', () => {
  it('attaches no listener and schedules nothing', () => {
    const rig = start({ token: null });
    expect(rig.target.attached()).toBe(0);
    expect(rig.clock.pending()).toBe(0);
    expect(rig.onExpire).not.toHaveBeenCalled();
    expect(rig.refresh).not.toHaveBeenCalled();
    // And stopping a clock that never started is a no-op, not a throw.
    expect(() => rig.stop()).not.toThrow();
  });
});

describe('with a window that cannot be measured', () => {
  it('runs no clock when the receipt is not before the expiry', async () => {
    // `issuedAt` is the browser's clock and `expiresAt` is the server's, so a
    // device running ahead of the server hands over a window of zero or less.
    // Expiring on that would bounce the parent out the instant they crossed the
    // PIN — silently, and every time.
    for (const expiresAt of [0, -1, -WINDOW]) {
      const rig = start({ token: instants({ issuedAt: 0, expiresAt }) });
      expect(rig.target.attached()).toBe(0);
      expect(rig.clock.pending()).toBe(0);
      await rig.clock.advance(WINDOW * 4);
      expect(rig.onExpire).not.toHaveBeenCalled();
      expect(rig.refresh).not.toHaveBeenCalled();
    }
  });

  it('runs no clock on an instant that is not a number at all', async () => {
    for (const token of [
      instants({ issuedAt: Number.NaN }),
      instants({ expiresAt: Number.NaN }),
      instants({ ceilingAt: Number.NaN }),
      instants({ ceilingAt: Number.POSITIVE_INFINITY }),
    ]) {
      const rig = start({ token });
      expect(rig.target.attached()).toBe(0);
      expect(rig.clock.pending()).toBe(0);
      await rig.clock.advance(WINDOW * 4);
      expect(rig.onExpire).not.toHaveBeenCalled();
      expect(rig.refresh).not.toHaveBeenCalled();
    }
  });
});

describe('while a replacement is still in flight', () => {
  it('asks once and no more, and still ends the window on time', async () => {
    const clock = fakeClock();
    const target = fakeTarget();
    const onExpire = vi.fn();
    // A request that never answers at all: the connection is open and silent.
    const refresh = vi.fn((): Promise<RefreshOutcome> => new Promise<RefreshOutcome>(() => {}));
    createIdleClock<number>({
      token: instants(),
      target,
      now: () => clock.now(),
      setTimeout: (handler, delayMs) => clock.setTimeout(handler, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(handle),
      refresh,
      onExpire,
    });

    await clock.advance(1);
    target.fire('keydown');
    await clock.advance(WINDOW * REFRESH_AT_FRACTION);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Retry thresholds keep coming round, and so do interactions. Neither may
    // dispatch a second request over the first: the older response would
    // resolve last and install its stale instants over the newer token's.
    for (let step = 0; step < 20; step += 1) {
      target.fire('keydown');
      await clock.advance(WINDOW * RETRY_AT_FRACTION);
    }
    expect(refresh).toHaveBeenCalledTimes(1);

    // And the deadline was armed throughout: a hanging request buys no time.
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe('stopping the clock', () => {
  it('detaches every listener and cancels the pending timer', async () => {
    const rig = start();
    expect(rig.target.attached()).toBe(INTERACTION_EVENTS.length);
    expect(rig.clock.pending()).toBe(1);

    rig.stop();
    expect(rig.target.attached()).toBe(0);
    expect(rig.clock.pending()).toBe(0);

    await rig.clock.advance(WINDOW * 10);
    expect(rig.onExpire).not.toHaveBeenCalled();
  });
});
