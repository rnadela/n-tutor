import { describe, expect, it } from 'vitest';
import {
  INSTALL_BANNER_DISMISS_KEY,
  browserInstallBannerStorage,
  installBannerDismissed,
  installBannerMode,
  installBannerSurface,
  isIosSafari,
  isRunningInstalled,
  rememberInstallBannerDismissed,
  type InstallBannerInput,
  type InstallBannerStorage,
} from './install-banner';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/** iPadOS 13 and later, which reports itself as a Mac by default. */
const IPADOS_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_SAFARI = IPADOS_AS_MAC;
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/** A `window` that matches the given media queries and nothing else. */
function windowMatching(...queries: string[]) {
  return { matchMedia: (query: string) => ({ matches: queries.includes(query) }) };
}

const BROWSER_WINDOW = windowMatching();

function decide(overrides: Partial<InstallBannerInput> = {}) {
  return installBannerMode({
    surface: 'parent',
    hasPrompt: true,
    dismissed: false,
    windowLike: BROWSER_WINDOW,
    navigatorLike: { userAgent: ANDROID_CHROME },
    ...overrides,
  });
}

describe('which screens may carry the banner', () => {
  it('places it on Student Mode Home and on Parent View', () => {
    expect(installBannerSurface('/student')).toBe('student');
    expect(installBannerSurface('/parent')).toBe('parent');
    expect(installBannerSurface('/parent/analytics')).toBe('parent');
    expect(installBannerSurface('/parent/attempts/abc')).toBe('parent');
    // The PIN gate is Parent View's own front door, and the shell renders the
    // banner in that branch too.
    expect(installBannerSurface('/parent/pin')).toBe('parent');
  });

  it('keeps it off every Student Mode screen but Home', () => {
    // A child part-way through a test is the last person to interrupt with an
    // offer, and a results screen is the second-last.
    for (const path of [
      '/student/tests/abc',
      '/student/tests/abc/attempt',
      '/student/tests/abc/results',
    ]) {
      expect(installBannerSurface(path)).toBeNull();
    }
  });

  it('keeps it off camera capture, by route rather than by viewfinder state', () => {
    // The whole screen *is* the capture view. A state-dependent banner would
    // also come and go while a parent photographs pages.
    expect(installBannerSurface('/parent/capture')).toBeNull();
    expect(installBannerSurface('/parent/capture/review')).toBeNull();
  });

  it('keeps it off Admin, the auth screens and the front door', () => {
    for (const path of [
      '/',
      '/admin',
      '/admin/grade-levels',
      '/auth/sign-in',
      '/auth/sign-up',
      '/parenting',
      '/studentish',
    ]) {
      expect(installBannerSurface(path)).toBeNull();
    }
  });

  it('reads a trailing slash as the same screen', () => {
    expect(installBannerSurface('/student/')).toBe('student');
    expect(installBannerSurface('/parent/')).toBe('parent');
    expect(installBannerSurface('/parent/capture/')).toBeNull();
  });
});

describe('whether the app is already running installed', () => {
  it('takes the display-mode query as installed', () => {
    expect(isRunningInstalled(windowMatching('(display-mode: standalone)'))).toBe(true);
  });

  it('takes iOS’s own flag as installed, since it matches no query', () => {
    expect(isRunningInstalled({ navigator: { standalone: true } })).toBe(true);
    // And only when it is actually true — the property exists on iOS Safari in
    // a browser tab as well.
    expect(isRunningInstalled({ navigator: { standalone: false }, ...windowMatching() })).toBe(
      false,
    );
  });

  it('says no on a plain browser tab', () => {
    expect(isRunningInstalled(BROWSER_WINDOW)).toBe(false);
  });

  it('throws nothing where matchMedia is missing, broken or absent', () => {
    const asWindow = (value: unknown) => value as Parameters<typeof isRunningInstalled>[0];
    expect(isRunningInstalled({})).toBe(false);
    expect(isRunningInstalled(asWindow({ matchMedia: null }))).toBe(false);
    expect(isRunningInstalled(asWindow({ matchMedia: 'nope' }))).toBe(false);
    expect(
      isRunningInstalled({
        matchMedia: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
    // A platform that answers with nothing at all.
    expect(isRunningInstalled({ matchMedia: () => null })).toBe(false);
  });
});

describe('which browsers are iOS Safari', () => {
  it('recognises iPhone and iPad Safari', () => {
    expect(isIosSafari({ userAgent: IPHONE_SAFARI })).toBe(true);
    expect(isIosSafari({ userAgent: IPAD_SAFARI })).toBe(true);
  });

  it('recognises an iPad that reports itself as a Mac', () => {
    // iPadOS 13 and later ships "desktop site" as the default. Touch points
    // are the only thing separating it from a real Mac.
    expect(isIosSafari({ userAgent: IPADOS_AS_MAC, maxTouchPoints: 5 })).toBe(true);
  });

  it('is not a desktop Mac, which has no Add to Home Screen', () => {
    expect(isIosSafari({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
    expect(isIosSafari({ userAgent: MAC_SAFARI })).toBe(false);
    // A trackpad is not a touchscreen: one reported point is still not an iPad.
    expect(isIosSafari({ userAgent: MAC_SAFARI, maxTouchPoints: 1 })).toBe(false);
  });

  it('rejects the iOS browsers that are not Safari', () => {
    // Every one of them carries `Safari` in its user agent and none of them can
    // add a page to the home screen, so the Share steps would name a menu that
    // is not there.
    const inApp = [
      'CriOS/124.0',
      'FxiOS/124.0',
      'EdgiOS/124.0',
      'OPiOS/16.0',
      'OPT/4.0',
      'DuckDuckGo/7',
      'GSA/300.0',
      '[FBAN/FBIOS;FBDV/iPhone15]',
      '[FBAV/450.0]',
      'Instagram 300.0',
      'Line/14.0',
      'YaBrowser/24.4',
    ];
    for (const token of inApp) {
      expect(isIosSafari({ userAgent: `${IPHONE_SAFARI} ${token}` }), token).toBe(false);
    }
  });

  it('rejects the in-app webviews a family actually arrives in', () => {
    // A link from a message or a feed opens in one of these far more often
    // than in Safari itself, and none of them has a Share → Add to Home
    // Screen: without these names each one would get steps naming a menu that
    // is not on their screen.
    const webviews = [
      'MicroMessenger/8.0.49(0x18003128)', // WeChat
      'WhatsApp/2.24',
      'Snapchat/12.80.0.32',
      'musical_ly_34.5.0 JsSdk/2.0', // TikTok
      'BytedanceWebview/d8a21c6',
      'Twitter for iPhone',
      'Pinterest/11.0',
      '[FBAN/FBIOS;FBDV/iPhone15]',
      'FBIOS',
    ];
    for (const token of webviews) {
      expect(isIosSafari({ userAgent: `${IPHONE_SAFARI} ${token}` }), token).toBe(false);
    }
    // And on an iPad in the same webviews, where the install path is just as
    // absent and the screen is big enough that a banner would be unmissable.
    for (const token of webviews) {
      expect(isIosSafari({ userAgent: `${IPAD_SAFARI} ${token}` }), token).toBe(false);
    }
  });

  it('is nothing at all on Android, or with no user agent to read', () => {
    expect(isIosSafari({ userAgent: ANDROID_CHROME })).toBe(false);
    expect(isIosSafari({})).toBe(false);
    expect(isIosSafari({ userAgent: '' })).toBe(false);
  });
});

describe('the whole visibility rule', () => {
  it('offers the prompt where the browser deferred one', () => {
    expect(decide({ surface: 'parent' })).toBe('prompt');
    expect(decide({ surface: 'student' })).toBe('prompt');
  });

  it('offers the iOS steps where no prompt will ever fire', () => {
    expect(decide({ hasPrompt: false, navigatorLike: { userAgent: IPHONE_SAFARI } })).toBe('ios');
  });

  it('prefers a one-tap install to a paragraph of instructions', () => {
    // Should both somehow hold, the prompt wins.
    expect(decide({ hasPrompt: true, navigatorLike: { userAgent: IPHONE_SAFARI } })).toBe('prompt');
  });

  it('shows nothing on a browser with no install path', () => {
    // No dead-end instructions: a browser that cannot install the app is told
    // nothing rather than told to look for a menu it does not have.
    expect(decide({ hasPrompt: false })).toBeNull();
    expect(decide({ hasPrompt: false, navigatorLike: { userAgent: MAC_SAFARI } })).toBeNull();
    expect(decide({ hasPrompt: false, navigatorLike: null })).toBeNull();
  });

  it('shows nothing on a screen the rule excludes', () => {
    expect(decide({ surface: null })).toBeNull();
    expect(decide({ surface: installBannerSurface('/parent/capture') })).toBeNull();
    expect(decide({ surface: installBannerSurface('/student/tests/abc') })).toBeNull();
  });

  it('shows nothing when the app is already running installed', () => {
    expect(decide({ windowLike: windowMatching('(display-mode: standalone)') })).toBeNull();
    expect(decide({ windowLike: { navigator: { standalone: true } } })).toBeNull();
    // Including on the iOS path, where the steps would be instructions to
    // install an app the reader is already inside.
    expect(
      decide({
        hasPrompt: false,
        navigatorLike: { userAgent: IPHONE_SAFARI },
        windowLike: { navigator: { standalone: true } },
      }),
    ).toBeNull();
  });

  it('shows nothing once the session has dismissed it', () => {
    expect(decide({ dismissed: true })).toBeNull();
    expect(
      decide({ dismissed: true, hasPrompt: false, navigatorLike: { userAgent: IPHONE_SAFARI } }),
    ).toBeNull();
  });

  it('shows nothing where there is no window — the server, and the first render', () => {
    // The first client render has read no `sessionStorage` and no user agent
    // yet, so rendering nothing is the one answer that cannot disagree with the
    // markup the server sent.
    expect(decide({ windowLike: null })).toBeNull();
  });
});

describe('where the dismissal is remembered', () => {
  function storageWith(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      storage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
      } satisfies InstallBannerStorage,
    };
  }

  it('namespaces its key, and never under the attempt prefix', () => {
    // `clearAll` and `retainOnly` sweep `ntr.attempt.`, and a sweep is entitled
    // to delete anything it finds there.
    expect(INSTALL_BANNER_DISMISS_KEY).toMatch(/^n-tutor:/u);
    expect(INSTALL_BANNER_DISMISS_KEY).not.toContain('ntr.attempt.');
  });

  it('round-trips a dismissal through one key', () => {
    const { map, storage } = storageWith();
    expect(installBannerDismissed(storage)).toBe(false);
    rememberInstallBannerDismissed(storage);
    expect([...map.keys()]).toEqual([INSTALL_BANNER_DISMISS_KEY]);
    expect(installBannerDismissed(storage)).toBe(true);
  });

  it('reads anything else under the key as not dismissed', () => {
    const { storage } = storageWith({ [INSTALL_BANNER_DISMISS_KEY]: 'maybe' });
    expect(installBannerDismissed(storage)).toBe(false);
  });

  it('treats an absent store as not dismissed, and writing to it as a non-event', () => {
    expect(installBannerDismissed(null)).toBe(false);
    expect(() => rememberInstallBannerDismissed(null)).not.toThrow();
  });

  it('survives a store whose getter and setter throw', () => {
    // A private-mode or blocked store throws on access, and a banner is never a
    // reason a screen fails to render.
    const throwing: InstallBannerStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(installBannerDismissed(throwing)).toBe(false);
    expect(() => rememberInstallBannerDismissed(throwing)).not.toThrow();
  });

  it('has no window to read in a node render, and says so without throwing', () => {
    expect(browserInstallBannerStorage()).toBeNull();
  });
});
