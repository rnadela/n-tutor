import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallPromptEventLike, InstallPromptWindow } from './install-prompt';

/**
 * The store is module-level — it has to be, since the event it holds fires once
 * per page load and outlives every component. So each test gets its own copy of
 * the module rather than a reset hook the product would have to carry.
 */
type Store = typeof import('./install-prompt');

let store: Store;

beforeEach(async () => {
  vi.resetModules();
  store = await import('./install-prompt');
});

/** A `window` that records its listeners and can fire them on demand. */
function fakeWindow() {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const windowLike: InstallPromptWindow = {
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
  };
  return {
    windowLike,
    countFor: (type: string) => (listeners.get(type) ?? []).length,
    fire(type: string, event: unknown = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function promptEvent(
  prompt: InstallPromptEventLike['prompt'] = async () => ({
    outcome: 'accepted',
  }),
) {
  const preventDefault = vi.fn();
  return { event: { preventDefault, prompt } satisfies InstallPromptEventLike, preventDefault };
}

describe('catching the browser’s install offer', () => {
  it('prevents the browser’s own infobar and holds the event', () => {
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    const { event, preventDefault } = promptEvent();

    page.fire(store.BEFORE_INSTALL_PROMPT, event);

    // Without `preventDefault` the browser shows its own mini-infobar beside
    // the banner: two offers to install the same app, one of them unplaceable.
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.deferredInstallPrompt()).toBe(event);
  });

  it('holds nothing before the event fires', () => {
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    expect(store.deferredInstallPrompt()).toBeNull();
  });

  it('notifies every subscriber when the offer arrives', () => {
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    const seen = vi.fn();
    const unsubscribe = store.subscribeInstallPrompt(seen);

    page.fire(store.BEFORE_INSTALL_PROMPT, promptEvent().event);
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    page.fire(store.APP_INSTALLED);
    // Gone means gone: a banner that unmounted must not be woken up.
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('adds no second listener for the same window', () => {
    // React Strict Mode runs mount effects twice in development, and unlike a
    // service-worker registration a second `addEventListener` is not a no-op.
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    store.captureInstallPrompt(page.windowLike);

    expect(page.countFor(store.BEFORE_INSTALL_PROMPT)).toBe(1);
    expect(page.countFor(store.APP_INSTALLED)).toBe(1);
  });

  it('ignores anything fired at it that is not an install prompt', () => {
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);

    for (const notAnEvent of [null, undefined, 'beforeinstallprompt', {}, { prompt: 1 }]) {
      expect(() => page.fire(store.BEFORE_INSTALL_PROMPT, notAnEvent)).not.toThrow();
      expect(store.deferredInstallPrompt()).toBeNull();
    }
  });

  it('throws nothing at a window that cannot listen', () => {
    const asWindow = (value: unknown) => value as InstallPromptWindow;
    expect(() => store.captureInstallPrompt(asWindow({}))).not.toThrow();
  });

  it('drops the held offer once the app is installed, however that happened', () => {
    // This is what makes "it does not come back" true even when the person
    // installs from the browser's own menu rather than from the banner.
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    page.fire(store.BEFORE_INSTALL_PROMPT, promptEvent().event);
    expect(store.deferredInstallPrompt()).not.toBeNull();

    page.fire(store.APP_INSTALLED);
    expect(store.deferredInstallPrompt()).toBeNull();
  });

  it('keeps the offer when a platform refuses to be prevented', () => {
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    const event: InstallPromptEventLike = {
      preventDefault: () => {
        throw new Error('nope');
      },
      prompt: async () => ({ outcome: 'accepted' }),
    };

    expect(() => page.fire(store.BEFORE_INSTALL_PROMPT, event)).not.toThrow();
    expect(store.deferredInstallPrompt()).toBe(event);
  });
});

describe('showing the browser’s install dialog', () => {
  async function withOffer(prompt?: InstallPromptEventLike['prompt']) {
    const page = fakeWindow();
    store.captureInstallPrompt(page.windowLike);
    const { event } = promptEvent(prompt);
    page.fire(store.BEFORE_INSTALL_PROMPT, event);
    return { page, event };
  }

  it('says the install was accepted, and drops the offer so it cannot return', async () => {
    const seen = vi.fn();
    store.subscribeInstallPrompt(seen);
    await withOffer();

    await expect(store.promptToInstall()).resolves.toBe(true);
    expect(store.deferredInstallPrompt()).toBeNull();
    // Once for the arrival, once for the drop.
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('keeps the offer when the person cancels, so the action stays usable', async () => {
    const { event } = await withOffer(async () => ({ outcome: 'dismissed' }));

    await expect(store.promptToInstall()).resolves.toBe(false);
    expect(store.deferredInstallPrompt()).toBe(event);
    await expect(store.promptToInstall()).resolves.toBe(false);
  });

  it('swallows a rejection and a synchronous throw alike', async () => {
    const rejecting = await withOffer(() => Promise.reject(new Error('already prompted')));
    await expect(store.promptToInstall()).resolves.toBe(false);
    expect(store.deferredInstallPrompt()).toBe(rejecting.event);

    vi.resetModules();
    store = await import('./install-prompt');
    const throwing = await withOffer(() => {
      throw new Error('boom');
    });
    await expect(store.promptToInstall()).resolves.toBe(false);
    expect(store.deferredInstallPrompt()).toBe(throwing.event);
  });

  it('treats a platform that answers with nothing as a refusal', async () => {
    await withOffer(async () => undefined);
    await expect(store.promptToInstall()).resolves.toBe(false);
  });

  it('is a no-op with no offer held', async () => {
    await expect(store.promptToInstall()).resolves.toBe(false);
  });
});
