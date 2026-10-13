/**
 * Where the bottom navigation bar may appear, which of its tabs is the current
 * one, and how much room every surface has to leave underneath it.
 *
 * Framework-free on purpose, exactly like `color-mode.ts`: `apps/web` runs its
 * unit tests in `environment: 'node'` with no jsdom, so a rule living inside a
 * component could only be pinned by matching its source text — which passes on
 * code that is structurally right and behaviourally wrong. Every input arrives
 * as an argument, so each row of the story's I/O matrix is drivable from a
 * plain spec.
 *
 * The one thing this module never decides is *which layout is drawn*: that is a
 * CSS breakpoint on the bar itself (UX-DR44), never a width read in JavaScript.
 */
import { bottomNav, spacing } from '@/theme/tokens';

/**
 * The PIN gate, and only the gate itself.
 *
 * `/parent/pin/change` is an ordinary Parent View destination reached from the
 * sidebar, so the exclusion is an equality and never a prefix — a prefix would
 * take the bar off a screen a parent navigated to with it.
 */
const PARENT_PIN_GATE = '/parent/pin';
/** The Admin sign-in screen: nothing is authenticated, so there is nowhere to go. */
const ADMIN_LOGIN = '/admin/login';
/** Sign-in, sign-up and everything else before an account exists. */
const AUTH = '/auth';
/** Student Mode's Attempt, and everything under it: the test-taking screen. */
const STUDENT_ATTEMPT = '/student/tests';

/**
 * A pathname with its trailing slash removed, so `/parent/pin/` is the gate —
 * or `null` where there is no pathname to read at all.
 *
 * `null` rather than a throw, because `usePathname()` is `null` outside a
 * router, which is every unit render in this workspace and every render that
 * happens before Next's own router context is in place. A rule that threw there
 * would take a working screen down over a question it could simply decline to
 * answer, so "no pathname" is treated exactly like a route nothing recognises.
 */
function normalize(pathname: Pathname): string | null {
  if (typeof pathname !== 'string' || pathname === '') return null;
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/u, '') : pathname;
}

/**
 * What a caller may hand in as the route.
 *
 * `null` and `undefined` are admitted on purpose: `usePathname()` returns `null`
 * with no router above it, and a mount that forwarded that straight in should
 * get an answer rather than an exception.
 */
export type Pathname = string | null | undefined;

/** Whether `pathname` is `prefix` or a screen underneath it. */
function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Whether this screen carries the bar.
 *
 * Asked by all three shells and by the shared snackbar, so the answer is one
 * rule rather than four opinions. The excluded screens are the ones with
 * nowhere to navigate to (the PIN gate, Admin sign-in, the auth pages) and the
 * one that must not be interrupted (an in-progress Attempt).
 */
export function bottomNavShown(pathname: Pathname): boolean {
  const path = normalize(pathname);
  // No pathname is no answer, and no answer is no bar: the same verdict an
  // excluded route gets, reached without throwing.
  if (path === null) return false;
  if (path === PARENT_PIN_GATE) return false;
  if (path === ADMIN_LOGIN) return false;
  if (within(path, AUTH)) return false;
  if (within(path, STUDENT_ATTEMPT)) return false;
  return true;
}

/**
 * How a tab claims a route: as the one screen it links to, or as that screen
 * and everything under it.
 *
 * `exact` is for a surface's own landing — `/parent` would otherwise claim
 * every Parent View screen there is. `prefix` is for a list whose rows open a
 * drill-down, so reading one draft still reads as being in Drafts.
 */
export type BottomNavMatch = 'exact' | 'prefix';

/** The two fields the matcher needs of a tab. */
export interface BottomNavTarget {
  href: string;
  match: BottomNavMatch;
}

/**
 * Whether `tab` is the screen being looked at.
 *
 * The same longest-match-or-exact idiom `ParentSidebarChrome`'s `locate()` uses
 * for the header's breadcrumb, stated once here so the bar and the sidebar
 * cannot come to different conclusions about where the reader is.
 */
export function tabIsCurrent(pathname: Pathname, tab: BottomNavTarget): boolean {
  const path = normalize(pathname);
  const href = normalize(tab.href);
  if (path === null || href === null) return false;
  return tab.match === 'exact' ? path === href : within(path, href);
}

/**
 * Whether the overflow action is the current tab: true on every route none of
 * the listed tabs claims.
 *
 * "More" is current by elimination rather than by owning a route of its own,
 * because that is what it means — the destination being read is one of the ones
 * behind it. Without this a parent reading Student Profiles would see a bar
 * with nothing marked current at all.
 */
export function moreIsCurrent(pathname: Pathname, tabs: readonly BottomNavTarget[]): boolean {
  // Guarded ahead of the elimination: with no pathname every tab answers "not
  // me", and "none of them" would otherwise read as "the overflow one".
  if (normalize(pathname) === null) return false;
  return !tabs.some((tab) => tabIsCurrent(pathname, tab));
}

/**
 * How much room a screen leaves under its last row, and how far the snackbar
 * lifts off the bottom edge: the bar's height, one gutter, and whatever the
 * device's own rounded corner or home indicator takes.
 *
 * A `calc()` string rather than a number because `env()` is only resolvable by
 * the browser — and both figures come from tokens, so nothing here can drift
 * from the bar's actual height.
 */
export const barOffsetCss = `calc(${bottomNav.height}px + ${spacing.base}px + env(safe-area-inset-bottom))`;
