'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import NextLink from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { moreIsCurrent, tabIsCurrent, type BottomNavMatch } from '@/lib/bottom-nav';
import { bottomNav, typeRoles, type DensitySet } from '@/theme/tokens';

/**
 * One tab: a destination the surface already lists, plus the short label the
 * bar shows under its icon.
 *
 * `href` and `icon` are looked up from the surface's own destination list by
 * the shell that mounts the bar — the bar is a second *view* of that list, not
 * a second navigation — so a renamed route or a moved icon cannot leave the bar
 * pointing somewhere the sidebar no longer does.
 */
export interface BottomNavItem {
  href: string;
  /** A short noun, from the surface's `copy/` module (UX-DR31). */
  label: string;
  icon: LucideIcon;
  match: BottomNavMatch;
  /**
   * Anything the equivalent link elsewhere on the surface does *besides*
   * navigate. Student Mode's way into the parent side clears the client-held
   * answers on the way out (AD-26), and a tab that skipped that would be a
   * quieter version of the same crossing.
   */
  onPress?(): void;
}

/**
 * The overflow action: everything the four tabs do not name.
 *
 * A real callback and no `href`, because it opens the surface's existing drawer
 * rather than going anywhere — and the drawer it opens is the one the hamburger
 * used to open, with the same grouped list inside it.
 */
export interface BottomNavMore {
  label: string;
  icon: LucideIcon;
  onPress(): void;
}

export interface BottomNavProps {
  /** The route being read, from the mounting client component's `usePathname`. */
  pathname: string;
  items: readonly BottomNavItem[];
  /** The landmark's accessible name, from the surface's `copy/` module. */
  ariaLabel: string;
  /** The mounting surface's density set: its tap-target floor and its gutters. */
  density: DensitySet;
  more?: BottomNavMore;
}

/**
 * Whether the device is one with an on-screen keyboard rather than a hardware
 * one.
 *
 * A pointer query and deliberately not a breakpoint: a desktop browser at
 * 1100px has a real keyboard and no on-screen one, and hiding the bar while
 * somebody typed there would make the navigation flicker. This is not a claim
 * about *which layout is drawn* — that is a CSS breakpoint below — so it does
 * not reach for the width hook UX-DR44 forbids.
 *
 * Guarded, because the unit runner has no `matchMedia` at all; a device that
 * cannot answer simply keeps the bar.
 */
export function coarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * The glyph's edge length, in px.
 *
 * 20 rather than a figure of its own: the repo draws every nav and control
 * glyph at 18 or 20, and the collapsed sidebar rail — the other icon-above-
 * nothing placement — uses 20. A one-off size here would be the bar quietly
 * starting its own convention.
 */
const GLYPH = 20;

/**
 * A tab's glyph, drawn `aria-hidden`: the label beside it is what is
 * announced, and the one `size` figure lives here rather than at each use.
 */
function renderIcon(Icon: LucideIcon) {
  return <Icon size={GLYPH} aria-hidden="true" />;
}

/**
 * The sliver of a focused element this rule reads: its tag, its `type` and
 * whether it is editable. Structural rather than `HTMLElement`, so the rule is
 * drivable from a plain object under the `node` runner — this workspace has no
 * DOM, and a rule only reachable through a real event is a rule no spec can
 * state.
 */
export interface FocusTarget {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
}

/**
 * The `input` types that bring an on-screen keyboard up.
 *
 * Named rather than inferred from the tag, because `input` is also a checkbox,
 * a radio, a file picker, a range slider and a colour well — none of which
 * opens a keyboard, and every one of which would otherwise take the bar away
 * mid-tap on a phone. A missing or empty `type` is a text field: that is what
 * the HTML default is.
 */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
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
]);

/** Whether the focused thing is something text is typed into. */
export function isTextEntry(target: FocusTarget | null | undefined): boolean {
  if (target === null || target === undefined || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = target.type;
  if (type === undefined || type === null || type === '') return true;
  return typeof type === 'string' && TEXT_INPUT_TYPES.has(type.toLowerCase());
}

/**
 * Whether the bar should be out of the way, given what now holds focus.
 *
 * One rule for both halves of the move: on `focusin` the thing that now holds
 * focus is `event.target`, and on `focusout` it is `event.relatedTarget`. Asking
 * the same question of both is what keeps the state from sticking — a field that
 * is unmounted while focused (a dialog closing, a list re-rendering, a route
 * change) reports a `focusout` with no related target at all, which this reads
 * as "nothing is being typed into" rather than ignoring.
 */
export function typingAfterFocusChange(nowFocused: FocusTarget | null | undefined): boolean {
  return isTextEntry(nowFocused);
}

/**
 * The one bottom navigation bar, mounted by Parent View, the Admin console and
 * Student Mode.
 *
 * One component rather than three, so the three surfaces cannot drift into
 * three different bars; each one hands in its own density, its own destination
 * list and its own words. Which layout is drawn — bar below `lg`, sidebar from
 * `lg` up — is a `display` breakpoint and never a width read in JavaScript, so
 * the first paint on the slowest device we run on is already the right one.
 *
 * The current tab is marked three ways at once — the surface's accent, a bold
 * weight, and a bar across the top of the tab — plus `aria-current="page"`.
 * Never colour alone (UX-DR33).
 */
export function BottomNav({ pathname, items, ariaLabel, density, more }: BottomNavProps) {
  /**
   * Whether a text field currently has focus on a touch device. The bar sits
   * where the on-screen keyboard comes up, so leaving it there would put the
   * navigation over the field being typed into.
   */
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!coarsePointer()) return undefined;
    // Focus can already be on a text field before this effect ever runs — an
    // autofocused field on first paint, for one — and `focusin` only reports a
    // *change* of focus, so that case would otherwise never set `typing` at all.
    setTyping(typingAfterFocusChange(document.activeElement as FocusTarget | null));
    function onFocusIn(event: FocusEvent) {
      setTyping(typingAfterFocusChange(event.target as FocusTarget | null));
    }
    function onFocusOut(event: FocusEvent) {
      setTyping(typingAfterFocusChange(event.relatedTarget as FocusTarget | null));
    }
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // A route change is a new screen, and a new screen is never mid-typing. The
  // belt to the focus rule's braces: a field unmounted by the navigation itself
  // may never report a `focusout` at all, and a bar that stayed hidden would
  // leave the surface below `lg` with no navigation for the rest of the session.
  useEffect(() => {
    setTyping(false);
  }, [pathname]);

  if (typing) return null;

  const moreCurrent = more !== undefined && moreIsCurrent(pathname, items);

  /** Everything a tab and the overflow action draw in common. */
  function actionSx(current: boolean) {
    return {
      position: 'relative' as const,
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: `${density.gap / 4}px`,
      minHeight: density.tapTarget,
      height: '100%',
      px: `${density.gap / 2}px`,
      color: current ? 'primary.main' : 'text.secondary',
      // DESIGN.md's `bottom-nav` block names the label `{typography.caption}`,
      // so the role is read rather than restated. Only the weight departs from
      // it, and only on the current tab, where bold is one of the three
      // carriers that say where you are.
      fontFamily: typeRoles.caption.fontFamily,
      fontSize: typeRoles.caption.fontSize,
      lineHeight: typeRoles.caption.lineHeight,
      fontWeight: current ? 700 : typeRoles.caption.fontWeight,
      textDecoration: 'none',
    };
  }

  /**
   * The label's own box.
   *
   * It never wraps: five tabs at 320px, or a browser's text zoom, would otherwise
   * push the bar past `bottomNav.height` — and every `barOffsetCss` reservation on
   * every surface is that height, so a taller bar is a last row hidden behind it.
   * An ellipsis is a legible truncation; a second line is a broken reservation.
   */
  const labelSx = {
    maxWidth: '100%',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as const;

  /** The current tab's third carrier: a bar across the top of the tab. */
  function indicator() {
    return (
      <Box
        aria-hidden="true"
        data-testid="bottom-nav-indicator"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: bottomNav.indicator,
          bgcolor: 'primary.main',
        }}
      />
    );
  }

  return (
    <Box
      component="nav"
      aria-label={ariaLabel}
      data-testid="bottom-nav"
      sx={{
        display: { xs: 'flex', lg: 'none' },
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        alignItems: 'stretch',
        minHeight: bottomNav.height,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        boxShadow: 'none',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <Box
        component="ul"
        role="list"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          alignItems: 'stretch',
          flex: 1,
          minHeight: bottomNav.height,
        }}
      >
        {items.map((item) => {
          const current = tabIsCurrent(pathname, item);
          const Icon = item.icon;
          return (
            <Box
              component="li"
              role="listitem"
              key={item.href}
              sx={{ display: 'flex', flex: 1, minWidth: 0 }}
            >
              <Button
                component={NextLink}
                href={item.href}
                variant="text"
                color="inherit"
                disableRipple
                aria-current={current ? 'page' : undefined}
                onClick={item.onPress}
                sx={actionSx(current)}
              >
                {current ? indicator() : null}
                {renderIcon(Icon)}
                <Box component="span" sx={labelSx}>
                  {item.label}
                </Box>
              </Button>
            </Box>
          );
        })}
        {more === undefined ? null : (
          <Box component="li" role="listitem" sx={{ display: 'flex', flex: 1, minWidth: 0 }}>
            <Button
              type="button"
              variant="text"
              color="inherit"
              disableRipple
              aria-current={moreCurrent ? 'page' : undefined}
              onClick={more.onPress}
              sx={actionSx(moreCurrent)}
            >
              {moreCurrent ? indicator() : null}
              {renderIcon(more.icon)}
              <Box component="span" sx={labelSx}>
                {more.label}
              </Box>
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
