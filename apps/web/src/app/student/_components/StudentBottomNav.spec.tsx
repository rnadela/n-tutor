import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { BottomNav } from '@/components/BottomNav';
import { STUDENT_TABS } from './StudentBottomNav';
import { studentCopy } from '@/copy/student';
import { bottomNavShown, tabIsCurrent } from '@/lib/bottom-nav';
import { studentTheme } from '@/theme/theme';
import { comfortableDensity, density } from '@/theme/tokens';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'StudentBottomNav.tsx'), 'utf8');
/** Comments stripped: the comments name the very things asserted below. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/**
 * `StudentBottomNav` itself reads `usePathname`, which this workspace has no
 * router for — so the tab data is asserted directly and the bar it hands them
 * to is rendered with the same props the component passes.
 */
function render(pathname: string): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: studentTheme },
      createElement(BottomNav, {
        pathname,
        items: STUDENT_TABS,
        ariaLabel: studentCopy.bottomNav.label,
        density: comfortableDensity,
      }),
    ),
  );
}

function css(markup: string): string {
  const sheet = (markup.match(/<style[^>]*>([\s\S]*?)<\/style>/gu) ?? []).join('\n');
  expect(sheet.length, 'emotion emitted no stylesheet').toBeGreaterThan(0);
  return sheet;
}

describe('Student Mode’s three tabs', () => {
  it('are Home, the finished tests and the way across to the parent side', () => {
    expect(STUDENT_TABS.map((tab) => tab.href)).toEqual([
      '/student',
      '/student/results',
      '/parent/pin',
    ]);
  });

  it('take their words from the copy module', () => {
    expect(STUDENT_TABS.map((tab) => tab.label)).toEqual([
      studentCopy.bottomNav.home,
      studentCopy.bottomNav.results,
      studentCopy.bottomNav.parent,
    ]);
    expect(CODE).not.toMatch(/label: '/u);
  });

  it('leaves nothing behind on the way to Results, which is inside Student Mode', () => {
    // Only the crossing out of Student Mode clears the client-held answers.
    const results = STUDENT_TABS.find((tab) => tab.href === '/student/results');
    expect(results?.onPress).toBeUndefined();
    expect(CODE.match(/onPress/gu)).toHaveLength(1);
  });

  it('lets each tab claim only its own screen', () => {
    expect(STUDENT_TABS.every((tab) => tab.match === 'exact')).toBe(true);
  });

  it('clears the client-held answers on the way to the parent side', () => {
    // The link this tab replaces below `lg` does the same thing, for AD-26's
    // reason: past the PIN gate nobody is a child.
    expect(CODE).toContain('onPress: () => clearAll(attemptStorage())');
    expect(STUDENT_TABS.find((tab) => tab.href === '/parent/pin')?.onPress).toBeTypeOf('function');
  });

  it('renders all three destinations as real links with their labels', () => {
    const markup = render('/student');
    expect(markup).toContain('aria-label="Student sections"');
    for (const tab of STUDENT_TABS) {
      expect(markup).toContain(`href="${tab.href}"`);
      expect(markup).toContain(tab.label);
    }
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/student"/u);
  });

  it('meets Student Mode’s own 48px floor, not the console’s 44px one', () => {
    expect(css(render('/student'))).toContain(`min-height:${comfortableDensity.tapTarget}px`);
    expect(comfortableDensity.tapTarget).toBe(48);
    expect(density.tapTarget).toBe(44);
    // The figure is the density handed in, never a number in this file.
    expect(CODE).toContain('density={comfortableDensity}');
    expect(CODE).not.toMatch(/(?<!\d)(44|48)(?!\d)/u);
  });
});

describe('where Student Mode’s bar does not appear', () => {
  it('is absent on an in-progress Attempt and its results', () => {
    expect(bottomNavShown('/student/tests')).toBe(false);
    expect(bottomNavShown('/student/tests/abc-1')).toBe(false);
    expect(CODE).toContain('if (!bottomNavShown(pathname)) return null;');
  });

  it('takes its clearance away with it, so the Attempt ends where it always did', () => {
    // The spacer is rendered by this component and not as a padding on the
    // server layout, which knows no pathname: stated there it would also end
    // the one screen with no bar a bar's height early. Both sit behind the one
    // guard, so neither can outlive the other.
    const body = CODE.slice(CODE.indexOf('export function StudentBottomNav'));
    expect(body).toContain('barOffsetCss');
    expect(body).toContain('data-testid="bottom-nav-spacer"');
    expect(body.indexOf('return null;')).toBeLessThan(body.indexOf('barOffsetCss'));
    expect(body.indexOf('return null;')).toBeLessThan(body.indexOf('<BottomNav'));
    // And it is decorative, so it is out of the accessibility tree.
    expect(CODE).toMatch(/aria-hidden="true"\s*\n?\s*data-testid="bottom-nav-spacer"/u);
  });

  it('survives a render with no router above it rather than throwing', () => {
    // `usePathname()` is `null` outside a router; the empty string it falls
    // back to is a route nothing recognises, which is no bar.
    expect(CODE).toContain("usePathname() ?? ''");
    expect(bottomNavShown('')).toBe(false);
  });

  it('is present on Home', () => {
    expect(bottomNavShown('/student')).toBe(true);
  });

  it('is present on the Results screen, which is an ordinary Student Mode route', () => {
    expect(bottomNavShown('/student/results')).toBe(true);
    // And the tab reads as current there, and only there.
    expect(tabIsCurrent('/student/results', { href: '/student/results', match: 'exact' })).toBe(
      true,
    );
    expect(tabIsCurrent('/student', { href: '/student/results', match: 'exact' })).toBe(false);
  });
});

describe('how the component reads where it is', () => {
  it('reads the pathname here rather than turning the layout into a client file', () => {
    expect(CODE).toContain("'use client'");
    expect(CODE).toContain('usePathname()');
    // Which layout is drawn is the bar's own `display` breakpoint (UX-DR44).
    expect(CODE).not.toMatch(/useMediaQuery|matchMedia|window\./u);
  });
});
