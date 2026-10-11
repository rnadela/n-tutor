import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installBannerSurface } from '@/lib/install-banner';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'ParentSidebarChrome.tsx'), 'utf8');

/**
 * The source with its comments stripped, the pattern `layout.spec.ts` set.
 *
 * Read rather than rendered, for `page.spec.tsx`'s reason: this workspace runs
 * with `environment: 'node'` and no router, so the shell cannot be rendered at
 * all — and the claim here is about what it wires up, not about markup. What
 * the banner itself renders is asserted in `components/InstallBanner.spec.tsx`,
 * where it can be.
 */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/u.test(line))
  .join('\n');

describe('where Parent View mounts the install banner', () => {
  it('states the mount exactly once, and renders it in both branches', () => {
    // One element, two renders: the gate returns early, so a single render in
    // the main branch would leave the gate without a banner — and two copies
    // of the element itself would be two places to keep in step.
    const mounts = CODE.match(/<InstallBanner\s+surface="parent"\s*\/>/gu) ?? [];
    expect(mounts).toHaveLength(1);
    const renders = CODE.match(/\{installBanner\}/gu) ?? [];
    expect(renders).toHaveLength(2);
    expect(CODE).toContain("from '@/components/InstallBanner'");
  });

  it('names the parent surface and never the student one', () => {
    expect(CODE).not.toContain('surface="student"');
  });

  it('gates the mount on the shared placement rule, under its own name', () => {
    // Asked rather than re-decided, so `/parent/capture` is excluded by one
    // rule instead of by a second opinion living here. The name says it is a
    // claim about the *route*, not about what this device can install.
    expect(CODE).toMatch(
      /const routeCarriesInstallBanner = installBannerSurface\(pathname\) === 'parent'/u,
    );
    expect(CODE).toMatch(/routeCarriesInstallBanner \? <InstallBanner/u);
    // And the shell states no route of its own about it.
    expect(CODE).not.toMatch(/'\/parent\/capture'[^\n]*InstallBanner/u);
  });

  it('puts it above the content on both branches, never over it', () => {
    // Immediately before `{children}` both times: the banner sits in the flow
    // above the screen, and never floats over whatever the parent is reading.
    const above = CODE.match(/\{installBanner\}\s*\{children\}/gu) ?? [];
    expect(above).toHaveLength(2);
  });

  it('leaves camera capture out, through the rule it defers to', () => {
    expect(installBannerSurface('/parent/capture')).toBeNull();
    expect(installBannerSurface('/parent/analytics')).toBe('parent');
  });
});
