import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installBannerSurface } from '@/lib/install-banner';
import { bottomNavShown } from '@/lib/bottom-nav';
import { parentCopy } from '@/copy/parent';
import { NAV_GROUPS, PARENT_TABS } from './ParentSidebarChrome';

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

describe('what the breakpoint move removed from Parent View’s shell', () => {
  it('reads no viewport width, so the first paint is already the right layout', () => {
    // A hook renders the narrow layout first on every device and swaps after
    // hydration: the reflow UX-DR44 exists to forbid, and the thing
    // `TableCards.spec.tsx` pins everywhere else.
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\.inner/u);
    expect(CODE).not.toContain('@media');
    expect(CODE).not.toContain('isNarrow');
    // Both branches render; `display` decides which one is on screen.
    expect(CODE).toContain("display: { xs: 'none', lg: 'flex' }");
  });

  it('keeps no hamburger: the bar’s More action opens the drawer instead', () => {
    expect(CODE).not.toContain('menuToggle');
    expect(CODE).not.toContain('<Menu ');
    expect(parentCopy.parentView).not.toHaveProperty('menuToggle');
    // And it is the same drawer, opened through the same setter the nav links
    // close — not a second drawer with a second copy of the list in it.
    expect(CODE).toContain('onMore={() => setDrawerOpen(true)}');
    const drawers = CODE.match(/<Drawer\b/gu) ?? [];
    expect(drawers).toHaveLength(1);
    const lists = CODE.match(/<NavList\b/gu) ?? [];
    expect(lists).toHaveLength(2);
  });

  it('stops qualifying the remembered rail state by width', () => {
    // Below `lg` the sidebar is not on screen at all, so there is no width at
    // which a remembered collapse means nothing.
    expect(CODE).toContain('const railCollapsed = collapsed;');
  });
});

describe('Parent View’s bottom navigation', () => {
  it('names four destinations, every one of them resolved from NAV_GROUPS', () => {
    // The bar is a second *view* of the destination data, not a second
    // navigation: a renamed route stops the build rather than shipping a tab
    // that points where the sidebar no longer does.
    const destinations = NAV_GROUPS.flatMap((group) => group.items);
    expect(PARENT_TABS).toHaveLength(4);
    expect(PARENT_TABS.map((tab) => tab.href)).toEqual([
      '/parent',
      '/parent/capture',
      '/parent/drafts',
      '/parent/attempts',
    ]);
    for (const tab of PARENT_TABS) {
      const destination = destinations.find((item) => item.href === tab.href);
      expect(destination, tab.href).toBeDefined();
      expect(tab.icon, tab.href).toBe(destination!.icon);
    }
    expect(CODE).toContain('icon: navDestination(href).icon');
  });

  it('carries a short word per tab, every one of them from the copy module', () => {
    const words = Object.values(parentCopy.parentView.bottomNav);
    for (const tab of PARENT_TABS) {
      expect(words, tab.href).toContain(tab.label);
      // Not the sidebar's sentence: "Pending practice tests" does not fit a
      // fifth of a phone.
      expect(tab.label.length, tab.href).toBeLessThanOrEqual(12);
    }
    expect(words).toContain(parentCopy.parentView.bottomNav.more);
  });

  it('lets Home claim only Home, and each list its own drill-downs', () => {
    expect(PARENT_TABS.find((tab) => tab.href === '/parent')?.match).toBe('exact');
    for (const tab of PARENT_TABS.filter((item) => item.href !== '/parent')) {
      expect(tab.match, tab.href).toBe('prefix');
    }
  });

  it('is suppressed on a route that carries no bar, and over a live viewfinder', () => {
    expect(bottomNavShown('/parent/pin')).toBe(false);
    expect(bottomNavShown('/parent/pin/change')).toBe(true);
    expect(CODE).toContain('if (!barIsOnScreen(pathname, captureOpen)) return null;');
    expect(CODE).toContain('useCaptureOpen()');
    expect(CODE).toContain('<CaptureOpenProvider>');
  });

  it('states “the bar is on screen” once, and reserves room by the same rule', () => {
    // Two opinions would be a live camera screen with a bar's worth of dead
    // space under it, or a list whose last row sat behind a bar that was there
    // after all.
    const rule = CODE.match(/function barIsOnScreen\([^)]*\)[^{]*\{\s*return ([^;]+);/u);
    expect(rule, 'no barIsOnScreen rule').not.toBeNull();
    expect(rule![1]).toContain('bottomNavShown(pathname)');
    expect(rule![1]).toContain('!captureOpen');
    // Both the bar and the clearance ask it, and nothing else decides either.
    const asks = CODE.match(/barIsOnScreen\(pathname, captureOpen\)/gu) ?? [];
    expect(asks).toHaveLength(2);
    // The clearance lives where the camera's state is readable, which the
    // provider's own render is not.
    expect(CODE).toMatch(/function ParentContent\(/u);
    expect(CODE).toContain('const captureOpen = useCaptureOpen();');
  });

  it('is absent from the gate branch entirely, not merely hidden there', () => {
    // The gate returns before the shell is rendered, so nothing naming the
    // bar can reach it.
    const [gate] = CODE.split('const railCollapsed');
    expect(gate).toContain('if (onGate) {');
    expect(gate).not.toContain('<ParentBottomNav');
  });

  it('pads the content by the shared offset below `lg` and not above it', () => {
    expect(CODE).toContain('barOffsetCss');
    expect(CODE).toContain('{ xs: barOffsetCss, lg: `${density.sectionMargin}px` }');
    // And by the section margin alone where no bar is on screen.
    expect(CODE).toMatch(/: `\$\{density\.sectionMargin\}px`;/u);
  });
});
