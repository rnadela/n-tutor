import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_TABS, SIDEBAR_ITEMS } from './AdminChrome';
import { adminCopy } from '@/copy/admin';
import { bottomNavShown } from '@/lib/bottom-nav';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'AdminChrome.tsx'), 'utf8');

/**
 * The source with its comments stripped, the pattern
 * `ParentSidebarChrome.spec.tsx` set.
 *
 * Read rather than rendered: this workspace runs with `environment: 'node'` and
 * no router, so the shell cannot be rendered at all — and the claims here are
 * about what it wires up. What the bar itself renders is asserted in
 * `components/BottomNav.spec.tsx`, where it can be.
 */
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/u.test(line))
  .join('\n');

describe('the Admin console’s bottom navigation', () => {
  it('is every sidebar destination, in the sidebar’s own order', () => {
    // The bar is a second *view* of `SIDEBAR_ITEMS`, not a second list: a
    // destination added to or renamed in the sidebar cannot leave the bar
    // pointing somewhere the sidebar no longer does.
    expect(ADMIN_TABS.map((tab) => tab.href)).toEqual(SIDEBAR_ITEMS.map((item) => item.href));
    expect(ADMIN_TABS.map((tab) => tab.icon)).toEqual(SIDEBAR_ITEMS.map((item) => item.icon));
    expect(ADMIN_TABS).toHaveLength(5);
    expect(CODE).toContain('SIDEBAR_ITEMS.map(');
  });

  it('names those five destinations and no others', () => {
    expect(ADMIN_TABS.map((tab) => tab.href)).toEqual([
      '/admin',
      '/admin/taxonomy',
      '/admin/accounts',
      '/admin/flagged-explanations',
      '/admin/topics',
    ]);
  });

  it('carries a short word per tab, every one of them from the copy module', () => {
    const words = Object.values(adminCopy.bottomNav);
    for (const tab of ADMIN_TABS) {
      expect(words, tab.href).toContain(tab.label);
      // A tab has a fifth of a phone: the sidebar's "Subjects & Grade Levels"
      // does not fit, and a wrapped label is a bar that reflows.
      expect(tab.label.length, tab.href).toBeLessThanOrEqual(12);
    }
  });

  it('lets Overview claim only its own screen', () => {
    // As a prefix it would be the current tab on every Admin screen there is.
    expect(ADMIN_TABS.find((tab) => tab.href === '/admin')?.match).toBe('exact');
    for (const tab of ADMIN_TABS.filter((item) => item.href !== '/admin')) {
      expect(tab.match, tab.href).toBe('prefix');
    }
  });

  it('makes a missing or renamed destination a typecheck failure, not a blank console', () => {
    // The label table is keyed by the href union `SIDEBAR_ITEMS` itself
    // produces, so a destination added or renamed there is a missing key (and,
    // for the old href, an excess one) at compile time. The throw inside the
    // map is the backstop behind that and nothing more: it fires during module
    // evaluation, which blanks the console rather than failing a build — so no
    // comment here or in the source may claim otherwise.
    expect(CODE).toContain("type AdminHref = (typeof SIDEBAR_ITEMS)[number]['href']");
    expect(CODE).toContain('satisfies Record<AdminHref, string>');
    expect(CODE).toContain('as const satisfies readonly NavItem[]');
    expect(SOURCE).not.toContain('stops the build');
  });

  it('offers no overflow action, because five destinations fit', () => {
    expect(CODE).not.toContain('more=');
    expect(CODE).not.toContain('MoreHorizontal');
  });
});

describe('what the breakpoint move removed', () => {
  it('reads no viewport width, so the first paint is already the right layout', () => {
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\.inner/u);
    expect(CODE).not.toContain('@media');
    expect(CODE).toContain("display: { xs: 'none', lg: 'flex' }");
  });

  it('keeps no drawer and no hamburger: there is nothing left to open', () => {
    expect(CODE).not.toContain('Drawer');
    expect(CODE).not.toContain('menuToggle');
    expect(CODE).not.toContain('drawerOpen');
    expect(adminCopy.nav).not.toHaveProperty('menuToggle');
  });

  it('leaves the header’s own cluster alone', () => {
    expect(CODE).toContain('<ColorModeSwitch />');
    expect(CODE).toContain('adminCopy.nav.signOut');
  });
});

describe('where the bar does not appear', () => {
  it('is absent from the sign-in screen, by the shared rule and by the early return', () => {
    expect(bottomNavShown('/admin/login')).toBe(false);
    expect(CODE).toContain('const routeCarriesBottomNav = bottomNavShown(pathname)');
    expect(CODE).toContain('{routeCarriesBottomNav ? (');
    // The sign-in branch returns before anything else is rendered.
    expect(CODE).toMatch(/if \(onLoginScreen\) \{\s*return \(/u);
  });

  it('is on every other Admin screen', () => {
    for (const tab of ADMIN_TABS) {
      expect(bottomNavShown(tab.href), tab.href).toBe(true);
    }
  });
});

describe('how much room the content leaves under the bar', () => {
  it('pads by the shared offset below `lg` and by the section margin from there up', () => {
    expect(CODE).toContain('barOffsetCss');
    expect(CODE).toContain('{ xs: barOffsetCss, lg: `${density.sectionMargin}px` }');
  });
});
