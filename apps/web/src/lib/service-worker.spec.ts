import { describe, expect, it, vi } from 'vitest';
import {
  registerServiceWorker,
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  type ServiceWorkerCapableNavigator,
} from './service-worker';

function navigatorWith(register: (url: string, options?: { scope?: string }) => Promise<unknown>) {
  return { serviceWorker: { register } } satisfies ServiceWorkerCapableNavigator;
}

describe('registerServiceWorker', () => {
  it('registers /sw.js at the root scope on a supporting browser', async () => {
    const register = vi.fn(() => Promise.resolve({}));

    registerServiceWorker(navigatorWith(register));

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE });
    // The scope is the whole app, so following a link inside n-tutor stays in
    // the installed window.
    expect(SERVICE_WORKER_SCOPE).toBe('/');
    expect(SERVICE_WORKER_URL).toBe('/sw.js');
  });

  it('does nothing, and throws nothing, where there is no service worker', () => {
    // The real shape of an unsupporting browser: no such property at all.
    expect(() => registerServiceWorker({})).not.toThrow();
  });

  it('treats a null container, or one that cannot register, as no support', () => {
    // Neither shape is what the type says, and both are what browsers and
    // polyfills actually hand over. Reaching `register` on either is a
    // TypeError, so the guard has to be falsiness plus a callable check rather
    // than `=== undefined`.
    const asNavigator = (value: unknown) => value as ServiceWorkerCapableNavigator;

    expect(() => registerServiceWorker(asNavigator({ serviceWorker: null }))).not.toThrow();
    expect(() => registerServiceWorker(asNavigator({ serviceWorker: {} }))).not.toThrow();
    expect(() =>
      registerServiceWorker(asNavigator({ serviceWorker: { register: 'nope' } })),
    ).not.toThrow();
  });

  it('swallows a rejected registration', async () => {
    const register = vi.fn(() => Promise.reject(new Error('insecure context')));

    expect(() => registerServiceWorker(navigatorWith(register))).not.toThrow();

    // An unhandled rejection would surface as a console error on the person's
    // page — and in a browser that reports them, as a crash report — for a
    // failure that costs them nothing. Letting the microtask queue drain here
    // is what proves the rejection was attached to, not merely ignored.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('swallows a registration that throws synchronously', () => {
    const register = vi.fn(() => {
      throw new Error('not allowed');
    });

    expect(() => registerServiceWorker(navigatorWith(register))).not.toThrow();
  });

  it('registers once per call and never retries', () => {
    const register = vi.fn(() => Promise.resolve({}));
    const navigatorLike = navigatorWith(register);

    registerServiceWorker(navigatorLike);

    // No retry loop, no interval: registration is best-effort and a second
    // attempt would buy nothing the browser has not already decided.
    expect(register).toHaveBeenCalledTimes(1);
  });
});
