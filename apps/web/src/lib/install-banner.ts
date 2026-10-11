/**
 * When the install banner may render, and nothing about how it looks.
 *
 * Framework-free on purpose, like `service-worker.ts`. `apps/web` runs its unit
 * tests in `environment: 'node'` with no jsdom, so a rule living inside a
 * component could only be pinned by matching its source text — which passes on
 * code that is structurally right and behaviourally wrong. Every input arrives
 * as an argument, so each row of the story's I/O matrix is drivable from a plain
 * spec with a hand-written stub.
 *
 * The one thing this module never decides is whether a browser *has* an install
 * path: that answer is the deferred `beforeinstallprompt` event, which lives in
 * `install-prompt.ts` because it fires once, early, outside any component's
 * lifetime.
 */

/**
 * Where the session's dismissal is remembered.
 *
 * Namespaced like `n-tutor:parent-sidebar-collapsed`, and deliberately **not**
 * under `ntr.attempt.` — `clearAll` and `retainOnly` sweep that prefix, and a
 * sweep is entitled to delete anything it finds there.
 */
export const INSTALL_BANNER_DISMISS_KEY = 'n-tutor:install-banner-dismissed';

/** The value written under the key. Presence is the whole signal. */
const DISMISSED = '1';

/** The two surfaces the banner is mounted on, and the only two. */
export type InstallBannerSurface = 'parent' | 'student';

/**
 * What the banner offers: a one-tap install where the browser deferred a
 * prompt, the Share → Add to Home Screen steps on iOS/iPadOS Safari, and
 * `null` — nothing at all — everywhere else.
 */
export type InstallBannerMode = 'prompt' | 'ios';

/** Student Mode's Home, and the only Student Mode screen the banner is on. */
const STUDENT_HOME = '/student';
/** Parent View's root, and the prefix every Parent View screen shares. */
const PARENT_ROOT = '/parent';
/**
 * Camera capture, excluded by route rather than by viewfinder state: the whole
 * screen *is* the capture view, and a state-dependent banner would appear and
 * disappear while a parent photographs pages.
 */
const PARENT_CAPTURE = '/parent/capture';

/** A path with its trailing slash removed, so `/student/` is Student Home. */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/u, '') : pathname;
}

/** Whether `pathname` is `prefix` or a screen underneath it. */
function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Which surface's banner this screen may carry, if any.
 *
 * The single source of the placement rule, read by both mount points: Parent
 * View's shell asks it rather than re-deciding, so `/parent/capture` is excluded
 * once instead of twice. Admin and the auth screens fall through to `null`
 * because they match neither prefix — a family is not installing the app from a
 * sign-in form, and an operator is not installing it at all.
 */
export function installBannerSurface(pathname: string): InstallBannerSurface | null {
  const path = normalize(pathname);
  // Student Home exactly. Take Test and Results are deliberately out: a child
  // mid-test is the last person to interrupt with an offer.
  if (path === STUDENT_HOME) return 'student';
  if (within(path, PARENT_CAPTURE)) return null;
  if (within(path, PARENT_ROOT)) return 'parent';
  return null;
}

/**
 * The sliver of `window` the installed-check needs.
 *
 * Both members are optional because that is the real shape: `matchMedia` is
 * absent in a non-browser render, and `navigator.standalone` exists only on
 * iOS/iPadOS Safari.
 */
export interface InstallBannerWindow {
  matchMedia?: (query: string) => { matches: boolean } | null;
  /**
   * `standalone` is iOS/iPadOS Safari's own non-standard flag, which `lib.dom`
   * does not declare — and `userAgent` is named beside it so this stays a type
   * the real `Navigator` satisfies: a shape whose every member is unknown to
   * `Navigator` has "no properties in common" with it and would not assign.
   */
  navigator?: { standalone?: boolean; userAgent?: string };
}

/** The media query a browser matches inside an installed window. */
export const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Whether the app is already running installed.
 *
 * Two signals because no one browser answers both: Chromium and Android match
 * the display-mode query, while iOS/iPadOS Safari matches nothing and sets
 * `navigator.standalone` instead. Either one is enough — an offer to install
 * the app you are reading it inside is the clearest possible sign nobody is
 * minding the banner.
 *
 * Wrapped, and falsy-plus-callable guarded for `service-worker.ts`'s reason: a
 * `matchMedia` that is `null` or not a function is a TypeError away, and a
 * thrown TypeError would take a working screen down over a banner.
 */
export function isRunningInstalled(windowLike: InstallBannerWindow): boolean {
  try {
    if (windowLike.navigator?.standalone === true) return true;
    const matchMedia = windowLike.matchMedia;
    if (typeof matchMedia !== 'function') return false;
    return matchMedia(STANDALONE_QUERY)?.matches === true;
  } catch {
    // An unparseable query or a blocked `matchMedia` means "we cannot tell",
    // and the honest reading of that is "not installed": the worst case is a
    // banner shown once inside an installed window, not a broken screen.
    return false;
  }
}

/** The sliver of `navigator` the iOS check reads. */
export interface InstallBannerNavigator {
  userAgent?: string;
  /**
   * The only thing separating an iPad in its default "desktop site" mode from
   * a real Mac. `platform` is deliberately absent: it is deprecated, it lies
   * on exactly the device this check is about, and nothing here reads it.
   */
  maxTouchPoints?: number;
}

/**
 * The browsers that run on iOS but are not Safari.
 *
 * Every one of them is WebKit underneath and none of them can add a page to the
 * home screen, so Safari's Share steps would be instructions to a menu that is
 * not there — the dead end the story rules out.
 */
const NON_SAFARI_IOS = [
  // Third-party browsers, which have their own menus and no Add to Home Screen.
  'CriOS', // Chrome
  'FxiOS', // Firefox
  'EdgiOS', // Edge
  'OPiOS', // Opera
  'OPT/', // Opera Touch
  'DuckDuckGo',
  'YaBrowser', // Yandex
  // In-app webviews. A family reaching a link from a message or a feed arrives
  // in one of these far more often than in Safari itself, and every one of them
  // carries `Safari` in its user agent while offering no way to install
  // anything — so without these names they would each get a set of steps
  // naming a Share menu that is not on their screen.
  'GSA/', // the Google app
  'FBAN', // Facebook
  'FBAV',
  'FBIOS',
  'Instagram',
  'MicroMessenger', // WeChat
  'WhatsApp',
  'Snapchat',
  'musical_ly', // TikTok
  'BytedanceWebview', // TikTok's newer webview
  'Twitter',
  'Pinterest',
  'Line/',
] as const;

/**
 * Whether this is iOS/iPadOS Safari — the one family that has an install path
 * and never fires `beforeinstallprompt`.
 *
 * Three facts make the check what it is. An iPad on iPadOS 13 and later reports
 * itself as `Macintosh`, and is told apart from a real Mac only by having touch
 * points. Every iOS browser carries `Safari` somewhere in its user agent, so
 * presence of the word proves nothing on its own and the in-app and third-party
 * tokens have to be rejected by name. And a desktop Mac is excluded outright:
 * Safari on macOS has no Add to Home Screen.
 */
export function isIosSafari(navigatorLike: InstallBannerNavigator): boolean {
  const userAgent = navigatorLike.userAgent ?? '';
  if (userAgent === '') return false;

  const touchPoints = navigatorLike.maxTouchPoints ?? 0;
  const isIos =
    /iPhone|iPad|iPod/u.test(userAgent) ||
    // iPadOS in its default "desktop site" mode. A trackpad Mac reports 0.
    (/Macintosh/u.test(userAgent) && touchPoints > 1);
  if (!isIos) return false;

  if (!userAgent.includes('Safari')) return false;
  return !NON_SAFARI_IOS.some((token) => userAgent.includes(token));
}

/** Everything the banner's visibility turns on, all of it passed in. */
export interface InstallBannerInput {
  /** What `installBannerSurface` said about the screen, or `null`. */
  surface: InstallBannerSurface | null;
  /** Whether `install-prompt.ts` is holding a deferred prompt. */
  hasPrompt: boolean;
  /** Whether this session has already dismissed the banner. */
  dismissed: boolean;
  /**
   * The browser's `window` and `navigator`, or `null` where there is not one —
   * a server render, and the client's first render, which must agree with it.
   */
  windowLike: InstallBannerWindow | null;
  navigatorLike: InstallBannerNavigator | null;
}

/**
 * The whole visibility rule, in the order the reasons matter.
 *
 * Dismissal and being installed come before either install path, because both
 * are "this person is done with the offer" and neither is worth re-deriving per
 * browser family. The prompt beats the iOS steps where both somehow hold: a
 * one-tap install is a better answer than a paragraph of instructions.
 */
export function installBannerMode(input: InstallBannerInput): InstallBannerMode | null {
  const { surface, hasPrompt, dismissed, windowLike, navigatorLike } = input;
  if (surface === null) return null;
  // No window means no browser to install into — and, on the client's first
  // render, no `sessionStorage` read yet either. Rendering nothing is the one
  // answer that cannot disagree with the server's markup.
  if (windowLike === null) return null;
  if (dismissed) return null;
  if (isRunningInstalled(windowLike)) return null;
  if (hasPrompt) return 'prompt';
  if (navigatorLike !== null && isIosSafari(navigatorLike)) return 'ios';
  // A browser with no install path gets no instructions: a dead end is worse
  // than silence.
  return null;
}

/** The slice of `Storage` the dismissal uses, and no more. */
export interface InstallBannerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * This browser's `sessionStorage`, or `null` where there is not one.
 *
 * The single place `window` is named, so the rules above stay functions of a
 * storage-like. Merely *touching* the property throws in some blocked-site-data
 * configurations, which is why even the lookup is wrapped — `attempt-store.ts`
 * found the same thing.
 *
 * `sessionStorage` and nothing stronger: the dismissal is meant to last the
 * browser session and return in a new one, which is this store's own lifetime.
 * No clock, no key to expire, and nothing about a family's device kept past the
 * tab.
 */
export function browserInstallBannerStorage(): InstallBannerStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this session dismissed the banner.
 *
 * A store that is absent, blocked or throwing reads as "not dismissed": the
 * cost of being wrong is one banner the person dismisses again, and the
 * alternative — a screen that fails to render because a getter threw — is not a
 * trade worth making.
 */
export function installBannerDismissed(storage: InstallBannerStorage | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(INSTALL_BANNER_DISMISS_KEY) === DISMISSED;
  } catch {
    return false;
  }
}

/**
 * Remembers the dismissal, or does not.
 *
 * Nothing is reported either way. A failed write means the banner comes back on
 * the next page load, which is the same outcome as a session that never had a
 * store — and the component holds its own dismissed state for the page's life
 * regardless, so the tap always does something.
 */
export function rememberInstallBannerDismissed(storage: InstallBannerStorage | null): void {
  if (storage === null) return;
  try {
    storage.setItem(INSTALL_BANNER_DISMISS_KEY, DISMISSED);
  } catch {
    // Nothing to persist to; the dismissal just won't survive a reload.
  }
}
