import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The sync's source, read rather than rendered.
 *
 * `apps/web` runs vitest in `environment: 'node'` with no jsdom, so a component
 * whose whole output is a `document` write in an effect has nothing a render can
 * assert — and the one claim that matters here is likewise invisible end to end:
 * `brandInk.light` and `brandInk.dark` are the same value, so a browser cannot
 * tell this component's re-sync from Next re-emitting its own metadata. What the
 * dependency list says is therefore the only place that claim can be pinned, and
 * it is pinned here deliberately rather than left to a reviewer's eye.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'ColorModeMeta.tsx'), 'utf8');

/** The effect's dependency array, as written. */
const DEPENDENCIES = /\}, \[([^\]]*)\]\);/u.exec(SOURCE)?.[1] ?? '';

describe('what re-runs the theme-colour sync', () => {
  it('re-runs it when the chosen scheme changes', () => {
    expect(DEPENDENCIES).toContain('scheme');
  });

  it('re-runs it on a client-side navigation as well', () => {
    // A client-side navigation can re-emit the root `viewport` metadata, which
    // puts the device-scoped pair back in the head. With `scheme` alone in the
    // list there is nothing to notice — the chosen mode did not change, the
    // path did — and the title bar is left on the device's answer for the rest
    // of the visit. The day `brandInk`'s two values diverge, that is a visible
    // bug; this is what keeps it from being written.
    expect(DEPENDENCIES).toContain('pathname');
    expect(SOURCE).toContain('usePathname');
  });

  it('writes through the shared rule rather than touching metas itself', () => {
    // One writer, one selector: the component decides *when*, and
    // `color-mode.ts` decides *what* — which is the half the matrix pins.
    expect(SOURCE).toContain('syncThemeColor(document, scheme)');
    expect(SOURCE).not.toContain('querySelectorAll');
  });

  it('renders nothing, so it can be mounted anywhere inside the provider', () => {
    expect(SOURCE).toContain('return null;');
  });
});
