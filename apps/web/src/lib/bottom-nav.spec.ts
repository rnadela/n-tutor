import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  barOffsetCss,
  bottomNavShown,
  moreIsCurrent,
  tabIsCurrent,
  type BottomNavTarget,
} from './bottom-nav';
import { bottomNav, spacing } from '@/theme/tokens';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'bottom-nav.ts'), 'utf8');
/** Comments stripped: the comments below name the very figures the sweep bans. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/** Parent View's four tab destinations, the shape the bar passes in. */
const PARENT_TAB_HREFS: readonly BottomNavTarget[] = [
  { href: '/parent', match: 'exact' },
  { href: '/parent/capture', match: 'prefix' },
  { href: '/parent/drafts', match: 'prefix' },
  { href: '/parent/attempts', match: 'prefix' },
];

describe('which screens carry the bar', () => {
  it('carries it on an ordinary signed-in screen on every surface', () => {
    for (const path of [
      '/parent',
      '/parent/',
      '/parent/drafts',
      '/parent/drafts/abc-1',
      '/parent/capture',
      '/admin',
      '/admin/taxonomy',
      '/student',
      '/student/',
    ]) {
      expect(bottomNavShown(path), path).toBe(true);
    }
  });

  it('keeps it off the PIN gate, which is exactly one screen', () => {
    expect(bottomNavShown('/parent/pin')).toBe(false);
    expect(bottomNavShown('/parent/pin/')).toBe(false);
  });

  it('keeps it on Change PIN, which is a destination and not the gate', () => {
    // A prefix exclusion would take the bar off a screen the parent reached
    // *with* the bar, from the sidebar's Account group.
    expect(bottomNavShown('/parent/pin/change')).toBe(true);
    expect(bottomNavShown('/parent/pin/change/')).toBe(true);
  });

  it('keeps it off Admin sign-in', () => {
    expect(bottomNavShown('/admin/login')).toBe(false);
    expect(bottomNavShown('/admin/login/')).toBe(false);
  });

  it('keeps it off every auth page, before there is an account to navigate', () => {
    expect(bottomNavShown('/auth')).toBe(false);
    expect(bottomNavShown('/auth/')).toBe(false);
    expect(bottomNavShown('/auth/sign-in')).toBe(false);
    expect(bottomNavShown('/auth/sign-up')).toBe(false);
    expect(bottomNavShown('/auth/signed-in')).toBe(false);
  });

  it('keeps it off an in-progress Attempt and its results', () => {
    expect(bottomNavShown('/student/tests')).toBe(false);
    expect(bottomNavShown('/student/tests/')).toBe(false);
    expect(bottomNavShown('/student/tests/abc-1')).toBe(false);
    expect(bottomNavShown('/student/tests/abc-1/results')).toBe(false);
  });

  it('declines rather than throws where there is no pathname to read', () => {
    // `usePathname()` is `null` outside a router, which is every unit render in
    // this workspace and every render before Next's router context is in place.
    // No pathname is no answer, and no answer is no bar — the same verdict an
    // excluded route gets, reached without taking a working screen down.
    expect(bottomNavShown(null)).toBe(false);
    expect(bottomNavShown(undefined)).toBe(false);
    expect(bottomNavShown('')).toBe(false);
  });

  it('answers the tab and overflow matchers for a missing pathname too', () => {
    const home: BottomNavTarget = { href: '/parent', match: 'exact' };
    for (const path of [null, undefined, '']) {
      expect(tabIsCurrent(path, home), String(path)).toBe(false);
      // Not "current by elimination": with no pathname every tab answers "not
      // me", and "none of them" must not read as "the overflow one".
      expect(moreIsCurrent(path, PARENT_TAB_HREFS), String(path)).toBe(false);
    }
  });

  it('is not fooled by a screen whose name merely starts like an excluded one', () => {
    // `startsWith` on the bare prefix would swallow all three.
    expect(bottomNavShown('/student/testsuite')).toBe(true);
    expect(bottomNavShown('/parent/pins')).toBe(true);
    expect(bottomNavShown('/admin/logins')).toBe(true);
    expect(bottomNavShown('/authors')).toBe(true);
  });
});

describe('which tab is the current one', () => {
  it('claims only its own screen where the tab is a surface’s landing', () => {
    const home: BottomNavTarget = { href: '/parent', match: 'exact' };
    expect(tabIsCurrent('/parent', home)).toBe(true);
    expect(tabIsCurrent('/parent/', home)).toBe(true);
    // Otherwise Home would be current on every Parent View screen there is.
    expect(tabIsCurrent('/parent/drafts', home)).toBe(false);
  });

  it('claims its drill-downs where the tab is a list', () => {
    const drafts: BottomNavTarget = { href: '/parent/drafts', match: 'prefix' };
    expect(tabIsCurrent('/parent/drafts', drafts)).toBe(true);
    expect(tabIsCurrent('/parent/drafts/abc', drafts)).toBe(true);
    expect(tabIsCurrent('/parent/draftsmen', drafts)).toBe(false);
  });
});

describe('when the overflow action is the current tab', () => {
  it('is current on a destination none of the tabs claims', () => {
    expect(moreIsCurrent('/parent/students', PARENT_TAB_HREFS)).toBe(true);
    expect(moreIsCurrent('/parent/settings', PARENT_TAB_HREFS)).toBe(true);
    expect(moreIsCurrent('/parent/pin/change', PARENT_TAB_HREFS)).toBe(true);
  });

  it('is not current where a tab already claims the screen', () => {
    expect(moreIsCurrent('/parent', PARENT_TAB_HREFS)).toBe(false);
    expect(moreIsCurrent('/parent/capture/review', PARENT_TAB_HREFS)).toBe(false);
    expect(moreIsCurrent('/parent/drafts/abc', PARENT_TAB_HREFS)).toBe(false);
  });
});

describe('how much room a screen leaves under the bar', () => {
  it('is the bar’s height, a gutter, and the device’s own bottom inset', () => {
    expect(barOffsetCss).toContain('env(safe-area-inset-bottom)');
    expect(barOffsetCss).toContain(`${bottomNav.height}px`);
    expect(barOffsetCss).toContain(`${spacing.base}px`);
    expect(barOffsetCss.startsWith('calc(')).toBe(true);
  });

  it('names the tokens rather than restating their figures', () => {
    // A literal 56 here is a second copy of the bar's height, and the copy is
    // what goes stale when the bar changes.
    expect(CODE).toContain('bottomNav.height');
    expect(CODE).toContain('spacing.base');
    expect(CODE).not.toMatch(/(?<!\d)(56|3)(?!\d)/u);
    // The sweep has to be able to fail.
    expect('height: 56').toMatch(/(?<!\d)(56|3)(?!\d)/u);
  });

  it('reads no viewport width and names no breakpoint of its own', () => {
    // Which layout is drawn is a CSS breakpoint on the bar (UX-DR44); this
    // module only answers questions about a pathname.
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\./u);
    expect(CODE).not.toContain('@media');
    expect(CODE).not.toContain('1200');
  });
});
