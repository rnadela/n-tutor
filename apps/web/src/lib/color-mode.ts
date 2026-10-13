/**
 * Which colour scheme is in effect, what pressing the switch would do, where
 * the switch may appear, and what colour the browser chrome should carry.
 *
 * Framework-free on purpose, like `install-banner.ts`. `apps/web` runs its unit
 * tests in `environment: 'node'` with no jsdom, so a rule living inside a
 * component could only be pinned by matching its source text — which passes on
 * code that is structurally right and behaviourally wrong. Every input arrives
 * as an argument, so each row of the story's I/O matrix is drivable from a plain
 * spec with a hand-written stub.
 *
 * The one thing this module never decides is *where the choice is stored*: MUI
 * owns that, under its own default keys, and the whole point of Story 1.10 is
 * that nothing here configures them.
 */
import { colorTokens } from '@/theme/tokens';

/**
 * The two options, and the only two. There is no "System": once a family has
 * chosen, the device preference stops deciding, and a third state that handed
 * the decision back would be a way to un-choose that UX-DR45 does not offer.
 */
export type ColorSchemeChoice = 'light' | 'dark';

/**
 * MUI's `mode`, restated so this module does not import a framework for a
 * union. `'system'` means "follow the device"; `undefined` means "not known
 * yet", which is every server render and the hydration render after it.
 */
export type ColorModeSetting = ColorSchemeChoice | 'system' | undefined;

/** Student Mode's Attempt, and everything under it: the test-taking screen. */
const STUDENT_ATTEMPT = '/student/tests';
/**
 * Camera capture, excluded by route rather than by viewfinder state — the whole
 * screen *is* the capture view, and it inherits Parent View's header, so
 * without this the switch would sit over a live camera.
 */
const PARENT_CAPTURE = '/parent/capture';

/** A path with its trailing slash removed, so `/parent/capture/` is capture. */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/u, '') : pathname;
}

/** Whether `pathname` is `prefix` or a screen underneath it. */
function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The scheme a person is actually looking at, or `null` while that is unknown.
 *
 * `null` rather than a guess, because a guess is wrong half the time and the
 * switch's whole label is a claim about what the next press will do. `mode` is
 * `undefined` through the server render and the hydration render, and
 * `systemMode` is `undefined` until the media query has been read — so both
 * unresolved rows of the matrix land here and the caller draws a placeholder.
 */
export function effectiveScheme(
  mode: ColorModeSetting,
  systemMode: ColorSchemeChoice | undefined,
): ColorSchemeChoice | null {
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'system') return systemMode ?? null;
  return null;
}

/** The scheme a press offers: always the other one. */
export function nextScheme(scheme: ColorSchemeChoice): ColorSchemeChoice {
  return scheme === 'light' ? 'dark' : 'light';
}

/**
 * Whether this screen carries the switch.
 *
 * **`ParentSidebarChrome` is the only mount that consults this**, and capture is
 * the only exclusion it needs: the capture screen inherits Parent View's own
 * header, so without this gate the switch would sit over a live viewfinder. The
 * other three mounts — the Admin header, the auth header and Student home — are
 * unconditional, because no excluded screen renders any of them.
 *
 * The Attempt is named here all the same, for two reasons and neither of them a
 * guard on today's code: it is the second screen the story excludes, so the
 * rule is stated in one place rather than half here and half in prose; and a
 * later story that gives the Attempt chrome has a predicate to ask instead of a
 * decision to re-derive. Nothing calls it with an Attempt path today, so the
 * unit spec is what holds that branch honest.
 */
export function colorModeSwitchShown(pathname: string): boolean {
  const path = normalize(pathname);
  if (within(path, PARENT_CAPTURE)) return false;
  if (within(path, STUDENT_ATTEMPT)) return false;
  return true;
}

/**
 * The colour the browser paints its own chrome for a scheme — the icon's ink,
 * from the token, so the installed window's chrome matches the icon that was
 * tapped.
 *
 * Note that `brandInk.light` and `brandInk.dark` are the same value today, and
 * deliberately so (`tokens.ts`): this function exists so the *source* of the
 * figure is one place, not because the two differ.
 */
export function themeColorFor(scheme: ColorSchemeChoice): string {
  return colorTokens.brandInk[scheme];
}

/** The one attribute writer `syncThemeColor` needs of an element. */
export interface ThemeColorMeta {
  setAttribute(name: string, value: string): void;
}

/**
 * The sliver of `document` the sync reads: one query, nothing else.
 *
 * Narrow so the writer is drivable from a stub under the `node` runner, and so
 * this module keeps naming no global.
 */
export interface ThemeColorDocument {
  querySelectorAll(selector: string): Iterable<ThemeColorMeta>;
}

/** The tags whose `content` follows the chosen scheme. */
export const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

/**
 * Points every `theme-color` meta at the chosen scheme's ink.
 *
 * *Every* one, rather than appending a media-less tag of our own: a browser
 * applies the first `theme-color` whose `media` matches, and the media-scoped
 * pair comes from the server `viewport` export at the top of `<head>`, so a tag
 * added later would never win. Writing the same value into both makes whichever
 * one matches correct.
 *
 * A document with no such meta is a no-op. Nothing is reported either way: the
 * title bar's tint is not worth taking a working screen down for.
 */
export function syncThemeColor(docLike: ThemeColorDocument, scheme: ColorSchemeChoice): void {
  const content = themeColorFor(scheme);
  for (const meta of docLike.querySelectorAll(THEME_COLOR_SELECTOR)) {
    meta.setAttribute('content', content);
  }
}
