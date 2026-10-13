'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Whether a live camera viewfinder is on screen, carried from the component
 * that owns it up to the shell that has to get out of its way.
 *
 * Every other visibility rule the bottom bar follows is a question about the
 * pathname, answered by `bottom-nav.ts`. This one cannot be: `/parent/capture`
 * is an ordinary Parent View screen — page management, with the bar — and only
 * the *viewfinder* inside it must not have navigation sitting over it. That is
 * state three levels below the shell, so the smallest thing that carries one
 * boolean upward is a context. Suppressing the whole route instead would take
 * the bar off the entire upload flow, which is not what the story asks for.
 *
 * Modelled on `elevation.tsx`, with one difference: there is no throw for a
 * missing provider. A default of "closed" means any other mount of `AddPages`
 * is harmless rather than fatal, and a shell that never hears from a camera
 * simply keeps its bar.
 */
interface CaptureOpenContextValue {
  open: boolean;
  report(open: boolean): void;
}

const CaptureOpenContext = createContext<CaptureOpenContextValue>({
  open: false,
  report: () => {},
});

export function CaptureOpenProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const report = useCallback((next: boolean) => setOpen(next), []);
  const value = useMemo<CaptureOpenContextValue>(() => ({ open, report }), [open, report]);
  return <CaptureOpenContext.Provider value={value}>{children}</CaptureOpenContext.Provider>;
}

/** Whether a viewfinder is open anywhere under this provider. */
export function useCaptureOpen(): boolean {
  return useContext(CaptureOpenContext).open;
}

/** What a reporter is, so the rule below needs no React to be driven. */
export type CaptureOpenReporter = (open: boolean) => void;

/**
 * The whole of the report: say what the camera is doing now, and hand back the
 * cleanup that says it is closed.
 *
 * Exported and taking the reporter as an argument so the rule is testable as
 * behaviour: `apps/web` runs its unit tests in `environment: 'node'` with no
 * DOM, so an effect driven through a render is not observable here, and a source
 * match would pass on a provider that was wired up wrong.
 */
export function reportCaptureOpen(report: CaptureOpenReporter, open: boolean): () => void {
  report(open);
  return () => report(false);
}

/**
 * Reports the viewfinder's state upward, and reports it closed on unmount.
 *
 * The unmount report matters: leaving the capture screen while the camera is up
 * is a route change, and without it the shell would believe a viewfinder was
 * still on screen and keep the bar off every screen after it.
 */
export function useReportCaptureOpen(open: boolean): void {
  const { report } = useContext(CaptureOpenContext);
  useEffect(() => reportCaptureOpen(report, open), [open, report]);
}
