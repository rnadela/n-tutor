'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface Elevation {
  token: string;
  expiresAt: string;
  ceilingAt: string;
}

export interface ElevationContextValue {
  elevation: Elevation | null;
  /**
   * When this browser received the token it holds, or `null` while it holds
   * none.
   *
   * The idle clock measures its window as `expiresAt - receivedAt`, so the
   * only duration in play is one the server stated. Taking the receipt rather
   * than the server's own issue instant makes the browser's window shorter
   * than the server's by one network round trip — conservative in the safe
   * direction, and free of any clock-skew guesswork.
   */
  receivedAt: number | null;
  /** Replaces whatever is held; the caller never mutates the object in place. */
  setElevation(elevation: Elevation): void;
  /** Leaving Parent View: the token stops existing anywhere. */
  clearElevation(): void;
}

/** What the provider holds: the token and the instant it arrived, together. */
export interface Held {
  elevation: Elevation;
  receivedAt: number;
}

/**
 * The provider's whole state transition when a token arrives.
 *
 * Exported, and taking the instant rather than reading the clock, so the stamp
 * is testable as behaviour: `apps/web` runs its unit tests without a DOM, so a
 * state change driven through a render is not observable here, and a source
 * match would pass on code that is structurally right and behaviourally wrong.
 */
export function receiveElevation(elevation: Elevation, receivedAt: number): Held {
  return { elevation, receivedAt };
}

const ElevationContext = createContext<ElevationContextValue | null>(null);

/**
 * Holds the elevation token in memory, and nowhere else.
 *
 * Deliberately no `localStorage`, no `sessionStorage`, no cookie and no
 * IndexedDB: AD-18 makes the elevation credential a thing a reload destroys, so
 * closing the tab or reloading the page puts the PIN back in front of Parent
 * View. Persisting it anywhere would quietly undo the gate this story exists to
 * build — which is why `elevation.spec.tsx` asserts on storage spies rather
 * than trusting this comment.
 */
export function ElevationProvider({ children }: { children: React.ReactNode }) {
  const [held, setHeld] = useState<Held | null>(null);

  const setElevation = useCallback(
    (next: Elevation) => setHeld(receiveElevation(next, Date.now())),
    [],
  );
  const clearElevation = useCallback(() => setHeld(null), []);

  const value = useMemo<ElevationContextValue>(
    () => ({
      elevation: held?.elevation ?? null,
      receivedAt: held?.receivedAt ?? null,
      setElevation,
      clearElevation,
    }),
    [held, setElevation, clearElevation],
  );

  return <ElevationContext.Provider value={value}>{children}</ElevationContext.Provider>;
}

export function useElevation(): ElevationContextValue {
  const value = useContext(ElevationContext);
  if (value === null) {
    throw new Error('useElevation must be used inside an ElevationProvider.');
  }
  return value;
}
