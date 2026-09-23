'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface Elevation {
  token: string;
  expiresAt: string;
  ceilingAt: string;
}

export interface ElevationContextValue {
  elevation: Elevation | null;
  /** Replaces whatever is held; the caller never mutates the object in place. */
  setElevation(elevation: Elevation): void;
  /** Leaving Parent View: the token stops existing anywhere. */
  clearElevation(): void;
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
  const [elevation, setElevationState] = useState<Elevation | null>(null);

  const setElevation = useCallback((next: Elevation) => setElevationState(next), []);
  const clearElevation = useCallback(() => setElevationState(null), []);

  const value = useMemo<ElevationContextValue>(
    () => ({ elevation, setElevation, clearElevation }),
    [elevation, setElevation, clearElevation],
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
