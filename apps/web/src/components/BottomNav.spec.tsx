import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { Clock, Home, MoreHorizontal, Upload } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  BottomNav,
  coarsePointer,
  isTextEntry,
  typingAfterFocusChange,
  type BottomNavItem,
} from './BottomNav';
import { parentTheme, studentTheme } from '@/theme/theme';
import { bottomNav, comfortableDensity, density, typeRoles } from '@/theme/tokens';

/**
 * The one bottom navigation bar all three surfaces mount.
 *
 * `apps/web` runs vitest with `environment: 'node'` and ships no DOM testing
 * library, so the rules this component exists to hold — which layout is drawn
 * at which width, which tab reads as current, what the landmark is called — are
 * asserted over the markup and the stylesheet emotion emits beside it, the
 * idiom `TableCards.spec.tsx` set.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'BottomNav.tsx'), 'utf8');
/** Comments stripped, so a rule is never satisfied by a sentence about it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

function render(node: ReactElement, theme: Theme = parentTheme): string {
  return renderToStaticMarkup(createElement(ThemeProvider, { theme }, node));
}

/**
 * Just the CSS emotion emitted for a render, with the markup dropped.
 *
 * Asserted non-empty here rather than at every call site: if emotion ever
 * stopped inserting its sheet during SSR, every negative assertion below would
 * pass on an empty string and this file would be green while asserting nothing.
 */
function css(markup: string): string {
  const sheet = (markup.match(/<style[^>]*>([\s\S]*?)<\/style>/gu) ?? []).join('\n');
  expect(sheet.length, 'emotion emitted no stylesheet').toBeGreaterThan(0);
  return sheet;
}

/** MUI's own default, named rather than restated: `lg` is 1200. */
const LG = parentTheme.breakpoints.values.lg;

/** An overflow action, for the cases that need the fifth slot filled. */
const MORE = { label: 'More', icon: MoreHorizontal, onPress: () => {} };

const TABS: readonly BottomNavItem[] = [
  { href: '/parent', label: 'Home', icon: Home, match: 'exact' },
  { href: '/parent/capture', label: 'Upload', icon: Upload, match: 'prefix' },
  { href: '/parent/drafts', label: 'Drafts', icon: Clock, match: 'prefix' },
];

function bar(pathname: string, extra: Partial<Parameters<typeof BottomNav>[0]> = {}) {
  return (
    <BottomNav
      pathname={pathname}
      items={TABS}
      ariaLabel="Parent View sections"
      density={density}
      {...extra}
    />
  );
}

describe('which layout is drawn at which width', () => {
  it('states the cutoff as a breakpoint key and never as a viewport hook', () => {
    // A width hook renders the narrow layout first on every device and swaps
    // after hydration: the reflow UX-DR44 exists to forbid.
    expect(CODE).not.toMatch(/useMediaQuery|window\.inner/u);
    // And never a media query written by hand, which would pin a figure the
    // theme already owns.
    expect(CODE).not.toContain('@media');
    expect(CODE).not.toContain('1200');
    expect(CODE).toContain("display: { xs: 'flex', lg: 'none' }");
  });

  it('reads a media query for the pointer and for nothing else', () => {
    // `(pointer: coarse)` is a claim about the input device, not about the
    // viewport width, so it is not the hook the breakpoint rule forbids.
    const queries = CODE.match(/matchMedia\(([^)]*\))?[^)]*\)/gu) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query).toContain('(pointer: coarse)');
    }
    expect(CODE).not.toMatch(/matchMedia\(\s*['"`][^'"`]*width/u);
  });

  it('draws the bar below the desktop breakpoint and removes it from there up', () => {
    const sheet = css(render(bar('/parent')));
    expect(sheet).toContain('display:flex');
    expect(sheet).toMatch(new RegExp(`@media \\(min-width:${LG}px\\)[^}]*display:none`, 'u'));
  });
});

describe('what makes the bar step aside while somebody types', () => {
  it('counts a field, an area and an editable region as typing, and nothing else', () => {
    // The bar sits exactly where an on-screen keyboard comes up, so a focused
    // text field is the one state it must get out of the way for.
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    // A tab of the bar itself takes focus on every press; treating that as
    // typing would make the bar vanish the moment it was used.
    expect(isTextEntry({ tagName: 'A' })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
  });

  it('counts only the input types that bring a keyboard up', () => {
    // `input` is also a checkbox, a radio, a file picker, a slider and a colour
    // well. None of them opens a keyboard, and every one of them would
    // otherwise take the navigation away mid-tap on a phone.
    for (const type of ['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color']) {
      expect(isTextEntry({ tagName: 'INPUT', type }), type).toBe(false);
    }
    for (const type of [
      'text',
      'email',
      'password',
      'search',
      'tel',
      'url',
      'number',
      'date',
      'time',
      'datetime-local',
      'month',
      'week',
    ]) {
      expect(isTextEntry({ tagName: 'INPUT', type }), type).toBe(true);
    }
    // A missing or empty `type` is a text field: that is the HTML default.
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: '' })).toBe(true);
    // And the attribute is case-insensitive in HTML.
    expect(isTextEntry({ tagName: 'INPUT', type: 'EMAIL' })).toBe(true);
    // A `textarea` and an editable region have no `type` to qualify them.
    expect(isTextEntry({ tagName: 'TEXTAREA', type: 'checkbox' })).toBe(true);
  });

  it('steps back the moment focus is anywhere but a text entry', () => {
    // Asked of `event.target` on `focusin` and of `event.relatedTarget` on
    // `focusout`, so the state cannot stick: a field unmounted while focused —
    // a dialog closing, a list re-rendering, a route change — reports a
    // `focusout` with no related target at all, and the bar must come back.
    expect(typingAfterFocusChange({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(typingAfterFocusChange({ tagName: 'BUTTON' })).toBe(false);
    expect(typingAfterFocusChange(null)).toBe(false);
    expect(typingAfterFocusChange(undefined)).toBe(false);
  });

  it('asks the same question of both halves of a focus move', () => {
    // One rule, two readings: `target` going in, `relatedTarget` coming out. A
    // `focusout` handler that read `target` instead would only ever clear the
    // state when the thing being left was itself a field.
    expect(CODE).toContain('setTyping(typingAfterFocusChange(event.target');
    expect(CODE).toContain('setTyping(typingAfterFocusChange(event.relatedTarget');
    // `focusin` only reports a *change* of focus, so a field already focused
    // when this effect first runs — an autofocused one, on first paint — needs
    // its own read of what already has focus.
    expect(CODE).toContain('setTyping(typingAfterFocusChange(document.activeElement');
    // And a route change clears it outright, because a new screen is never
    // mid-typing.
    expect(CODE).toMatch(/setTyping\(false\);\s*\}, \[pathname\]\)/u);
  });

  it('keeps the bar where the pointer cannot be asked about at all', () => {
    // This runner has no `matchMedia`, which is the same answer a browser that
    // refuses the query gives: no on-screen keyboard is claimed, so the bar
    // stays — and the renders below prove it is drawn in exactly that
    // environment.
    expect(coarsePointer()).toBe(false);
    expect(render(bar('/parent'))).toContain('<nav');
  });
});

describe('how the bar sits on the screen', () => {
  it('is pinned to the bottom edge above the content, on paper, with one hairline', () => {
    const sheet = css(render(bar('/parent')));
    expect(sheet).toContain('position:fixed');
    expect(sheet).toContain('bottom:0');
    expect(sheet).toContain('left:0');
    expect(sheet).toContain('right:0');
    expect(sheet).toContain(`z-index:${parentTheme.zIndex.appBar}`);
    expect(sheet).toContain('border-top:1px solid');
    expect(sheet).toContain('box-shadow:none');
    expect(sheet).toContain(`min-height:${bottomNav.height}px`);
  });

  it('pads by the device’s own insets on all three edges it touches', () => {
    // Without these the bar sits under a home indicator and inside a rounded
    // corner. `viewport-fit=cover` at the root is what makes them resolve.
    const sheet = css(render(bar('/parent')));
    expect(sheet).toContain('padding-bottom:env(safe-area-inset-bottom)');
    expect(sheet).toContain('padding-left:env(safe-area-inset-left)');
    expect(sheet).toContain('padding-right:env(safe-area-inset-right)');
  });

  it('animates nothing', () => {
    expect(SOURCE).not.toContain('@keyframes');
    expect(CODE).toContain('disableRipple');
  });
});

describe('what the bar is made of', () => {
  it('is a navigation landmark with an accessible name from the surface’s copy', () => {
    const markup = render(bar('/parent'));
    expect(markup).toContain('<nav');
    expect(markup).toContain('aria-label="Parent View sections"');
    // The name is a prop, never a string inside the component: three surfaces
    // mount this and each one names itself (UX-DR31).
    expect(CODE).not.toContain('Parent View');
  });

  it('is one real link per destination, so Parent View elevation survives', () => {
    // A full load would unmount `ElevationProvider` and put the PIN back in
    // front of the next screen (AD-18).
    const markup = render(bar('/parent'));
    const links = markup.match(/<a\s[^>]*href="/gu) ?? [];
    expect(links).toHaveLength(TABS.length);
    for (const tab of TABS) {
      expect(markup).toContain(`href="${tab.href}"`);
    }
    expect(CODE).toContain('component={NextLink}');
  });

  it('shows every tab’s label, not only its icon', () => {
    const markup = render(bar('/parent'));
    for (const tab of TABS) {
      expect(markup).toContain(tab.label);
    }
  });

  it('draws each glyph decoratively, leaving the label to be announced', () => {
    expect(render(bar('/parent'))).toContain('aria-hidden="true"');
  });
});

describe('which tab reads as the current one', () => {
  it('marks exactly one tab current, and marks it for assistive technology', () => {
    const markup = render(bar('/parent/drafts'));
    const marks = markup.match(/aria-current="page"/gu) ?? [];
    expect(marks).toHaveLength(1);
    // On the Drafts link and on neither of the others.
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/parent\/drafts"/u);
  });

  it('marks it three ways at once, never by colour alone', () => {
    const markup = render(bar('/parent/drafts'));
    const sheet = css(markup);
    // The indicator is a real element, so it survives every colour being
    // stripped (UX-DR33).
    const indicators = markup.match(/data-testid="bottom-nav-indicator"/gu) ?? [];
    expect(indicators).toHaveLength(1);
    expect(sheet).toContain(`height:${bottomNav.indicator}px`);
    expect(sheet).toContain('font-weight:700');
    expect(CODE).toContain("color: current ? 'primary.main' : 'text.secondary'");
  });

  it('claims only its own screen where the tab is a surface’s landing', () => {
    const markup = render(bar('/parent/capture/review'));
    // Upload, by prefix — and not Home, which would otherwise be current on
    // every Parent View screen there is.
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/parent\/capture"/u);
    expect(markup).not.toMatch(/aria-current="page"[^>]*href="\/parent"/u);
  });
});

describe('the overflow action', () => {
  const more = MORE;

  it('is a real button with a callback and no destination of its own', () => {
    const markup = render(bar('/parent', { more }));
    expect(markup).toContain('<button');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('More');
    const links = markup.match(/<a\s[^>]*href="/gu) ?? [];
    expect(links).toHaveLength(TABS.length);
  });

  it('is absent entirely where the surface passes none', () => {
    const markup = render(bar('/parent'));
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('More');
  });

  it('is the current tab on a destination none of the tabs claims', () => {
    // Otherwise a parent reading Student Profiles would see a bar with nothing
    // marked current at all.
    const markup = render(bar('/parent/students', { more }));
    expect(markup).toMatch(/<button[^>]*aria-current="page"/u);
    const indicators = markup.match(/data-testid="bottom-nav-indicator"/gu) ?? [];
    expect(indicators).toHaveLength(1);
  });

  it('is not the current tab where a tab already claims the screen', () => {
    const markup = render(bar('/parent/drafts', { more }));
    expect(markup).not.toMatch(/<button[^>]*aria-current="page"/u);
  });
});

describe('where the bar’s figures come from', () => {
  it('meets the floor of whichever surface mounts it', () => {
    expect(css(render(bar('/parent'), parentTheme))).toContain(`min-height:${density.tapTarget}px`);
    expect(
      css(
        render(
          <BottomNav
            pathname="/student"
            items={TABS}
            ariaLabel="Student sections"
            density={comfortableDensity}
          />,
          studentTheme,
        ),
      ),
    ).toContain(`min-height:${comfortableDensity.tapTarget}px`);
    // Two different floors from one component: the figure is the surface's
    // density and never a number inside the bar.
    expect(density.tapTarget).not.toBe(comfortableDensity.tapTarget);
  });

  it('states no colour, no tap target and no size figure of its own', () => {
    expect(CODE).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/u);
    expect(CODE).not.toMatch(/\b(?!1px)\d+px\b/u);
    expect(CODE).not.toMatch(/(?<!\d)(44|48)(?!\d)/u);
    expect(CODE).not.toMatch(/(?<!\d)56(?!\d)/u);
    // The sweep has to be able to fail.
    expect('minHeight: 44').toMatch(/(?<!\d)(44|48)(?!\d)/u);
    expect(CODE).toContain('bottomNav.height');
    expect(CODE).toContain('bottomNav.indicator');
    expect(CODE).toContain('density.tapTarget');
    // No rem literal either: the label's font is a role, and a one-off size
    // here would be the bar quietly starting its own type scale.
    expect(CODE).not.toMatch(/\d*\.?\d+rem/u);
    expect(CODE).toContain('typeRoles.caption');
    // The sweep has to be able to fail.
    expect("fontSize: '0.6875rem'").toMatch(/\d*\.?\d+rem/u);
  });

  it('draws the label in the caption role DESIGN.md names for it', () => {
    const sheet = css(render(bar('/parent')));
    expect(sheet).toContain(`font-size:${typeRoles.caption.fontSize}`);
    expect(sheet).toContain(`line-height:${typeRoles.caption.lineHeight}`);
    expect(sheet).toContain(`font-weight:${typeRoles.caption.fontWeight}`);
    // Weight is the one departure, and only on the current tab.
    expect(css(render(bar('/parent/drafts')))).toContain('font-weight:700');
  });

  it('draws every glyph at the repo’s own nav size, not one of its own', () => {
    const sizes = [...CODE.matchAll(/size=\{(\d+)\}|GLYPH = (\d+)/gu)].map(
      (match) => match[1] ?? match[2],
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      // 18 and 20 are the two figures every other icon in the repo uses.
      expect(['18', '20'], `glyph size ${size}`).toContain(size);
    }
  });

  it('never lets a label wrap the bar taller than the room reserved for it', () => {
    // Five tabs at 320px, or a browser's text zoom, would otherwise push the
    // bar past `bottomNav.height` — and every `barOffsetCss` reservation on
    // every surface is that height, so a taller bar is a last row hidden
    // behind it. The short-label assertions in the shells' specs are a
    // courtesy; this is the guarantee.
    const sheet = css(render(bar('/parent', { more: MORE })));
    expect(sheet).toContain('white-space:nowrap');
    expect(sheet).toContain('overflow:hidden');
    expect(sheet).toContain('text-overflow:ellipsis');
    expect(sheet).toContain('max-width:100%');
  });
});
