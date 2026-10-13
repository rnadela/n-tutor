import { describe, expect, it } from 'vitest';
import { reportCaptureOpen } from './capture-open';

/**
 * The one boolean the bottom bar cannot derive from a pathname: whether a live
 * camera viewfinder is on screen.
 *
 * Driven through the exported rule rather than through a render: `apps/web` runs
 * with `environment: 'node'` and no DOM, so an effect is not observable here —
 * and a source match would pass on a provider wired up the wrong way round.
 */
function reporter(): { report: (open: boolean) => void; said: boolean[] } {
  const said: boolean[] = [];
  return { report: (open: boolean) => said.push(open), said };
}

describe('what the capture screen tells the shell', () => {
  it('reports an open viewfinder as open', () => {
    const { report, said } = reporter();
    reportCaptureOpen(report, true);
    expect(said).toEqual([true]);
  });

  it('reports a closed viewfinder as closed', () => {
    const { report, said } = reporter();
    reportCaptureOpen(report, false);
    expect(said).toEqual([false]);
  });

  it('reports closed again on the way out, whatever it last said', () => {
    // Leaving the capture screen with the camera up is a route change. Without
    // this the shell would believe a viewfinder was still on screen and keep
    // the bar off every screen after it.
    const { report, said } = reporter();
    const cleanup = reportCaptureOpen(report, true);
    cleanup();
    expect(said).toEqual([true, false]);
  });

  it('hands back a cleanup rather than performing it, so the caller owns when', () => {
    const { report, said } = reporter();
    const cleanup = reportCaptureOpen(report, true);
    expect(said).toEqual([true]);
    expect(cleanup).toBeTypeOf('function');
  });
});
