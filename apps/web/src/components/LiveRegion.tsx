'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Box from '@mui/material/Box';

/**
 * What the region is carrying, and how many times it has been asked to carry
 * something.
 *
 * The count is not decoration. Announcing the same sentence twice in a row —
 * two saves, two identical failures — sets identical state, React bails out of
 * the re-render, and the second announcement never happens. The count makes
 * every announcement a distinct state, and keys the region so the node is
 * replaced rather than left untouched.
 */
export interface Announcement {
  message: string;
  count: number;
}

export const NO_ANNOUNCEMENT: Announcement = { message: '', count: 0 };

/** The whole state transition, as a pure function of what came before. */
export function announced(previous: Announcement, message: string): Announcement {
  return { message, count: previous.count + 1 };
}

/** Clearing keeps the count: it is a new state, not a return to the start. */
export function cleared(previous: Announcement): Announcement {
  return { message: '', count: previous.count + 1 };
}

export interface LiveRegionValue {
  /** What the region is currently carrying, verbatim. */
  message: string;
  /** How many announcements have been made, this one included. */
  count: number;
  /**
   * Announces a state change. The argument is the copy the screen displays —
   * never a second, test-only string (UX-DR33).
   */
  announce(message: string): void;
  /** Empties the region, so a stale announcement does not linger behind. */
  clear(): void;
}

const LiveRegionContext = createContext<LiveRegionValue | null>(null);

/**
 * Visually hidden without being hidden from assistive technology: `display:
 * none` and `visibility: hidden` both remove the region from the accessibility
 * tree, so nothing would be announced at all.
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
  padding: 0,
  margin: '-1px',
} as const;

/**
 * The region itself, separate from the state that feeds it so that what gets
 * announced is assertable without driving a state change through a render —
 * `apps/web` runs its unit tests without a DOM.
 */
export function AnnouncementRegion({ message }: { message: string }) {
  return (
    <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
      {message}
    </Box>
  );
}

/**
 * The one polite live region for a surface, plus the `announce()` every
 * primitive reports through.
 *
 * One region, not one per component: two `role="status"` nodes on a screen make
 * "the region on this screen" ambiguous, for a screen reader as much as for a
 * test. It is mounted once, in `ThemeRegistry`.
 */
export function LiveRegionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Announcement>(NO_ANNOUNCEMENT);

  const announce = useCallback(
    (next: string) => setState((previous) => announced(previous, next)),
    [],
  );
  const clear = useCallback(() => setState((previous) => cleared(previous)), []);

  const value = useMemo<LiveRegionValue>(
    () => ({ message: state.message, count: state.count, announce, clear }),
    [state, announce, clear],
  );

  return (
    <LiveRegionContext.Provider value={value}>
      {children}
      {/* Keyed by the count, so a repeat of the same sentence replaces the
          node rather than leaving assistive technology with nothing new. */}
      <AnnouncementRegion key={state.count} message={state.message} />
    </LiveRegionContext.Provider>
  );
}

/**
 * Throws outside a provider: a state change that reports into nothing is a
 * silent accessibility regression, which is what UX-DR33 exists to prevent.
 */
export function useAnnounce(): LiveRegionValue {
  const value = useContext(LiveRegionContext);
  if (value === null) {
    throw new Error('useAnnounce must be used inside a LiveRegionProvider.');
  }
  return value;
}
