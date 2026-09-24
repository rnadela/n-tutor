'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useElevation } from '@/lib/elevation';
import { createIdleClock, type RefreshOutcome, type TokenInstants } from '@/lib/idle-expiry';
import { parentApi } from '@/lib/parent-api';
import { endsParentView } from '@/lib/parent-view';

/**
 * What a failed refresh means for Parent View.
 *
 * The elevation guard's own refusal is a statement about authority; a dropped
 * connection, a 429 or a 500 is a statement about the network. Only the first
 * ends Parent View — inverting this would throw a working parent out mid-task
 * on a single bad response, so it is exported and asserted as a rule rather
 * than read out of this file's source.
 */
export function refreshOutcomeFor(cause: unknown): 'expired' | 'failed' {
  return endsParentView(cause) ? 'expired' : 'failed';
}

/**
 * Parent View's idle clock, mounted once by the layout so every Parent View
 * surface is covered by the same one (AD-13).
 *
 * It renders nothing and says nothing. Expiry is silent and uniform: no
 * warning, no countdown, no dialog and no live-region announcement — a parent
 * who walked away is not there to read any of it, and one who is still there
 * never reaches the deadline.
 *
 * On expiry it navigates to `/student`, the profile this device is already
 * bound to. It deliberately does **not** call `clearElevation()` first: Story
 * 1.4 learned that clearing while the Parent View screens are still mounted
 * makes each of them re-run its "no token" branch and fire its own
 * `router.replace('/parent/pin')`, which races and wins. Leaving the `/parent`
 * route group unmounts `ElevationProvider`, which destroys the token
 * unconditionally — and by the time the clock acts the token is already past
 * its own `exp` anyway.
 */
export function ParentIdleExpiry() {
  const router = useRouter();
  const { elevation, receivedAt, setElevation } = useElevation();

  // The clock reaches the token it holds through a ref rather than through the
  // effect's dependencies. A refresh replaces the token in context, and
  // re-creating the clock on that would restart the idle deadline — which is
  // exactly what a refresh must never do.
  const held = useRef<{ token: string; expiresAt: string; ceilingAt: string } | null>(null);
  const receivedRef = useRef<number | null>(null);

  // Written in a committed effect rather than during render: a render-phase
  // write is a side effect concurrent rendering is free to throw away or run
  // twice. Declared before the clock's effect so it commits first, which is
  // what lets the clock below read the token this render holds.
  useEffect(() => {
    held.current = elevation;
    receivedRef.current = receivedAt;
  });

  // The one thing the clock's lifetime turns on: whether there is a Parent View
  // to expire at all. On `/parent/pin`, or once the token is gone, no listener
  // is attached and no timer is scheduled.
  const elevated = elevation !== null && receivedAt !== null;

  useEffect(() => {
    if (!elevated) return;
    const current = held.current;
    const issuedAt = receivedRef.current;
    if (current === null || issuedAt === null) return;

    const token: TokenInstants = {
      issuedAt,
      expiresAt: Date.parse(current.expiresAt),
      ceilingAt: Date.parse(current.ceilingAt),
    };
    // An unreadable instant is a malformed response, not an idle parent. The
    // server refuses an expired token on its own, so the safe move is to run no
    // clock rather than one doing arithmetic on NaN.
    if (!Number.isFinite(token.expiresAt) || !Number.isFinite(token.ceilingAt)) return;

    return createIdleClock<number>({
      token,
      target: window,
      now: () => Date.now(),
      setTimeout: (handler, delayMs) => window.setTimeout(handler, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
      refresh: async (): Promise<RefreshOutcome> => {
        const holding = held.current;
        if (holding === null) return { outcome: 'expired' };
        try {
          const next = await parentApi.refreshElevation(holding.token);
          const expiresAt = Date.parse(next.expiresAt);
          const ceilingAt = Date.parse(next.ceilingAt);
          if (!Number.isFinite(expiresAt) || !Number.isFinite(ceilingAt)) {
            return { outcome: 'failed' };
          }
          // The replacement's own instants become the window; the client never
          // rewrites either of them, and the ceiling is whatever came back.
          setElevation(next);
          return { outcome: 'replaced', instants: { issuedAt: Date.now(), expiresAt, ceilingAt } };
        } catch (cause: unknown) {
          return { outcome: refreshOutcomeFor(cause) };
        }
      },
      onExpire: () => router.replace('/student'),
    });
  }, [elevated, router, setElevation]);

  return null;
}
